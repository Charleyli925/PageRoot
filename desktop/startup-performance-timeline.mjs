import { performance as nodePerformance } from "node:perf_hooks";

const MAX_STARTUP_MARKS = 32;
const STARTUP_STAGE = /^[a-z][a-z0-9-]{0,63}$/u;

function finiteEpochMilliseconds(value) {
  const milliseconds = Number(value);
  return Number.isFinite(milliseconds) && milliseconds >= 0
    ? Math.round(milliseconds * 1_000) / 1_000
    : 0;
}

/**
 * Append-only launch diagnostics. It never gates startup and the snapshot
 * contains only stage names and timestamps, never paths, tokens or HTML.
 */
export function createStartupPerformanceTimeline({
  timeOrigin = nodePerformance.timeOrigin,
  now = () => nodePerformance.now(),
} = {}) {
  if (typeof now !== "function") {
    throw new TypeError("Startup performance timeline requires a monotonic clock.");
  }
  const marks = [];
  const origin = finiteEpochMilliseconds(timeOrigin);

  const mark = (stage) => {
    const name = String(stage || "");
    if (!STARTUP_STAGE.test(name) || marks.length >= MAX_STARTUP_MARKS) return null;
    const nowValue = Number(now());
    if (!Number.isFinite(nowValue)) return null;
    const entry = Object.freeze({
      stage: name,
      atUnixMs: finiteEpochMilliseconds(origin + Math.max(0, nowValue)),
    });
    marks.push(entry);
    return entry;
  };

  const snapshot = () => Object.freeze({
    schemaVersion: 1,
    timeOriginUnixMs: origin,
    marks: Object.freeze(marks.map((entry) => Object.freeze({ ...entry }))),
  });

  mark("process-start");
  return Object.freeze({ mark, snapshot });
}
