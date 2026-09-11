#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  chmod, cp, lstat, mkdir, mkdtemp, open, readFile, readdir, rename, rm,
  symlink, writeFile,
} from "node:fs/promises";
import { basename, join } from "node:path";

import { applicationRoot, readApplicationIdentity, repositoryRoot } from "./application-build-identity.mjs";

if (process.platform !== "linux") {
  throw new Error("Debian packages must be built on Linux with dpkg-dev installed.");
}
if (process.argv.length > 2) {
  throw new Error("Usage: node scripts/package-deb.mjs (run make linux_app to build first)");
}
const architecture = { x64: "amd64", arm64: "arm64", arm: "armhf" }[process.arch];
if (!architecture) throw new Error(`Unsupported Debian architecture: ${process.arch}`);
for (const command of ["dpkg-deb", "dpkg-shlibdeps"]) {
  try {
    execFileSync(command, ["--version"], { stdio: "ignore" });
  } catch {
    throw new Error(`${command} is required; install dpkg-dev before running make linux_app.`);
  }
}

const identity = await readApplicationIdentity();
const outputRoot = join(repositoryRoot, "build/bin");
const applicationDirectory = join(outputRoot, identity.applicationName);
const resourcesDirectory = join(applicationDirectory, "resources");
const manifest = JSON.parse(await readFile(join(applicationRoot, "package.json"), "utf8"));
const metadata = JSON.parse(await readFile(join(resourcesDirectory, "application-build.json"), "utf8"));
if (metadata.version !== manifest.version || metadata.platform !== "linux" ||
    metadata.architecture !== process.arch) {
  throw new Error("Packaged application does not match this version/platform; run make linux_app.");
}
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(manifest.version)) {
  throw new Error("Validex package version must be a semantic version.");
}
// Debian sorts prereleases before their release when separated with '~'.
const version = manifest.version.replace(/^(\d+\.\d+\.\d+)-/, "$1~");
const packageName = `validex_${version}_${architecture}.deb`;
const maintainer = "TunahanCan <tunahan.can@hotmail.com.tr>";
const description = "API development, testing and debugging workspace\n" +
  " Local Electron desktop application with a Go backend and command-line tools\n" +
  " for HTTP requests, collections, OpenAPI, mock servers and diagnostics.\n";

for (const path of [
  join(applicationDirectory, "validex"),
  join(applicationDirectory, "chrome-sandbox"),
  join(resourcesDirectory, "validex-backend"),
  join(resourcesDirectory, "frontend/index.html"),
  join(outputRoot, "validex-cli"),
]) {
  if (!(await lstat(path)).isFile()) throw new Error(`Required package file is missing: ${path}`);
}

async function digest(path, algorithm) {
  const hash = createHash(algorithm);
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function isELF(path) {
  const file = await open(path, "r");
  try {
    const header = Buffer.alloc(4);
    const { bytesRead } = await file.read(header, 0, 4, 0);
    return bytesRead === 4 && header.equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]));
  } finally {
    await file.close();
  }
}

async function payloadFiles(root, relativePath = "") {
  const directory = join(root, relativePath);
  await chmod(directory, 0o755);
  const files = [];
  for (const entry of (await readdir(directory, { withFileTypes: true }))
    .sort((left, right) => left.name.localeCompare(right.name, "en"))) {
    const relative = join(relativePath, entry.name);
    if (entry.isDirectory()) {
      files.push(...await payloadFiles(root, relative));
    } else if (entry.isFile()) {
      const path = join(root, relative);
      const info = await lstat(path);
      await chmod(path, (info.mode & 0o111) ? 0o755 : 0o644);
      files.push(relative);
    } else if (!entry.isSymbolicLink()) {
      throw new Error(`Unsupported file in Debian package: ${relative}`);
    }
  }
  return files;
}

