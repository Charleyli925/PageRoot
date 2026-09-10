import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  DEFAULT_ACTIVE_REVIEW_FOCUS_GROUP_ID,
  nextActiveReviewFocusGroupId,
} from "../app/lib/review-focus-state.js";

async function loadReviewState() {
  const typescript = await import("typescript");
  const source = await readFile(
    new URL("../app/workbench/review-state.ts", import.meta.url),
    "utf8",
  );
  const compiled = typescript.transpileModule(source, {
    compilerOptions: {
      module: typescript.ModuleKind.ESNext,
      target: typescript.ScriptTarget.ES2022,
    },
    fileName: "review-state.ts",
  });
  const output = compiled.outputText.replace(
    '"../lib/review-focus-state.js"',
    JSON.stringify(new URL("../app/lib/review-focus-state.js", import.meta.url).href),
  );
  return import(`data:text/javascript;base64,${Buffer.from(output, "utf8").toString("base64")}`);
}

const { DEFAULT_REVIEW_STATE, reduceReviewState } = await loadReviewState();

test("Review enters in overview without an active focus group", () => {
  assert.equal(DEFAULT_ACTIVE_REVIEW_FOCUS_GROUP_ID, null);
});

test("navigation identity and visual focus identity remain independent", () => {
  const navigationTarget = "change-2";
  const focused = nextActiveReviewFocusGroupId(
    null,
    "focus-change-2-display-owner-2",
  );
  assert.equal(navigationTarget, "change-2");
  assert.equal(focused, "focus-change-2-display-owner-2");
  assert.equal(nextActiveReviewFocusGroupId(focused, null), null);
  assert.equal(nextActiveReviewFocusGroupId(null, ""), null);
});

test("focus group and side-local regions activate and clear atomically", () => {
  const focused = reduceReviewState(DEFAULT_REVIEW_STATE, {
    type: "set-active-focus",
    value: {
      groupId: "focus-change-2-display-owner-2",
      regionIds: {
        before: "region-before-2",
        after: "region-after-2",
      },
    },
  });
  assert.equal(focused.activeFocusGroupId, "focus-change-2-display-owner-2");
  assert.deepEqual(focused.activeFocusRegionIds, {
    before: "region-before-2",
    after: "region-after-2",
  });

  const overview = reduceReviewState(focused, {
    type: "set-active-focus",
    value: null,
  });
  assert.equal(overview.activeFocusGroupId, null);
  assert.deepEqual(overview.activeFocusRegionIds, { before: null, after: null });
  assert.equal(overview.navigationTarget, focused.navigationTarget);
});
