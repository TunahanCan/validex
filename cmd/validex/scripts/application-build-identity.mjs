import { execFileSync } from "node:child_process";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const applicationRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const repositoryRoot = resolve(applicationRoot, "../..");
export const identityManifestPath = join(repositoryRoot, "internal/appidentity/manifest.json");
export const developmentRuntimeMarkerSchema = 3;

export async function readApplicationIdentity() {
  const manifest = JSON.parse(await readFile(identityManifestPath, "utf8"));
  if (manifest.applicationID !== "com.validex.Validex" || manifest.applicationName !== "Validex" ||
      manifest.backendProcessName !== "validex-backend" || manifest.cliProcessName !== "validex-cli") {
    throw new Error("Canonical Validex application identity does not match the installed application");
  }
  return manifest;
}

export function resolveBuildRevision(environment = process.env) {
  const configured = environment.VALIDEX_BUILD_REVISION;
  if (configured !== undefined) {
    if (!/^[A-Za-z0-9._-]{1,80}$/.test(configured)) throw new Error("Invalid VALIDEX_BUILD_REVISION");
    return configured;
  }
  try {
    const revision = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repositoryRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const modified = execFileSync("git", ["status", "--porcelain", "--untracked-files=normal"], {
      cwd: repositoryRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return `${revision}${modified ? "-dirty" : ""}`;
  } catch {
    return "unknown";
  }
}

export async function applicationBuildMetadata({ platform = process.platform, architecture = process.arch } = {}) {
  const packageManifest = JSON.parse(await readFile(join(applicationRoot, "package.json"), "utf8"));
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(packageManifest.version)) {
    throw new Error("Validex package version must be a semantic version");
  }
  return { version: packageManifest.version, revision: resolveBuildRevision(), platform, architecture };
}

export async function writeBuildIdentity(directory, metadata) {
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "application-identity.json"), await readFile(identityManifestPath));
  await writeFile(join(directory, "application-build.json"), `${JSON.stringify(metadata, null, 2)}\n`);
}
