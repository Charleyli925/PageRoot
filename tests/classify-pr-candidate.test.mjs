import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import test from "node:test";

import {
  classifyPrCandidate,
  writeCandidateClassification,
} from "../scripts/classify-pr-candidate.mjs";

test("packaging-risk changes request the reusable dry run", () => {
  const result = classifyPrCandidate({
    changedFiles: ["desktop/main.mjs", "package.json", "app/workbench.tsx"],
  });
  assert.equal(result.packagingRequired, true);
  assert.equal(result.advisoryScope, "packaging-risk");
  assert.deepEqual(result.packagingFiles, ["desktop/main.mjs", "package.json"]);
});

test("candidate classification preserves every former release-dry-run packaging path", () => {
  const formerPackagingPaths = [
    ".github/workflows/developer-preview.yml",
    ".github/workflows/release-candidate.yml",
    ".github/workflows/release-dry-run.yml",
    ".github/workflows/release.yml",
    "package.json",
    "package-lock.json",
    "desktop/main.mjs",
    "public/brand-logo.png",
    "schemas/document.schema.json",
    "shared/target.ts",
    "scripts/application-update-config.mjs",
    "bridge/attachment-storage.mjs",
    "scripts/build-package.mjs",
    "bridge/candidate-assessment.mjs",
    "scripts/ci-evidence.mjs",
    "scripts/create-release-assets.mjs",
    "scripts/developer-preview.mjs",
    "bridge/draft-aggregate.mjs",
    "bridge/draft-service.mjs",
    "bridge/finalize-attempt.mjs",
    "bridge/html-source-parser.mjs",
    "bridge/lifecycle-core.mjs",
    "scripts/package-delivery-report.mjs",
    "scripts/packaged-app-identity.mjs",
    "bridge/product-contract.mjs",
    "bridge/record-user-supplement.mjs",
    "scripts/release-app-checkpoint.mjs",
    "scripts/release-app-stage.mjs",
    "scripts/release-candidate-provenance.mjs",
    "scripts/release-provenance.mjs",
    "scripts/source-gate-provenance.mjs",
    "bridge/target-identity.mjs",
    "bridge/user-supplement-core.mjs",
    "scripts/verify-packaged-artifact.mjs",
    "bridge/workspace-bridge.mjs",
    "tests/application-update-config.test.mjs",
    "tests/desktop-package.test.mjs",
    "tests/developer-preview-package.test.mjs",
    "tests/e2e/electron/packaged-runtime-smoke.spec.mjs",
    "tests/e2e/electron/packaged-startup-smoke.spec.mjs",
    "tests/e2e/electron/playwright.packaged-startup.config.mjs",
    "tests/e2e/electron/playwright.packaged.config.mjs",
    "tests/packaged-artifact-gate.test.mjs",
    "tests/release-app-stage.test.mjs",
    "tests/test-impact-map.json",
    "LICENSE",
    "NOTICE",
    "PRIVACY.md",
    "THIRD_PARTY_NOTICES.md",
    "PageRoot 用户声明与免责声明.txt",
  ];
  for (const file of formerPackagingPaths) {
    assert.equal(
      classifyPrCandidate({ changedFiles: [file] }).packagingRequired,
      true,
      file,
    );
  }
});

test("source-only changes skip packaging without becoming a merge blocker", () => {
  const result = classifyPrCandidate({ changedFiles: ["app/workbench.tsx", "docs/DEVELOPMENT.md"] });
  assert.equal(result.packagingRequired, false);
  assert.equal(result.sizePolicy, "advisory_only");
  assert.equal(result.advisorySize, "small");
});

test("large PR classification remains advisory", () => {
  const result = classifyPrCandidate({
    changedFiles: Array.from({ length: 81 }, (_, index) => `app/file-${index}.tsx`),
  });
  assert.equal(result.advisorySize, "large");
  assert.equal(result.packagingRequired, false);
  assert.equal(result.sizePolicy, "advisory_only");
});

test("classification artifact is reproducible and repository-scoped", async () => {
  const output = "output/pr-candidate/test-candidate.json";
  try {
    const destination = await writeCandidateClassification(
      classifyPrCandidate({ changedFiles: ["package-lock.json"] }),
      output,
    );
    const artifact = JSON.parse(await readFile(destination, "utf8"));
    assert.equal(artifact.packagingRequired, true);
    await assert.rejects(
      () => writeCandidateClassification(artifact, "../../outside.json"),
      /inside the repository/u,
    );
  } finally {
    await rm(output, { force: true }).catch(() => {});
    await rm("output/pr-candidate", { recursive: true, force: true }).catch(() => {});
  }
});
