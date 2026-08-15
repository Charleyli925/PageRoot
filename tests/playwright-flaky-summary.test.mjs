import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  summarizeFlakyRuns,
  writeFlakyEvidence,
} from "../scripts/playwright-flaky-summary.mjs";

function reporterSuite() {
  return {
    suites: [
      {
        title: "native-dom-electron.spec.mjs",
        specs: [
          {
            title: "native-dom-electron.spec.mjs",
            tests: [
              { title: "green test", outcome: "expected", retries: 0 },
              { title: "flaky test", outcome: "flaky", retries: 1 },
              { title: "failed test", outcome: "unexpected", retries: 1 },
              { title: "skipped test", outcome: "skipped", retries: 0 },
            ],
          },
        ],
      },
    ],
  };
}

test("flaky summary counts outcomes and retry attempts from the JSON reporter", () => {
  const summary = summarizeFlakyRuns(reporterSuite());
  assert.deepEqual(summary, {
    total: 4,
    passed: 1,
    failed: 1,
    flaky: 1,
    retries: 2,
    skipped: 1,
  });
});

test("flaky summary tolerates nested suites and missing optional fields", () => {
  const summary = summarizeFlakyRuns({
    suites: [
      {
        suites: [
          {
            specs: [
              {
                tests: [
                  { outcome: "expected" },
                  { outcome: "flaky", retries: 3 },
                ],
              },
            ],
          },
        ],
      },
    ],
  });
  assert.equal(summary.total, 2);
  assert.equal(summary.flaky, 1);
  assert.equal(summary.retries, 3);
});

test("flaky evidence is written machine-readably inside the repository", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "pageroot-flaky-summary-"));
  try {
    const destination = await writeFlakyEvidence(
      summarizeFlakyRuns(reporterSuite()),
      "output/ci-evidence/electron-native-flaky.json",
      { suite: "electron-native", report: "output/playwright/native-dom-electron/results.json" },
    );
    const record = JSON.parse(await readFile(destination, "utf8"));
    assert.equal(record.schemaVersion, 1);
    assert.equal(record.suite, "electron-native");
    assert.equal(record.flaky, 1);
    assert.equal(record.retries, 2);
    assert.equal(record.failed, 1);
    await rm(destination, { force: true });
    await assert.rejects(
      () => writeFlakyEvidence(summarizeFlakyRuns(reporterSuite()), path.join(tempRoot, "outside.json")),
      /inside the repository/u,
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
