import assert from "node:assert/strict";
import test from "node:test";

import {
  decideEditRuntimeRefresh,
  isRuntimeInPlaceAttribute,
} from "../app/components/edit-runtime-refresh-decision.js";

test("static text, style and sibling reorder stay in the mounted frame", () => {
  for (const mutationKind of ["text", "style", "reorder"]) {
    assert.deepEqual(decideEditRuntimeRefresh({ mutationKind }), {
      action: "in-place",
      reason: `static-${mutationKind}`,
      synchronizeCurrentFrame: true,
      markRuntimeRefreshPending: false,
    });
  }
});

test("Runtime text and style edits coalesce until an explicit boundary", () => {
  assert.deepEqual(decideEditRuntimeRefresh({
    hasRuntime: true,
    nativeEditActive: true,
    mutationKind: "text",
  }), {
    action: "defer-until-boundary",
    reason: "continuous-native-edit",
    synchronizeCurrentFrame: true,
    markRuntimeRefreshPending: true,
  });
  assert.deepEqual(decideEditRuntimeRefresh({
    hasRuntime: true,
    mutationKind: "style",
  }), {
    action: "defer-until-boundary",
    reason: "runtime-style",
    synchronizeCurrentFrame: true,
    markRuntimeRefreshPending: true,
  });
});

test("Runtime structure, reorder and program changes prepare a candidate now", () => {
  for (const mutationKind of ["structure", "reorder"]) {
    assert.equal(decideEditRuntimeRefresh({
      hasRuntime: true,
      mutationKind,
    }).action, "candidate-now");
  }
  assert.deepEqual(decideEditRuntimeRefresh({
    hasRuntime: true,
    mutationKind: "style",
    programIdentityChanged: true,
  }), {
    action: "candidate-now",
    reason: "program-identity-changed",
    synchronizeCurrentFrame: false,
    markRuntimeRefreshPending: false,
  });
});

test("ordinary attributes are in-place while script-sensitive attributes rebuild", () => {
  for (const name of ["class", "title", "aria-label", "data-report-kind"]) {
    assert.equal(isRuntimeInPlaceAttribute(name), true);
  }
  for (const name of ["onclick", "src", "srcset", "href", "action", "integrity"]) {
    assert.equal(isRuntimeInPlaceAttribute(name), false);
    assert.equal(decideEditRuntimeRefresh({
      hasRuntime: true,
      mutationKind: "attribute",
      attributeName: name,
    }).action, "candidate-now");
  }
});
