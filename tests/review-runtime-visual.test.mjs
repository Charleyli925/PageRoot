import assert from "node:assert/strict";
import test from "node:test";

import {
  ReviewRuntimeVisualCoordinator,
  acceptReviewRuntimeVisualSnapshots,
  changedReviewRuntimeVisualCandidateKeys,
  mergeReviewRuntimeVisualChanges,
  selectPrioritizedReviewRuntimeVisualCandidates,
} from "../app/lib/review-runtime-visual.js";
import { runtimeVisualHostilePage } from "./fixtures/runtime-visual-hostile-pages.mjs";

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
  const twoCandidates = new Set(["runtime-host-1", "runtime-host-2"]);
  assert.equal(acceptReviewRuntimeVisualSnapshots([
    snapshot("runtime-host-1"),
  ], twoCandidates), null);
  assert.equal(acceptReviewRuntimeVisualSnapshots([
    snapshot("runtime-host-1"),
    snapshot("runtime-host-2"),
  ], twoCandidates)?.length, 2);
  assert.equal(acceptReviewRuntimeVisualSnapshots([
    snapshot("runtime-host-1", { contentSignature: "not-a-signature" }),
  ], allowed), null);
  assert.equal(acceptReviewRuntimeVisualSnapshots([{
    ...snapshot("runtime-host-1"),
    state: "unavailable",
    contentSignature: "",
    paintSignature: "",
    geometrySignature: "",
    contentAtoms: 0,
    paintAtoms: 0,
    geometryAtoms: 0,
  }], allowed)?.[0].state, "unavailable");
  assert.equal(acceptReviewRuntimeVisualSnapshots(
    [],
    new Set(Array.from({ length: 129 }, (_, index) => `runtime-host-${index + 1}`)),
  ), null);
});

test("comment target and nearest-group runtime candidates take bounded slots first", () => {
  const ordinary = Array.from({ length: 129 }, (_, index) => ({
    key: `ordinary-${index + 1}`,
    commentPriority: 0,
  }));
  const adjacentChart = { key: "adjacent-chart", commentPriority: 1 };
  const ancestorComment = { key: "ancestor-comment", commentPriority: 2 };
  const directComment = { key: "direct-comment", commentPriority: 3 };
  const input = [...ordinary, adjacentChart, ancestorComment, directComment];
  const selected = selectPrioritizedReviewRuntimeVisualCandidates(input);

  assert.equal(selected.length, 128);
  assert.equal(selected[0], directComment);
  assert.equal(selected[1], ancestorComment);
  assert.equal(selected[2], adjacentChart);
  assert.deepEqual(
    selected.slice(3).map(({ key }) => key),
    ordinary.slice(0, 125).map(({ key }) => key),
  );
  assert.equal(input[0], ordinary[0], "selection must not reorder the source list");
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
  assert.deepEqual(changedReviewRuntimeVisualCandidateKeys({
    candidates,
    before,
    after: [{
      ...snapshot("runtime-host-1"),
      state: "unavailable",
      contentSignature: "",
      paintSignature: "",
      geometrySignature: "",
      contentAtoms: 0,
      paintAtoms: 0,
      geometryAtoms: 0,
    }],
  }), []);
});

test("one painted child and its geometry form review visual evidence", () => {
  const fixture = runtimeVisualHostilePage("pr100-single-painted-child");
  const candidates = [{ key: "runtime-host-1" }];
  const paintedChild = (geometrySeed) => snapshot("runtime-host-1", {
    contentSignature: "",
    paintSignature: signature("b"),
    geometrySignature: signature(geometrySeed),
    contentAtoms: 0,
    paintAtoms: 1,
    geometryAtoms: 1,
  });
  assert.deepEqual(changedReviewRuntimeVisualCandidateKeys({
    candidates,
    before: [paintedChild("c")],
    after: [paintedChild("d")],
  }), ["runtime-host-1"], fixture.contract);
});

test("snapshot validation enforces the aggregate page atom budget", () => {
  const keys = new Set(["runtime-host-1", "runtime-host-2", "runtime-host-3"]);
  const snapshots = [...keys].map((key) => snapshot(key, {
    contentAtoms: 3_000,
    paintAtoms: 0,
    paintSignature: "",
    geometryAtoms: 0,
    geometrySignature: "",
  }));
  assert.equal(acceptReviewRuntimeVisualSnapshots(snapshots, keys), null);
});

test("snapshot validation enforces the combined per-host atom budget", () => {
  const keys = new Set(["runtime-host-1"]);
  assert.equal(acceptReviewRuntimeVisualSnapshots([
    snapshot("runtime-host-1", {
      contentAtoms: 3_000,
      paintAtoms: 1_096,
      geometryAtoms: 0,
      vectorAtoms: 0,
      geometrySignature: "",
      vectorSignature: "",
    }),
  ], keys)?.length, 1);
  assert.equal(acceptReviewRuntimeVisualSnapshots([
    snapshot("runtime-host-1", {
      contentAtoms: 3_000,
      paintAtoms: 1_097,
      geometryAtoms: 0,
      vectorAtoms: 0,
      geometrySignature: "",
      vectorSignature: "",
    }),
  ], keys), null);
});

