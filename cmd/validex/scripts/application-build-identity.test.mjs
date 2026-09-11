import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import { applicationBuildMetadata, developmentRuntimeMarkerSchema, readApplicationIdentity, resolveBuildRevision, writeBuildIdentity } from "./application-build-identity.mjs";

const { isPackagedApplicationRuntime, applicationIconPath } = createRequire(import.meta.url)("../electron/dist/identity.js");

test("the shell accepts the packager's development marker and uses source icons", async () => {
  const identity = await readApplicationIdentity();
  const metadata = await applicationBuildMetadata();
  const marker = {
    applicationID: `${identity.applicationID}.dev`, applicationName: identity.applicationName,
    applicationVersion: metadata.version, architecture: "arm64", electronVersion: "43.2.0",
    platform: "darwin", schema: developmentRuntimeMarkerSchema, signingIdentity: "-",
  };
  const options = {
    applicationVersion: marker.applicationVersion, architecture: marker.architecture,
    developmentMarker: marker, developmentRuntime: "1", electronPackaged: true,
    electronVersion: marker.electronVersion, executablePath: "/workspace/build/dev/Validex.app/Contents/MacOS/Validex",
    platform: "darwin",
  };
  const packaged = isPackagedApplicationRuntime(options);
  assert.equal(packaged, false);
  assert.equal(applicationIconPath({ applicationRoot: "/workspace", resourcesRoot: "/runtime/Resources", packaged }),
    join("/workspace", "build", "appicon.png"));
  assert.equal(isPackagedApplicationRuntime({ ...options, developmentRuntime: undefined }), true);
  assert.equal(isPackagedApplicationRuntime({ ...options, developmentMarker: { ...marker, schema: -1 } }), true);
});

test("build identity preserves the canonical application and product UUID across components", async () => {
  const identity = await readApplicationIdentity();
  assert.equal(identity.applicationID, "com.validex.Validex");
  assert.equal(identity.productUUID, "6a2bf295-cc04-4390-abaf-9ccfcdbc3379");
  const metadata = await applicationBuildMetadata({ platform: "win32", architecture: "x64" });
  assert.equal(metadata.platform, "win32");
  assert.equal(metadata.architecture, "x64");
  assert.deepEqual(Object.keys(metadata).sort(), ["architecture", "platform", "revision", "version"]);
  const root = await mkdtemp(join(tmpdir(), "validex-build-identity-"));
  try {
    await writeBuildIdentity(root, metadata);
    assert.deepEqual(JSON.parse(await readFile(join(root, "application-identity.json"), "utf8")), identity);
    assert.deepEqual(JSON.parse(await readFile(join(root, "application-build.json"), "utf8")), metadata);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("configured build revisions cannot inject linker arguments", () => {
  assert.equal(resolveBuildRevision({ VALIDEX_BUILD_REVISION: "abc123-release.1" }), "abc123-release.1");
  for (const revision of ["", "revision -X other=value", "value\nnext", "a".repeat(81)]) {
    assert.throws(() => resolveBuildRevision({ VALIDEX_BUILD_REVISION: revision }), /Invalid VALIDEX_BUILD_REVISION/);
  }
});
