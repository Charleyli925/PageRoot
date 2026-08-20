import assert from "node:assert/strict";
import test from "node:test";

import {
  ReviewScrollCoordinator,
  buildReviewScrollMap,
  followerReviewScrollLeft,
  mapReviewScrollTop,
  normalizeReviewScrollGeometry,
  relayedReviewScrollLeft,
} from "../app/lib/review-scroll-sync.js";

function geometry({ maximumScroll, viewportHeight = 600, revision = 1, anchors }) {
  return { maximumScroll, viewportHeight, revision, anchors };
}

function createHarness() {
  let now = 0;
  let frameSequence = 0;
  const frames = new Map();
  let timerSequence = 0;
  const timers = new Map();
  const commands = [];
  const owners = [];
  const coordinator = new ReviewScrollCoordinator({
    requestFrame(callback) {
      const handle = ++frameSequence;
      frames.set(handle, callback);
      return handle;
    },
    cancelFrame(handle) {
      frames.delete(handle);
    },
    setTimer(callback, delay) {
      const handle = ++timerSequence;
      timers.set(handle, { callback, at: now + delay });
      return handle;
    },
    clearTimer(handle) {
      timers.delete(handle);
    },
    now: () => now,
    applyFollower: (side, command) => commands.push({ side, ...command }),
    onOwnerChange: (owner) => owners.push(owner),
  });
  return {
    coordinator,
    commands,
    owners,
    flushFrame() {
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((callback) => callback(now));
    },
    advance(milliseconds) {
      now += milliseconds;
      const due = [...timers.entries()].filter(([, timer]) => timer.at <= now);
      due.forEach(([handle, timer]) => {
        timers.delete(handle);
        timer.callback();
      });
    },
    pendingFrameCount: () => frames.size,
  };
}

const beforeGeometry = geometry({
  maximumScroll: 3_000,
  anchors: [
    { id: "intro", top: 0, height: 600 },
    { id: "metrics", top: 800, height: 800 },
    { id: "details", top: 1_900, height: 700 },
  ],
});

const afterGeometry = geometry({
  maximumScroll: 1_350,
  anchors: [
    { id: "intro", top: 0, height: 400 },
    { id: "metrics", top: 520, height: 380 },
    { id: "details", top: 1_020, height: 300 },
  ],
});

test("semantic map is continuous, monotonic, and does not force both bottoms together", () => {
  const map = buildReviewScrollMap(beforeGeometry, afterGeometry);
  let previous = -1;
  for (let top = 0; top <= beforeGeometry.maximumScroll; top += 25) {
    const mapped = mapReviewScrollTop(map, "before", top);
    assert.ok(mapped >= previous, `${mapped} must not reverse after ${previous}`);
    assert.ok(mapped - previous < 150, "adjacent samples must not jump discontinuously");
    previous = mapped;
  }
  assert.equal(mapReviewScrollTop(map, "before", 0), 0);
  assert.equal(mapReviewScrollTop(map, "before", 3_000), 1_350);
  assert.ok(
    mapReviewScrollTop(map, "after", 1_350) < 3_000,
    "the shorter page bottom is a clamp, not an instruction to pull the long page to its bottom",
  );
});

test("reordered anchors are excluded instead of making the map reverse", () => {
  const map = buildReviewScrollMap(
    geometry({
      maximumScroll: 2_000,
      anchors: [
        { id: "a", top: 100, height: 300 },
        { id: "b", top: 600, height: 300 },
        { id: "c", top: 1_100, height: 300 },
      ],
    }),
    geometry({
      maximumScroll: 2_000,
      anchors: [
        { id: "b", top: 100, height: 300 },
        { id: "a", top: 600, height: 300 },
        { id: "c", top: 1_100, height: 300 },
      ],
    }),
  );
  const samples = [0, 200, 500, 900, 1_300, 2_000]
    .map((top) => mapReviewScrollTop(map, "before", top));
  samples.slice(1).forEach((value, index) => assert.ok(value >= samples[index]));
});

test("geometry validation rejects malformed cross-frame payloads", () => {
  assert.equal(normalizeReviewScrollGeometry(null), null);
  assert.equal(normalizeReviewScrollGeometry({ maximumScroll: -1, viewportHeight: 600, anchors: [] }), null);
  assert.deepEqual(normalizeReviewScrollGeometry({
    maximumScroll: 100,
    viewportHeight: 600,
    revision: 2.8,
    anchors: [
      { id: "safe-anchor", top: 10, height: 30 },
      { id: "safe-anchor", top: 80, height: 10 },
      { id: "../unsafe", top: 40, height: 20 },
      { id: "zero", top: 10, height: 0 },
    ],
  }), {
    maximumScroll: 100,
    viewportHeight: 600,
    revision: 2,
    anchors: [
      { id: "safe-anchor", top: 10, height: 30 },
      { id: "unsafe", top: 40, height: 20 },
    ],
  });
});

