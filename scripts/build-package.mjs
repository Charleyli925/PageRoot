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

import {
  DEVELOPER_PREVIEW_ARTIFACT_PATTERN,
  developerPreviewBuilderArguments,
  developerPreviewEnvironment,
  developerPreviewPackageJson,
  developerPreviewReleaseDirectory,
  resolveDeveloperPreviewIdentity,
} from "./developer-preview.mjs";
import { writeApplicationUpdateConfig } from "./application-update-config.mjs";
import {
  candidateAppBuilderArguments,
  candidateAppEnvironment,
  candidateAppReleaseDirectory,
  candidateArtifactBuilderArguments,
  candidateArtifactBuilderEnvironment,
  releaseDryRunAppBuilderArguments,
  releaseDryRunAppEnvironment,
  releaseDryRunAppReleaseDirectory,
  restoreReleaseMetadataFromApp,
} from "./release-app-stage.mjs";
import { writeBuildInfo } from "./release-provenance.mjs";
import { expectedArtifactLayout } from "./verify-packaged-artifact.mjs";
import { createTelemetryBuildConfig } from "../desktop/usage-telemetry.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const productRoot = path.resolve(path.dirname(scriptPath), "..");

export function parseBuildOptions(argv) {
  const options = {
    architecture: null,
    prepackagedAppPath: null,
    profile: "release",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--arch") {
      options.architecture = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (argument === "--profile") {
      options.profile = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (argument === "--prepackaged") {
      options.prepackagedAppPath = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    throw new Error(`Unknown package-build argument: ${argument}`);
  }
  if (!/^(?:arm64|x64)$/u.test(options.architecture ?? "")) {
    throw new Error("--arch must be arm64 or x64.");
  }
  if (!/^(?:release|developer|candidate-app|candidate-artifacts|release-dry-run)$/u.test(options.profile)) {
    throw new Error(
      "--profile must be release, developer, candidate-app, candidate-artifacts or release-dry-run.",
    );
  }
  if (options.profile === "candidate-artifacts") {
    if (
      typeof options.prepackagedAppPath !== "string"
      || !path.isAbsolute(options.prepackagedAppPath)
      || path.extname(options.prepackagedAppPath) !== ".app"
    ) {
      throw new Error("candidate-artifacts requires --prepackaged with an absolute .app path.");
    }
  } else if (options.prepackagedAppPath !== null) {
    throw new Error("--prepackaged is allowed only with the candidate-artifacts profile.");
  }
  return options;
}

export function releasePackageBuilderArguments(architecture) {
  return ["--mac", "dmg", "zip", `--${architecture}`, "--publish", "never"];
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
  const {
    architecture,
    prepackagedAppPath,
    profile,
  } = parseBuildOptions(process.argv.slice(2));
  const isDeveloperPreview = profile === "developer";
  const isCandidateApp = profile === "candidate-app";
  const isCandidateArtifacts = profile === "candidate-artifacts";
  const isReleaseDryRun = profile === "release-dry-run";
  const packageJson = JSON.parse(
    await readFile(path.join(productRoot, "package.json"), "utf8"),
  );
  const developerPreviewIdentity = isDeveloperPreview
    ? resolveDeveloperPreviewIdentity({ productRoot, packageJson })
    : null;
  const packagedPackageJson = isDeveloperPreview
    ? developerPreviewPackageJson(packageJson, developerPreviewIdentity)
    : packageJson;
  const releaseDirectory = isDeveloperPreview
    ? developerPreviewReleaseDirectory(productRoot)
    : isCandidateApp
      ? candidateAppReleaseDirectory(productRoot)
      : isReleaseDryRun
        ? releaseDryRunAppReleaseDirectory(productRoot)
        : path.resolve(
          productRoot,
          packageJson.build?.directories?.output ?? "release",
        );
  const layout = expectedArtifactLayout({
    productRoot,
    packageJson: packagedPackageJson,
    arch: architecture,
    releaseDirectory,
    artifactName: isDeveloperPreview
      ? DEVELOPER_PREVIEW_ARTIFACT_PATTERN
      : undefined,
  });
  const buildEnvironment = isDeveloperPreview
    ? developerPreviewEnvironment(process.env)
    : isCandidateApp
      ? candidateAppEnvironment(process.env)
      : isReleaseDryRun
        ? releaseDryRunAppEnvironment(process.env)
        : isCandidateArtifacts
          ? candidateArtifactBuilderEnvironment(process.env)
          : process.env;
  let buildInfo;
  let telemetryConfig;
  let applicationUpdateConfig;
  if (isCandidateArtifacts) {
    const restored = await restoreReleaseMetadataFromApp({
      productRoot,
      appPath: prepackagedAppPath,
      architecture,
    });
    buildInfo = restored.buildInfo;
    telemetryConfig = restored.telemetry;
    applicationUpdateConfig = restored.applicationUpdate;
    console.log(`Build provenance restored from signed app: ${prepackagedAppPath}`);
  } else {
    const provenance = await writeBuildInfo({
      productRoot,
      architecture,
      version: packagedPackageJson.version,
    });
    buildInfo = provenance.buildInfo;
    telemetryConfig = await writeUsageTelemetryBuildConfig({
      productRoot,
      environment: buildEnvironment,
    });
    const updateMetadata = await writeApplicationUpdateConfig({
      productRoot,
      packageJson: packagedPackageJson,
    });
    applicationUpdateConfig = updateMetadata.config;
    console.log(`Build provenance: ${provenance.destination}`);
    console.log(`Application update config: ${updateMetadata.destination}`);
  }
  console.log(`Git commit: ${buildInfo.commitSha}`);
  console.log(`Package profile: ${profile}`);
  if (developerPreviewIdentity) {
    console.log(
      `Developer preview identity: ${developerPreviewIdentity.productName} `
      + `${developerPreviewIdentity.version} `
      + `(stable ${developerPreviewIdentity.stableTag}, sequence ${developerPreviewIdentity.buildSequence})`,
    );
  }
  console.log(
    telemetryConfig.enabled
      ? `Usage telemetry configured for ${telemetryConfig.host}`
      : "Usage telemetry build config has no project token; collection will remain inactive.",
  );
  console.log(
    `Application update channel: ${applicationUpdateConfig.owner}`
      + `/${applicationUpdateConfig.repo} (${applicationUpdateConfig.releaseType})`,
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
  const builderArguments = isDeveloperPreview
    ? developerPreviewBuilderArguments({
      architecture,
      identity: developerPreviewIdentity,
      releaseDirectory,
    })
    : isCandidateApp
      ? candidateAppBuilderArguments({
        architecture,
        releaseDirectory,
      })
      : isReleaseDryRun
        ? releaseDryRunAppBuilderArguments({
          architecture,
          releaseDirectory,
        })
        : isCandidateArtifacts
          ? candidateArtifactBuilderArguments({
            architecture,
            prepackagedAppPath,
            releaseDirectory,
          })
          : releasePackageBuilderArguments(architecture);
  const child = spawn(
    executable,
    builderArguments,
    {
      cwd: productRoot,
      env: buildEnvironment,
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

  if (isCandidateApp || isReleaseDryRun) {
    console.log(
      isReleaseDryRun
        ? `Credential-free release dry-run app assembled in ${releaseDirectory}`
        : `Pre-sign candidate app assembled in ${releaseDirectory}`,
    );
    return;
  }

  const notarization = await notarizeAndStapleDmg({
    dmgPath: layout.dmgPath,
    environment: isCandidateArtifacts ? process.env : buildEnvironment,
  });
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
