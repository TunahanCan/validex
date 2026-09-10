#!/usr/bin/env node

import { join } from "node:path";
import process from "node:process";
import {
  acquireBuildLock,
  buildPaths,
  defaultProjectRoot,
  runProcess,
} from "./build.mjs";

const paths = buildPaths(defaultProjectRoot);
const lock = await acquireBuildLock(defaultProjectRoot);
try {
  // Retained internal modules remain testable without entering the production
  // entry graph. Hold its lock while writing and reading the shared emit tree.
  await runProcess(process.execPath, [
    paths.compiler,
    "-p", join(defaultProjectRoot, "tsconfig.test.json"),
  ], { cwd: defaultProjectRoot, stdio: "inherit" });
  await runProcess(process.execPath, ["--test"], {
    cwd: defaultProjectRoot,
    stdio: "inherit",
  });
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
} finally {
  await lock.release();
}
