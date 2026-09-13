import assert from "node:assert/strict";
import test from "node:test";

import { decideEditRuntimeRefresh } from "../app/components/edit-runtime-refresh-decision.js";

test("structure without a verified plan still rebuilds; sibling reorder stays in-place", () => {
  assert.deepEqual(decideEditRuntimeRefresh({ mutationKind: "structure" }), {
    action: "candidate-now",
    reason: "static-structural-change",
    synchronizeCurrentFrame: false,
  });
  assert.deepEqual(decideEditRuntimeRefresh({
    hasRuntime: true,
    mutationKind: "structure",
  }), {
    action: "candidate-now",
    reason: "runtime-structure",
    synchronizeCurrentFrame: false,
  });
  assert.deepEqual(decideEditRuntimeRefresh({ mutationKind: "reorder" }), {
    action: "in-place",
    reason: "static-reorder",
    synchronizeCurrentFrame: true,
  });
  assert.deepEqual(decideEditRuntimeRefresh({
    hasRuntime: true,
    mutationKind: "reorder",
  }), {
    action: "in-place",
    reason: "runtime-reorder",
    synchronizeCurrentFrame: true,
  });
});
