#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { join } from "node:path";
import {
  applicationBuildMetadata, applicationRoot, readApplicationIdentity,
  repositoryRoot, writeBuildIdentity,
} from "./application-build-identity.mjs";
import { signMacExecutable } from "./mac-application-signing.mjs";
import { stampWindowsExecutable } from "./windows-application-identity.mjs";

const components = process.argv.slice(2);
if (!components.length) components.push("backend", "cli");
if (components.some((component) => !["backend", "cli"].includes(component))) {
  throw new Error("Usage: node scripts/build-go.mjs [backend] [cli]");
}
const identity = await readApplicationIdentity();
const goEnvironment = JSON.parse(execFileSync("go", ["env", "-json", "GOOS", "GOARCH"], {
  cwd: repositoryRoot, encoding: "utf8",
}));
const platform = goEnvironment.GOOS === "windows" ? "win32" : goEnvironment.GOOS;
const architecture = { amd64: "x64", "386": "ia32" }[goEnvironment.GOARCH] ?? goEnvironment.GOARCH;
const metadata = await applicationBuildMetadata({ platform, architecture });
const output = join(applicationRoot, "build/bin");
await writeBuildIdentity(output, metadata);
for (const component of components) {
  const name = identity[`${component}ProcessName`];
  const executable = join(output, `${name}${platform === "win32" ? ".exe" : ""}`);
  execFileSync("go", ["build", "-trimpath", "-ldflags",
    `-X validex/internal/appidentity.Version=${metadata.version} -X validex/internal/appidentity.Revision=${metadata.revision}`,
    "-o", executable, `./cmd/${name}`,
  ], { cwd: repositoryRoot, stdio: "inherit" });
  if (platform === "darwin" && process.platform === "darwin") {
    await signMacExecutable(executable, identity.applicationID);
  } else if (platform === "win32" && process.platform === "win32") {
    await stampWindowsExecutable({ executable, component, identity, metadata });
  } else if (platform === "win32") {
    process.stderr.write("Windows resource branding requires a native Windows packaging build.\n");
  }
  process.stdout.write(`Built ${name} ${metadata.version} (${metadata.revision}) at ${executable}\n`);
}
