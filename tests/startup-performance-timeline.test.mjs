import assert from "node:assert/strict";
import test from "node:test";

import { createStartupPerformanceTimeline } from "../desktop/startup-performance-timeline.mjs";

test("startup timeline publishes ordered content-free epoch marks", () => {
  let now = 4;
  const timeline = createStartupPerformanceTimeline({
    timeOrigin: 1_000,
    now: () => now,
  });
  now = 11.25;
  timeline.mark("app-ready");
  now = 18.5;
  timeline.mark("browser-window-created");

  assert.deepEqual(timeline.snapshot(), {
    schemaVersion: 1,
    timeOriginUnixMs: 1_000,
    marks: [
      { stage: "process-start", atUnixMs: 1_004 },
      { stage: "app-ready", atUnixMs: 1_011.25 },
      { stage: "browser-window-created", atUnixMs: 1_018.5 },
    ],
  });
  assert.equal(timeline.mark("invalid stage"), null);
  assert.equal(timeline.snapshot().marks.length, 3);
});
