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

test("comment-scoped runtime evidence must match a fresh document run", () => {
  const candidates = [
    {
      key: "comment-scoped-host",
      outlineId: "outline-1",
      changeId: "runtime-change-outline-1",
      label: "图表区",
      requiresDeterministicConfirmation: true,
    },
    {
      key: "causal-host",
      outlineId: "outline-1",
      changeId: "runtime-change-outline-1",
      label: "图表区",
    },
  ];
  const initialBefore = [
    snapshot("comment-scoped-host"),
    snapshot("causal-host"),
  ];
  const initialAfter = [
    snapshot("comment-scoped-host", { paintSignature: signature("d") }),
    snapshot("causal-host", { paintSignature: signature("e") }),
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
  assert.equal(unstableCoordinator.start(), true);
  unstableCoordinator.accept("before", [
    snapshot("comment-scoped-host", { paintSignature: signature("f") }),
    snapshot("causal-host"),
  ]);
  unstableCoordinator.accept("after", initialAfter);
  assert.deepEqual(unstableResolutions, [["causal-host"]]);

  const stableResolutions = [];
  const stableCoordinator = new ReviewRuntimeVisualCoordinator({
    candidates,
    onResolve: (keys) => stableResolutions.push([...keys]),
    onRequestConfirmation: () => true,
  });
  stableCoordinator.accept("before", initialBefore);
  stableCoordinator.accept("after", initialAfter);
  assert.equal(stableCoordinator.start(), true);
  stableCoordinator.accept("before", initialBefore);
  stableCoordinator.accept("after", initialAfter);
  assert.deepEqual(stableResolutions, [["comment-scoped-host", "causal-host"]]);

  const unavailableConfirmationResolutions = [];
  const unavailableConfirmationCoordinator = new ReviewRuntimeVisualCoordinator({
    candidates,
    onResolve: (keys) => unavailableConfirmationResolutions.push([...keys]),
    onRequestConfirmation: () => true,
  });
  unavailableConfirmationCoordinator.accept("before", initialBefore);
  unavailableConfirmationCoordinator.accept("after", initialAfter);
  assert.equal(unavailableConfirmationCoordinator.failConfirmation(), true);
  assert.deepEqual(unavailableConfirmationResolutions, [["causal-host"]]);

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
  assert.equal(timeoutCoordinator.start(), true);
  confirmationTimers.at(-1)();
  assert.deepEqual(timeoutResolutions, [["causal-host"]]);
});
