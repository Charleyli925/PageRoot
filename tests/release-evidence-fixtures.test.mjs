import assert from "node:assert/strict";
import test from "node:test";

import {
  createSyntheticAppBundle,
  fixtureBuildInfo,
  fixtureCandidateIdentity,
  fixturePackageJson,
  fixtureSourceGateIdentity,
  fixtureTelemetryConfig,
} from "./helpers/release-evidence-fixtures.mjs";

test("release evidence fixtures require explicit profiles and return fresh values", async (t) => {
  assert.throws(() => fixturePackageJson(), /fixture profile must be/u);
  assert.throws(() => fixtureTelemetryConfig(), /fixture profile must be/u);
  await assert.rejects(
    createSyntheticAppBundle(t),
    /fixture profile must be/u,
  );

  const firstPackage = fixturePackageJson("candidate");
  const secondPackage = fixturePackageJson("candidate");
  firstPackage.build.extraResources[0].filter.push("mutated.schema.json");
  assert.notEqual(firstPackage, secondPackage);
  assert.notEqual(firstPackage.build, secondPackage.build);
  assert.equal(
    secondPackage.build.extraResources[0].filter.includes("mutated.schema.json"),
    false,
  );

  const firstBuildInfo = fixtureBuildInfo();
  const secondBuildInfo = fixtureBuildInfo();
  firstBuildInfo.version = "9.9.9";
  assert.equal(secondBuildInfo.version, "0.9.4");

  const firstTelemetry = fixtureTelemetryConfig("release");
  const secondTelemetry = fixtureTelemetryConfig("release");
  firstTelemetry.projectToken = "phc_mutated";
  assert.equal(secondTelemetry.projectToken, "phc_syntheticpageroot");

  const firstCandidate = fixtureCandidateIdentity();
  const secondCandidate = fixtureCandidateIdentity();
  firstCandidate.packageJson.version = "9.9.9";
  assert.equal(secondCandidate.packageJson.version, "0.8.9");

  const firstSource = fixtureSourceGateIdentity();
  const secondSource = fixtureSourceGateIdentity();
  firstSource.now.setUTCFullYear(2030);
  assert.equal(secondSource.now.getUTCFullYear(), 2026);
});

test("release evidence fixture profiles preserve their separate trust identities", () => {
  const developer = fixturePackageJson("developer");
  const release = fixturePackageJson("release");
  assert.equal(developer.build.appId, "com.htmlai.workbench.developer-preview");
  assert.equal(developer.build.productName, "PageRoot Developer Preview");
  assert.equal(release.build.appId, "com.htmlai.workbench");
  assert.equal(release.build.productName, "PageRoot");

  const developerTelemetry = fixtureTelemetryConfig("developer");
  const dryRunTelemetry = fixtureTelemetryConfig("dry-run");
  const candidateTelemetry = fixtureTelemetryConfig("candidate");
  assert.deepEqual(
    { enabled: developerTelemetry.enabled, projectToken: developerTelemetry.projectToken },
    { enabled: false, projectToken: "" },
  );
  assert.equal(dryRunTelemetry.enabled, true);
  assert.equal(candidateTelemetry.enabled, true);
});
