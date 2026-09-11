import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { appendFile, mkdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { promisify } from "node:util";

import { applicationID, applicationName } from "./identity";

export interface IdentityManifest {
  schemaVersion: number;
  productUUID: string;
  applicationID: string;
  applicationName: string;
  backendProcessName: string;
  cliProcessName: string;
}

export interface SignatureEvidence {
  scheme: "codesign" | "authenticode" | "none";
  status: "valid" | "ad-hoc" | "unsigned" | "invalid" | "unavailable" | "not-applicable";
  identifier?: string;
  teamIdentifier?: string;
  authorities?: string[];
  publisher?: string;
  certificateThumbprint?: string;
  detail?: string;
}

export interface IdentityArtifact {
  component: "desktop" | "backend" | "cli" | "application-code";
  componentID: string;
  fileName: string;
  path: string;
  resolvedPath?: string;
  sha256?: string;
  sizeBytes?: number;
  pid?: number;
  error?: string;
  signature: SignatureEvidence;
}

export interface ApplicationIdentityReport {
  schemaVersion: 1;
  event: "validex.identity";
  recordedAt: string;
  sessionID: string;
  applicationID: string;
  applicationName: string;
  productUUID: string | null;
  version: string;
  revision: string;
  mode: "development" | "packaged";
  platform: NodeJS.Platform;
  architecture: string;
  pid: number;
  parentPID: number;
  electronVersion: string;
  chromiumVersion: string;
  logDirectory: string;
  artifacts: IdentityArtifact[];
  diagnosticErrors: string[];
}

const execute = promisify(execFile);

function errorCode(error: unknown): string {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return typeof code === "string" ? code : "unavailable";
}

export function parseIdentityManifest(value: unknown): IdentityManifest {
  if (!value || typeof value !== "object") throw new Error("Invalid identity manifest");
  const manifest = value as Record<string, unknown>;
  if (manifest.schemaVersion !== 1 || manifest.applicationID !== applicationID ||
      manifest.applicationName !== applicationName || manifest.backendProcessName !== "validex-backend" ||
      manifest.cliProcessName !== "validex-cli" || typeof manifest.productUUID !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(manifest.productUUID)) {
    throw new Error("Invalid identity manifest");
  }
  return manifest as unknown as IdentityManifest;
}

export function parseMacSignature(details: string, verified: boolean): SignatureEvidence {
  const lines = details.split(/\r?\n/);
  const field = (name: string) => lines.find((line) => line.startsWith(`${name}=`))?.slice(name.length + 1);
  const authorities = lines.filter((line) => line.startsWith("Authority=")).map((line) => line.slice(10));
  const team = field("TeamIdentifier");
  const identifier = field("Identifier");
  return {
    scheme: "codesign",
    status: !verified ? "invalid" : field("Signature") === "adhoc" ? "ad-hoc" : "valid",
    ...(identifier ? { identifier } : {}),
    ...(team && team !== "not set" ? { teamIdentifier: team } : {}),
    ...(authorities.length ? { authorities, publisher: authorities[0] } : {}),
    detail: "Executable signature integrity; notarization and organizational approval are not assessed.",
  };
}

export function parseWindowsSignature(value: unknown): SignatureEvidence {
  if (!value || typeof value !== "object") return { scheme: "authenticode", status: "unavailable" };
  const signature = value as Record<string, unknown>;
  const status = signature.status === "Valid" ? "valid"
    : signature.status === "NotSigned" ? "unsigned"
      : typeof signature.status === "string" ? "invalid" : "unavailable";
  return {
    scheme: "authenticode", status,
    ...(typeof signature.publisher === "string" && signature.publisher ? { publisher: signature.publisher } : {}),
    ...(typeof signature.thumbprint === "string" && signature.thumbprint ? { certificateThumbprint: signature.thumbprint } : {}),
    detail: "Reported by Get-AuthenticodeSignature. File metadata and application IDs do not establish a publisher.",
  };
}

export async function inspectSignature(path: string, platform: NodeJS.Platform): Promise<SignatureEvidence> {
  if (platform === "darwin") {
    let details: string;
    try {
      const result = await execute("/usr/bin/codesign", ["--display", "--verbose=4", path], { timeout: 5000, maxBuffer: 32768 });
      details = result.stderr;
    } catch (error) {
      const output = String((error as { stderr?: string }).stderr ?? "");
      return { scheme: "codesign", status: output.includes("not signed at all") ? "unsigned" : "unavailable" };
    }
    let verified = true;
    try {
      await execute("/usr/bin/codesign", ["--verify", "--strict", path], { timeout: 5000, maxBuffer: 32768 });
    } catch (error) {
      const failure = error as { code?: string | number; killed?: boolean; signal?: string };
      if (failure.killed || failure.signal || typeof failure.code !== "number") {
        return { scheme: "codesign", status: "unavailable", detail: "Signature verification could not be completed." };
      }
      verified = false;
    }
    return parseMacSignature(details, verified);
  }
  if (platform === "win32") {
    try {
      // The script is static; the literal file path is passed through a dedicated
      // environment value, never interpolated into PowerShell source.
      const result = await execute(join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"), [
        "-NoProfile", "-NonInteractive", "-Command",
        "$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $s=Get-AuthenticodeSignature -LiteralPath $env:VALIDEX_IDENTITY_TARGET; @{status=$s.Status.ToString();publisher=$s.SignerCertificate.Subject;thumbprint=$s.SignerCertificate.Thumbprint}|ConvertTo-Json -Compress",
      ], { timeout: 10000, maxBuffer: 32768, windowsHide: true, env: { ...process.env, VALIDEX_IDENTITY_TARGET: path } });
      return parseWindowsSignature(JSON.parse(result.stdout.trim().replace(/^\uFEFF/, "")));
    } catch {
      return { scheme: "authenticode", status: "unavailable" };
    }
  }
  return { scheme: "none", status: "not-applicable", detail: "No portable embedded signature check; package/repository signing is separate." };
}

