import assert from "node:assert/strict";
import test from "node:test";

import {
  commentMarkerGroupKey,
  COMMENT_VIRTUALIZATION_THRESHOLD,
  MAX_COMMENT_COUNT,
  virtualizedCommentIds,
} from "../app/lib/comment-virtualization.js";

test("small comment sets render completely", () => {
  const ids = Array.from(
    { length: COMMENT_VIRTUALIZATION_THRESHOLD },
    (_, index) => `comment_${index + 1}`,
  );
  assert.deepEqual(
    [...virtualizedCommentIds({
      ids,
      positions: {},
      heights: {},
      viewportTop: 0,
      viewportHeight: 600,
    })],
    ids,
  );
});

test("large comment sets render only the viewport window plus forced cards", () => {
  const ids = Array.from(
    { length: MAX_COMMENT_COUNT },
    (_, index) => `comment_${index + 1}`,
  );
  const positions = Object.fromEntries(
    ids.map((id, index) => [id, index * 220]),
  );
  const heights = Object.fromEntries(ids.map((id) => [id, 180]));
  const visible = virtualizedCommentIds({
    ids,
    positions,
    heights,
    viewportTop: 8_800,
    viewportHeight: 700,
    forcedIds: ["comment_1", "comment_100"],
  });
  assert.ok(visible.has("comment_1"));
  assert.ok(visible.has("comment_100"));
  assert.ok(visible.has("comment_41"));
  assert.ok(visible.size < 25);
});

test("independent comments on one exact source range share one Canvas marker", () => {
  const target = {
    id: "target_comment_001",
    selector: "#metric",
    level: "part",
    text: "4.6天",
    sourceAnchor: {
      sourceSha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      startOffset: 120,
      endOffset: 148,
    },
  };
  assert.equal(
    commentMarkerGroupKey(target),
    commentMarkerGroupKey({ ...target, id: "target_comment_100" }),
  );
  assert.notEqual(
    commentMarkerGroupKey(target),
    commentMarkerGroupKey({
      ...target,
      id: "target_comment_other_range",
      sourceAnchor: { ...target.sourceAnchor, startOffset: 121 },
    }),
  );
});