const stagingRoot = await mkdtemp(join(outputRoot, ".deb-package-"));
try {
  const packageRoot = join(stagingRoot, "package");
  const installedApplication = join(packageRoot, "usr/lib/validex");
  const installedResources = join(installedApplication, "resources");
  const binaryDirectory = join(packageRoot, "usr/bin");
  const desktopDirectory = join(packageRoot, "usr/share/applications");
  const iconDirectory = join(packageRoot, "usr/share/icons/hicolor/scalable/apps");
  const documentationDirectory = join(packageRoot, "usr/share/doc/validex");
  for (const directory of [binaryDirectory, desktopDirectory, iconDirectory, documentationDirectory]) {
    await mkdir(directory, { recursive: true });
  }
  await cp(applicationDirectory, installedApplication, { recursive: true, verbatimSymlinks: true });
  await cp(join(outputRoot, "validex-cli"), join(installedResources, "validex-cli"));
  await chmod(join(installedResources, "validex-cli"), 0o755);
  await symlink("../lib/validex/resources/validex-cli", join(binaryDirectory, "validex-cli"));
  await writeFile(join(binaryDirectory, "validex"),
    '#!/bin/sh\n' +
    'unset ELECTRON_RUN_AS_NODE\n' +
    'if [ -n "${XDG_DATA_DIRS_VSCODE_SNAP_ORIG:-}" ]; then\n' +
    '  XDG_DATA_DIRS="$XDG_DATA_DIRS_VSCODE_SNAP_ORIG"\n' +
    '  export XDG_DATA_DIRS\n' +
    '  unset GSETTINGS_SCHEMA_DIR XDG_DATA_HOME\n' +
    'fi\n' +
    'exec /usr/lib/validex/validex "$@"\n', { mode: 0o755 });

  const desktopTemplate = await readFile(
    join(repositoryRoot, `build/linux/${identity.applicationID}.desktop.in`), "utf8",
  );
  await writeFile(join(desktopDirectory, `${identity.applicationID}.desktop`),
    desktopTemplate.replaceAll("@VALIDEX_EXEC@", "/usr/bin/validex"));
  await cp(join(installedResources, "frontend/appicon.svg"),
    join(iconDirectory, `${identity.applicationID}.svg`));
  for (const name of ["THIRD_PARTY_NOTICES.md", "LICENSE.electron", "LICENSES.chromium.html"]) {
    await symlink(`../../../lib/validex/resources/${name}`, join(documentationDirectory, name));
  }

  const files = await payloadFiles(packageRoot);
  // dpkg-deb writes root ownership without requiring sudo. Chromium requires
  // this helper to be root-owned and setuid for its Linux sandbox fallback.
  await chmod(join(installedApplication, "chrome-sandbox"), 0o4755);
  // dpkg-shlibdeps uses DEBIAN to locate the package root and resolve $ORIGIN.
  const controlDirectory = join(packageRoot, "DEBIAN");
  await mkdir(controlDirectory, { mode: 0o755 });

  const debianDirectory = join(stagingRoot, "debian");
  await mkdir(debianDirectory);
  await writeFile(join(debianDirectory, "control"),
    `Source: validex\nSection: devel\nPriority: optional\nMaintainer: ${maintainer}\n\n` +
    `Package: validex\nArchitecture: ${architecture}\nDescription: ${description}`);
  const elfFiles = [];
  let installedBytes = 0;
  const checksums = [];
  for (const relativePath of files) {
    const path = join(packageRoot, relativePath);
    installedBytes += (await lstat(path)).size;
    checksums.push(`${await digest(path, "md5")}  ${relativePath}`);
    if (await isELF(path)) elfFiles.push(path);
  }
  // Private Electron libraries travel with the application. Missing system
  // libraries still fail the scan; unregistered bundled libraries need no deps.
  const dependencyOutput = execFileSync("dpkg-shlibdeps", [
    "-O", "--ignore-missing-info", `-l${installedApplication}`,
    ...elfFiles.map((path) => `-e${path}`),
  ], { cwd: stagingRoot, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  const dependencies = dependencyOutput.split("\n")
    .find((line) => line.startsWith("shlibs:Depends="))?.slice("shlibs:Depends=".length);
  if (!dependencies) throw new Error("Could not determine Debian runtime dependencies.");

  await writeFile(join(controlDirectory, "control"),
    `Package: validex\nVersion: ${version}\nSection: devel\nPriority: optional\n` +
    `Architecture: ${architecture}\nMaintainer: ${maintainer}\n` +
    `Installed-Size: ${Math.ceil(installedBytes / 1024)}\n` +
    `Depends: ${dependencies}, ca-certificates, zenity | kdialog\n` +
    "Recommends: libgl1, libegl1, xdg-utils\n" +
    "Homepage: https://github.com/TunahanCan/validex\n" +
    `Description: ${description}`, { mode: 0o644 });
  await writeFile(join(controlDirectory, "md5sums"), `${checksums.join("\n")}\n`, { mode: 0o644 });

  const temporaryPackage = join(stagingRoot, packageName);
  execFileSync("dpkg-deb", ["--root-owner-group", "-Zxz", "-z6", "--build", packageRoot, temporaryPackage],
    { stdio: "inherit" });
  const destination = join(outputRoot, packageName);
  await rename(temporaryPackage, destination);
  await writeFile(`${destination}.sha256`, `${await digest(destination, "sha256")}  ${basename(destination)}\n`);
  process.stdout.write(`Created Debian package: ${destination}\n`);
} finally {
  await rm(stagingRoot, { recursive: true, force: true });
}
