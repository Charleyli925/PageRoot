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

test("Runtime text, style and sibling reorder edits end after in-place projection", () => {
  for (const mutationKind of ["text", "style", "reorder"]) {
    assert.deepEqual(decideEditRuntimeRefresh({
      hasRuntime: true,
      nativeEditActive: mutationKind === "text",
      mutationKind,
    }), {
      action: "in-place",
      reason: `runtime-${mutationKind}`,
      synchronizeCurrentFrame: true,
      markRuntimeRefreshPending: false,
    });
  }
});

test("Runtime structure and program changes prepare a candidate now", () => {
  assert.equal(decideEditRuntimeRefresh({
    hasRuntime: true,
    mutationKind: "structure",
  }).action, "candidate-now");
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

test("ordinary Runtime attributes defer while script-sensitive attributes rebuild", () => {
  for (const name of ["class", "title", "aria-label", "data-report-kind"]) {
    assert.equal(isRuntimeInPlaceAttribute(name), true);
    assert.deepEqual(decideEditRuntimeRefresh({
      hasRuntime: true,
      mutationKind: "attribute",
      attributeName: name,
    }), {
      action: "defer-until-boundary",
      reason: "runtime-attribute",
      synchronizeCurrentFrame: true,
      markRuntimeRefreshPending: true,
    });
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