export async function fingerprintArtifact(
  component: IdentityArtifact["component"], componentID: string, path: string,
  signatureReader: (path: string) => Promise<SignatureEvidence>,
): Promise<IdentityArtifact> {
  const artifact: IdentityArtifact = {
    component, componentID, path, fileName: basename(path),
    signature: { scheme: "none", status: "unavailable" },
  };
  try {
    artifact.resolvedPath = await realpath(path);
    const before = await stat(artifact.resolvedPath);
    if (!before.isFile()) throw new Error("Not a regular file");
    if (before.size > 512 * 1024 * 1024) {
      artifact.error = "File exceeds the 512 MiB fingerprint limit.";
      return artifact;
    }
    const hash = createHash("sha256");
    let bytesRead = 0;
    for await (const chunk of createReadStream(artifact.resolvedPath)) {
      bytesRead += (chunk as Buffer).length;
      if (bytesRead > 512 * 1024 * 1024) throw new Error("Fingerprint limit exceeded");
      hash.update(chunk as Buffer);
    }
    const after = await stat(artifact.resolvedPath);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ino !== after.ino) {
      artifact.error = "File changed while collecting identity; collect a fresh report.";
      return artifact;
    }
    artifact.sha256 = hash.digest("hex");
    artifact.sizeBytes = after.size;
    artifact.signature = component === "application-code"
      ? { scheme: "none", status: "not-applicable", detail: "JavaScript entry point; included for build identification." }
      : await signatureReader(artifact.resolvedPath);
    const signed = await stat(artifact.resolvedPath);
    if (before.size !== signed.size || before.mtimeMs !== signed.mtimeMs || before.ino !== signed.ino) {
      delete artifact.sha256;
      artifact.signature = { scheme: artifact.signature.scheme, status: "unavailable" };
      artifact.error = "File changed while collecting identity; collect a fresh report.";
    }
  } catch (error) {
    artifact.error = errorCode(error);
  }
  return artifact;
}

export interface IdentityReportOptions {
  manifestPath: string;
  buildMetadataPath: string;
  desktopPath: string;
  backendPath: string;
  cliPath: string;
  entryPath: string;
  logDirectory: string;
  version: string;
  packaged: boolean;
  electronVersion: string;
  chromiumVersion: string;
}

