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

test("runtime comments on one source host keep distinct visual objects apart", () => {
  const sourceTarget = {
    id: "target_comment_001",
    elementId: "pr1_11111111111141118111111111111111",
    selector: "main",
    level: "part",
    sourceAnchor: {
      sourceSha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      startOffset: 10,
      endOffset: 20,
    },
  };
  const first = {
    ...sourceTarget,
    visualHint: {
      runtimeGenerated: true,
      kind: "table",
      label: "财务数据表",
      renderedText: "项目 2025Q1 2025Q2",
      relativePath: "table:nth-of-type(1)",
      relativeBox: { x: 0, y: 0, width: 0.4, height: 0.2 },
    },
  };
  const second = {
    ...sourceTarget,
    visualHint: {
      ...first.visualHint,
      label: "利润数据表",
      renderedText: "利润 2025Q1 2025Q2",
      relativePath: "table:nth-of-type(2)",
      relativeBox: { x: 0, y: 0.4, width: 0.4, height: 0.2 },
    },
  };
  assert.notEqual(commentMarkerGroupKey(first), commentMarkerGroupKey(second));
  assert.equal(
    commentMarkerGroupKey(first),
    commentMarkerGroupKey({ ...first, id: "target_comment_002" }),
  );
});

test("runtime marker identity survives rendered text and box changes", () => {
  const target = {
    id: "target_comment_runtime_stable",
    elementId: "pr1_11111111111141118111111111111111",
    selector: "main",
    level: "part",
    visualHint: {
      runtimeGenerated: true,
      kind: "table",
      label: "财务数据表",
      renderedText: "项目 2025Q1",
      relativePath: "table:nth-of-type(1)",
      relativeBox: { x: 0.1, y: 0.2, width: 0.4, height: 0.2 },
    },
  };
  assert.equal(
    commentMarkerGroupKey(target),
    commentMarkerGroupKey({
      ...target,
      id: "target_comment_runtime_changed",
      visualHint: {
        ...target.visualHint,
        renderedText: "项目 2025Q1 2025Q2 2026Q2",
        relativeBox: { x: 0.08, y: 0.19, width: 0.55, height: 0.22 },
      },
    }),
  );
});
