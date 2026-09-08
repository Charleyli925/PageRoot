import assert from "node:assert/strict";
import test from "node:test";

import {
  collectPlaywrightReportTests,
  reconcilePlaywrightTests,
  selectPlaywrightTests,
} from "../scripts/run-playwright-selection.mjs";

function report() {
  return {
    config: { rootDir: "/repo/tests/e2e/electron" },
    suites: [{
      title: "sample.spec.mjs",
      file: "sample.spec.mjs",
      line: 0,
      specs: [{
        title: "shared contract",
        file: "sample.spec.mjs",
        tags: ["gate-smoke", "smoke-editing"],
        tests: [{ projectName: "desktop", status: "expected", results: [{}] }],
      }, {
        title: "changed-only contract",
        file: "sample.spec.mjs",
        tags: [],
        tests: [{ projectName: "desktop", status: "skipped", results: [{}] }],
      }],
      suites: [],
    }],
  };
}

test("runtime selection unions tags and changed specs without duplicate tests", () => {
  const discovered = collectPlaywrightReportTests(report(), "/repo");
  const selection = selectPlaywrightTests(discovered, {
    tags: ["@gate-smoke", "@smoke-editing"],
    files: ["tests/e2e/electron/sample.spec.mjs"],
  });
  assert.deepEqual(selection.missingTags, []);
  assert.deepEqual(selection.missingFiles, []);
  assert.equal(selection.selected.length, 2);
  assert.equal(new Set(selection.selected.map(({ key }) => key)).size, 2);
});

test("runtime selection reports undiscovered selectors and unexecuted tests", () => {
  const discovered = collectPlaywrightReportTests(report(), "/repo");
  const selection = selectPlaywrightTests(discovered, {
    tags: ["@smoke-missing"],
    files: ["tests/e2e/electron/missing.spec.mjs"],
  });
  assert.deepEqual(selection.missingTags, ["smoke-missing"]);
  assert.deepEqual(selection.missingFiles, ["tests/e2e/electron/missing.spec.mjs"]);

  const reconciliation = reconcilePlaywrightTests(discovered, discovered.slice(0, 1));
  assert.equal(reconciliation.planned, 2);
  assert.equal(reconciliation.executed, 1);
  assert.equal(reconciliation.notExecuted.length, 1);
});