test("high-velocity input emits only the newest follower target for one frame", () => {
  const harness = createHarness();
  harness.coordinator.setLinked(true);
  harness.coordinator.updateGeometry("before", beforeGeometry);
  harness.coordinator.updateGeometry("after", afterGeometry);
  harness.coordinator.handleIntent("before");
  harness.coordinator.handlePosition("before", { top: 200, left: 0 });
  harness.coordinator.handlePosition("before", { top: 900, left: 0 });
  harness.coordinator.handlePosition("before", { top: 1_700, left: 0 });
  assert.equal(harness.pendingFrameCount(), 1);
  harness.flushFrame();
  assert.equal(harness.commands.length, 1);
  assert.equal(harness.commands[0].side, "after");
  assert.equal(
    harness.commands[0].top,
    mapReviewScrollTop(buildReviewScrollMap(beforeGeometry, afterGeometry), "before", 1_700),
  );
});

test("rapid reversal replaces the target directly without a stale chase animation", () => {
  const harness = createHarness();
  harness.coordinator.setLinked(true);
  harness.coordinator.updateGeometry("before", beforeGeometry);
  harness.coordinator.updateGeometry("after", afterGeometry);
  harness.coordinator.handleIntent("before");
  harness.coordinator.handlePosition("before", { top: 1_600, left: 0 });
  harness.flushFrame();
  harness.coordinator.handlePosition("before", { top: 280, left: 0 });
  harness.flushFrame();
  assert.equal(harness.commands.length, 2);
  assert.ok(harness.commands[1].top < harness.commands[0].top);
  assert.equal(harness.pendingFrameCount(), 0);
});

test("programmatic overview invalidates a queued gesture without discarding its map", () => {
  const harness = createHarness();
  harness.coordinator.setLinked(true);
  harness.coordinator.updateGeometry("before", beforeGeometry);
  harness.coordinator.updateGeometry("after", afterGeometry);
  harness.coordinator.handleIntent("before");
  harness.coordinator.handlePosition("before", { top: 1_600, left: 0 });
  const before = harness.coordinator.snapshot();
  assert.equal(harness.pendingFrameCount(), 1);

  const gestureId = harness.coordinator.invalidateGesture();
  harness.coordinator.handlePosition("before", {
    top: 0,
    left: 0,
    commandId: "overview-before",
  });
  harness.coordinator.handlePosition("after", {
    top: 0,
    left: 0,
    commandId: "overview-after",
  });
  harness.flushFrame();

  const after = harness.coordinator.snapshot();
  assert.equal(gestureId, before.gestureId + 1);
  assert.equal(after.leader, null);
  assert.equal(after.mapRevision, before.mapRevision);
  assert.deepEqual(after.positions, {
    before: { top: 0, left: 0 },
    after: { top: 0, left: 0 },
  });
  assert.equal(harness.commands.length, 0, "the queued follower command must stay cancelled");
  assert.equal(harness.owners.at(-1).gestureId, gestureId);
});

test("a new gesture on the same side does not discard its first scroll delta", () => {
  const harness = createHarness();
  const map = buildReviewScrollMap(beforeGeometry, afterGeometry);
  harness.coordinator.setLinked(true);
  harness.coordinator.updateGeometry("before", beforeGeometry);
  harness.coordinator.updateGeometry("after", afterGeometry);
  harness.coordinator.handleIntent("before");
  harness.coordinator.handlePosition("before", { top: 500, left: 0 });
  harness.flushFrame();
  harness.advance(141);

  harness.coordinator.handleIntent("before");
  harness.coordinator.handlePosition("before", { top: 1_100, left: 0 });
  harness.flushFrame();
  assert.equal(harness.commands.at(-1).top, mapReviewScrollTop(map, "before", 1_100));
});

