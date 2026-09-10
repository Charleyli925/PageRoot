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

test("ordinary Runtime attributes finish in place without a deferred rebuild", () => {
  for (const name of ["class", "title", "aria-label", "data-report-kind"]) {
    assert.equal(isRuntimeInPlaceAttribute(name, "section"), true);
    assert.deepEqual(decideEditRuntimeRefresh({
      hasRuntime: true,
      mutationKind: "attribute",
      attributeName: name,
      elementTagName: "section",
    }), {
      action: "in-place",
      reason: "runtime-attribute",
      synchronizeCurrentFrame: true,
      markRuntimeRefreshPending: false,
    });
  }
});

test("attribute safety follows element purpose and resource impact", () => {
  for (const [tagName, name] of [
    ["img", "src"],
    ["source", "srcset"],
    ["a", "href"],
    ["form", "action"],
    ["script", "integrity"],
    ["section", "onclick"],
  ]) {
    assert.equal(isRuntimeInPlaceAttribute(name, tagName), false);
    assert.equal(decideEditRuntimeRefresh({
      hasRuntime: true,
      mutationKind: "attribute",
      attributeName: name,
      elementTagName: tagName,
    }).action, "candidate-now");
  }
  for (const [tagName, name] of [
    ["div", "src"],
    ["section", "href"],
    ["p", "data-report-kind"],
  ]) assert.equal(isRuntimeInPlaceAttribute(name, tagName), true);
  assert.equal(isRuntimeInPlaceAttribute("data-pageroot-id", "div"), false);
});
