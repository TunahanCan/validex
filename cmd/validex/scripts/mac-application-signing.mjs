import { execFileSync, spawnSync } from "node:child_process";
import { open, readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { macHelperIdentities } from "./mac-application-identity.mjs";

export function macSigningArguments(path, identifier, signingIdentity = process.env.VALIDEX_CODESIGN_IDENTITY || "-") {
  if (!signingIdentity.trim() || signingIdentity.includes("\0")) throw new Error("Invalid macOS signing identity");
  return ["--force", "--sign", signingIdentity,
    signingIdentity === "-" ? "--timestamp=none" : "--timestamp",
    ...(identifier ? ["--identifier", identifier] : []), path];
}

export function verifyMacSigningIdentifier(path, identifier) {
  execFileSync("codesign", ["--verify", "--strict", path], { stdio: "inherit" });
  const result = spawnSync("codesign", ["--display", "--verbose=2", path], { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0 || !result.stderr.split(/\r?\n/).includes(`Identifier=${identifier}`)) {
    throw new Error(`Unexpected macOS code-signing identifier for ${path}: expected ${identifier}`);
  }
}

export async function signMacExecutable(path, identifier, signingIdentity) {
  execFileSync("codesign", macSigningArguments(path, identifier, signingIdentity), { stdio: "inherit" });
  verifyMacSigningIdentifier(path, identifier);
}

async function isMachO(path) {
  const file = await open(path, "r");
  try {
    const magic = Buffer.alloc(4);
    const { bytesRead } = await file.read(magic, 0, 4, 0);
    return bytesRead === 4 && [0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe,
      0xcafebabe, 0xbebafeca, 0xcafebabf, 0xbfbafeca].includes(magic.readUInt32BE());
  } finally { await file.close(); }
}

async function nestedCodePaths(directory) {
  const paths = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    // Framework aliases are symlinks; sign their real versioned targets once.
    if (entry.isDirectory()) {
      paths.push(...await nestedCodePaths(path));
      if (entry.name.endsWith(".framework") || entry.name.endsWith(".app")) paths.push(path);
    } else if (entry.isFile() && await isMachO(path)) paths.push(path);
  }
  return paths;
}

export async function signMacApplication({ applicationPath, applicationName, bundleIdentifier,
  backendPath, backendIdentifier, signingIdentity }) {
  // Apple requires signing nested code inside out; --deep signing also skips
  // standalone tools placed in Resources. Sign the backend explicitly first.
  if (backendPath) await signMacExecutable(backendPath, backendIdentifier, signingIdentity);
  const helpers = new Map(macHelperIdentities(applicationName, bundleIdentifier)
    .map((helper) => [`${helper.targetName}.app`, helper.bundleIdentifier]));
  for (const path of await nestedCodePaths(join(applicationPath, "Contents/Frameworks"))) {
    const identifier = helpers.get(basename(path));
    execFileSync("codesign", macSigningArguments(path, identifier, signingIdentity), { stdio: "inherit" });
  }
  await signMacExecutable(applicationPath, bundleIdentifier, signingIdentity);
  execFileSync("codesign", ["--verify", "--deep", "--strict", applicationPath], { stdio: "inherit" });
  for (const [name, identifier] of helpers) {
    verifyMacSigningIdentifier(join(applicationPath, "Contents/Frameworks", name), identifier);
  }
}