test("runtime visual merge reuses a static change and emits one opaque marker per outline", () => {
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
    { changeId: "change-1", outlineId: "outline-1" },
    { changeId: "runtime-change-outline-2", outlineId: "outline-2" },
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
  assert.deepEqual(timerDelays, [1500]);
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

  const incompleteResolutions = [];
  const incompleteCoordinator = new ReviewRuntimeVisualCoordinator({
    candidates: [
      { key: "runtime-host-1" },
      { key: "runtime-host-2" },
    ],
    onResolve: (keys) => incompleteResolutions.push([...keys]),
  });
  assert.equal(incompleteCoordinator.accept("before", [
    snapshot("runtime-host-1"),
  ]), true);
  assert.equal(incompleteCoordinator.accept("after", [
    snapshot("runtime-host-1"),
    snapshot("runtime-host-2"),
  ]), true);
  assert.deepEqual(incompleteResolutions, [[]]);
});

test("owner runtime evidence must match a fresh independent document run", () => {
  const candidates = [
    {
      key: "owner-host-1",
      outlineId: "outline-1",
      changeId: "runtime-change-outline-1",
      label: "图表区",
      requiresDeterministicConfirmation: true,
    },
    {
      key: "owner-host-2",
      outlineId: "outline-1",
      changeId: "runtime-change-outline-1",
      label: "图表区",
      requiresDeterministicConfirmation: true,
    },
  ];
  const initialBefore = [
    snapshot("owner-host-1"),
    snapshot("owner-host-2"),
  ];
  const initialAfter = [
    snapshot("owner-host-1", { paintSignature: signature("d") }),
    snapshot("owner-host-2", { paintSignature: signature("e") }),
  ];
  const unstableResolutions = [];
  let unstableRequests = 0;
  const unstableCoordinator = new ReviewRuntimeVisualCoordinator({
    candidates,
    onResolve: (keys) => unstableResolutions.push([...keys]),
    onRequestConfirmation: () => {
      unstableRequests += 1;
      return true;
    },
  });
  unstableCoordinator.accept("before", initialBefore);
  unstableCoordinator.accept("after", initialAfter);
  assert.equal(unstableRequests, 1);
  assert.deepEqual(unstableResolutions, []);
  assert.equal(unstableCoordinator.accept("before", [
    snapshot("owner-host-1", { paintSignature: signature("f") }),
    snapshot("owner-host-2"),
  ]), true, "the first confirmation result must start its own confirmation round");
  assert.equal(unstableCoordinator.accept("after", initialAfter), true);
  assert.deepEqual(unstableResolutions, [["owner-host-2"]]);

  const stableResolutions = [];
  const stableCoordinator = new ReviewRuntimeVisualCoordinator({
    candidates,
    onResolve: (keys) => stableResolutions.push([...keys]),
    onRequestConfirmation: () => true,
  });
  stableCoordinator.accept("before", initialBefore);
  stableCoordinator.accept("after", initialAfter);
  assert.equal(stableCoordinator.accept("before", initialBefore), true);
  assert.equal(stableCoordinator.accept("after", initialAfter), true);
  assert.deepEqual(stableResolutions, [["owner-host-1", "owner-host-2"]]);

  const unavailableConfirmationResolutions = [];
  const unavailableConfirmationCoordinator = new ReviewRuntimeVisualCoordinator({
    candidates,
    onResolve: (keys) => unavailableConfirmationResolutions.push([...keys]),
    onRequestConfirmation: () => true,
  });
  unavailableConfirmationCoordinator.accept("before", initialBefore);
  unavailableConfirmationCoordinator.accept("after", initialAfter);
  assert.equal(unavailableConfirmationCoordinator.failConfirmation(), true);
  assert.deepEqual(unavailableConfirmationResolutions, [[]]);

  const confirmationTimers = [];
  const timeoutResolutions = [];
  const timeoutCoordinator = new ReviewRuntimeVisualCoordinator({
    candidates,
    onResolve: (keys) => timeoutResolutions.push([...keys]),
    onRequestConfirmation: () => true,
    setTimer: (callback) => {
      confirmationTimers.push(callback);
      return callback;
    },
    clearTimer: () => {},
  });
  timeoutCoordinator.accept("before", initialBefore);
  timeoutCoordinator.accept("after", initialAfter);
  assert.equal(timeoutCoordinator.phase, "awaiting-confirmation");
  assert.equal(timeoutCoordinator.accept("before", initialBefore), true);
  assert.equal(timeoutCoordinator.phase, "confirmation");
  confirmationTimers.at(-1)();
  assert.deepEqual(timeoutResolutions, [[]]);
});
