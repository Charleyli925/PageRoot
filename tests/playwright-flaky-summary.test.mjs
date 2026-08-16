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
              {
                title: "green test",
                status: "expected",
                results: [{ retry: 0, status: "passed" }],
              },
              {
                title: "flaky test",
                status: "flaky",
                results: [
                  { retry: 0, status: "failed" },
                  { retry: 1, status: "passed" },
                ],
              },
              {
                title: "failed test",
                status: "unexpected",
                results: [
                  { retry: 0, status: "failed" },
                  { retry: 1, status: "failed" },
                ],
              },
              {
                title: "skipped test",
                status: "skipped",
                results: [{ retry: 0, status: "skipped" }],
              },
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
                  {
                    status: "expected",
                    results: [{ retry: 0, status: "passed" }],
                  },
                  {
                    status: "flaky",
                    results: [
                      { retry: 0, status: "failed" },
                      { retry: 1, status: "passed" },
                      { retry: 2, status: "passed" },
                    ],
                  },
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
  assert.equal(summary.retries, 2);
});

test("legacy outcome/retries pseudoschema fails closed instead of fabricating zero counts", () => {
  assert.throws(
    () => summarizeFlakyRuns({
      suites: [
        {
          specs: [
            {
              tests: [
                { title: "legacy flaky", outcome: "flaky", retries: 1 },
              ],
            },
          ],
        },
      ],
    }),
    /unsupported status/u,
  );
});

test("an invalid result retry count fails closed instead of being dropped", () => {
  assert.throws(
    () => summarizeFlakyRuns({
      suites: [
        {
          specs: [
            {
              tests: [
                {
                  status: "flaky",
                  results: [
                    { retry: 0, status: "failed" },
                    { retry: "one", status: "passed" },
                  ],
                },
              ],
            },
          ],
        },
      ],
    }),
    /invalid retry count/u,
  );
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
