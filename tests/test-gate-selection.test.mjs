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
import { CI_HEALTH_WORKFLOW_INPUTS } from "../scripts/ci-health-report.mjs";
import { nodeTestGroups } from "../scripts/test-node-group.mjs";

const productRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const map = validateImpactMap(JSON.parse(
  await readFile(new URL("./test-impact-map.json", import.meta.url), "utf8"),
));

function suiteIds(plan) {
  return plan.suites.map(({ id }) => id);
}

const TASK_OWNER_CASES = [
  {
    file: "app/lib/comment-rail-layout.js",
    nodeTests: [
      "tests/comment-rail-layout.test.mjs",
      "tests/workbench-shell-ux.test.mjs",
    ],
    suites: ["typecheck", "lint", "node-targeted", "build-web", "browser-smoke"],
    directOwners: ["tests/comment-rail-layout.test.mjs"],
    unrelatedOwners: ["tests/application-update.test.mjs", "tests/review-runtime-visual.test.mjs"],
  },
  {
    file: "app/workbench/review-document.ts",
    nodeTests: [
      "tests/ai-review-workspace.test.mjs",
      "tests/review-comment-source-map.test.mjs",
      "tests/review-projection-facts.test.mjs",
      "tests/review-runtime-visual.test.mjs",
      "tests/review-semantic-alignment.test.mjs",
      "tests/review-text-diff.test.mjs",
      "tests/runtime-snapshot-hosts.test.mjs",
      "tests/runtime-visual-contract.test.mjs",
    ],
    suites: ["typecheck", "lint", "node-targeted", "build-desktop", "ai-smoke"],
    directOwners: ["tests/review-text-diff.test.mjs", "tests/runtime-visual-contract.test.mjs"],
    unrelatedOwners: [
      "tests/desktop-package.test.mjs",
      "tests/desktop-preload-ipc.test.mjs",
      "tests/workbench-shell-ux.test.mjs",
    ],
  },
  {
    file: "app/components/NoticeBar.tsx",
    nodeTests: ["tests/notification-policy.test.mjs", "tests/notification-ui.test.mjs"],
    suites: ["typecheck", "lint", "node-targeted", "build-web", "browser-smoke"],
    directOwners: ["tests/notification-ui.test.mjs"],
    unrelatedOwners: ["tests/html-preview-sandbox.test.mjs", "tests/workbench-shell-ux.test.mjs"],
  },
  {
    file: "app/application/comment-session.js",
    nodeTests: ["tests/comment-session.test.mjs"],
    suites: ["typecheck", "lint", "node-targeted"],
    directOwners: ["tests/comment-session.test.mjs"],
    unrelatedOwners: [
      "tests/draft-session.test.mjs",
      "tests/project-session.test.mjs",
      "tests/run-session.test.mjs",
      "tests/version-session.test.mjs",
    ],
  },
  {
    file: "desktop/application-update.mjs",
    nodeTests: ["tests/application-update.test.mjs"],
    suites: ["typecheck", "lint", "node-targeted", "build-desktop", "electron-smoke"],
    directOwners: ["tests/application-update.test.mjs"],
    unrelatedOwners: ["tests/desktop-file-writer.test.mjs", "tests/review-runtime-capture-owner.test.mjs"],
  },
  {
    file: "desktop/runtime-visual-capture-owner.mjs",
    nodeTests: [
      "tests/review-runtime-capture-owner.test.mjs",
      "tests/review-runtime-visual.test.mjs",
      "tests/runtime-snapshot-hosts.test.mjs",
      "tests/runtime-visual-contract.test.mjs",
    ],
    suites: [
      "typecheck",
      "lint",
      "node-targeted",
      "build-desktop",
      "electron-smoke",
      "ai-smoke",
    ],
    directOwners: ["tests/review-runtime-capture-owner.test.mjs"],
    unrelatedOwners: ["tests/application-update.test.mjs", "tests/source-rename.test.mjs"],
  },
  {
    file: "scripts/workspace-bridge.mjs",
    nodeTests: [
      "tests/attachment-storage.test.mjs",
      "tests/compatibility-decoders.test.mjs",
      "tests/html-source-parser.test.mjs",
      "tests/lifecycle-core.test.mjs",
      "tests/product-contract.test.mjs",
      "tests/project-context-service.test.mjs",
      "tests/scope-validator.test.mjs",
      "tests/targeted-change-schema.test.mjs",
      "tests/user-supplement.test.mjs",
      "tests/workspace-bridge.test.mjs",
    ],
    suites: ["typecheck", "lint", "node-targeted", "build-desktop", "ai-smoke"],
    directOwners: ["tests/workspace-bridge.test.mjs"],
    unrelatedOwners: ["tests/desktop-package.test.mjs", "tests/review-runtime-capture-owner.test.mjs"],
  },
];

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

test("a changed owned Node test still runs only itself", () => {
  const plan = selectGatePlan({
    map,
    lane: "edit",
    changedFiles: ["tests/comment-session.test.mjs"],
  });
  assert.deepEqual(suiteIds(plan), ["node-targeted"]);
  assert.deepEqual(plan.selectedNodeTests, ["tests/comment-session.test.mjs"]);
});

test("owner rules select only the direct regression coverage for representative files", () => {
  let totalNodeTests = 0;
  for (const ownerCase of TASK_OWNER_CASES) {
    const plan = assertFullyAutomatedPlan(selectGatePlan({
      map,
      lane: "task",
      changedFiles: [ownerCase.file],
    }));
    assert.deepEqual(plan.selectedNodeTests, ownerCase.nodeTests, ownerCase.file);
    assert.deepEqual(suiteIds(plan), ownerCase.suites, ownerCase.file);
    for (const owner of ownerCase.directOwners) {
      assert.ok(plan.selectedNodeTests.includes(owner), `${ownerCase.file} must keep ${owner}`);
    }
    for (const owner of ownerCase.unrelatedOwners) {
      assert.equal(plan.selectedNodeTests.includes(owner), false, `${ownerCase.file} must omit ${owner}`);
    }
    totalNodeTests += plan.selectedNodeTests.length;
  }
  assert.ok(totalNodeTests <= 56, `representative ownership selected ${totalNodeTests} Node tests`);
});

test("unmapped code still falls back to the core Node group", () => {
  const plan = selectGatePlan({
    map,
    lane: "edit",
    changedFiles: ["app/unmapped-owner.ts"],
  });
  assert.deepEqual(suiteIds(plan), ["node-core"]);
  assert.deepEqual(plan.selectedNodeTests, []);
});

test("a file with two direct owners safely unions their coverage", () => {
  const plan = selectGatePlan({
    map,
    lane: "task",
    changedFiles: ["desktop/main.mjs"],
  });
  assert.ok(plan.selectedNodeTests.includes("tests/desktop-preload-ipc.test.mjs"));
  assert.ok(plan.selectedNodeTests.includes("tests/qoder-handoff.test.mjs"));
  assert.deepEqual(suiteIds(plan), [
    "typecheck",
    "lint",
    "node-targeted",
    "build-desktop",
    "electron-smoke",
    "ai-smoke",
  ]);
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

test("every CI Health workflow input selects its ownership coverage", () => {
  for (const workflow of Object.values(CI_HEALTH_WORKFLOW_INPUTS)) {
    const plan = selectGatePlan({
      map,
      lane: "edit",
      changedFiles: [`.github/workflows/${workflow}`],
    });
    assert.ok(
      plan.selectedNodeTests.includes("tests/ci-health-report.test.mjs"),
      `${workflow} must select CI Health contract coverage`,
    );
  }
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
