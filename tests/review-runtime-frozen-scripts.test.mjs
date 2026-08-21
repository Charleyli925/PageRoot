import assert from "node:assert/strict";
import test from "node:test";

import {
  createReviewRuntimeFrozenScriptStore,
} from "../desktop/review-runtime-frozen-scripts.mjs";

const ECHARTS_URL = "https://cdnjs.cloudflare.com/ajax/libs/echarts/5.5.0/echarts.min.js";
const OTHER_ECHARTS_URL = "https://cdn.jsdelivr.net/npm/echarts@5.5.0/dist/echarts.min.js";
const SCRIPT_BYTES = Buffer.from("window.__pagerootFrozenEcharts = true;", "utf8");

function htmlWith(...sources) {
  return `<!doctype html><html><head>${sources.map((src) => (
    `<script src="${src}"></script>`
  )).join("")}</head><body><div id="chart"></div></body></html>`;
}

function fetchOk(bytes = SCRIPT_BYTES) {
  return async () => new Response(new Uint8Array(bytes), { status: 200 });
}

test("prewarm freezes only allowlisted chart-library scripts declared in the HTML", async () => {
  const fetched = [];
  const store = createReviewRuntimeFrozenScriptStore({
    netFetch: async (url, options) => {
      fetched.push(url);
      return fetchOk()(url, options);
    },
  });
  await store.prewarm({
    captureSessionId: "review-session-a",
    html: htmlWith(
      ECHARTS_URL,
      "https://attacker.invalid/echarts.js",
      "https://cdnjs.cloudflare.com/ajax/libs/lodash/4.17.21/lodash.min.js",
      "./assets/local.js",
    ),
  });
  assert.deepEqual(fetched, [ECHARTS_URL], "only the allowlisted ECharts URL is fetched");
  assert.deepEqual(
    [...store.resolve("review-session-a", ECHARTS_URL)],
    [...SCRIPT_BYTES],
  );
  assert.equal(store.resolve("review-session-a", "https://attacker.invalid/echarts.js"), null);
  assert.equal(
    store.resolve(
      "review-session-a",
      "https://cdnjs.cloudflare.com/ajax/libs/lodash/4.17.21/lodash.min.js",
    ),
    null,
  );
});

test("frozen bytes are fetched once and shared across capture sessions", async () => {
  let calls = 0;
  const store = createReviewRuntimeFrozenScriptStore({
    netFetch: async () => {
      calls += 1;
      return new Response(new Uint8Array(SCRIPT_BYTES), { status: 200 });
    },
  });
  await store.prewarm({ captureSessionId: "review-session-a", html: htmlWith(ECHARTS_URL) });
  await store.prewarm({ captureSessionId: "review-session-a", html: htmlWith(ECHARTS_URL) });
  await store.prewarm({ captureSessionId: "review-session-b", html: htmlWith(ECHARTS_URL) });
  assert.equal(calls, 1, "one fetch serves both sides and later sessions");
  assert.ok(store.resolve("review-session-a", ECHARTS_URL));
  assert.ok(store.resolve("review-session-b", ECHARTS_URL));
});

test("a failed fetch pins the same absence for both sides of the capture session", async () => {
  let healthy = false;
  const store = createReviewRuntimeFrozenScriptStore({
    netFetch: async () => {
      if (!healthy) throw new Error("offline");
      return new Response(new Uint8Array(SCRIPT_BYTES), { status: 200 });
    },
  });
  await store.prewarm({ captureSessionId: "review-session-a", html: htmlWith(ECHARTS_URL) });
  assert.equal(store.resolve("review-session-a", ECHARTS_URL), null);
  healthy = true;
  // The after side of the same pair must observe the identical absence even
  // though the network recovered between the two captures.
  await store.prewarm({ captureSessionId: "review-session-a", html: htmlWith(ECHARTS_URL) });
  assert.equal(store.resolve("review-session-a", ECHARTS_URL), null);
  // A new review pair may fetch again.
  await store.prewarm({ captureSessionId: "review-session-b", html: htmlWith(ECHARTS_URL) });
  assert.ok(store.resolve("review-session-b", ECHARTS_URL));
});

test("an oversized script freezes as absent instead of serving partial bytes", async () => {
  const oversized = Buffer.alloc(3 * 1024 * 1024 + 1, 97);
  const store = createReviewRuntimeFrozenScriptStore({
    netFetch: async () => new Response(new Uint8Array(oversized), { status: 200 }),
  });
  await store.prewarm({ captureSessionId: "review-session-a", html: htmlWith(ECHARTS_URL) });
  assert.equal(store.resolve("review-session-a", ECHARTS_URL), null);
});

test("prewarm is bounded and resolve never serves an unpinned URL", async () => {
  const store = createReviewRuntimeFrozenScriptStore({ netFetch: fetchOk() });
  const many = Array.from({ length: 24 }, (_, index) => (
    `https://cdn.jsdelivr.net/npm/echarts@5.5.0/dist/echarts-${index}.min.js`
  ));
  await store.prewarm({ captureSessionId: "review-session-a", html: htmlWith(...many) });
  const pinned = many.filter((url) => store.resolve("review-session-a", url) !== null);
  assert.equal(pinned.length, 16, "prewarm stops at the URL budget");
  assert.equal(
    store.resolve("review-session-a", OTHER_ECHARTS_URL),
    null,
    "a URL that was never declared in the frozen HTML is never served",
  );
  assert.equal(
    store.resolve("review-session-unknown", ECHARTS_URL),
    null,
    "an unknown capture session has no outcomes",
  );
});
