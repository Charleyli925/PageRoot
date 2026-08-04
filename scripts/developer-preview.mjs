import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

export const DEVELOPER_PREVIEW_PRODUCT_NAME = "PageRoot Developer Preview";
export const DEVELOPER_PREVIEW_APP_ID_SUFFIX = ".developer-preview";
export const DEVELOPER_PREVIEW_ARTIFACT_PATTERN =
  "PageRoot-Developer-Preview-${version}-${arch}.${ext}";

const STABLE_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const DEVELOPER_VERSION_MARKER = "999";

const SENSITIVE_BUILD_ENVIRONMENT = new Set([
  "APPLE_API_ISSUER",
  "APPLE_API_KEY",
  "APPLE_API_KEY_ID",
  "APPLE_APP_SPECIFIC_PASSWORD",
  "APPLE_ID",
  "APPLE_KEYCHAIN",
  "APPLE_KEYCHAIN_PROFILE",
  "APPLE_TEAM_ID",
  "CSC_KEY_PASSWORD",
  "CSC_LINK",
  "CSC_NAME",
  "GH_TOKEN",
  "GITHUB_TOKEN",
  "NPM_TOKEN",
  "PAGEROOT_POSTHOG_HOST",
  "PAGEROOT_POSTHOG_TOKEN",
]);

function assertArchitecture(architecture) {
  assert.match(architecture ?? "", /^(?:arm64|x64)$/u, "architecture must be arm64 or x64");
}

