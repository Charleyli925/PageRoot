import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_ACTIVE_REVIEW_FOCUS_GROUP_ID,
  nextActiveReviewFocusGroupId,
} from "../app/lib/review-focus-state.js";

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
