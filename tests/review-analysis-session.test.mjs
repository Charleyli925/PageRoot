import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import {
  ReviewAnalysisCancelledError,
  ReviewAnalysisSession,
} from "../app/application/review-analysis-session.js";

test("Review analysis runs only after the explicit Review command", () => {
  const workbench = readFileSync(new URL("../app/workbench.tsx", import.meta.url), "utf8");
  const reviewAnalysis = readFileSync(
    new URL("../app/workbench/review-analysis.ts", import.meta.url),
    "utf8",
  );
  assert.equal(
    existsSync(new URL("../app/workbench/ReviewAnalysisPrewarm.tsx", import.meta.url)),
    false,
  );
  assert.doesNotMatch(workbench, /ReviewAnalysisPrewarm|review:prewarmed/u);
  assert.doesNotMatch(reviewAnalysis, /useEffect|prepareReviewCandidate|review-prewarm/u);
  assert.match(workbench, /await prepareReviewAnalysis\(/u);
});

test("review source-fact cache ignores comments and current session identity", () => {
  const workbench = readFileSync(new URL("../app/workbench.tsx", import.meta.url), "utf8");
  const reviewAnalysis = readFileSync(
    new URL("../app/workbench/review-analysis.ts", import.meta.url),
    "utf8",
  );
  const reviewDocument = readFileSync(
    new URL("../app/workbench/review-document.ts", import.meta.url),
    "utf8",
  );
  assert.match(workbench, /ReviewAnalysisSession<ReviewSourceFacts>/u);
  assert.match(workbench, /estimateSize: reviewSourceFactsByteSize/u);
  assert.doesNotMatch(workbench, /ReviewAnalysisSession<PreparedReviewDocuments>/u);
  assert.match(
    reviewAnalysis,
    /const sourceKey = \[[^]*candidate\.baseSnapshotSha256,[^]*candidate\.sha256,[^]*candidate\.sourcePath,[^]*externalBootstrap \? "external" : "inline",[^]*\]\.join\("\\u0000"\)/u,
  );
  assert.doesNotMatch(reviewAnalysis, /browserSha256/u);
  assert.match(reviewAnalysis, /buildReviewSourceFactsAsync\(/u);
  assert.match(reviewAnalysis, /projectReviewDocuments\(beforeHtml, facts/u);
  const sourceKeyBlock = reviewAnalysis.match(
    /const sourceKey = \[[\s\S]*?\]\.join\("\\u0000"\)/u,
  )?.[0] || "";
  assert.match(sourceKeyBlock, /candidate\.baseSnapshotSha256/u);
  assert.match(sourceKeyBlock, /candidate\.sha256/u);
  assert.match(sourceKeyBlock, /candidate\.sourcePath/u);
  assert.match(sourceKeyBlock, /externalBootstrap/u);
  assert.doesNotMatch(
    sourceKeyBlock,
    /commentsKey|sessionId|candidateAssessment|operationKey/u,
  );
  assert.match(reviewDocument, /export type ReviewSourceFacts =/u);
  assert.match(reviewDocument, /function\* buildReviewSourceFactSteps\(/u);
  assert.match(reviewDocument, /export function projectReviewDocuments\(/u);
  assert.match(reviewDocument, /bindReviewComments\(beforeDocument, beforeHtml, comments\)/u);
});

test("comment-only requests reuse cached source facts; HTML changes recompute", async () => {
  let computes = 0;
  const session = new ReviewAnalysisSession();
  const sourceKey = ({ sha256, sourcePath, externalBootstrap = false }) => [
    "base-html",
    sha256,
    sourcePath,
    externalBootstrap ? "external" : "inline",
  ].join("\u0000");
  const analyze = (candidate) => session.analyze({
    key: sourceKey(candidate),
    compute: async () => {
      computes += 1;
      return { sha256: candidate.sha256 };
    },
  });

  const first = await analyze({
    sha256: "after-a",
    sourcePath: "/tmp/page.html",
  });
  const commentOnly = await analyze({
    sha256: "after-a",
    sourcePath: "/tmp/page.html",
  });
  const otherSessionSameHtml = await analyze({
    sha256: "after-a",
    sourcePath: "/tmp/page.html",
  });
  assert.equal(first, commentOnly);
  assert.equal(commentOnly, otherSessionSameHtml);
  assert.equal(computes, 1);

  const htmlChanged = await analyze({
    sha256: "after-b",
    sourcePath: "/tmp/page.html",
  });
  assert.notEqual(htmlChanged, first);
  assert.equal(computes, 2);

  session.clear();
  await analyze({
    sha256: "after-a",
    sourcePath: "/tmp/page.html",
  });
  assert.equal(computes, 3);
});

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
  assert.equal(session.peek("first")?.key, "first");
  session.cancel();
  assert.equal(session.peek("first")?.key, "first");
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
  assert.equal(session.peek("first"), null);
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

test("clearing a review session releases completed prepared documents", async () => {
  const session = new ReviewAnalysisSession();
  let computes = 0;
  await session.analyze({
    key: "adopted-review",
    compute: () => {
      computes += 1;
      return { html: "candidate" };
    },
  });
  assert.deepEqual(session.peek("adopted-review"), { html: "candidate" });

  session.clear();
  assert.equal(session.peek("adopted-review"), null);
  await session.analyze({
    key: "adopted-review",
    compute: () => {
      computes += 1;
      return { html: "next-candidate" };
    },
  });
  assert.equal(computes, 2);
  assert.deepEqual(session.peek("adopted-review"), { html: "next-candidate" });
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

test("a cancelled prepared result is neither cached nor publishable to a later generation", async () => {
  const session = new ReviewAnalysisSession({
    estimateSize: (value) => value.bytes,
  });
  let release;
  let markStarted;
  let computes = 0;
  const started = new Promise((resolve) => {
    markStarted = resolve;
  });
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const stale = session.analyze({
    key: "prepared-review",
    compute: async () => {
      computes += 1;
      markStarted();
      await gate;
      return { generation: "stale", bytes: 8 };
    },
  });
  await started;
  session.cancel();
  release();
  await assert.rejects(stale, ReviewAnalysisCancelledError);

  const current = await session.analyze({
    key: "prepared-review",
    compute: () => {
      computes += 1;
      return { generation: "current", bytes: 8 };
    },
  });
  assert.deepEqual(current, { generation: "current", bytes: 8 });
  assert.equal(computes, 2);
});
