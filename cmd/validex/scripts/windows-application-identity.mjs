import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function windowsVersionStrings({ executable, component, identity, metadata }) {
  const descriptions = { desktop: "Validex Desktop", backend: "Validex API Backend", cli: "Validex Command-Line Interface" };
  if (!descriptions[component]) throw new Error("Unknown Validex executable component");
  return {
    ProductName: identity.applicationName,
    FileDescription: descriptions[component],
    InternalName: identity.applicationID,
    OriginalFilename: basename(executable),
    FileVersion: metadata.version,
    ProductVersion: metadata.version,
    Comments: `Application ID: ${identity.applicationID}; Product UUID: ${identity.productUUID}; Component: ${component}; Revision: ${metadata.revision}`,
  };
}

function padding(length) { return Buffer.alloc((4 - length % 4) % 4); }
function unicode(value) { return Buffer.from(`${value}\0`, "utf16le"); }

function versionBlock(key, value, children = [], type = 1) {
  const header = Buffer.alloc(6);
  const keyData = unicode(key);
  const parts = [header, keyData, padding(6 + keyData.length), value];
  let length = parts.reduce((total, part) => total + part.length, 0);
  for (const child of children) {
    const pad = padding(length);
    parts.push(pad, child);
    length += pad.length + child.length;
  }
  if (length > 65535) throw new Error("Windows version resource is too large");
  header.writeUInt16LE(length, 0);
  header.writeUInt16LE(type === 1 ? value.length / 2 : value.length, 2);
  header.writeUInt16LE(type, 4);
  return Buffer.concat(parts);
}

/** Encodes Microsoft's documented VS_VERSIONINFO layout without build dependencies. */
export function windowsVersionResource(strings) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?$/.exec(strings.FileVersion);
  if (!match) throw new Error("Windows file version must be a semantic version");
  const parts = [...match.slice(1).map(Number), 0];
  if (parts.some((part) => !Number.isInteger(part) || part < 0 || part > 65535)) {
    throw new Error("Windows numeric version components must fit 16 bits");
  }
  const ms = ((parts[0] << 16) | parts[1]) >>> 0;
  const ls = ((parts[2] << 16) | parts[3]) >>> 0;
  const fixed = Buffer.alloc(52);
  [0xfeef04bd, 0x00010000, ms, ls, ms, ls, 0x3f, 0, 0x00040004, 1, 0, 0, 0]
    .forEach((value, index) => fixed.writeUInt32LE(value, index * 4));
  const values = Object.entries(strings).map(([key, value]) => {
    if (typeof value !== "string" || value.includes("\0")) throw new Error("Invalid Windows version string");
    return versionBlock(key, unicode(value));
  });
  const translation = Buffer.alloc(4);
  translation.writeUInt16LE(0x0409, 0);
  translation.writeUInt16LE(1200, 2);
  return versionBlock("VS_VERSION_INFO", fixed, [
    versionBlock("StringFileInfo", Buffer.alloc(0), [versionBlock("040904b0", Buffer.alloc(0), values)]),
    versionBlock("VarFileInfo", Buffer.alloc(0), [versionBlock("Translation", translation, [], 0)]),
  ], 0);
}

export async function stampWindowsExecutable(options) {
  if (process.platform !== "win32") throw new Error("Windows executable branding requires a native Windows build");
  const strings = windowsVersionStrings(options);
  const temporary = await mkdtemp(join(tmpdir(), "validex-version-resource-"));
  try {
    const resource = join(temporary, "version.bin");
    const metadata = join(temporary, "version.json");
    await writeFile(resource, windowsVersionResource(strings));
    await writeFile(metadata, JSON.stringify(strings));
    execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-File",
      join(dirname(fileURLToPath(import.meta.url)), "stamp-windows-identity.ps1"),
      "-Executable", options.executable, "-VersionResource", resource, "-Metadata", metadata,
    ], { stdio: "inherit" });
  } finally { await rm(temporary, { recursive: true, force: true }); }
}
