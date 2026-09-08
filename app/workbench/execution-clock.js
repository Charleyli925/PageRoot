// Process-local clock. Only the epoch start is recoverable; never persist
// performance.now() or this object across application starts.
export function createExecutionClock({ startedAt, wallNow = Date.now, monotonicNow = () => performance.now() }) {
  const start = Date.parse(startedAt || "");
  const wallAnchor = wallNow();
  const monotonicAnchor = monotonicNow();
  let last = Math.max(Number.isFinite(start) ? start : wallAnchor, wallAnchor);
  let stopped = false;
  return Object.freeze({
    sample({ resume = false } = {}) {
      if (!stopped) last = Math.max(last, wallAnchor + Math.max(0, monotonicNow() - monotonicAnchor), resume ? wallNow() : 0);
      return last;
    },
    stop() { this.sample(); stopped = true; return last; },
  });
}
