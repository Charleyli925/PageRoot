#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { writeBuildInfo } from "./release-provenance.mjs";
import { expectedArtifactLayout } from "./verify-packaged-artifact.mjs";
import { createTelemetryBuildConfig } from "../desktop/usage-telemetry.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const productRoot = path.resolve(path.dirname(scriptPath), "..");

function parseArchitecture(argv) {
  if (argv.length !== 2 || argv[0] !== "--arch" || !/^(?:arm64|x64)$/u.test(argv[1])) {
    throw new Error("Usage: node scripts/build-package.mjs --arch <arm64|x64>");
  }
  return argv[1];
}

async function runCommand(command, arguments_, { environment = process.env } = {}) {
  const child = spawn(command, arguments_, {
    cwd: productRoot,
    env: environment,
    stdio: "inherit",
  });
  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error(`${path.basename(command)} ended by ${signal}`));
      else resolve(code ?? 1);
    });
  });
  if (exitCode !== 0) {
    throw new Error(`${path.basename(command)} exited with code ${exitCode}`);
  }
}

function requiredNotarizationCredentials(environment) {
  const credentials = {
    appleId: environment.APPLE_ID,
    password: environment.APPLE_APP_SPECIFIC_PASSWORD,
    teamId: environment.APPLE_TEAM_ID,
  };
  const missing = Object.entries(credentials)
    .filter(([, value]) => typeof value !== "string" || value.length === 0)
    .map(([name]) => name);
  if (missing.length > 0) {
    throw new Error(`DMG notarization credentials are missing: ${missing.join(", ")}`);
  }
  return credentials;
}

export async function notarizeAndStapleDmg({
  dmgPath,
  environment = process.env,
  commandRunner = runCommand,
}) {
  if (environment.PAGEROOT_REQUIRE_NOTARIZATION !== "1") {
    return { skipped: true };
  }
  await access(dmgPath);
  const credentials = requiredNotarizationCredentials(environment);
  await commandRunner(
    "/usr/bin/xcrun",
    [
      "notarytool",
      "submit",
      dmgPath,
      "--apple-id",
      credentials.appleId,
      "--password",
      credentials.password,
      "--team-id",
      credentials.teamId,
      "--wait",
    ],
    { environment },
  );
  await commandRunner(
    "/usr/bin/xcrun",
    ["stapler", "staple", dmgPath],
    { environment },
  );
  await commandRunner(
    "/usr/bin/xcrun",
    ["stapler", "validate", dmgPath],
    { environment },
  );
  return { skipped: false };
}

function normalizedYamlUrl(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export async function refreshDmgUpdateMetadata({ dmgPath, updateInfoPath }) {
  const [dmgBytes, dmgInfo, updateInfo] = await Promise.all([
    readFile(dmgPath),
    stat(dmgPath),
    readFile(updateInfoPath, "utf8"),
  ]);
  const dmgName = path.basename(dmgPath);
  const lines = updateInfo.split("\n");
  const matchingEntries = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^\s{2}- url:\s*(.+?)\s*$/u);
    if (match && normalizedYamlUrl(match[1]) === dmgName) matchingEntries.push(index);
  }
  if (matchingEntries.length === 0) return { updated: false };
  if (matchingEntries.length !== 1) {
    throw new Error(`latest-mac.yml contains duplicate DMG entries for ${dmgName}`);
  }

  const entryStart = matchingEntries[0];
  const entryEnd = lines.findIndex(
    (line, index) => index > entryStart && /^\s{2}- url:/u.test(line),
  );
  const effectiveEnd = entryEnd === -1 ? lines.length : entryEnd;
  const sha512 = createHash("sha512").update(dmgBytes).digest("base64");
  let shaUpdated = false;
  let sizeUpdated = false;
  for (let index = entryStart + 1; index < effectiveEnd; index += 1) {
    if (/^\s{4}sha512:/u.test(lines[index])) {
      lines[index] = `    sha512: ${sha512}`;
      shaUpdated = true;
    } else if (/^\s{4}size:/u.test(lines[index])) {
      lines[index] = `    size: ${dmgInfo.size}`;
      sizeUpdated = true;
    }
  }
  if (!shaUpdated || !sizeUpdated) {
    throw new Error(`latest-mac.yml DMG entry is incomplete for ${dmgName}`);
  }
  const finalizedUpdateInfo = lines.join("\n");
  await writeFile(updateInfoPath, finalizedUpdateInfo, "utf8");
  return {
    updated: true,
    sha512,
    size: dmgInfo.size,
  };
}

export async function writeUsageTelemetryBuildConfig({
  productRoot: root = productRoot,
  environment = process.env,
} = {}) {
  const config = createTelemetryBuildConfig(environment);
  if (
    environment.PAGEROOT_REQUIRE_TELEMETRY_CONFIG === "1"
    && !config.enabled
  ) {
    throw new Error(
      "PAGEROOT_POSTHOG_TOKEN is required for a telemetry-enabled release candidate.",
    );
  }
  const destination = path.join(
    root,
    "output",
    "release-metadata",
    "usage-telemetry-config.json",
  );
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify(config, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  return {
    destination,
    enabled: config.enabled,
    host: config.host,
  };
}

async function main() {
  const architecture = parseArchitecture(process.argv.slice(2));
  const packageJson = JSON.parse(
    await readFile(path.join(productRoot, "package.json"), "utf8"),
  );
  const layout = expectedArtifactLayout({ productRoot, packageJson, arch: architecture });
  const { buildInfo, destination } = await writeBuildInfo({ productRoot, architecture });
  const telemetryConfig = await writeUsageTelemetryBuildConfig({ productRoot });
  console.log(`Build provenance: ${destination}`);
  console.log(`Git commit: ${buildInfo.commitSha}`);
  console.log(
    telemetryConfig.enabled
      ? `Usage telemetry configured for ${telemetryConfig.host}`
      : "Usage telemetry build config has no project token; collection will remain inactive.",
  );

  const executable = path.join(
    productRoot,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "electron-builder.cmd" : "electron-builder",
  );
  // A release tag makes electron-builder infer `--publish onTagOrDraft` unless
  // publishing is disabled explicitly. PageRoot publishes only after the DMG
  // and updater assets have passed the artifact gate in the Release workflow.
  const child = spawn(
    executable,
    ["--mac", "dmg", "zip", `--${architecture}`, "--publish", "never"],
    {
      cwd: productRoot,
      env: process.env,
      stdio: "inherit",
    },
  );
  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error(`electron-builder ended by ${signal}`));
      else resolve(code ?? 1);
    });
  });
  if (exitCode !== 0) {
    process.exitCode = exitCode;
    return;
  }

  const notarization = await notarizeAndStapleDmg({ dmgPath: layout.dmgPath });
  if (!notarization.skipped) {
    const metadata = await refreshDmgUpdateMetadata({
      dmgPath: layout.dmgPath,
      updateInfoPath: layout.updateInfoPath,
    });
    console.log(`DMG notarization ticket stapled and validated: ${layout.dmgPath}`);
    console.log(
      metadata.updated
        ? `Final DMG metadata refreshed: ${layout.updateInfoPath}`
        : "latest-mac.yml advertises only the updater ZIP; no DMG entry required refresh",
    );
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  });
}