test("switching sides invalidates the old frame and preserves takeover continuity", () => {
  const harness = createHarness();
  harness.coordinator.setLinked(true);
  harness.coordinator.updateGeometry("before", beforeGeometry);
  harness.coordinator.updateGeometry("after", afterGeometry);
  harness.coordinator.handleIntent("before");
  harness.coordinator.handlePosition("before", { top: 2_700, left: 0 });
  harness.flushFrame();
  const shortPageBottom = harness.commands.at(-1).top;

  harness.coordinator.handleIntent("after");
  harness.coordinator.handlePosition("after", { top: shortPageBottom - 40, left: 0 });
  harness.flushFrame();
  const takeover = harness.commands.at(-1);
  assert.equal(takeover.side, "before");
  assert.ok(takeover.top > 2_500, "the long page must continue from its current tail without a jump");

  harness.coordinator.handlePosition("before", { top: 2_900, left: 0 });
  assert.equal(harness.pendingFrameCount(), 0, "a stale event from the former leader cannot steal ownership");
  assert.equal(harness.owners.at(-1).leader, "after");
});

test("layout geometry is frozen during a gesture and committed after idle", () => {
  const harness = createHarness();
  harness.coordinator.setLinked(true);
  harness.coordinator.updateGeometry("before", beforeGeometry);
  harness.coordinator.updateGeometry("after", afterGeometry);
  harness.coordinator.handleIntent("before");
  harness.coordinator.handlePosition("before", { top: 900, left: 0 });
  harness.flushFrame();
  const firstRevision = harness.coordinator.snapshot().mapRevision;
  harness.coordinator.updateGeometry("after", {
    ...afterGeometry,
    revision: 2,
    maximumScroll: 2_000,
  });
  assert.equal(harness.coordinator.snapshot().mapRevision, firstRevision);
  harness.advance(141);
  assert.equal(harness.coordinator.snapshot().mapRevision, "1:2");
});

test("a page beyond a short reported maximum is not yanked back at the page end", () => {
  const harness = createHarness();
  harness.coordinator.setLinked(true);
  harness.coordinator.updateGeometry("before", beforeGeometry);
  harness.coordinator.updateGeometry("after", afterGeometry);
  // Scrollbars and frozen geometry both make a reported maximum short, so
  // native scrolling lands further down than the coordinator was told.
  harness.coordinator.handleIntent("before");
  harness.coordinator.handlePosition("before", { top: 3_015, left: 0 });
  harness.flushFrame();
  assert.equal(harness.coordinator.snapshot().positions.before.top, 3_015);
  assert.equal(harness.commands.at(-1).top, 1_350);

  harness.coordinator.handlePosition("after", {
    top: 1_365,
    left: 0,
    commandId: harness.commands.at(-1).commandId,
  });
  harness.advance(141);
  harness.coordinator.handleIntent("after");
  harness.coordinator.handlePosition("after", { top: 1_365, left: 0 });
  harness.flushFrame();
  const takeover = harness.commands.at(-1);
  assert.equal(takeover.side, "before");
  assert.ok(
    takeover.top >= 3_015,
    "a short maximum must not pull a page back from where native scrolling put it",
  );
});

test("horizontal following matches boundaries and stops on the applied echo", () => {
  assert.equal(followerReviewScrollLeft({
    sourceLeft: 120,
    sourceMaximum: 400,
    followerLeft: 0,
    followerMaximum: 400,
  }), 120);
  assert.equal(followerReviewScrollLeft({
    sourceLeft: 400,
    sourceMaximum: 400,
    followerLeft: 0,
    followerMaximum: 260,
  }), 260, "a fully scrolled page must pull the narrower page to its own end");
  assert.equal(followerReviewScrollLeft({
    sourceLeft: .4,
    sourceMaximum: 400,
    followerLeft: 120,
    followerMaximum: 260,
  }), 0);
  assert.equal(followerReviewScrollLeft({
    sourceLeft: 120,
    sourceMaximum: 400,
    followerLeft: 120,
    followerMaximum: 400,
  }), null, "the echo of an applied command must not travel back to its source");
});

test("a relayed horizontal wheel applies once and yields to native chaining", () => {
  assert.equal(relayedReviewScrollLeft({
    baseline: 40,
    current: 40,
    delta: 90,
    maximum: 400,
  }), 130);
  assert.equal(relayedReviewScrollLeft({
    baseline: 40,
    current: 40,
    delta: -90,
    maximum: 400,
  }), 0, "the relay clamps instead of overscrolling the pane");
  assert.equal(relayedReviewScrollLeft({
    baseline: 40,
    current: 130,
    delta: 90,
    maximum: 400,
  }), null, "a gesture the browser already chained out must not be applied twice");
  assert.equal(relayedReviewScrollLeft({
    baseline: 400,
    current: 400,
    delta: 90,
    maximum: 400,
  }), null, "a pane already at its end reports nothing to apply");
  assert.equal(relayedReviewScrollLeft({
    baseline: 40,
    current: 40,
    delta: Number.NaN,
    maximum: 400,
  }), null);
});
