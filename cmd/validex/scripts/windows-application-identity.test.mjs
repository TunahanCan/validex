import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { stampWindowsExecutable, windowsVersionResource, windowsVersionStrings } from "./windows-application-identity.mjs";

const identity = { applicationName: "Validex", applicationID: "com.validex.Validex", productUUID: "6a2bf295-cc04-4390-abaf-9ccfcdbc3379" };
const metadata = { version: "0.2.0", revision: "abc123-dirty" };
const align = (value) => (value + 3) & ~3;

function readVersionBlock(data, offset = 0) {
  const end = offset + data.readUInt16LE(offset);
  const valueLength = data.readUInt16LE(offset + 2);
  const type = data.readUInt16LE(offset + 4);
  let cursor = offset + 6;
  const keyStart = cursor;
  while (data.readUInt16LE(cursor) !== 0) cursor += 2;
  const key = data.subarray(keyStart, cursor).toString("utf16le");
  cursor = align(cursor + 2);
  const valueSize = type === 1 ? valueLength * 2 : valueLength;
  const value = data.subarray(cursor, cursor + valueSize);
  cursor = align(cursor + valueSize);
  const children = [];
  while (cursor < end) {
    const child = readVersionBlock(data, cursor);
    assert.ok(child.end > cursor && child.end <= end);
    children.push(child);
    cursor = align(child.end);
  }
  return { key, type, value, children, end };
}

test("all Windows components share product identity and retain their real filenames and roles", () => {
  for (const [component, filename, description] of [
    ["desktop", "validex.exe", "Validex Desktop"],
    ["backend", "validex-backend.exe", "Validex API Backend"],
    ["cli", "validex-cli.exe", "Validex Command-Line Interface"],
  ]) {
    const strings = windowsVersionStrings({ executable: join("build", filename), component, identity, metadata });
    assert.equal(strings.ProductName, "Validex");
    assert.equal(strings.InternalName, "com.validex.Validex");
    assert.equal(strings.FileDescription, description);
    assert.equal(strings.OriginalFilename, filename);
    assert.ok(strings.Comments.includes(identity.productUUID));
    assert.equal(Object.hasOwn(strings, "Publisher"), false);
    assert.equal(Object.hasOwn(strings, "CompanyName"), false);
    const resource = windowsVersionResource(strings);
    const root = readVersionBlock(resource);
    assert.equal(root.key, "VS_VERSION_INFO");
    assert.equal(root.end, resource.length);
    assert.equal(root.type, 0);
    assert.equal(root.value.length, 52);
    assert.equal(root.value.readUInt32LE(), 0xfeef04bd);
    assert.equal(root.value.readUInt32LE(8), 2);
    const table = root.children.find((child) => child.key === "StringFileInfo").children[0];
    assert.equal(table.key, "040904b0");
    const restored = Object.fromEntries(table.children.map((child) => [child.key, child.value.toString("utf16le").slice(0, -1)]));
    assert.deepEqual(restored, strings);
    const translation = root.children.find((child) => child.key === "VarFileInfo").children[0];
    assert.deepEqual([...translation.value], [9, 4, 176, 4]);
  }
});

test("Windows metadata rejects malformed numeric versions and null-terminated strings", () => {
  const strings = windowsVersionStrings({ executable: "validex.exe", component: "desktop", identity, metadata });
  assert.throws(() => windowsVersionResource({ ...strings, FileVersion: "70000.1.0" }), /16 bits/);
  assert.throws(() => windowsVersionResource({ ...strings, FileVersion: "development" }), /semantic version/);
  assert.throws(() => windowsVersionResource({ ...strings, ProductName: "Invalid\0name" }), /Invalid Windows/);
});

test("native Windows resource updates preserve runnable Node and Go executables", { skip: process.platform !== "win32" }, async () => {
  const root = await mkdtemp(join(tmpdir(), "validex-windows-identity-"));
  try {
    const desktop = join(root, "validex.exe");
    await cp(process.execPath, desktop);
    await stampWindowsExecutable({ executable: desktop, component: "desktop", identity, metadata });
    assert.equal(execFileSync(desktop, ["--version"], { encoding: "utf8" }).trim(), process.version);
    const source = join(root, "main.go");
    const backend = join(root, "validex-backend.exe");
    await writeFile(source, "package main\nfunc main() {}\n");
    execFileSync("go", ["build", "-o", backend, source], { stdio: "inherit" });
    await stampWindowsExecutable({ executable: backend, component: "backend", identity, metadata });
    execFileSync(backend, [], { stdio: "inherit" });
  } finally { await rm(root, { recursive: true, force: true }); }
});
