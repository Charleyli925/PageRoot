import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  parseBuildOptions,
  releasePackageBuilderArguments,
} from "../scripts/build-package.mjs";
import {
  DEVELOPER_PREVIEW_ARTIFACT_PATTERN,
  createDeveloperPreviewIdentity,
  developerPreviewArtifactName,
  developerPreviewBuilderArguments,
  developerPreviewEnvironment,
  developerPreviewPackageJson,
  developerPreviewReleaseDirectory,
  developerPreviewSequenceVersion,
  developerPreviewVersion,
  resolveDeveloperPreviewIdentity,
  writeDeveloperPreviewAttestation,
} from "../scripts/developer-preview.mjs";
import {
  selectGatePlan,
  validateImpactMap,
} from "../scripts/test-gate-core.mjs";

const productRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePackageJson = Object.freeze({
  name: "pageroot",
  version: "0.9.5",
  main: "desktop/main.mjs",
  build: {
    appId: "com.htmlai.workbench",
    productName: "PageRoot",
    artifactName: "PageRoot-${version}-${arch}.${ext}",
  },
});

function runGit(repository, arguments_) {
  const result = spawnSync("git", arguments_, {
    cwd: repository,
    encoding: "utf8",
  });
  assert.equal(
    result.status,
    0,
    `git ${arguments_.join(" ")} failed: ${result.stderr || result.stdout}`,
  );
  return result.stdout.trim();
}

async function createPreviewRepository() {
  const root = await mkdtemp(path.join(os.tmpdir(), "pageroot-preview-identity-"));
  const repository = path.join(root, "repository");
  const origin = path.join(root, "origin.git");
  await mkdir(repository);
  runGit(repository, ["init"]);
  runGit(repository, ["config", "user.name", "PageRoot Test"]);
  runGit(repository, ["config", "user.email", "pageroot-test@example.invalid"]);
  runGit(repository, ["init", "--bare", origin]);
  runGit(repository, ["remote", "add", "origin", origin]);
  return { root, repository };
}

function createOfficialStableTag(repository, version) {
  const tag = `v${version}`;
  runGit(repository, ["tag", "-a", tag, "-m", `PageRoot ${version}`]);
  runGit(repository, ["push", "origin", `refs/tags/${tag}`]);
}

test("developer preview versions are recognizable and advance from the latest stable patch", () => {
  assert.equal(
    developerPreviewSequenceVersion({ stableVersion: "0.9.5", buildSequence: 1 }),
    "0.9.69991",
  );
  assert.equal(
    developerPreviewSequenceVersion({ stableVersion: "0.9.5", buildSequence: 2 }),
    "0.9.69992",
  );
  assert.equal(
    developerPreviewSequenceVersion({ stableVersion: "0.9.9", buildSequence: 12 }),
    "0.9.1099912",
  );
  assert.equal(
    developerPreviewVersion({
      stableVersion: "0.9.5",
      buildSequence: 1,
      commitSha: "a".repeat(40),
    }),
    `0.9.69991-dev.g${"a".repeat(40)}`,
  );
  assert.notEqual(
    developerPreviewVersion({
      stableVersion: "0.9.5",
      buildSequence: 1,
      commitSha: "a".repeat(40),
    }),
    developerPreviewVersion({
      stableVersion: "0.9.5",
      buildSequence: 1,
      commitSha: "b".repeat(40),
    }),
    "different commits must never reuse a developer preview version",
  );
  assert.throws(
    () => developerPreviewSequenceVersion({ stableVersion: "0.9.5-beta.1", buildSequence: 1 }),
    /exactly three numeric components/u,
  );
  assert.throws(
    () => developerPreviewSequenceVersion({ stableVersion: "0.9.5", buildSequence: 0 }),
    /positive safe integer/u,
  );
  assert.throws(
    () => developerPreviewVersion({
      stableVersion: "0.9.5",
      buildSequence: 1,
      commitSha: "not-a-commit",
    }),
    /full Git SHA/u,
  );
});

