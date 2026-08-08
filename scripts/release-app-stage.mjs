import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { notarize } from "@electron/notarize";
import { signAsync } from "@electron/osx-sign";
import {
  createKeychain,
  findIdentity,
  removeKeychain,
} from "app-builder-lib/out/codeSign/macCodeSign.js";
import { TmpDir } from "temp-file";

import {
  assertBuildInfo,
  buildInfoRelativePath,
  expectedBuildInfo,
} from "./release-provenance.mjs";

const RELEASE_CREDENTIAL_ENVIRONMENT = new Set([
  "APPLE_API_ISSUER",
  "APPLE_API_KEY",
  "APPLE_API_KEY_ID",
  "APPLE_APP_SPECIFIC_PASSWORD",
  "APPLE_ID",
  "APPLE_KEYCHAIN",
  "APPLE_KEYCHAIN_PROFILE",
  "APPLE_TEAM_ID",
  "CSC_FOR_PULL_REQUEST",
  "CSC_INSTALLER_KEY_PASSWORD",
  "CSC_INSTALLER_LINK",
  "CSC_KEY_PASSWORD",
  "CSC_KEYCHAIN",
  "CSC_LINK",
  "CSC_NAME",
  "GH_TOKEN",
  "GITHUB_TOKEN",
  "NPM_TOKEN",
]);
export const RELEASE_DRY_RUN_TELEMETRY_TOKEN = "phc_release_dry_run_oracle";
export const RELEASE_DRY_RUN_TELEMETRY_HOST = "https://us.i.posthog.com";

function assertArchitecture(architecture) {
  assert.match(architecture ?? "", /^(?:arm64|x64)$/u, "architecture must be arm64 or x64");
}

function architectureDirectory(architecture) {
  assertArchitecture(architecture);
  return architecture === "arm64" ? "mac-arm64" : "mac";
}

function withoutReleaseCredentials(environment) {
  const sanitized = { ...environment };
  for (const name of RELEASE_CREDENTIAL_ENVIRONMENT) delete sanitized[name];
  return {
    ...sanitized,
    CSC_IDENTITY_AUTO_DISCOVERY: "false",
    PAGEROOT_REQUIRE_NOTARIZATION: "0",
  };
}

