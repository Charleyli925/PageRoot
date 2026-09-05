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
    product: { failed: 1, flaky: 1, retries: 2 },
    infra: { failed: 0, flaky: 0, retries: 0 },
    tests: [
      { title: "green test", status: "expected", retries: 0, infraSensitive: false },
      { title: "flaky test", status: "flaky", retries: 1, infraSensitive: false },
      { title: "failed test", status: "unexpected", retries: 1, infraSensitive: false },
      { title: "skipped test", status: "skipped", retries: 0, infraSensitive: false },
    ],
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

test("infra-sensitive tags are counted separately from product contracts", () => {
  const summary = summarizeFlakyRuns({
    suites: [{
      specs: [{
        title: "ci-environment-preflight.spec.mjs",
        tests: [{
          title: "hosted macOS can show, schedule and paint a synthetic Electron renderer",
          tags: ["@infra-sensitive"],
          status: "flaky",
          results: [
            { retry: 0, status: "failed" },
            { retry: 1, status: "passed" },
          ],
        }],
      }],
    }],
  });
  assert.equal(summary.flaky, 1);
  assert.equal(summary.product.flaky, 0);
  assert.equal(summary.product.retries, 0);
  assert.equal(summary.infra.flaky, 1);
  assert.equal(summary.infra.retries, 1);
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
    assert.equal(record.schemaVersion, 2);
    assert.equal(record.suite, "electron-native");
    assert.equal(record.flaky, 1);
    assert.equal(record.retries, 2);
    assert.equal(record.failed, 1);
    assert.deepEqual(record.product, { failed: 1, flaky: 1, retries: 2 });
    await rm(destination, { force: true });
    await assert.rejects(
      () => writeFlakyEvidence(summarizeFlakyRuns(reporterSuite()), path.join(tempRoot, "outside.json")),
      /inside the repository/u,
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
