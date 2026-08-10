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
import { fixtureSourceGateIdentity } from "./helpers/release-evidence-fixtures.mjs";

const productRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function workflowJob(workflow, jobId) {
  const marker = `  ${jobId}:\n`;
  const start = workflow.indexOf(marker);
  assert.notEqual(start, -1, `${jobId} job must exist`);
  const remainder = workflow.slice(start + marker.length);
  const nextJob = remainder.search(/^  [a-z0-9-]+:\n/mu);
  return nextJob === -1 ? remainder : remainder.slice(0, nextJob);
}
const sourceFixture = fixtureSourceGateIdentity();
const {
  currentTreeSha: treeSha,
  packageVersion,
} = sourceFixture;
const artifactName = sourceGateArtifactName(treeSha, packageVersion);

function evidence(overrides = {}) {
  const identity = fixtureSourceGateIdentity();
  return {
    currentCommitSha: identity.currentCommitSha,
    currentTreeSha: identity.currentTreeSha,
    packageVersion: identity.packageVersion,
    pullRequests: [{
      number: 25,
      merged_at: "2026-07-23T11:00:00.000Z",
      merge_commit_sha: identity.currentCommitSha,
      base: { ref: "main" },
      head: { sha: identity.headSha },
    }],
    workflowRuns: [{
      id: 300,
      event: "pull_request",
      status: "completed",
      conclusion: "success",
      head_sha: identity.headSha,
      updated_at: "2026-07-23T11:30:00.000Z",
    }],
    artifactsByRunId: {
      300: [{
        id: 901,
        name: sourceGateArtifactName(
          identity.currentTreeSha,
          identity.packageVersion,
        ),
        expired: false,
      }],
    },
    now: identity.now,
    maxAgeHours: identity.maxAgeHours,
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

test("GitHub workflows run tests in parallel with one final-review policy and keep exact-tree release provenance", async () => {
  const [ci, feedback, dryRun, candidate, release, packageText] = await Promise.all([
    readFile(path.join(productRoot, ".github/workflows/ci.yml"), "utf8"),
    readFile(path.join(productRoot, ".github/workflows/pr-feedback.yml"), "utf8"),
    readFile(path.join(productRoot, ".github/workflows/release-dry-run.yml"), "utf8"),
    readFile(path.join(productRoot, ".github/workflows/release-candidate.yml"), "utf8"),
    readFile(path.join(productRoot, ".github/workflows/release.yml"), "utf8"),
    readFile(path.join(productRoot, "package.json"), "utf8"),
  ]);
  const packageJson = JSON.parse(packageText);
  const reviewPolicy = workflowJob(ci, "review-policy");
  const candidateContext = workflowJob(ci, "candidate-context");
  const baselinePolicy = workflowJob(ci, "baseline-policy");
  const sourceBuild = workflowJob(ci, "source-build");
  const sourceNode = workflowJob(ci, "source-node");
  const sourceBrowser = workflowJob(ci, "source-browser");
  const electronNative = workflowJob(ci, "source-electron-native");
  const electronAi = workflowJob(ci, "source-electron-ai");
  const releaseDryRun = workflowJob(ci, "release-dry-run");
  const releaseGate = workflowJob(ci, "release-gate");

  assert.match(ci, /types: \[ready_for_review\]/u);
  assert.doesNotMatch(ci, /workflow_dispatch/u);
  assert.doesNotMatch(ci, /types: \[[^\]]*synchronize/u);
  assert.doesNotMatch(ci, /pull_request_target/u);
  assert.doesNotMatch(ci, /contents: write|issues: write|pull-requests: write/u);
  assert.doesNotMatch(ci, /gh pr merge|mergePullRequest/u);
  assert.doesNotMatch(ci, /name: (?:draft|pr)-feedback/u);
  assert.match(ci, /issues: read/u);
  assert.match(reviewPolicy, /name: review-policy/u);
  assert.match(reviewPolicy, /check-pr-review-policy\.mjs/u);
  assert.match(reviewPolicy, /--expected-head "\$\{\{ github\.event\.pull_request\.head\.sha \}\}"/u);
  assert.match(reviewPolicy, /--expected-base "\$\{\{ github\.event\.pull_request\.base\.sha \}\}"/u);
  assert.match(reviewPolicy, /--settle-seconds 30/u);
  assert.match(reviewPolicy, /--timeout-seconds 900/u);
  assert.match(reviewPolicy, /--poll-seconds 15/u);
  assert.match(reviewPolicy, /--mode wait/u);
  assert.match(reviewPolicy, /PageRoot-review-policy-\$\{\{ github\.run_id \}\}/u);
  assert.match(reviewPolicy, /output\/review-policy\/review-policy\.json/u);
  assert.doesNotMatch(reviewPolicy, /Draft|exact_sha_review/u);
  assert.match(candidateContext, /classify-pr-candidate\.mjs/u);
  assert.match(candidateContext, /advisory_only|PR-size limit/u);
  assert.match(baselinePolicy, /name: baseline-policy/u);
  assert.match(baselinePolicy, /needs:[\s\S]*- branch-policy/u);
  assert.doesNotMatch(baselinePolicy, /review-policy/u);
  assert.match(baselinePolicy, /npm run audit:dependencies/u);
  assert.match(sourceBuild, /needs:[\s\S]*- baseline-policy/u);
  assert.doesNotMatch(sourceBuild, /review-policy/u);
  assert.match(sourceBuild, /npm run ci:source-build:prepared/u);
  assert.match(sourceBuild, /name: PageRoot-web-build-\$\{\{ github\.run_id \}\}/u);
  assert.match(sourceBuild, /retention-days: 30/u);
  assert.match(sourceBuild, /overwrite: true/u);
  assert.doesNotMatch(sourceBuild, /PageRoot-web-build-[^\n]*run_attempt/u);
  assert.match(sourceNode, /name: PageRoot-web-build-\$\{\{ github\.run_id \}\}/u);
  assert.match(sourceBrowser, /name: PageRoot-web-build-\$\{\{ github\.run_id \}\}/u);
  assert.doesNotMatch(sourceNode, /PageRoot-web-build-[^\n]*run_attempt/u);
  assert.doesNotMatch(sourceBrowser, /PageRoot-web-build-[^\n]*run_attempt/u);
  assert.match(electronNative, /needs:[\s\S]*- baseline-policy/u);
  assert.match(electronAi, /needs:[\s\S]*- baseline-policy/u);
  assert.doesNotMatch(electronNative, /review-policy/u);
  assert.doesNotMatch(electronAi, /review-policy/u);
  assert.match(ci, /name: release-gate/u);
  assert.match(releaseGate, /needs:[\s\S]*- review-policy[\s\S]*- baseline-policy/u);
  assert.match(releaseGate, /needs:[\s\S]*- candidate-context[\s\S]*- release-dry-run/u);
  assert.match(releaseGate, /REVIEW_RESULT: \$\{\{ needs\.review-policy\.result \}\}/u);
  assert.match(releaseGate, /BASELINE_RESULT: \$\{\{ needs\.baseline-policy\.result \}\}/u);
  assert.match(releaseGate, /Revalidate frozen head\/base final-review policy immediately/u);
  assert.match(releaseGate, /--mode revalidate/u);
  assert.match(releaseGate, /--expected-head "\$\{\{ github\.event\.pull_request\.head\.sha \}\}"/u);
  assert.match(releaseGate, /--expected-base "\$\{\{ github\.event\.pull_request\.base\.sha \}\}"/u);
  assert.match(releaseGate, /Refresh dependency and packaged-runtime baseline before attestation/u);
  assert.match(releaseGate, /npm run audit:dependencies/u);
  assert.match(ci, /source-gate-provenance\.mjs create/u);
  assert.match(ci, /steps\.provenance\.outputs\.artifact_name/u);
  assert.match(ci, /runs-on: ubuntu-24\.04/u);
  assert.match(ci, /runs-on: macos-14/u);
  assert.match(ci, /--shard=1\/3/u);
  assert.match(ci, /--shard=2\/3/u);
  assert.match(ci, /--shard=3\/3/u);
  assert.match(ci, /--fully-parallel --workers=1/u);
  assert.match(ci, /name: electron-native/u);
  assert.match(ci, /name: electron-ai/u);
  assert.match(ci, /test:electron:ci-preflight:prepared/u);
  assert.match(ci, /--stage environment-preflight/u);
  assert.match(ci, /npm run desktop:renderer/u);
  assert.doesNotMatch(ci, /dist-desktop/u);
  assert.doesNotMatch(ci, /Download shared source build/u);
  assert.match(ci, /scripts\/ci-evidence\.mjs run/u);
  assert.match(ci, /Verify PR result, exact tree, version and freshness/u);
  assert.doesNotMatch(ci, /name: main-smoke|gate:main:auto/u);
  assert.doesNotMatch(ci, /push:[\s\S]{0,300}gate:release:auto/u);

  assert.match(feedback, /types: \[opened, synchronize, reopened\]/u);
  assert.doesNotMatch(feedback, /converted_to_draft/u);
  assert.match(feedback, /name: pr-feedback/u);
  assert.match(feedback, /--stage pr-feedback/u);
  assert.match(feedback, /npm run gate:edit -- --base "\$PR_BASE_SHA"/u);
  assert.match(feedback, /group: pageroot-pr-/u);
  assert.match(ci, /group: pageroot-pr-/u);
  assert.doesNotMatch(feedback, /name: release-gate|test:browser:full|test:electron:full/u);
  assert.equal(
    packageJson.scripts["ci:source-build"],
    "npm run audit:dependencies && npm run ci:source-build:prepared",
  );
  assert.equal(
    packageJson.scripts["ci:source-build:prepared"],
    "npm run typecheck && npm run lint && npm run build",
  );

  assert.match(ci, /uses: \.\/\.github\/workflows\/release-dry-run\.yml/u);
  assert.match(releaseDryRun, /uses: \.\/\.github\/workflows\/release-dry-run\.yml/u);
  assert.doesNotMatch(releaseDryRun, /\bsecrets\s*:/u);
  assert.match(ci, /packaging_required == 'true'/u);
  assert.match(dryRun, /workflow_call:/u);
  assert.match(dryRun, /workflow_dispatch:/u);
  assert.doesNotMatch(dryRun, /^\s+pull_request:/mu);
  assert.match(dryRun, /ref: \$\{\{ inputs\.source_head \}\}/u);
  assert.match(dryRun, /persist-credentials: false/u);
  assert.doesNotMatch(dryRun, /secrets:|gh release create|APPLE_/u);

  assert.match(candidate, /source-gate-provenance\.mjs verify/u);
  assert.match(candidate, /gate:candidate-app:auto/u);
  assert.match(candidate, /PAGEROOT_SOURCE_GATE_TRUSTED/u);
  assert.match(candidate, /PAGEROOT_SOURCE_GATE_TREE/u);
  assert.match(candidate, /release-app-checkpoint\.mjs create/u);
  assert.match(candidate, /release-app-checkpoint\.mjs restore/u);
  assert.match(candidate, /--profile candidate-artifacts/u);
  assert.match(candidate, /release-candidate-provenance\.mjs create/u);
  assert.match(candidate, /test:electron:ci-preflight:prepared/u);
  assert.doesNotMatch(candidate, /npm run release:mac/u);
  assert.doesNotMatch(candidate, /gate:artifact-only:auto/u);
  assert.doesNotMatch(candidate, /gh release create/u);

  assert.match(release, /release-candidate-provenance\.mjs resolve/u);
  assert.match(release, /release-candidate-provenance\.mjs verify/u);
  assert.match(release, /gh release create/u);
  assert.match(release, /release-candidate\.json/u);
  assert.doesNotMatch(release, /tags:/u);
  assert.doesNotMatch(release, /source-gate-provenance\.mjs verify/u);
  assert.doesNotMatch(release, /gate:artifact-only:auto/u);
});
