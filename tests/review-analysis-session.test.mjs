import assert from "node:assert/strict";
import test from "node:test";

import {
  ReviewAnalysisCancelledError,
  ReviewAnalysisSession,
} from "../app/application/review-analysis-session.js";

test("review analysis yields, coalesces identical work, and caches bounded results", async () => {
  let computes = 0;
  let yielded = false;
  const session = new ReviewAnalysisSession({
    maxCacheEntries: 2,
    maxCacheBytes: 20,
    estimateSize: (value) => value.bytes,
  });
  const first = session.analyze({
    key: "first",
    compute: () => {
      assert.equal(yielded, true);
      computes += 1;
      return { key: "first", bytes: 8 };
    },
  });
  const duplicate = session.analyze({
    key: "first",
    compute: () => {
      throw new Error("coalesced work must not run twice");
    },
  });
  yielded = true;
  assert.equal(await first, await duplicate);
  assert.equal(computes, 1);
  assert.equal((await session.analyze({
    key: "first",
    compute: () => {
      computes += 1;
      return { key: "first", bytes: 8 };
    },
  })).key, "first");
  assert.equal(computes, 1);

  await session.analyze({
    key: "second",
    compute: () => ({ key: "second", bytes: 8 }),
  });
  await session.analyze({
    key: "third",
    compute: () => ({ key: "third", bytes: 8 }),
  });
  await session.analyze({
    key: "first",
    compute: () => {
      computes += 1;
      return { key: "first", bytes: 8 };
    },
  });
  assert.equal(computes, 2);
  session.dispose();
});

test("review analysis rejects superseded work before it starts", async () => {
  const session = new ReviewAnalysisSession();
  let computed = false;
  const pending = session.analyze({
    key: "stale",
    compute: () => {
      computed = true;
      return "stale";
    },
  });
  session.cancel();
  await assert.rejects(pending, ReviewAnalysisCancelledError);
  assert.equal(computed, false);
});

test("review analysis translates cancellation during asynchronous compute", async () => {
  const session = new ReviewAnalysisSession();
  let release;
  let markStarted;
  const started = new Promise((resolve) => {
    markStarted = resolve;
  });
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const pending = session.analyze({
    key: "running",
    compute: async ({ isCancelled }) => {
      markStarted();
      await gate;
      if (isCancelled()) throw new Error("stop chunked analysis");
      return "running";
    },
  });
  await started;
  session.cancel();
  release();
  await assert.rejects(pending, ReviewAnalysisCancelledError);
});
