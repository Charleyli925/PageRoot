import assert from "node:assert/strict";
import test from "node:test";

import {
  WORKSPACE_PERFORMANCE_TIMING_FIELDS,
  WorkspacePerformanceTiming,
} from "../bridge/project-file-repository/workspace-performance-timing.mjs";

test("workspace timing accumulates queue and repeated phase durations", async () => {
  let now = 100;
  const timing = new WorkspacePerformanceTiming({ now: () => now });
  now += 12;
  timing.markDequeued();
  const value = await timing.measure("recoveryMs", async () => {
    now += 7;
    return "ready";
  });
  await timing.measure("recoveryMs", async () => {
    now += 3;
  });
  const serialized = timing.measureSync("workspaceSerializeMs", () => {
    now += 2;
    return { ok: true };
  });
  now += 1;

  assert.equal(value, "ready");
  assert.deepEqual(serialized, { ok: true });
  assert.deepEqual(timing.snapshot(), {
    repositoryQueueWaitMs: 12,
    recoveryMs: 10,
    registryResolveMs: 0,
    projectReloadMs: 0,
    workingCopyScanMs: 0,
    workingCopyReconcileMs: 0,
    workingCopyIdentityMs: 0,
    stateFilesReadMs: 0,
    sourceReadMs: 0,
    workspaceSerializeMs: 2,
    workspaceTotalMs: 25,
  });
  assert.deepEqual(
    Object.keys(timing.snapshot()),
    [...WORKSPACE_PERFORMANCE_TIMING_FIELDS],
  );
});

test("workspace timing records a failing phase without changing the error", async () => {
  let now = 0;
  const timing = new WorkspacePerformanceTiming({ now: () => now });
  const expected = new Error("failed read");
  await assert.rejects(
    timing.measure("stateFilesReadMs", async () => {
      now += 9;
      throw expected;
    }),
    (error) => error === expected,
  );
  assert.equal(timing.snapshot().stateFilesReadMs, 9);
});
