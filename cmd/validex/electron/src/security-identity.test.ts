import { deepStrictEqual, equal, match, rejects, throws } from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

import { applicationID } from "./identity";
import {
  collectApplicationIdentity, fingerprintArtifact, identityTicketText,
  parseIdentityManifest, parseMacSignature, parseWindowsSignature, persistApplicationIdentity,
  type ApplicationIdentityReport,
} from "./security-identity";

const manifestPath = resolve(__dirname, "../../../..", "internal/appidentity/manifest.json");

test("the canonical identity is shared by every main component", async () => {
  const manifest = parseIdentityManifest(JSON.parse(await readFile(manifestPath, "utf8")));
  equal(manifest.applicationID, applicationID);
  equal(manifest.productUUID, "6a2bf295-cc04-4390-abaf-9ccfcdbc3379");
  throws(() => parseIdentityManifest({ ...manifest, applicationID: `${applicationID}.backend` }));
  throws(() => parseIdentityManifest({ ...manifest, productUUID: "temporary" }));
});

test("signature evidence distinguishes ad-hoc identity from a verified publisher", () => {
  const adHoc = parseMacSignature("Identifier=com.validex.Validex\nSignature=adhoc\nTeamIdentifier=not set\n", true);
  equal(adHoc.status, "ad-hoc");
  equal(adHoc.identifier, applicationID);
  equal(adHoc.publisher, undefined);
  equal(adHoc.teamIdentifier, undefined);

  const signed = "Identifier=com.validex.Validex\nAuthority=Developer ID Application: Example\nAuthority=Apple Root CA\nTeamIdentifier=EXAMPLE123\n";
  equal(parseMacSignature(signed, true).publisher, "Developer ID Application: Example");
  equal(parseMacSignature(signed, true).teamIdentifier, "EXAMPLE123");
  equal(parseMacSignature(signed, false).status, "invalid");

  deepStrictEqual(
    ["Valid", "NotSigned", "HashMismatch"].map((status) => parseWindowsSignature({ status }).status),
    ["valid", "unsigned", "invalid"],
  );
  equal(parseWindowsSignature({ status: "NotSigned", CompanyName: "Validex" }).publisher, undefined);
  equal(parseWindowsSignature({ status: "Valid", publisher: "CN=Example", thumbprint: "1234" }).certificateThumbprint, "1234");
  equal(parseWindowsSignature(null).status, "unavailable");
});

test("fingerprints use actual bytes and paths, while missing files stay diagnostic", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "validex-identity-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "validex-backend");
  const contents = Buffer.from("fixture executable bytes\0\xff", "latin1");
  await writeFile(path, contents);
  const artifact = await fingerprintArtifact("backend", applicationID, path, async () => ({ scheme: "none", status: "not-applicable" }));
  equal(artifact.sha256, createHash("sha256").update(contents).digest("hex"));
  equal(artifact.sizeBytes, contents.length);
  equal(artifact.error, undefined);
  const missing = await fingerprintArtifact("cli", applicationID, join(directory, "missing"), async () => {
    throw new Error("A missing file must not invoke signature inspection");
  });
  equal(missing.sha256, undefined);
  equal(missing.error, "ENOENT");
  if (process.platform !== "win32") {
    const link = join(directory, "linked-backend");
    await symlink(path, link);
    const linked = await fingerprintArtifact("backend", applicationID, link, async (target) => {
      equal(target, artifact.resolvedPath);
      return { scheme: "none", status: "not-applicable" };
    });
    equal(linked.sha256, artifact.sha256);
    equal(linked.path, link);
    equal(linked.resolvedPath, artifact.resolvedPath);
  }
  const changed = await fingerprintArtifact("backend", applicationID, path, async (target) => {
    await writeFile(target, "modified while inspecting signature");
    return { scheme: "codesign", status: "valid", publisher: "A different build's certificate" };
  });
  equal(changed.sha256, undefined);
  equal(changed.signature.status, "unavailable");
  equal(changed.signature.publisher, undefined);
  match(changed.error!, /File changed/);
});

test("startup inventory survives missing binaries and produces private, rotated ticket files", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "validex-identity-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const buildMetadataPath = join(directory, "application-build.json");
  await writeFile(buildMetadataPath, JSON.stringify({ revision: "fixture-revision" }));
  const report = await collectApplicationIdentity({
    manifestPath, buildMetadataPath,
    desktopPath: join(directory, "missing-desktop"), backendPath: join(directory, "missing-backend"),
    cliPath: join(directory, "missing-cli"), entryPath: __filename,
    logDirectory: join(directory, "logs"), version: "0.2.0", packaged: true,
    electronVersion: "fixture", chromiumVersion: "fixture",
  });
  equal(report.productUUID, "6a2bf295-cc04-4390-abaf-9ccfcdbc3379");
  equal(report.revision, "fixture-revision");
  equal(report.artifacts.length, 3);
  equal(report.artifacts.every((artifact) => artifact.componentID === applicationID), true);
  equal(report.artifacts.filter((artifact) => artifact.error === "ENOENT").length, 2);
  match(report.artifacts.find((artifact) => artifact.component === "application-code")!.sha256!, /^[a-f0-9]{64}$/);
  equal(report.diagnosticErrors.length, 0);
  const ticket = identityTicketText(report);
  match(ticket, /Application ID: com\.validex\.Validex/);
  match(ticket, /Publisher: not verified/);
  match(ticket, /Windows App Control PE\/Authenticode rule hashes can differ/);
  equal("env" in report, false);
  equal("argv" in report, false);
  equal("hostname" in report, false);

  await persistApplicationIdentity(report, true);
  const saved = JSON.parse(await readFile(join(report.logDirectory, "application-identity.json"), "utf8")) as ApplicationIdentityReport;
  deepStrictEqual(saved, report);
  equal(await readFile(join(report.logDirectory, "application-identity.txt"), "utf8"), `${ticket}\n`);
  const logPath = join(report.logDirectory, "identity-startup.jsonl");
  deepStrictEqual(JSON.parse((await readFile(logPath, "utf8")).trim()), report);
  if (process.platform !== "win32") equal((await stat(logPath)).mode & 0o777, 0o600);
  const previousContent = "x".repeat(256 * 1024);
  await writeFile(logPath, previousContent);
  await persistApplicationIdentity(report, true);
  equal(await readFile(join(report.logDirectory, "identity-startup.previous.jsonl"), "utf8"), previousContent);
  deepStrictEqual(JSON.parse((await readFile(logPath, "utf8")).trim()), report);

  await writeFile(join(directory, "not-a-directory"), "file");
  await rejects(() => persistApplicationIdentity({ ...report, logDirectory: join(directory, "not-a-directory", "logs") }));
});
