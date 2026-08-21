import {
  fetchFixedEchartsBytes,
  permittedEchartsUrl,
} from "./edit-runtime-protocol.mjs";

// Bounded prewarm-and-freeze store for Review snapshot captures. The capture
// page never gets live network: before the first side is captured, every
// allowlisted chart-library script URL declared in the frozen HTML is fetched
// once in the main process and frozen. Both sides of one capture session are
// then served the exact same bytes — or the exact same absence — so a slow or
// failed fetch can never render one side and leave the other blank, which
// would fabricate a changed verdict for an unchanged chart.
const SCRIPT_SRC_PATTERN = /<script\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/giu;
const PREWARM_URL_LIMIT = 16;
const PREWARM_DEADLINE_MS = 2_500;
const FROZEN_URL_LIMIT = 8;
const SESSION_OUTCOME_LIMIT = 32;

function declaredScriptUrls(html) {
  const urls = [];
  const seen = new Set();
  const source = String(html || "");
  SCRIPT_SRC_PATTERN.lastIndex = 0;
  let match = SCRIPT_SRC_PATTERN.exec(source);
  while (match && urls.length < PREWARM_URL_LIMIT) {
    const url = match[1] ?? match[2] ?? "";
    if (permittedEchartsUrl(url) && !seen.has(url)) {
      seen.add(url);
      urls.push(url);
    }
    match = SCRIPT_SRC_PATTERN.exec(source);
  }
  return urls;
}

function evictOldest(map, limit) {
  while (map.size >= limit) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) return;
    map.delete(oldest);
  }
}

export function createReviewRuntimeFrozenScriptStore({
  netFetch,
  now = () => Date.now(),
  prewarmDeadlineMs = PREWARM_DEADLINE_MS,
} = {}) {
  if (typeof netFetch !== "function") {
    throw new TypeError("Review frozen script store requires net.fetch.");
  }
  const boundedPrewarmMs = Math.max(1, Math.min(
    PREWARM_DEADLINE_MS,
    Math.round(Number(prewarmDeadlineMs)) || PREWARM_DEADLINE_MS,
  ));
  // frozenBytes is a cross-session immutable byte cache; outcomesBySession
  // pins the served-or-absent decision per capture session so both sides of
  // one before/after pair stay symmetric even when a fetch would succeed
  // between them.
  const frozenBytes = new Map();
  const outcomesBySession = new Map();

  const sessionOutcomes = (captureSessionId) => {
    const key = String(captureSessionId || "");
    const existing = outcomesBySession.get(key);
    if (existing) return existing;
    evictOldest(outcomesBySession, SESSION_OUTCOME_LIMIT);
    const outcomes = new Map();
    outcomesBySession.set(key, outcomes);
    return outcomes;
  };

  const prewarm = async ({ captureSessionId, html } = {}) => {
    const outcomes = sessionOutcomes(captureSessionId);
    const deadlineAt = now() + boundedPrewarmMs;
    for (const url of declaredScriptUrls(html)) {
      if (outcomes.has(url)) continue;
      const cached = frozenBytes.get(url);
      if (cached) {
        outcomes.set(url, cached);
        continue;
      }
      try {
        const bytes = await fetchFixedEchartsBytes(url, netFetch, deadlineAt);
        evictOldest(frozenBytes, FROZEN_URL_LIMIT);
        frozenBytes.set(url, bytes);
        outcomes.set(url, bytes);
      } catch {
        // The absence is part of the session outcome: the other side of this
        // pair must miss the same script instead of racing a retry.
        outcomes.set(url, null);
      }
    }
  };

  // Synchronous by design: the isolated-session request hooks decide from the
  // pinned outcome only. A URL that was never prewarmed for this session has
  // no outcome and is never served.
  const resolve = (captureSessionId, url) => {
    const outcomes = outcomesBySession.get(String(captureSessionId || ""));
    const bytes = outcomes?.get(String(url || ""));
    return bytes instanceof Buffer ? bytes : null;
  };

  return Object.freeze({ prewarm, resolve });
}
