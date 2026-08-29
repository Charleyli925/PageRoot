import assert from "node:assert/strict";
import test from "node:test";

import {
  commentMarkerGroupKey,
  COMMENT_VIRTUALIZATION_THRESHOLD,
  virtualizedCommentIds,
} from "../app/lib/comment-virtualization.js";

const COMMENT_STRESS_COUNT = 100;

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
    { length: COMMENT_STRESS_COUNT },
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

test("stable element identity groups moved comments without selector or Hash equality", () => {
  const target = {
    id: "target_comment_001",
    elementId: "pr1_11111111111141118111111111111111",
    selector: "main > section:nth-of-type(1)",
    level: "part",
    sourceAnchor: {
      sourceSha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      startOffset: 10,
      endOffset: 20,
    },
  };
  assert.equal(
    commentMarkerGroupKey(target),
    commentMarkerGroupKey({
      ...target,
      id: "target_comment_002",
      selector: "main > article > section:nth-of-type(3)",
      sourceAnchor: {
        sourceSha256: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        startOffset: 800,
        endOffset: 900,
      },
    }),
  );
  assert.notEqual(
    commentMarkerGroupKey(target),
    commentMarkerGroupKey({
      ...target,
      elementId: "pr1_22222222222242229222222222222222",
    }),
  );
});
