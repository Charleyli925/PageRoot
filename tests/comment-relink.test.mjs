import assert from "node:assert/strict";
import test from "node:test";

import {
  canLocateTarget,
  commentHasContent,
  unsafeRelinkComments,
} from "../app/workbench/comment-relink-model.js";

const ELEMENT_ID = "pr1_11111111111141118111111111111111";

function comment(overrides = {}) {
  return {
    commentId: "comment_1",
    createdAt: "2026-08-24T00:00:00.000Z",
    updatedAt: "2026-08-24T00:00:00.000Z",
    target: {
      id: "target_comment_1",
      elementId: ELEMENT_ID,
      label: "正文",
      selector: "main p",
      level: "part",
      tagName: "p",
      text: "正文",
      resolution: "exact",
    },
    text: "改一下这里",
    ...overrides,
  };
}

test("canLocateTarget accepts only exact or rebound Stable IDs", () => {
  assert.equal(canLocateTarget({ resolution: "exact", elementId: ELEMENT_ID }), true);
  assert.equal(canLocateTarget({ resolution: "rebound", elementId: ELEMENT_ID }), true);
  assert.equal(canLocateTarget({ resolution: "exact" }), false);
  assert.equal(canLocateTarget({ resolution: "rebound" }), false);
  assert.equal(canLocateTarget({ resolution: "ambiguous", elementId: ELEMENT_ID }), false);
  assert.equal(canLocateTarget({ resolution: "orphaned", elementId: ELEMENT_ID }), false);
});

test("unsafeRelinkComments keeps only contentful comments with unprovable targets", () => {
  const safe = comment();
  const orphaned = comment({
    commentId: "comment_2",
    target: { ...comment().target, resolution: "orphaned" },
  });
  const ambiguous = comment({
    commentId: "comment_3",
    target: { ...comment().target, resolution: "ambiguous" },
  });
  const emptyAndOrphaned = comment({
    commentId: "comment_4",
    text: "   ",
    target: { ...comment().target, resolution: "orphaned" },
  });
  const attachmentsOnlyOrphaned = comment({
    commentId: "comment_5",
    text: "",
    attachments: [{ attachmentId: "attachment_x1" }],
    target: { ...comment().target, resolution: "orphaned" },
  });

  const unsafe = unsafeRelinkComments([
    safe,
    orphaned,
    ambiguous,
    emptyAndOrphaned,
    attachmentsOnlyOrphaned,
  ]);

  assert.deepEqual(
    unsafe.map((item) => item.commentId),
    ["comment_2", "comment_3", "comment_5"],
  );
});

test("commentHasContent accepts text or attachments", () => {
  assert.equal(commentHasContent({ text: "有字", attachments: [] }), true);
  assert.equal(commentHasContent({ text: "", attachments: [{}] }), true);
  assert.equal(commentHasContent({ text: "  ", attachments: [] }), false);
});