test("developer preview identity uses committed first-parent order after the latest official tag", async () => {
  const { root, repository } = await createPreviewRepository();
  try {
    await writeFile(path.join(repository, "identity.txt"), "stable\n");
    runGit(repository, ["add", "identity.txt"]);
    runGit(repository, ["-c", "commit.gpgsign=false", "commit", "-m", "stable"]);
    createOfficialStableTag(repository, "0.9.5");

    await writeFile(path.join(repository, "identity.txt"), "preview one\n");
    runGit(repository, ["add", "identity.txt"]);
    runGit(repository, ["-c", "commit.gpgsign=false", "commit", "-m", "preview one"]);
    const firstCommit = runGit(repository, ["rev-parse", "HEAD"]);
    const first = resolveDeveloperPreviewIdentity({
      productRoot: repository,
      packageJson: sourcePackageJson,
    });
    assert.equal(first.stableTag, "v0.9.5");
    assert.equal(first.buildSequence, 1);
    assert.equal(first.sequenceVersion, "0.9.69991");
    assert.equal(first.commitSha, firstCommit);
    assert.equal(first.version, `0.9.69991-dev.g${firstCommit}`);

    await writeFile(path.join(repository, "identity.txt"), "preview two\n");
    runGit(repository, ["add", "identity.txt"]);
    runGit(repository, ["-c", "commit.gpgsign=false", "commit", "-m", "preview two"]);
    const secondCommit = runGit(repository, ["rev-parse", "HEAD"]);
    const second = resolveDeveloperPreviewIdentity({
      productRoot: repository,
      packageJson: sourcePackageJson,
    });
    assert.equal(second.buildSequence, 2);
    assert.equal(second.sequenceVersion, "0.9.69992");
    assert.equal(second.version, `0.9.69992-dev.g${secondCommit}`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("developer preview ignores non-official semver-shaped tags", async () => {
  const { root, repository } = await createPreviewRepository();
  try {
    await writeFile(path.join(repository, "identity.txt"), "stable\n");
    runGit(repository, ["add", "identity.txt"]);
    runGit(repository, ["-c", "commit.gpgsign=false", "commit", "-m", "stable"]);
    createOfficialStableTag(repository, "0.9.5");

    await writeFile(path.join(repository, "identity.txt"), "preview\n");
    runGit(repository, ["add", "identity.txt"]);
    runGit(repository, ["-c", "commit.gpgsign=false", "commit", "-m", "preview"]);
    runGit(repository, ["tag", "v99.0.0"]);
    runGit(repository, ["push", "origin", "refs/tags/v99.0.0"]);
    runGit(repository, ["tag", "-a", "v98.0.0", "-m", "PageRoot 98.0.0"]);

    const identity = resolveDeveloperPreviewIdentity({
      productRoot: repository,
      packageJson: sourcePackageJson,
    });
    assert.equal(identity.stableTag, "v0.9.5");
    assert.equal(identity.sequenceVersion, "0.9.69991");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("developer preview is an explicit ad-hoc DMG profile while release packaging stays unchanged", () => {
  assert.deepEqual(
    parseBuildOptions(["--arch", "arm64"]),
    { architecture: "arm64", prepackagedAppPath: null, profile: "release" },
  );
  assert.deepEqual(
    parseBuildOptions(["--profile", "developer", "--arch", "x64"]),
    { architecture: "x64", prepackagedAppPath: null, profile: "developer" },
  );
  assert.deepEqual(
    releasePackageBuilderArguments("arm64"),
    ["--mac", "dmg", "zip", "--arm64", "--publish", "never"],
  );

  const releaseDirectory = "/tmp/pageroot-developer-preview/release";
  const identity = createDeveloperPreviewIdentity({
    packageJson: sourcePackageJson,
    stableVersion: "0.9.5",
    buildSequence: 1,
    commitSha: "a".repeat(40),
  });
  assert.deepEqual(developerPreviewPackageJson(sourcePackageJson, identity), {
    ...sourcePackageJson,
    version: `0.9.69991-dev.g${"a".repeat(40)}`,
    productName: "PageRoot Developer Preview",
    build: {
      ...sourcePackageJson.build,
      appId: "com.htmlai.workbench.developer-preview",
      productName: "PageRoot Developer Preview",
      artifactName: DEVELOPER_PREVIEW_ARTIFACT_PATTERN,
    },
  });
  assert.deepEqual(
    developerPreviewBuilderArguments({
      architecture: "arm64",
      identity,
      releaseDirectory,
    }),
    [
      "--mac",
      "dmg",
      "--arm64",
      "--publish",
      "never",
      "--config.forceCodeSigning=false",
      "--config.mac.identity=-",
      "--config.mac.notarize=false",
      "--config.mac.hardenedRuntime=false",
      "--config.appId=com.htmlai.workbench.developer-preview",
      "--config.productName=PageRoot Developer Preview",
      "--config.extraMetadata.productName=PageRoot Developer Preview",
      `--config.extraMetadata.version=0.9.69991-dev.g${"a".repeat(40)}`,
      `--config.buildVersion=0.9.69991-dev.g${"a".repeat(40)}`,
      `--config.mac.bundleVersion=0.9.69991-dev.g${"a".repeat(40)}`,
      `--config.mac.bundleShortVersion=0.9.69991-dev.g${"a".repeat(40)}`,
      `--config.directories.output=${releaseDirectory}`,
      `--config.artifactName=${DEVELOPER_PREVIEW_ARTIFACT_PATTERN}`,
    ],
  );
  assert.equal(
    developerPreviewArtifactName({
      version: `0.9.69991-dev.g${"a".repeat(40)}`,
      architecture: "arm64",
    }),
    `PageRoot-Developer-Preview-0.9.69991-dev.g${"a".repeat(40)}-arm64.dmg`,
  );
});

test("developer preview strips release credentials and telemetry configuration", () => {
  const environment = developerPreviewEnvironment({
    PATH: "/usr/bin",
    CSC_LINK: "private-signing-material",
    CSC_KEY_PASSWORD: "private-password",
    APPLE_ID: "release@example.com",
    APPLE_APP_SPECIFIC_PASSWORD: "private-app-password",
    APPLE_TEAM_ID: "TEAM",
    GITHUB_TOKEN: "private-token",
    PAGEROOT_POSTHOG_TOKEN: "phc_private",
  });
  assert.equal(environment.PATH, "/usr/bin");
  for (const key of [
    "CSC_LINK",
    "CSC_KEY_PASSWORD",
    "APPLE_ID",
    "APPLE_APP_SPECIFIC_PASSWORD",
    "APPLE_TEAM_ID",
    "GITHUB_TOKEN",
    "PAGEROOT_POSTHOG_TOKEN",
  ]) {
    assert.equal(environment[key], undefined, `${key} must not reach preview packaging`);
  }
  assert.equal(environment.CSC_IDENTITY_AUTO_DISCOVERY, "false");
  assert.equal(environment.PAGEROOT_REQUIRE_NOTARIZATION, "0");
  assert.equal(environment.PAGEROOT_REQUIRE_TELEMETRY_CONFIG, "0");
});

test("developer preview attestation is explicitly non-release and binds exact bytes", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "pageroot-preview-contract-"));
  try {
    const identity = createDeveloperPreviewIdentity({
      packageJson: sourcePackageJson,
      stableVersion: "0.9.5",
      buildSequence: 2,
      commitSha: "a".repeat(40),
    });
    const releaseDirectory = developerPreviewReleaseDirectory(temporaryRoot);
    await mkdir(releaseDirectory, { recursive: true });
    const dmgPath = path.join(
      releaseDirectory,
      developerPreviewArtifactName({ version: identity.version, architecture: "arm64" }),
    );
    const dmgBytes = Buffer.from("synthetic developer preview");
    await writeFile(dmgPath, dmgBytes);
    const record = await writeDeveloperPreviewAttestation({
      productRoot: temporaryRoot,
      artifact: { dmgPath },
      identity,
      repository: {
        head: "a".repeat(40),
        tree: "b".repeat(40),
        dirty: false,
      },
      architecture: "arm64",
      results: [
        { id: "developer-package-build", status: "passed" },
        { id: "developer-packaged-verify", status: "passed" },
        { id: "developer-packaged-startup", status: "passed" },
        { id: "developer-package-report", status: "passed" },
      ],
      createdAt: new Date("2026-07-29T00:00:00.000Z"),
    });
    assert.equal(record.attestation.kind, "developer-preview");
    assert.equal(record.attestation.schemaVersion, 2);
    assert.equal(record.attestation.releaseEligible, false);
    assert.equal(record.attestation.notarized, false);
    assert.equal(record.attestation.sourceVersion, "0.9.5");
    assert.equal(record.attestation.stableVersion, "0.9.5");
    assert.equal(record.attestation.stableTag, "v0.9.5");
    assert.equal(record.attestation.buildSequence, 2);
    assert.equal(record.attestation.sequenceVersion, "0.9.69992");
    assert.equal(record.attestation.version, `0.9.69992-dev.g${"a".repeat(40)}`);
    assert.equal(record.attestation.productName, "PageRoot Developer Preview");
    assert.equal(
      record.attestation.bundleIdentifier,
      "com.htmlai.workbench.developer-preview",
    );
    assert.equal(
      record.attestation.artifact.file,
      `PageRoot-Developer-Preview-0.9.69992-dev.g${"a".repeat(40)}-arm64.dmg`,
    );
    assert.equal(
      record.attestation.artifact.sha256,
      createHash("sha256").update(dmgBytes).digest("hex"),
    );
    assert.deepEqual(record.attestation.automatedChecks, [
      "developer-package-build",
      "developer-packaged-verify",
      "developer-packaged-startup",
      "developer-package-report",
    ]);
    assert.deepEqual(
      JSON.parse(await readFile(record.destination, "utf8")),
      record.attestation,
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("developer preview stays optional, manual-only and independent from release lanes", async () => {
  const [packageText, impactMapText, workflow] = await Promise.all([
    readFile(path.join(productRoot, "package.json"), "utf8"),
    readFile(path.join(productRoot, "tests/test-impact-map.json"), "utf8"),
    readFile(path.join(productRoot, ".github/workflows/developer-preview.yml"), "utf8"),
  ]);
  const packageJson = JSON.parse(packageText);
  const impactMap = validateImpactMap(JSON.parse(impactMapText));
  assert.equal(packageJson.scripts["package:developer"], "npm run gate:developer-package");
  assert.equal(
    packageJson.scripts["gate:developer-package"],
    "node scripts/test-gate.mjs developer-package --arch arm64",
  );
  assert.deepEqual(
    selectGatePlan({ map: impactMap, lane: "developer-package" }).suites.map(({ id }) => id),
    [
      "build-desktop",
      "developer-package-build",
      "developer-packaged-verify",
      "developer-packaged-startup",
      "developer-package-report",
    ],
  );
  for (const lane of ["release", "artifact", "artifact-only"]) {
    assert.equal(
      impactMap.lanes[lane].fullSuites.some((suite) => suite.startsWith("developer-")),
      false,
      `${lane} must not trigger a developer preview`,
    );
  }
  assert.match(workflow, /^\s*workflow_dispatch:/mu);
  assert.doesNotMatch(workflow, /^\s*(?:pull_request|push|schedule):/mu);
  assert.doesNotMatch(
    workflow,
    /(?:MAC_CSC_LINK|MAC_CSC_KEY_PASSWORD|APPLE_APP_SPECIFIC_PASSWORD|secrets\.)/u,
  );
  assert.match(workflow, /developer-package/u);
  assert.match(workflow, /retention-days:\s*7/u);
  assert.match(workflow, /not eligible for a tag, GitHub Release, or updater publication/u);
});
