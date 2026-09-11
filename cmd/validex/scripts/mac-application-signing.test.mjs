import assert from "node:assert/strict";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { macSigningArguments, signMacExecutable, verifyMacSigningIdentifier } from "./mac-application-signing.mjs";

test("macOS signing gives standalone code a stable identifier without assuming a publisher", () => {
  const path = "/tmp/Validex build/validex-backend";
  assert.deepEqual(macSigningArguments(path, "com.validex.Validex", "-"), [
    "--force", "--sign", "-", "--timestamp=none", "--identifier", "com.validex.Validex", path,
  ]);
  assert.deepEqual(macSigningArguments(path, "com.validex.Validex", "Developer ID Application: Example"), [
    "--force", "--sign", "Developer ID Application: Example", "--timestamp", "--identifier", "com.validex.Validex", path,
  ]);
});

test("standalone macOS backend signing embeds and verifies its explicit identity", { skip: process.platform !== "darwin" }, async () => {
  const root = await mkdtemp(join(tmpdir(), "validex-signing-"));
  try {
    const executable = join(root, "validex-backend");
    await cp("/usr/bin/true", executable);
    await signMacExecutable(executable, "com.validex.Validex", "-");
    assert.throws(() => verifyMacSigningIdentifier(executable, "com.example.Unrelated"), /Unexpected macOS/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
