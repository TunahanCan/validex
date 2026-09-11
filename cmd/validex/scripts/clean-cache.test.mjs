import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { cleanProjectCache } from "./clean-cache.mjs";

async function put(root, name, content = name) {
  const path = join(root, name);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

async function fixture(t) {
  const temporary = await mkdtemp(join(tmpdir(), "validex-cache-test-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const root = join(temporary, "repository");
  await put(root, "Makefile");
  await put(root, "cmd/validex/package.json", "{}");
  return { root, temporary };
}

test("cleans generated outputs and transaction leftovers while preserving sources, dependencies and gitkeep files", async (t) => {
  const { root } = await fixture(t);
  const generated = [
    "build/bin/Validex/resources/app/package.json",
    "build/bin/validex_0.2.0_amd64.deb",
    "build/bin/.deb-package-leftover/package/DEBIAN/control",
    "build/dev/Validex.app/Contents/Info.plist",
    "build/Validex.icns",
    "build/Validex.iconset/icon_512x512.png",
    "build/.validex-mac-icon.json",
    "build/.electron-123-leftover/runtime",
    "build/.electron-development-456-leftover/runtime",
    "build/.validex-icon-leftover/icon.png",
    "cmd/validex/build/bin/validex-cli",
    "cmd/validex/build/dev/runtime",
    "cmd/validex/build/Validex.icns",
    "cmd/validex/build/.validex-mac-icon.json",
    "cmd/validex/build/Validex.iconset/icon.png",
    "cmd/validex/build/.electron-leftover/runtime",
    "cmd/validex/build/.validex-icon-leftover/icon.png",
    "cmd/validex/frontend/dist/index.html",
    "cmd/validex/frontend/dist/modules/main.js",
    "cmd/validex/frontend/.dev-dist/index.html",
    "cmd/validex/frontend/.typescript-build/esm/main.js",
    "cmd/validex/frontend/.dist-backup/index.html",
    "cmd/validex/frontend/.dist-swap.json",
    "cmd/validex/frontend/..dev-dist-backup/index.html",
    "cmd/validex/frontend/..dev-dist-swap.json",
    "cmd/validex/frontend/.dist-staging-leftover/index.html",
    "cmd/validex/frontend/..dev-dist-staging-leftover/index.html",
    "cmd/validex/frontend/coverage/report.json",
    "cmd/validex/frontend/tsconfig.tsbuildinfo",
    "cmd/validex/electron/tsconfig.tsbuildinfo",
    "cmd/validex/electron/dist/main.js",
    "cmd/validex/app_windows_amd64.syso",
    "tests/e2e/artifacts/example.png",
  ];
  const preserved = [
    "Makefile", "cmd/validex/package.json", "README.md",
    "build/appicon.png", "build/appicon.svg", "build/linux/com.validex.Validex.desktop.in",
    "build/notes.txt", "cmd/validex/build/appicon.png", "cmd/validex/build/appicon.svg",
    "cmd/validex/build/linux/com.validex.Validex.desktop.in",
    "cmd/validex/frontend/dist/.gitkeep", "tests/e2e/artifacts/.gitkeep",
    "cmd/validex/frontend/public/.gitkeep", "cmd/validex/frontend/public/appicon.png",
    "cmd/validex/frontend/src/main.ts", "cmd/validex/frontend/src/styles.css",
    "cmd/validex/frontend/.env.local", "cmd/validex/electron/src/main.ts",
    "cmd/validex/frontend/node_modules/typescript/lib/typescript.js",
    "cmd/validex/node_modules/.validex-deps-stamp",
    "cmd/validex/node_modules/electron/dist/electron",
    ".git/config", ".cache/go-build/sentinel", ".npm/sentinel",
    ".config/Validex/collection-library.json",
  ];
  for (const path of [...generated, ...preserved]) await put(root, path);

  assert.ok((await cleanProjectCache({ root })).length > 0);
  for (const path of generated) {
    await assert.rejects(lstat(join(root, path)), { code: "ENOENT" }, path);
  }
  for (const path of preserved) assert.equal(await readFile(join(root, path), "utf8"), path);
  assert.deepEqual(await readdir(join(root, "cmd/validex/frontend/dist")), [".gitkeep"]);
  assert.deepEqual(await readdir(join(root, "tests/e2e/artifacts")), [".gitkeep"]);
  assert.deepEqual(await cleanProjectCache({ root }), []);
});

test("rejects symlinked parents and cleanup targets before removing any output", async (t) => {
  for (const target of ["build", "cmd/validex/frontend", "tests/e2e/artifacts"]) {
    await t.test(target, async (t) => {
      const { root, temporary } = await fixture(t);
      const external = join(temporary, "external");
      await put(external, "keep.txt", "outside");
      await put(root, "cmd/validex/electron/dist/main.js", "keep until all paths are safe");
      await mkdir(dirname(join(root, target)), { recursive: true });
      await symlink(external, join(root, target), process.platform === "win32" ? "junction" : "dir");
      await assert.rejects(cleanProjectCache({ root }), /symbolic link/);
      assert.equal(await readFile(join(external, "keep.txt"), "utf8"), "outside");
      assert.equal(await readFile(join(root, "cmd/validex/electron/dist/main.js"), "utf8"), "keep until all paths are safe");
    });
  }
});

test("removes links inside generated bundles without following their external targets", async (t) => {
  const { root, temporary } = await fixture(t);
  const external = join(temporary, "external");
  await put(external, "keep.txt", "outside");
  await mkdir(join(root, "build/bin/Validex"), { recursive: true });
  await symlink(external, join(root, "build/bin/Validex/linked-runtime"), process.platform === "win32" ? "junction" : "dir");
  await cleanProjectCache({ root });
  assert.equal(await readFile(join(external, "keep.txt"), "utf8"), "outside");
  await assert.rejects(lstat(join(root, "build/bin")), { code: "ENOENT" });
});

test("rejects an unrecognized or symlinked repository root", async (t) => {
  const { root, temporary } = await fixture(t);
  await assert.rejects(cleanProjectCache({ root: temporary }), /Repository marker is missing/);
  const alias = join(temporary, "alias");
  await symlink(root, alias, process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(cleanProjectCache({ root: alias }), /invalid repository root/);
});