function parseStableVersion(version, label = "stable version") {
  const match = STABLE_VERSION_PATTERN.exec(version ?? "");
  assert.ok(match, `${label} must contain exactly three numeric components`);
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function compareStableVersions(left, right) {
  return left.major - right.major
    || left.minor - right.minor
    || left.patch - right.patch;
}

function gitOutput(productRoot, arguments_) {
  const result = spawnSync("git", arguments_, {
    cwd: productRoot,
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `git ${arguments_.join(" ")} failed: ${(result.stderr || result.stdout).trim()}`,
    );
  }
  return result.stdout.trim();
}

export function developerPreviewVersion({ stableVersion, buildSequence }) {
  const parsed = parseStableVersion(stableVersion);
  assert.equal(
    Number.isSafeInteger(buildSequence) && buildSequence > 0,
    true,
    "developer preview build sequence must be a positive safe integer",
  );
  const nextPatch = parsed.patch + 1;
  assert.equal(
    Number.isSafeInteger(nextPatch),
    true,
    "developer preview next patch must be a safe integer",
  );
  return `${parsed.major}.${parsed.minor}.${nextPatch}${DEVELOPER_VERSION_MARKER}${buildSequence}`;
}

export function createDeveloperPreviewIdentity({
  packageJson,
  stableVersion,
  stableTag = `v${stableVersion}`,
  buildSequence,
}) {
  assert.equal(typeof packageJson?.version, "string", "source package version must be configured");
  assert.equal(
    typeof packageJson?.build?.appId,
    "string",
    "source build.appId must be configured",
  );
  parseStableVersion(stableVersion);
  assert.equal(stableTag, `v${stableVersion}`, "stable tag must match the stable version");
  const version = developerPreviewVersion({ stableVersion, buildSequence });
  return Object.freeze({
    kind: "developer-preview",
    sourceVersion: packageJson.version,
    stableVersion,
    stableTag,
    buildSequence,
    version,
    productName: DEVELOPER_PREVIEW_PRODUCT_NAME,
    appId: `${packageJson.build.appId}${DEVELOPER_PREVIEW_APP_ID_SUFFIX}`,
    artifactPattern: DEVELOPER_PREVIEW_ARTIFACT_PATTERN,
  });
}

export function resolveDeveloperPreviewIdentity({ productRoot, packageJson }) {
  assert.equal(path.isAbsolute(productRoot), true, "product root must be absolute");
  const stableTags = gitOutput(productRoot, ["tag", "--merged", "HEAD", "--list", "v*"])
    .split("\n")
    .filter(Boolean)
    .flatMap((tag) => {
      const match = /^v(.+)$/u.exec(tag);
      if (!match || !STABLE_VERSION_PATTERN.test(match[1])) return [];
      return [{ tag, version: match[1], parsed: parseStableVersion(match[1]) }];
    })
    .sort((left, right) => compareStableVersions(left.parsed, right.parsed));
  const stable = stableTags.at(-1);
  assert.ok(
    stable,
    "developer preview packaging requires an official v<major>.<minor>.<patch> tag in HEAD history",
  );
  const buildSequence = Number(gitOutput(productRoot, [
    "rev-list",
    "--count",
    "--first-parent",
    `${stable.tag}..HEAD`,
  ]));
  assert.equal(
    Number.isSafeInteger(buildSequence) && buildSequence > 0,
    true,
    "developer preview packaging requires at least one committed change after the latest official tag",
  );
  return createDeveloperPreviewIdentity({
    packageJson,
    stableVersion: stable.version,
    stableTag: stable.tag,
    buildSequence,
  });
}

export function developerPreviewPackageJson(packageJson, identity) {
  assert.equal(identity?.kind, "developer-preview", "developer preview identity is required");
  return {
    ...packageJson,
    version: identity.version,
    productName: identity.productName,
    build: {
      ...packageJson.build,
      appId: identity.appId,
      productName: identity.productName,
      artifactName: identity.artifactPattern,
    },
  };
}

export function developerPreviewRoot(productRoot) {
  return path.resolve(productRoot, "output", "developer-preview");
}

export function developerPreviewReleaseDirectory(productRoot) {
  return path.join(developerPreviewRoot(productRoot), "release");
}

export function developerPreviewArtifactName({ version, architecture }) {
  assert.equal(typeof version, "string", "developer preview version must be configured");
  assertArchitecture(architecture);
  return DEVELOPER_PREVIEW_ARTIFACT_PATTERN
    .replaceAll("${version}", version)
    .replaceAll("${arch}", architecture)
    .replaceAll("${ext}", "dmg");
}

export function developerPreviewBuilderArguments({
  architecture,
  identity,
  releaseDirectory,
}) {
  assertArchitecture(architecture);
  assert.equal(identity?.kind, "developer-preview", "developer preview identity is required");
  assert.equal(
    path.isAbsolute(releaseDirectory),
    true,
    "developer preview release directory must be absolute",
  );
  return [
    "--mac",
    "dmg",
    `--${architecture}`,
    "--publish",
    "never",
    "--config.forceCodeSigning=false",
    "--config.mac.identity=-",
    "--config.mac.notarize=false",
    "--config.mac.hardenedRuntime=false",
    `--config.appId=${identity.appId}`,
    `--config.productName=${identity.productName}`,
    `--config.extraMetadata.productName=${identity.productName}`,
    `--config.extraMetadata.version=${identity.version}`,
    `--config.buildVersion=${identity.version}`,
    `--config.mac.bundleVersion=${identity.version}`,
    `--config.mac.bundleShortVersion=${identity.version}`,
    `--config.directories.output=${releaseDirectory}`,
    `--config.artifactName=${identity.artifactPattern}`,
  ];
}

export function developerPreviewEnvironment(environment = process.env) {
  const sanitized = { ...environment };
  for (const name of SENSITIVE_BUILD_ENVIRONMENT) delete sanitized[name];
  return {
    ...sanitized,
    CSC_IDENTITY_AUTO_DISCOVERY: "false",
    PAGEROOT_REQUIRE_NOTARIZATION: "0",
    PAGEROOT_REQUIRE_TELEMETRY_CONFIG: "0",
  };
}

export async function writeDeveloperPreviewAttestation({
  productRoot,
  artifact,
  identity,
  repository,
  architecture,
  results,
  createdAt = new Date(),
}) {
  assertArchitecture(architecture);
  assert.equal(identity?.kind, "developer-preview", "developer preview identity is required");
  assert.match(repository?.head ?? "", /^[a-f0-9]{40}$/u, "developer preview commit is invalid");
  assert.match(repository?.tree ?? "", /^[a-f0-9]{40}$/u, "developer preview tree is invalid");
  assert.equal(repository?.dirty, false, "developer preview source must be clean");
  assert.equal(Array.isArray(results), true, "developer preview results must be an array");
  assert.ok(results.length > 0, "developer preview results must not be empty");
  assert.ok(
    results.every((result) => result?.status === "passed"),
    "developer preview attestation requires every automated check to pass",
  );

  const previewRoot = developerPreviewRoot(productRoot);
  const resolvedDmgPath = path.resolve(artifact.dmgPath);
  assert.ok(
    resolvedDmgPath.startsWith(`${previewRoot}${path.sep}`),
    "developer preview DMG must stay under output/developer-preview",
  );
  const [dmgBytes, dmgInfo] = await Promise.all([
    readFile(resolvedDmgPath),
    stat(resolvedDmgPath),
  ]);
  assert.ok(dmgInfo.isFile(), "developer preview DMG must be a file");
  assert.equal(
    path.basename(resolvedDmgPath),
    developerPreviewArtifactName({
      version: identity.version,
      architecture,
    }),
    "developer preview DMG name does not match its identity",
  );

  const attestation = {
    schemaVersion: 2,
    kind: "developer-preview",
    releaseEligible: false,
    notarized: false,
    sourceVersion: identity.sourceVersion,
    stableVersion: identity.stableVersion,
    stableTag: identity.stableTag,
    buildSequence: identity.buildSequence,
    version: identity.version,
    productName: identity.productName,
    bundleIdentifier: identity.appId,
    architecture,
    commitSha: repository.head,
    treeSha: repository.tree,
    createdAt: createdAt.toISOString(),
    artifact: {
      file: path.basename(resolvedDmgPath),
      size: dmgInfo.size,
      sha256: createHash("sha256").update(dmgBytes).digest("hex"),
    },
    automatedChecks: results.map((result) => result.id),
  };
  const destination = path.join(previewRoot, "developer-preview.json");
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify(attestation, null, 2)}\n`, "utf8");
  return { attestation, destination };
}
