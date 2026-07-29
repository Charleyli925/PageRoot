import assert from "node:assert/strict";
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
  developerPreviewArtifactName,
  developerPreviewBuilderArguments,
  developerPreviewEnvironment,
  developerPreviewReleaseDirectory,
  writeDeveloperPreviewAttestation,
} from "../scripts/developer-preview.mjs";
import {
  selectGatePlan,
  validateImpactMap,
} from "../scripts/test-gate-core.mjs";

const productRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("developer preview is an explicit ad-hoc DMG profile while release packaging stays unchanged", () => {
  assert.deepEqual(
    parseBuildOptions(["--arch", "arm64"]),
    { architecture: "arm64", profile: "release" },
  );
  assert.deepEqual(
    parseBuildOptions(["--profile", "developer", "--arch", "x64"]),
    { architecture: "x64", profile: "developer" },
  );
  assert.deepEqual(
    releasePackageBuilderArguments("arm64"),
    ["--mac", "dmg", "zip", "--arm64", "--publish", "never"],
  );

  const releaseDirectory = "/tmp/pageroot-developer-preview/release";
  assert.deepEqual(
    developerPreviewBuilderArguments({ architecture: "arm64", releaseDirectory }),
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
      `--config.directories.output=${releaseDirectory}`,
      `--config.artifactName=${DEVELOPER_PREVIEW_ARTIFACT_PATTERN}`,
    ],
  );
  assert.equal(
    developerPreviewArtifactName({ version: "0.9.4", architecture: "arm64" }),
    "PageRoot-0.9.4-developer-preview-arm64.dmg",
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
    const releaseDirectory = developerPreviewReleaseDirectory(temporaryRoot);
    await mkdir(releaseDirectory, { recursive: true });
    const dmgPath = path.join(
      releaseDirectory,
      developerPreviewArtifactName({ version: "0.9.4", architecture: "arm64" }),
    );
    const dmgBytes = Buffer.from("synthetic developer preview");
    await writeFile(dmgPath, dmgBytes);
    const record = await writeDeveloperPreviewAttestation({
      productRoot: temporaryRoot,
      artifact: { dmgPath },
      repository: {
        head: "a".repeat(40),
        tree: "b".repeat(40),
        dirty: false,
      },
      version: "0.9.4",
      architecture: "arm64",
      results: [
        { id: "developer-package-build", status: "passed" },
        { id: "developer-packaged-verify", status: "passed" },
        { id: "developer-packaged-startup", status: "passed" },
      ],
      createdAt: new Date("2026-07-29T00:00:00.000Z"),
    });
    assert.equal(record.attestation.kind, "developer-preview");
    assert.equal(record.attestation.releaseEligible, false);
    assert.equal(record.attestation.notarized, false);
    assert.equal(
      record.attestation.artifact.sha256,
      createHash("sha256").update(dmgBytes).digest("hex"),
    );
    assert.deepEqual(record.attestation.automatedChecks, [
      "developer-package-build",
      "developer-packaged-verify",
      "developer-packaged-startup",
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
