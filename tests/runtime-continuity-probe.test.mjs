import assert from "node:assert/strict";
import test from "node:test";

import {
  attachRuntimeContinuityProbe,
  enableRuntimeContinuityProbe,
  readRuntimeContinuityTrace,
  recordRuntimeContinuityEvent,
  sampleRuntimeContinuityVisuals,
  summarizeRuntimeContinuity,
} from "../app/components/runtime-continuity-probe.js";

function element(tag, attributes = {}, children = []) {
  const node = {
    tagName: tag.toUpperCase(),
    attributes,
    children,
    parentElement: null,
    isConnected: true,
    scrollTop: 0,
    getAttribute(name) {
      return this.attributes[name] ?? null;
    },
    hasAttribute(name) {
      return Object.hasOwn(this.attributes, name);
    },
    closest(selector) {
      if (selector === ".review-scroll-stage" && this.attributes.class?.includes("review-scroll-stage")) {
        return this;
      }
      return this.parentElement?.closest(selector) || null;
    },
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    },
    querySelectorAll(selector) {
      const matches = [];
      const visit = (current) => {
        if (selector === "iframe" && current.tagName === "IFRAME") matches.push(current);
        if (selector === ".comments-panel.comment-rail" && current.attributes.class === "comments-panel comment-rail") {
          matches.push(current);
        }
        if (selector === 'iframe[data-frame-role="runtime-candidate"]'
          && current.tagName === "IFRAME"
          && current.attributes["data-frame-role"] === "runtime-candidate") {
          matches.push(current);
        }
        if (selector === "[data-html-canvas-selected]" && current.attributes["data-html-canvas-selected"] != null) {
          matches.push(current);
        }
        for (const child of current.children) visit(child);
      };
      for (const child of this.children) visit(child);
      return matches;
    },
    getBoundingClientRect() {
      return {
        x: 0,
        y: 0,
        width: Number(this.attributes.width || 0),
        height: Number(this.attributes.height || 0),
      };
    },
  };
  for (const child of children) child.parentElement = node;
  return node;
}

function fakeWindow() {
  const iframe = element("iframe", {
    title: "HTML",
    "data-frame-generation": "1",
    width: "640",
    height: "400",
  });
  const editor = element("div", { "data-testid": "html-canvas-editor" }, [iframe]);
  const rail = element("aside", { class: "comments-panel comment-rail", width: "280" });
  const stage = element("div", { class: "review-scroll-stage", width: "900" }, [editor, rail]);
  stage.scrollTop = 480;
  const window = {
    requestAnimationFrame() {
      return 1;
    },
    cancelAnimationFrame() {},
    getComputedStyle() {
      return { display: "block", visibility: "visible", opacity: "1" };
    },
  };
  return { window, editor, stage, iframe, rail };
}

test("runtime continuity probe stays silent until tests enable it", () => {
  const { window, editor } = fakeWindow();
  attachRuntimeContinuityProbe(() => editor, window);
  recordRuntimeContinuityEvent("frameCreated", {}, window);
  assert.deepEqual(readRuntimeContinuityTrace(window).events, []);
});

test("runtime continuity probe records lifecycle events and visual regressions", () => {
  const { window, editor } = fakeWindow();
  attachRuntimeContinuityProbe(() => editor, window);
  enableRuntimeContinuityProbe(window);
  recordRuntimeContinuityEvent("frameCreated", { reason: "load" }, window);
  recordRuntimeContinuityEvent("candidateCreated", {}, window);
  const first = sampleRuntimeContinuityVisuals(editor, window);
  assert.ok(first);
  const jumped = {
    events: readRuntimeContinuityTrace(window).events,
    samples: [
      { ...first, outerScrollTop: 480, canvasWidth: 900, commentRailWidth: 280, visibleFrameCount: 1 },
      {
        ...first,
        t: first.t + 16,
        outerScrollTop: 0,
        canvasWidth: 1100,
        commentRailWidth: 0,
        visibleFrameCount: 0,
      },
    ],
  };
  const summary = summarizeRuntimeContinuity(jumped);
  assert.equal(summary.frameCreated, 1);
  assert.equal(summary.candidateCreated, 1);
  assert.equal(summary.jumpedToTop, true);
  assert.equal(summary.railDisappeared, true);
  assert.equal(summary.missingVisibleFrame, true);
  assert.ok(summary.maxCanvasWidthDelta > 50);
});

test("continuity summary fails closed on empty samples and counts a zero-width canvas", () => {
  assert.equal(summarizeRuntimeContinuity({ events: [], samples: [] }).insufficientSamples, true);
  assert.equal(summarizeRuntimeContinuity({ events: [], samples: [] }).missingVisibleFrame, true);
  const collapsed = summarizeRuntimeContinuity({
    events: [],
    samples: [
      { canvasWidth: 640, commentRailWidth: 280, outerScrollTop: 480, innerScrollTop: 480, visibleFrameCount: 1, candidatePresent: false },
      { canvasWidth: 0, commentRailWidth: 120, outerScrollTop: 480, innerScrollTop: 0, visibleFrameCount: 1, candidatePresent: false },
    ],
  });
  assert.equal(collapsed.maxCanvasWidthDelta, 640);
  assert.equal(collapsed.railDisappeared, false);
  assert.equal(collapsed.railNarrowed, true);
  assert.equal(collapsed.jumpedToTop, true);
});

test("display:none and zero-size frames count as a missing visible frame", () => {
  const { window, editor, iframe } = fakeWindow();
  window.getComputedStyle = (node) => (
    node === iframe
      ? { display: "none", visibility: "visible", opacity: "1" }
      : { display: "block", visibility: "visible", opacity: "1" }
  );
  enableRuntimeContinuityProbe(window);
  attachRuntimeContinuityProbe(() => editor, window);
  const hidden = sampleRuntimeContinuityVisuals(editor, window);
  assert.equal(hidden.visibleFrameCount, 0);
  iframe.getBoundingClientRect = () => ({ x: 0, y: 0, width: 0, height: 0 });
  window.getComputedStyle = () => ({ display: "block", visibility: "visible", opacity: "1" });
  const zero = sampleRuntimeContinuityVisuals(editor, window);
  assert.equal(zero.visibleFrameCount, 0);
});

