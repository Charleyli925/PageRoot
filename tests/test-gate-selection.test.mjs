import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  assertFullyAutomatedPlan,
  selectGatePlan,
  validateImpactMap,
} from "../scripts/test-gate-core.mjs";
import { nodeTestGroups } from "../scripts/test-node-group.mjs";

const productRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const map = validateImpactMap(JSON.parse(
  await readFile(new URL("./test-impact-map.json", import.meta.url), "utf8"),
));

function suiteIds(plan) {
  return plan.suites.map(({ id }) => id);
}

test("edit and task gates select deterministic impact-based coverage", () => {
  const changedFiles = ["app/lib/source-patch-engine.js"];
  const edit = assertFullyAutomatedPlan(selectGatePlan({ map, lane: "edit", changedFiles }));
  const task = assertFullyAutomatedPlan(selectGatePlan({ map, lane: "task", changedFiles }));

  assert.deepEqual(suiteIds(edit), ["typecheck", "node-targeted"]);
  assert.ok(edit.selectedNodeTests.includes("tests/source-patch-engine.test.mjs"));
  assert.ok(edit.selectedNodeTests.includes("tests/generated-source-invariants.test.mjs"));
  assert.deepEqual(suiteIds(task), [
    "typecheck",
    "lint",
    "node-targeted",
    "build-web",
    "browser-smoke",
    "build-desktop",
    "electron-smoke",
  ]);
});

test("a changed Node test runs itself without expanding to the full Node suite", () => {
  const plan = selectGatePlan({
    map,
    lane: "edit",
    changedFiles: ["tests/source-text-map.test.mjs"],
  });
  assert.deepEqual(suiteIds(plan), ["node-targeted"]);
  assert.deepEqual(plan.selectedNodeTests, ["tests/source-text-map.test.mjs"]);
});

test("the one rendered Node test schedules its production build before the targeted test", () => {
  const plan = selectGatePlan({
    map,
    lane: "edit",
    changedFiles: ["tests/rendered-html.test.mjs"],
  });
  assert.deepEqual(suiteIds(plan), ["build-web", "node-targeted"]);
  assert.deepEqual(plan.selectedNodeTests, ["tests/rendered-html.test.mjs"]);
});

test("documentation-only changes produce an explicit no-test plan", () => {
  const plan = selectGatePlan({
    map,
    lane: "task",
    changedFiles: ["README.md", "tests/TEST_STRATEGY.md"],
  });
  assert.deepEqual(plan.suites, []);
  assert.deepEqual(plan.selectedNodeTests, []);
});

test("Release Dry Run workflow changes select CI Health ownership coverage", () => {
  const plan = selectGatePlan({
    map,
    lane: "edit",
    changedFiles: [".github/workflows/release-dry-run.yml"],
  });
  assert.ok(plan.selectedNodeTests.includes("tests/ci-health-report.test.mjs"));
});

test("real-HTML gate changes run the discovery oracle instead of an unrelated smoke subset", () => {
  const plan = selectGatePlan({
    map,
    lane: "task",
    changedFiles: ["tests/e2e/browser/real-complex-html.gate.mjs"],
  });
  assert.deepEqual(suiteIds(plan), ["typecheck", "lint", "build-web", "real-html"]);
});

test("the shared fixture driver schedules both browser and Electron smoke", () => {
  const plan = selectGatePlan({
    map,
    lane: "task",
    changedFiles: ["tests/e2e/browser/pageroot-driver.mjs"],
  });
  assert.deepEqual(suiteIds(plan), [
    "typecheck",
    "lint",
    "build-web",
    "browser-smoke",
    "build-desktop",
    "electron-smoke",
  ]);
});

test("packaged-runtime test changes wait for the artifact boundary instead of running unrelated Electron smoke", () => {
  const plan = selectGatePlan({
    map,
    lane: "task",
    changedFiles: ["tests/e2e/electron/packaged-runtime-smoke.spec.mjs"],
  });
  assert.deepEqual(suiteIds(plan), ["typecheck", "lint"]);
  assert.deepEqual(plan.selectedNodeTests, []);
});

test("developer-preview startup changes also stay outside the ordinary Electron smoke lane", () => {
  const plan = selectGatePlan({
    map,
    lane: "task",
    changedFiles: [
      "tests/e2e/electron/packaged-startup-smoke.spec.mjs",
      "tests/e2e/electron/playwright.packaged-startup.config.mjs",
    ],
  });
  assert.deepEqual(suiteIds(plan), ["typecheck", "lint"]);
  assert.deepEqual(plan.selectedNodeTests, []);
});

