import assert from "node:assert/strict";
import test from "node:test";

import {
  ReviewRuntimeVisualCoordinator,
  acceptReviewRuntimeVisualSnapshots,
  changedReviewRuntimeVisualCandidateKeys,
  mergeReviewRuntimeVisualChanges,
} from "../app/lib/review-runtime-visual.js";

const signature = (seed) => `${seed.repeat(32).slice(0, 32)}:12`;

function snapshot(key, overrides = {}) {
  return {
    key,
    state: "stable",
    contentSignature: signature("a"),
    paintSignature: signature("b"),
    geometrySignature: signature("c"),
    vectorSignature: "",
    canvasSignature: "",
    contentAtoms: 3,
    paintAtoms: 2,
    geometryAtoms: 3,
    vectorAtoms: 0,
    canvasPixels: 0,
    ...overrides,
  };
}

test("runtime visual snapshots accept only bounded declared host facts", () => {
  const allowed = new Set(["runtime-host-1"]);
  const accepted = acceptReviewRuntimeVisualSnapshots([
    snapshot("runtime-host-1"),
  ], allowed);
  assert.equal(accepted?.length, 1);
  assert.equal(accepted?.[0].key, "runtime-host-1");
  assert.equal(acceptReviewRuntimeVisualSnapshots([
    snapshot("runtime-host-2"),
  ], allowed), null);
  assert.equal(acceptReviewRuntimeVisualSnapshots([
    { ...snapshot("runtime-host-1"), extra: true },
  ], allowed), null);
  assert.equal(acceptReviewRuntimeVisualSnapshots([
    snapshot("runtime-host-1"),
    snapshot("runtime-host-1"),
  ], allowed), null);
  assert.equal(acceptReviewRuntimeVisualSnapshots([
    snapshot("runtime-host-1", { contentSignature: "not-a-signature" }),
  ], allowed), null);
  assert.equal(acceptReviewRuntimeVisualSnapshots(
    [],
    new Set(Array.from({ length: 129 }, (_, index) => `runtime-host-${index + 1}`)),
  ), null);
});

test("runtime comparison recognizes stable intrinsic visuals but ignores a lone geometry shift", () => {
  const candidates = [{ key: "runtime-host-1" }];
  const before = [snapshot("runtime-host-1")];
  assert.deepEqual(changedReviewRuntimeVisualCandidateKeys({
    candidates,
    before,
    after: [snapshot("runtime-host-1")],
  }), []);
  assert.deepEqual(changedReviewRuntimeVisualCandidateKeys({
    candidates,
    before,
    after: [snapshot("runtime-host-1", { contentSignature: signature("d") })],
  }), ["runtime-host-1"]);
  assert.deepEqual(changedReviewRuntimeVisualCandidateKeys({
    candidates,
    before: [snapshot("runtime-host-1", {
      contentSignature: "",
      paintSignature: "",
      geometrySignature: signature("c"),
      contentAtoms: 0,
      paintAtoms: 0,
      geometryAtoms: 1,
    })],
    after: [snapshot("runtime-host-1", {
      contentSignature: "",
      paintSignature: "",
      geometrySignature: signature("d"),
      contentAtoms: 0,
      paintAtoms: 0,
      geometryAtoms: 1,
    })],
  }), []);
  assert.deepEqual(changedReviewRuntimeVisualCandidateKeys({
    candidates,
    before: [{
      ...snapshot("runtime-host-1"),
      state: "empty",
      contentSignature: "",
      paintSignature: "",
      geometrySignature: "",
      contentAtoms: 0,
      paintAtoms: 0,
      geometryAtoms: 0,
    }],
    after: [snapshot("runtime-host-1")],
  }), ["runtime-host-1"]);
});

test("runtime visual merge reuses a static change and creates at most one change per untouched outline", () => {
  const documents = {
    changes: [{
      id: "change-1",
      label: "核心结论",
      helper: "文本调整",
      types: ["text"],
      beforePresent: true,
      afterPresent: true,
    }],
    outline: [
      {
        id: "outline-1",
        group: "页面",
        label: "核心结论",
        helper: "文本调整",
        changeId: "change-1",
        types: ["text"],
      },
      {
        id: "outline-2",
        group: "页面",
        label: "图表区",
        helper: "本轮未修改",
        types: [],
      },
    ],
    runtimeVisualCandidates: [
      {
        key: "runtime-host-1",
        outlineId: "outline-1",
        changeId: "change-1",
        label: "核心结论",
      },
      {
        key: "runtime-host-2",
        outlineId: "outline-2",
        changeId: "runtime-change-outline-2",
        label: "图表区",
      },
      {
        key: "runtime-host-3",
        outlineId: "outline-2",
        changeId: "runtime-change-outline-2",
        label: "图表区",
      },
    ],
  };
  const merged = mergeReviewRuntimeVisualChanges(documents, [
    "runtime-host-1",
    "runtime-host-2",
    "runtime-host-3",
  ]);
  assert.equal(merged.changes.length, 2);
  assert.deepEqual(merged.changes[0].types, ["text", "style"]);
  assert.equal(merged.changes[0].helper, "文本、视觉调整");
  assert.equal(merged.changes[1].id, "runtime-change-outline-2");
  assert.equal(merged.outline[1].changeId, "runtime-change-outline-2");
  assert.deepEqual(merged.markers, [
    { key: "runtime-host-1", changeId: "change-1" },
    { key: "runtime-host-2", changeId: "runtime-change-outline-2" },
    { key: "runtime-host-3", changeId: "runtime-change-outline-2" },
  ]);
});

test("runtime visual coordination commits once, falls back atomically, and ignores late sides", () => {
  const candidates = [{
    key: "runtime-host-1",
    outlineId: "outline-1",
    changeId: "runtime-change-outline-1",
    label: "图表区",
  }];
  const resolutions = [];
  const timers = [];
  const timerDelays = [];
  const coordinator = new ReviewRuntimeVisualCoordinator({
    candidates,
    onResolve: (keys) => resolutions.push([...keys]),
    setTimer: (callback, delay) => {
      timers.push(callback);
      timerDelays.push(delay);
      return callback;
    },
    clearTimer: () => {},
  });
  assert.deepEqual(timerDelays, []);
  assert.equal(coordinator.start(), true);
  assert.equal(coordinator.start(), false);
  assert.deepEqual(timerDelays, [500]);
  assert.equal(coordinator.accept("before", [snapshot("runtime-host-1")]), true);
  assert.deepEqual(resolutions, []);
  assert.equal(coordinator.accept("after", [
    snapshot("runtime-host-1", { paintSignature: signature("d") }),
  ]), true);
  assert.deepEqual(resolutions, [["runtime-host-1"]]);
  assert.equal(coordinator.accept("after", []), false);
  timers[0]();
  assert.deepEqual(resolutions, [["runtime-host-1"]]);

  const timeoutResolutions = [];
  const timeoutTimers = [];
  const timeoutCoordinator = new ReviewRuntimeVisualCoordinator({
    candidates,
    onResolve: (keys) => timeoutResolutions.push([...keys]),
    setTimer: (callback) => {
      timeoutTimers.push(callback);
      return callback;
    },
    clearTimer: () => {},
  });
  timeoutCoordinator.accept("before", [snapshot("runtime-host-1")]);
  timeoutTimers[0]();
  assert.deepEqual(timeoutResolutions, [[]]);
  assert.equal(timeoutCoordinator.accept("after", [snapshot("runtime-host-1")]), false);
});
