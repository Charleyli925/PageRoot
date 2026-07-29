import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

export const DEVELOPER_PREVIEW_ARTIFACT_PATTERN =
  "PageRoot-${version}-developer-preview-${arch}.${ext}";

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
  releaseDirectory,
}) {
  assertArchitecture(architecture);
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
    `--config.directories.output=${releaseDirectory}`,
    `--config.artifactName=${DEVELOPER_PREVIEW_ARTIFACT_PATTERN}`,
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
  repository,
  version,
  architecture,
  results,
  createdAt = new Date(),
}) {
  assertArchitecture(architecture);
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

  const attestation = {
    schemaVersion: 1,
    kind: "developer-preview",
    releaseEligible: false,
    notarized: false,
    version,
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