test("desktop handoff changes select Electron and deterministic AI closed-loop coverage", () => {
  const plan = selectGatePlan({
    map,
    lane: "task",
    changedFiles: ["desktop/qoder-handoff.mjs"],
  });
  assert.deepEqual(suiteIds(plan), [
    "typecheck",
    "lint",
    "node-targeted",
    "build-desktop",
    "electron-smoke",
    "ai-smoke",
  ]);
  assert.ok(plan.selectedNodeTests.includes("tests/qoder-handoff.test.mjs"));
});

test("release and artifact lanes use complete automated coverage and never smoke aliases", () => {
  const release = assertFullyAutomatedPlan(selectGatePlan({ map, lane: "release" }));
  assert.deepEqual(suiteIds(release), [
    "typecheck",
    "lint",
    "dependency-audit",
    "build-web",
    "node-full",
    "browser-full",
    "real-html",
    "build-desktop",
    "electron-full",
    "ai-closed-loop",
  ]);
  assert.equal(suiteIds(release).some((id) => id.endsWith("-smoke")), false);

  const artifact = assertFullyAutomatedPlan(selectGatePlan({ map, lane: "artifact" }));
  assert.deepEqual(suiteIds(artifact).slice(-4), [
    "package-build",
    "packaged-runtime",
    "packaged-verify",
    "package-delivery-report",
  ]);
  assert.equal(
    artifact.suites.some((suite) => /manual|human|人工|真人|手工|checklist/iu.test(
      `${suite.id} ${suite.description}`,
    )),
    false,
  );

  const main = assertFullyAutomatedPlan(selectGatePlan({ map, lane: "main" }));
  assert.deepEqual(suiteIds(main), [
    "node-smoke",
    "build-web",
    "browser-smoke",
  ]);

  const artifactOnly = assertFullyAutomatedPlan(selectGatePlan({ map, lane: "artifact-only" }));
  assert.deepEqual(suiteIds(artifactOnly), [
    "build-desktop",
    "package-build",
    "packaged-runtime",
    "packaged-verify",
    "package-delivery-report",
  ]);
});

test("developer package is opt-in, lightweight and verifies contents before startup", () => {
  const developerPackage = assertFullyAutomatedPlan(
    selectGatePlan({ map, lane: "developer-package" }),
  );
  assert.deepEqual(suiteIds(developerPackage), [
    "build-desktop",
    "developer-package-build",
    "developer-packaged-verify",
    "developer-packaged-startup",
    "developer-package-report",
  ]);
  for (const formalLane of ["release", "artifact", "artifact-only"]) {
    const formal = selectGatePlan({ map, lane: formalLane });
    assert.equal(
      suiteIds(formal).some((id) => id.startsWith("developer-")),
      false,
      `${formalLane} must not trigger the optional developer package`,
    );
  }
});

test("formal candidate app proves contents and runtime before signing stages can begin", () => {
  const candidateApp = assertFullyAutomatedPlan(
    selectGatePlan({ map, lane: "candidate-app" }),
  );
  assert.deepEqual(suiteIds(candidateApp), [
    "build-desktop",
    "candidate-app-build",
    "candidate-app-verify",
    "candidate-app-runtime",
  ]);
});

test("Node groups partition every top-level test exactly once outside full", async () => {
  const groups = await nodeTestGroups(path.join(productRoot, "tests"));
  const relative = (file) => path.basename(file);
  const categorized = [
    ...groups.core,
    ...groups.contract,
    ...groups.integration,
    ...groups.package,
  ].map(relative);
  assert.equal(new Set(categorized).size, categorized.length);
  assert.deepEqual([...new Set(categorized)].sort(), groups.full.map(relative).sort());
  assert.ok(groups.contract.some((file) => file.endsWith("workbench-shell-ux.test.mjs")));
  assert.ok(groups.package.some((file) => file.endsWith("packaged-artifact-gate.test.mjs")));
  assert.deepEqual(
    groups.smoke.map(relative).sort(),
    [
      "product-contract.test.mjs",
      "scope-validator.test.mjs",
      "source-patch-engine.test.mjs",
    ],
  );
});
