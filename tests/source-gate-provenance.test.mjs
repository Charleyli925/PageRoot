import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  evaluateSourceGateEvidence,
  readPackageVersions,
  sourceGateArtifactName,
} from "../scripts/source-gate-provenance.mjs";

const productRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const commitSha = "a".repeat(40);
const treeSha = "b".repeat(40);
const headSha = "c".repeat(40);
const packageVersion = "0.8.4";
const now = new Date("2026-07-23T12:00:00.000Z");
const artifactName = sourceGateArtifactName(treeSha, packageVersion);

function evidence(overrides = {}) {
  return {
    currentCommitSha: commitSha,
    currentTreeSha: treeSha,
    packageVersion,
    pullRequests: [{
      number: 25,
      merged_at: "2026-07-23T11:00:00.000Z",
      merge_commit_sha: commitSha,
      base: { ref: "main" },
      head: { sha: headSha },
    }],
    workflowRuns: [{
      id: 300,
      event: "pull_request",
      status: "completed",
      conclusion: "success",
      head_sha: headSha,
      updated_at: "2026-07-23T11:30:00.000Z",
    }],
    artifactsByRunId: {
      300: [{ id: 901, name: artifactName, expired: false }],
    },
    now,
    maxAgeHours: 168,
    ...overrides,
  };
}

test("source gate artifact name binds the exact Git tree and package version", () => {
  assert.equal(
    artifactName,
    `PageRoot-source-gate-${treeSha}-${packageVersion}`,
  );
  assert.throws(() => sourceGateArtifactName("short", packageVersion), /40-character Git SHA/u);
});

test("package and lockfile versions must match before provenance can be reused", () => {
  assert.deepEqual(
    readPackageVersions(
      { version: packageVersion },
      { version: packageVersion, packages: { "": { version: packageVersion } } },
    ),
    { packageVersion, lockVersion: packageVersion },
  );
  assert.throws(
    () => readPackageVersions(
      { version: "0.8.5" },
      { packages: { "": { version: packageVersion } } },
    ),
    /does not match/u,
  );
});

test("matching merged PR, successful run, tree artifact and fresh age are trusted", () => {
  const result = evaluateSourceGateEvidence(evidence());
  assert.equal(result.trusted, true);
  assert.equal(result.reason, "matching_source_gate");
  assert.equal(result.pullRequestNumber, 25);
  assert.equal(result.runId, 300);
  assert.equal(result.artifactName, artifactName);
});

test("a different main tree cannot reuse a successful PR run", () => {
  const result = evaluateSourceGateEvidence(evidence({
    currentTreeSha: "d".repeat(40),
  }));
  assert.equal(result.trusted, false);
  assert.equal(result.reason, "matching_attestation_missing");
});

test("stale source evidence requires the complete source gate again", () => {
  const result = evaluateSourceGateEvidence(evidence({
    now: new Date("2026-08-01T12:00:00.000Z"),
  }));
  assert.equal(result.trusted, false);
  assert.equal(result.reason, "source_gate_stale");
});

test("failed runs, expired artifacts and non-PR commits are never trusted", () => {
  assert.equal(evaluateSourceGateEvidence(evidence({
    workflowRuns: [{ ...evidence().workflowRuns[0], conclusion: "failure" }],
  })).reason, "no_successful_source_gate");
  assert.equal(evaluateSourceGateEvidence(evidence({
    artifactsByRunId: {
      300: [{ id: 901, name: artifactName, expired: true }],
    },
  })).reason, "matching_attestation_missing");
  assert.equal(evaluateSourceGateEvidence(evidence({
    pullRequests: [],
  })).reason, "no_merged_pull_request");
});

test("GitHub workflows keep one full PR boundary, a light main boundary and a conditional artifact boundary", async () => {
  const [ci, release] = await Promise.all([
    readFile(path.join(productRoot, ".github/workflows/ci.yml"), "utf8"),
    readFile(path.join(productRoot, ".github/workflows/release.yml"), "utf8"),
  ]);

  assert.match(ci, /name: release-gate/u);
  assert.match(ci, /source-gate-provenance\.mjs create/u);
  assert.match(ci, /steps\.provenance\.outputs\.artifact_name/u);
  assert.match(ci, /runs-on: ubuntu-24\.04/u);
  assert.match(ci, /runs-on: macos-14/u);
  assert.match(ci, /--shard=1\/3/u);
  assert.match(ci, /--shard=2\/3/u);
  assert.match(ci, /--shard=3\/3/u);
  assert.match(ci, /--fully-parallel --workers=1/u);
  assert.match(ci, /gate:main:auto/u);
  assert.match(ci, /Verify PR result, exact tree, version and freshness/u);
  assert.doesNotMatch(ci, /push:[\s\S]{0,300}gate:release:auto/u);

  assert.match(release, /source-gate-provenance\.mjs verify/u);
  assert.match(release, /gate:artifact-only:auto/u);
  assert.match(release, /PAGEROOT_SOURCE_GATE_TRUSTED/u);
  assert.match(release, /PAGEROOT_SOURCE_GATE_TREE/u);
  assert.match(release, /npm run release:mac/u);
  assert.match(release, /steps\.source-gate\.outputs\.trusted == 'true'/u);
  assert.match(release, /steps\.source-gate\.outputs\.trusted != 'true'/u);
});
