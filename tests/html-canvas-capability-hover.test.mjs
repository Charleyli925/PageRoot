import assert from "node:assert/strict";
import test from "node:test";

import {
  CANVAS_HOVER_HINT_DELAY_MS,
  CANVAS_HOVER_OUTLINE_DELAY_MS,
  createCanvasCapabilityHoverController,
} from "../app/components/html-canvas-capability-hover.js";

function capability(kind, targetKey) {
  return {
    kind,
    hint: kind === "edit-text" ? "双击编辑" : "单击选择并评论",
    spoken: "可编辑",
    cursor: kind === "edit-text" ? "text" : "pointer",
    element: {},
    targetKey,
  };
}

function createScheduler() {
  let now = 0;
  let nextId = 1;
  const timers = new Map();
  return {
    setTimeout(callback, delayMs) {
      const id = nextId;
      nextId += 1;
      timers.set(id, { callback, fireAt: now + delayMs });
      return id;
    },
    clearTimeout(handle) {
      timers.delete(handle);
    },
    flush(ms) {
      now += ms;
      for (const [id, timer] of [...timers]) {
        if (timer.fireAt <= now) {
          timers.delete(id);
          timer.callback();
        }
      }
    },
  };
}

test("fast pointer travel does not flash outline or caption", () => {
  const scheduler = createScheduler();
  const snapshots = [];
  const controller = createCanvasCapabilityHoverController({
    scheduler,
    onChange: (snapshot) => snapshots.push(snapshot),
  });
  controller.update(capability("edit-text", "p-1"));
  scheduler.flush(CANVAS_HOVER_OUTLINE_DELAY_MS - 1);
  controller.update(capability("select-comment", "img-1"));
  assert.equal(controller.snapshot.outline, false);
  assert.equal(controller.snapshot.hint, false);
  assert.equal(
    snapshots.some((snapshot) => snapshot.outline || snapshot.hint),
    false,
  );
});

test("caption appears only after the hint delay", () => {
  const scheduler = createScheduler();
  const controller = createCanvasCapabilityHoverController({ scheduler });
  controller.update(capability("edit-text", "p-1"));
  scheduler.flush(CANVAS_HOVER_OUTLINE_DELAY_MS);
  assert.equal(controller.snapshot.outline, true);
  assert.equal(controller.snapshot.hint, false);
  scheduler.flush(CANVAS_HOVER_HINT_DELAY_MS - CANVAS_HOVER_OUTLINE_DELAY_MS - 1);
  assert.equal(controller.snapshot.hint, false);
  scheduler.flush(1);
  assert.equal(controller.snapshot.hint, true);
  assert.equal(controller.snapshot.capability.hint, "双击编辑");
});

test("the same target does not restart hover timers", () => {
  const scheduler = createScheduler();
  const controller = createCanvasCapabilityHoverController({ scheduler });
  const first = capability("edit-text", "p-1");
  controller.update(first);
  scheduler.flush(CANVAS_HOVER_HINT_DELAY_MS);
  controller.update({ ...first });
  assert.equal(controller.snapshot.outline, true);
  assert.equal(controller.snapshot.hint, true);
});