export async function collectApplicationIdentity(options: IdentityReportOptions): Promise<ApplicationIdentityReport> {
  const diagnosticErrors: string[] = [];
  let productUUID: string | null = null;
  let revision = "unknown";
  try {
    productUUID = parseIdentityManifest(JSON.parse(await readFile(options.manifestPath, "utf8"))).productUUID;
  } catch {
    diagnosticErrors.push("Canonical identity manifest is missing or invalid.");
  }
  try {
    const build: unknown = JSON.parse(await readFile(options.buildMetadataPath, "utf8"));
    if (build && typeof build === "object" && "revision" in build && typeof build.revision === "string") revision = build.revision;
  } catch {
    diagnosticErrors.push("Build revision metadata is unavailable.");
  }
  const specifications = [
    ["desktop", applicationID, options.desktopPath],
    ["backend", applicationID, options.backendPath],
    ["cli", applicationID, options.cliPath],
    ["application-code", applicationID, options.entryPath],
  ] as const;
  const observedArtifacts = await Promise.all(specifications.map(([component, id, path]) =>
    fingerprintArtifact(component, id, path, (target) => inspectSignature(target, process.platform)),
  ));
  // The standalone CLI is optional; an absent CLI is not a broken desktop installation.
  const artifacts = observedArtifacts.filter((item) => item.component !== "cli" || item.error !== "ENOENT");
  const desktop = artifacts.find((item) => item.component === "desktop");
  if (desktop) desktop.pid = process.pid;
  return {
    schemaVersion: 1, event: "validex.identity", recordedAt: new Date().toISOString(), sessionID: randomUUID(),
    applicationID, applicationName, productUUID, version: options.version, revision,
    mode: options.packaged ? "packaged" : "development", platform: process.platform, architecture: process.arch,
    pid: process.pid, parentPID: process.ppid, electronVersion: options.electronVersion,
    chromiumVersion: options.chromiumVersion, logDirectory: options.logDirectory, artifacts, diagnosticErrors,
  };
}

export function identityTicketText(report: ApplicationIdentityReport): string {
  return [
    "Validex — application identity / uygulama kimliği",
    `Application ID: ${report.applicationID}`,
    `Product UUID: ${report.productUUID ?? "unavailable"}`,
    `Version: ${report.version} | Revision: ${report.revision}`,
    `Platform: ${report.platform}/${report.architecture} | Mode: ${report.mode}`,
    `Observed: ${report.recordedAt} | Session: ${report.sessionID}`,
    `Desktop PID: ${report.pid} | Parent PID: ${report.parentPID}`,
    `Runtime: Electron ${report.electronVersion} / Chromium ${report.chromiumVersion}`,
    "",
    ...report.artifacts.flatMap((artifact) => [
      `[${artifact.component}] ${artifact.componentID}`,
      `File: ${artifact.path}`,
      ...(artifact.resolvedPath !== artifact.path ? [`Resolved file: ${artifact.resolvedPath ?? "unavailable"}`] : []),
      `SHA-256 (raw file): ${artifact.sha256 ?? "unavailable"}`,
      ...(artifact.pid ? [`PID: ${artifact.pid}`] : []),
      `Signature: ${artifact.signature.scheme} / ${artifact.signature.status}`,
      `Publisher: ${artifact.signature.publisher ?? "not verified / doğrulanmadı"}`,
      ...(artifact.signature.identifier ? [`Signing identifier: ${artifact.signature.identifier}`] : []),
      ...(artifact.signature.teamIdentifier ? [`Team ID: ${artifact.signature.teamIdentifier}`] : []),
      ...(artifact.signature.certificateThumbprint ? [`Certificate thumbprint: ${artifact.signature.certificateThumbprint}`] : []),
      ...(artifact.error ? [`Diagnostic: ${artifact.error}`] : []),
      "",
    ]),
    "Desktop API network owner: validex-backend (Go child process); HTTP(S) to user-selected API targets.",
    "The standalone validex-cli can also send requests from its own process. If installed separately, attach its --identity output.",
    "Other network activity: DNS, configured redirects/proxies; optional local Mock Server listener. Development UI uses loopback.",
    "Application IDs / UUID identify the product; they do not certify the publisher or grant security approval.",
    "Raw SHA-256 identifies this exact file. Windows App Control PE/Authenticode rule hashes can differ; generate policy rules using your security tooling.",
    `Diagnostics directory: ${report.logDirectory}`,
    ...report.diagnosticErrors.map((error) => `Diagnostic: ${error}`),
  ].join("\n");
}

/** These files contain inventory only: no request URLs, bodies, headers, tokens, or environment dump. */
export async function persistApplicationIdentity(report: ApplicationIdentityReport, appendStartup = false): Promise<void> {
  await mkdir(report.logDirectory, { recursive: true, mode: 0o700 });
  await writeFile(join(report.logDirectory, "application-identity.json"), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  await writeFile(join(report.logDirectory, "application-identity.txt"), `${identityTicketText(report)}\n`, { mode: 0o600 });
  if (!appendStartup) return;
  const logPath = join(report.logDirectory, "identity-startup.jsonl");
  try {
    if ((await stat(logPath)).size >= 256 * 1024) {
      const previous = join(report.logDirectory, "identity-startup.previous.jsonl");
      await rm(previous, { force: true });
      await rename(logPath, previous);
    }
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error;
  }
  await appendFile(logPath, `${JSON.stringify(report)}\n`, { mode: 0o600 });
}
