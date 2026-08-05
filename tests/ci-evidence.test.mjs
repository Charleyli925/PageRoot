import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  classificationForStage,
  failureFingerprint,
  isAllowedCiEvidenceStage,
  normalizeFailureText,
} from "../scripts/ci-evidence.mjs";

test("CI failure fingerprints ignore transient runner paths, SHAs and timestamps", () => {
  const first = failureFingerprint({
    suite: "electron-native",
    stage: "source-test",
    repositoryRoot: "/repo/one",
    output: [
      "Error: Timed out after 30s",
      "at /repo/one/tests/example.spec.mjs:42",
      "temporary /private/var/folders/ab/cd/T/pageroot-123/file",
      `source ${"a".repeat(40)} at 2026-07-24T06:20:00.000Z`,
    ].join("\n"),
  });
  const second = failureFingerprint({
    suite: "electron-native",
    stage: "source-test",
    repositoryRoot: "/different/repo",
    output: [
      "Error: Timed out after 45s",
      "at /different/repo/tests/example.spec.mjs:42",
      "temporary /var/folders/xy/zz/T/pageroot-999/file",
      `source ${"b".repeat(40)} at 2026-07-24T07:30:00.000Z`,
    ].join("\n"),
  });
  assert.equal(first.signature, second.signature);
  assert.match(first.signature, /^pageroot-ci-v1:[0-9a-f]{20}$/u);
  assert.doesNotMatch(first.normalizedExcerpt, /private\/var|2026-07-24|a{40}/u);
});

test("CI stages produce explicit triage categories without calling source failures product bugs", () => {
  assert.deepEqual(classificationForStage("environment-preflight", true), {
    category: "ci_environment",
    categorySource: "deterministic_preflight",
    candidateCategories: ["ci_environment"],
  });
  assert.deepEqual(classificationForStage("source-test", true), {
    category: "needs_triage",
    categorySource: "stage_hint",
    candidateCategories: ["product", "test_script", "ci_environment"],
  });
  assert.equal(
    classificationForStage("artifact-candidate", true).category,
    "packaged_artifact",
  );
  assert.equal(classificationForStage("source-test", false).category, null);
});

test("formal release workflows use supported packaged-artifact evidence stages", async () => {
  const workflows = await Promise.all([
    readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8"),
    readFile(new URL("../.github/workflows/pr-feedback.yml", import.meta.url), "utf8"),
    readFile(new URL("../.github/workflows/developer-preview.yml", import.meta.url), "utf8"),
    readFile(new URL("../.github/workflows/release-candidate.yml", import.meta.url), "utf8"),
    readFile(new URL("../.github/workflows/release.yml", import.meta.url), "utf8"),
  ]);
  const workflowStages = workflows.flatMap((workflow) => (
    [...workflow.matchAll(/--stage ([a-z0-9-]+)/gu)].map((match) => match[1])
  ));

  assert.ok(workflowStages.length > 0);
  for (const stage of workflowStages) {
    assert.equal(isAllowedCiEvidenceStage(stage), true, `${stage} must be accepted`);
    if (stage === "developer-preview" || stage.startsWith("artifact-")) {
      assert.equal(classificationForStage(stage, true).category, "packaged_artifact");
    }
  }
  assert.equal(isAllowedCiEvidenceStage("artifact-unknown"), false);
});

test("failure normalization retains diagnostic lines and removes ANSI escapes", () => {
  const normalized = normalizeFailureText(
    "\u001b[31mnoise\u001b[0m\nError: expected ready but received loading\nother",
    "/repo",
  );
  assert.equal(normalized, "Error: expected ready but received loading");
});
