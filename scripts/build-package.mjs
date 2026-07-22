#!/usr/bin/env node

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { writeBuildInfo } from "./release-provenance.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const productRoot = path.resolve(path.dirname(scriptPath), "..");

function parseArchitecture(argv) {
  if (argv.length !== 2 || argv[0] !== "--arch" || !/^(?:arm64|x64)$/u.test(argv[1])) {
    throw new Error("Usage: node scripts/build-package.mjs --arch <arm64|x64>");
  }
  return argv[1];
}

async function main() {
  const architecture = parseArchitecture(process.argv.slice(2));
  const { buildInfo, destination } = await writeBuildInfo({ productRoot, architecture });
  console.log(`Build provenance: ${destination}`);
  console.log(`Git commit: ${buildInfo.commitSha}`);

  const executable = path.join(
    productRoot,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "electron-builder.cmd" : "electron-builder",
  );
  const child = spawn(executable, ["--mac", "dmg", `--${architecture}`], {
    cwd: productRoot,
    env: process.env,
    stdio: "inherit",
  });
  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error(`electron-builder ended by ${signal}`));
      else resolve(code ?? 1);
    });
  });
  if (exitCode !== 0) process.exitCode = exitCode;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