function requiredCredential(environment, name) {
  const value = environment[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Required release credential is not configured: ${name}`);
  }
  return value;
}

function assertManagedReleaseApp(productRoot, appPath, profile) {
  const outputChild = profile === "candidate"
    ? "release-candidate"
    : profile === "release-dry-run"
      ? "release-dry-run"
      : null;
  assert.ok(outputChild, "release app profile must be candidate or release-dry-run");
  const candidateRoot = path.resolve(productRoot, "output", outputChild);
  const resolved = path.resolve(appPath);
  const relative = path.relative(candidateRoot, resolved);
  assert.ok(
    relative !== ""
      && !relative.startsWith("..")
      && !path.isAbsolute(relative)
      && path.extname(resolved) === ".app",
    `${profile} app must stay under output/${outputChild}`,
  );
  return resolved;
}

function assertManagedCandidateApp(productRoot, appPath) {
  return assertManagedReleaseApp(productRoot, appPath, "candidate");
}

async function defaultCommandRunner(command, arguments_, { environment = process.env } = {}) {
  const child = spawn(command, arguments_, {
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

export function candidateAppReleaseDirectory(productRoot) {
  return path.resolve(productRoot, "output", "release-candidate", "staged");
}

export function releaseDryRunAppReleaseDirectory(productRoot) {
  return path.resolve(productRoot, "output", "release-dry-run", "staged");
}

export function candidateAppPath({
  productRoot,
  packageJson,
  architecture,
}) {
  assert.equal(
    typeof packageJson?.build?.productName,
    "string",
    "build.productName must be configured",
  );
  return path.join(
    candidateAppReleaseDirectory(productRoot),
    architectureDirectory(architecture),
    `${packageJson.build.productName}.app`,
  );
}

export function releaseDryRunAppPath({
  productRoot,
  packageJson,
  architecture,
}) {
  assert.equal(
    typeof packageJson?.build?.productName,
    "string",
    "build.productName must be configured",
  );
  return path.join(
    releaseDryRunAppReleaseDirectory(productRoot),
    architectureDirectory(architecture),
    `${packageJson.build.productName}.app`,
  );
}

function adHocAppBuilderArguments({
  architecture,
  releaseDirectory,
}) {
  assertArchitecture(architecture);
  assert.equal(path.isAbsolute(releaseDirectory), true, "app output must be absolute");
  return [
    "--mac",
    "dir",
    `--${architecture}`,
    "--publish",
    "never",
    "--config.forceCodeSigning=false",
    "--config.mac.identity=-",
    "--config.mac.notarize=false",
    "--config.mac.hardenedRuntime=false",
    `--config.directories.output=${releaseDirectory}`,
  ];
}

export function candidateAppBuilderArguments({
  architecture,
  releaseDirectory,
}) {
  return adHocAppBuilderArguments({ architecture, releaseDirectory });
}

export function releaseDryRunAppBuilderArguments({
  architecture,
  releaseDirectory,
}) {
  assertArchitecture(architecture);
  assert.equal(path.isAbsolute(releaseDirectory), true, "app output must be absolute");
  return [
    "--mac",
    "dir",
    `--${architecture}`,
    "--publish",
    "never",
    "--config.forceCodeSigning=false",
    "--config.mac.identity=null",
    "--config.mac.notarize=false",
    "--config.mac.hardenedRuntime=false",
    `--config.directories.output=${releaseDirectory}`,
  ];
}

export function candidateArtifactBuilderArguments({
  architecture,
  prepackagedAppPath,
  releaseDirectory,
}) {
  assertArchitecture(architecture);
  assert.equal(path.isAbsolute(prepackagedAppPath), true, "prepackaged app path must be absolute");
  assert.equal(path.extname(prepackagedAppPath), ".app", "prepackaged path must name an app");
  assert.equal(path.isAbsolute(releaseDirectory), true, "release output must be absolute");
  return [
    "--mac",
    "dmg",
    "zip",
    `--${architecture}`,
    "--publish",
    "never",
    `--prepackaged=${prepackagedAppPath}`,
    "--config.forceCodeSigning=false",
    "--config.mac.identity=null",
    "--config.mac.notarize=false",
    `--config.directories.output=${releaseDirectory}`,
  ];
}

export function candidateAppEnvironment(environment = process.env) {
  return {
    ...withoutReleaseCredentials(environment),
    PAGEROOT_REQUIRE_TELEMETRY_CONFIG: "1",
  };
}

export function releaseDryRunAppEnvironment(environment = process.env) {
  return {
    ...withoutReleaseCredentials(environment),
    PAGEROOT_POSTHOG_TOKEN: RELEASE_DRY_RUN_TELEMETRY_TOKEN,
    PAGEROOT_POSTHOG_HOST: RELEASE_DRY_RUN_TELEMETRY_HOST,
    PAGEROOT_REQUIRE_TELEMETRY_CONFIG: "1",
  };
}

export function candidateArtifactBuilderEnvironment(environment = process.env) {
  const sanitized = withoutReleaseCredentials(environment);
  delete sanitized.PAGEROOT_POSTHOG_HOST;
  delete sanitized.PAGEROOT_POSTHOG_TOKEN;
  return {
    ...sanitized,
    PAGEROOT_REQUIRE_TELEMETRY_CONFIG: "0",
  };
}

export async function signCandidateApp({
  productRoot,
  appPath,
  packageJson,
  environment = process.env,
  platform = process.platform,
  dependencies = {},
}) {
  assert.equal(platform, "darwin", "release app signing requires macOS");
  const resolvedAppPath = assertManagedCandidateApp(productRoot, appPath);
  const cscLink = requiredCredential(environment, "CSC_LINK");
  const cscKeyPassword = requiredCredential(environment, "CSC_KEY_PASSWORD");
  const temporaryDirectory = dependencies.temporaryDirectory ?? new TmpDir("pageroot-sign");
  const createSigningKeychain = dependencies.createSigningKeychain ?? createKeychain;
  const resolveIdentity = dependencies.resolveIdentity ?? findIdentity;
  const signApplication = dependencies.signApplication ?? signAsync;
  const deleteSigningKeychain = dependencies.deleteSigningKeychain ?? removeKeychain;
  let keychainFile = null;
  try {
    const keychain = await createSigningKeychain({
      tmpDir: temporaryDirectory,
      cscLink,
      cscKeyPassword,
      currentDir: productRoot,
    });
    keychainFile = keychain.keychainFile;
    const identity = await resolveIdentity(
      "Developer ID Application",
      environment.CSC_NAME || null,
      keychainFile,
    );
    assert.ok(identity, "Developer ID Application identity was not found");
    const entitlements = path.resolve(
      productRoot,
      packageJson.build?.mac?.entitlements ?? "desktop/resources/entitlements.mac.plist",
    );
    const entitlementsInherit = path.resolve(
      productRoot,
      packageJson.build?.mac?.entitlementsInherit
        ?? "desktop/resources/entitlements.mac.plist",
    );
    await signApplication({
      app: resolvedAppPath,
      // Keep the human-readable identity (including its Team ID) available to
      // osx-sign's entitlement preparation. A certificate hash alone cannot be
      // used to derive ElectronTeamID when the staged app has none yet.
      identity: identity.name,
      identityValidation: false,
      keychain: keychainFile || undefined,
      optionsForFile(filePath) {
        return {
          entitlements: filePath === resolvedAppPath ? entitlements : entitlementsInherit,
          hardenedRuntime: true,
        };
      },
      platform: "darwin",
      preAutoEntitlements: packageJson.build?.mac?.preAutoEntitlements,
      strictVerify: packageJson.build?.mac?.strictVerify ?? true,
      type: "distribution",
      version: packageJson.devDependencies?.electron,
    });
    return {
      appPath: resolvedAppPath,
      identity: identity.name,
    };
  } finally {
    try {
      if (keychainFile) await deleteSigningKeychain(keychainFile);
    } finally {
      await temporaryDirectory.cleanup();
    }
  }
}

export async function notarizeCandidateApp({
  productRoot,
  appPath,
  environment = process.env,
  platform = process.platform,
  dependencies = {},
}) {
  assert.equal(platform, "darwin", "release app notarization requires macOS");
  const resolvedAppPath = assertManagedCandidateApp(productRoot, appPath);
  const appleId = requiredCredential(environment, "APPLE_ID");
  const appleIdPassword = requiredCredential(
    environment,
    "APPLE_APP_SPECIFIC_PASSWORD",
  );
  const teamId = requiredCredential(environment, "APPLE_TEAM_ID");
  const notarizeApplication = dependencies.notarizeApplication ?? notarize;
  const commandRunner = dependencies.commandRunner ?? defaultCommandRunner;
  await notarizeApplication({
    appPath: resolvedAppPath,
    appleId,
    appleIdPassword,
    teamId,
    tool: "notarytool",
  });
  await commandRunner(
    "/usr/bin/xcrun",
    ["stapler", "staple", resolvedAppPath],
    { environment },
  );
  await commandRunner(
    "/usr/bin/xcrun",
    ["stapler", "validate", resolvedAppPath],
    { environment },
  );
  return { appPath: resolvedAppPath };
}

export async function restoreReleaseMetadataFromApp({
  productRoot,
  appPath,
  architecture,
  profile = "candidate",
  expectedBuildInfoResolver = expectedBuildInfo,
}) {
  const resolvedAppPath = assertManagedReleaseApp(productRoot, appPath, profile);
  const resourcesPath = path.join(resolvedAppPath, "Contents", "Resources");
  const buildInfoBytes = await readFile(path.join(resourcesPath, "build-info.json"));
  const telemetryBytes = await readFile(
    path.join(resourcesPath, "usage-telemetry-config.json"),
  );
  const expected = await expectedBuildInfoResolver({
    productRoot,
    architecture,
    requireClean: true,
  });
  const buildInfo = assertBuildInfo(JSON.parse(buildInfoBytes.toString("utf8")), expected);
  const telemetry = JSON.parse(telemetryBytes.toString("utf8"));
  assert.equal(telemetry?.version, 1, "candidate telemetry config schema is unsupported");
  assert.equal(telemetry?.enabled, true, "candidate telemetry config must be enabled");
  assert.match(
    telemetry?.projectToken ?? "",
    /^phc_[A-Za-z0-9_-]{12,256}$/u,
    "candidate telemetry config has no public project token",
  );
  assert.equal(
    telemetry?.host,
    "https://us.i.posthog.com",
    "candidate telemetry host is unexpected",
  );
  const metadataDirectory = path.join(productRoot, "output", "release-metadata");
  await mkdir(metadataDirectory, { recursive: true });
  await Promise.all([
    writeFile(path.join(productRoot, buildInfoRelativePath), buildInfoBytes),
    writeFile(
      path.join(metadataDirectory, "usage-telemetry-config.json"),
      telemetryBytes,
      { mode: 0o600 },
    ),
  ]);
  return {
    buildInfo,
    telemetry,
  };
}
