#!/usr/bin/env node

import { lstat, readdir, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const frontendRoot = "cmd/validex/frontend";
const buildRoots = ["build", "cmd/validex/build"];
const buildOutputs = ["bin", "dev", "Validex.icns", "Validex.iconset", ".validex-mac-icon.json"];
const fixedOutputs = [
  ...buildRoots.flatMap((root) => buildOutputs.map((name) => `${root}/${name}`)),
  `${frontendRoot}/.dev-dist`,
  `${frontendRoot}/.typescript-build`,
  `${frontendRoot}/.dist-backup`,
  `${frontendRoot}/.dist-swap.json`,
  `${frontendRoot}/..dev-dist-backup`,
  `${frontendRoot}/..dev-dist-swap.json`,
  `${frontendRoot}/coverage`,
  "cmd/validex/electron/dist",
];

async function information(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}

// Inspect every parent before listing or deleting a generated path. In
// particular, a symlink at build/ or frontend/ must never redirect cleanup.
async function inspectPath(root, name, directory = false) {
  const path = resolve(root, name);
  const within = relative(root, path);
  if (!within || within === ".." || within.startsWith(`..${sep}`) || isAbsolute(within)) {
    throw new Error(`Refusing to clean a path outside the repository: ${path}`);
  }
  const parts = within.split(sep);
  let current = root;
  let entry;
  for (let index = 0; index < parts.length; index += 1) {
    current = join(current, parts[index]);
    entry = await information(current);
    if (!entry) return undefined;
    if (entry.isSymbolicLink()) {
      throw new Error(`Refusing to clean through a symbolic link: ${current}`);
    }
    if ((index < parts.length - 1 || directory) && !entry.isDirectory()) {
      throw new Error(`Expected a cleanup parent directory: ${current}`);
    }
  }
  return entry;
}

async function matchingChildren(root, parent, matches) {
  if (!(await inspectPath(root, parent, true))) return [];
  const entries = await readdir(join(root, parent));
  return entries.filter(matches).map((name) => `${parent}/${name}`);
}

export async function cleanProjectCache({ root = repositoryRoot } = {}) {
  root = resolve(root);
  const rootInformation = await information(root);
  if (root === parse(root).root || !rootInformation?.isDirectory() || rootInformation.isSymbolicLink()) {
    throw new Error(`Refusing to clean an invalid repository root: ${root}`);
  }
  for (const marker of ["Makefile", "cmd/validex/package.json"]) {
    if (!(await inspectPath(root, marker))?.isFile()) {
      throw new Error(`Repository marker is missing: ${join(root, marker)}`);
    }
  }

  const candidates = [...fixedOutputs];
  for (const parent of buildRoots) {
    candidates.push(...await matchingChildren(root, parent,
      (name) => /^\.(?:electron-|validex-icon-).+/.test(name)));
  }
  candidates.push(...await matchingChildren(root, frontendRoot,
    (name) => /^\.(?:dist|\.dev-dist)-staging-.+/.test(name) || name.endsWith(".tsbuildinfo")));
  candidates.push(...await matchingChildren(root, "cmd/validex/electron",
    (name) => name.endsWith(".tsbuildinfo")));
  candidates.push(...await matchingChildren(root, "cmd/validex",
    (name) => /^app_[a-zA-Z0-9_]+\.syso$/.test(name)));
  for (const parent of [`${frontendRoot}/dist`, "tests/e2e/artifacts"]) {
    candidates.push(...await matchingChildren(root, parent, (name) => name !== ".gitkeep"));
  }

  // Complete the safety checks before the first mutation, so an unsafe later
  // target cannot cause a partially completed cleanup of earlier targets.
  const targets = [];
  for (const name of new Set(candidates)) {
    if (await inspectPath(root, name)) targets.push(name);
  }
  for (const name of targets) {
    await inspectPath(root, name);
    // rm unlinks symlinks inside generated trees without following them. macOS
    // Electron bundles contain these links, so they must remain removable.
    await rm(join(root, name), { recursive: true, force: true, maxRetries: 3 });
  }
  return targets;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) {
  try {
    if (process.argv.length > 2) throw new Error("Usage: node scripts/clean-cache.mjs");
    const removed = await cleanProjectCache();
    process.stdout.write(`Removed ${removed.length} generated build/cache entries.\n`);
  } catch (error) {
    process.stderr.write(`cache_del: ${error.message}\n`);
    process.exitCode = 1;
  }
}
