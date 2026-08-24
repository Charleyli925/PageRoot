import assert from "node:assert/strict";
import test from "node:test";

import {
  canLocateTarget,
  commentHasContent,
  relinkNoticeCopy,
  unsafeCommentTargetsNotice,
  unsafeRelinkComments,
} from "../app/workbench/comment-relink-model.js";

function comment(overrides = {}) {
  return {
    commentId: "comment_1",
    createdAt: "2026-08-24T00:00:00.000Z",
    updatedAt: "2026-08-24T00:00:00.000Z",
    target: {
      id: "target_comment_1",
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

test("canLocateTarget accepts exactly the provable resolutions", () => {
  assert.equal(canLocateTarget({ resolution: "exact" }), true);
  assert.equal(canLocateTarget({ resolution: "rebound" }), true);
  assert.equal(canLocateTarget({ resolution: "ambiguous" }), false);
  assert.equal(canLocateTarget({ resolution: "orphaned" }), false);
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

test("the rail card copy never promises submission, whatever the count", () => {
  const single = relinkNoticeCopy([comment()]);
  assert.equal(single.count, 1);
  assert.equal(single.title, "1 条评论需要重新定位");
  assert.equal(single.actionLabel, "选择新位置");
  assert.ok(!single.detail.includes("发送"));

  const many = relinkNoticeCopy([comment(), comment({ commentId: "comment_2" })]);
  assert.equal(many.count, 2);
  assert.equal(many.title, "2 条评论需要重新定位");
  assert.equal(many.actionLabel, "开始重新定位");
  assert.ok(!many.detail.includes("发送"));
});

test("the blocked-send notice points at the rail card and carries no action", () => {
  const notice = unsafeCommentTargetsNotice([comment()]);

  assert.equal(notice.tone, "warning");
  assert.equal(notice.disposition, "background-result");
  assert.equal(notice.dedupeKey, "unsafe-comment-targets");
  assert.ok(!("action" in notice), "the toast must not own a relink action (#281)");
  assert.ok(notice.message.includes("本轮评论"), "the pointer must name the rail");
  assert.ok(notice.message.includes("发送"), "the send context is why it exists");

  const many = unsafeCommentTargetsNotice([
    comment(),
    comment({ commentId: "comment_2" }),
  ]);
  assert.equal(many.title, "2 条评论需要重新定位");
  assert.ok(!("action" in many));
  assert.ok(!("sticky" in many), "a pointer is transient, the rail card persists");
});
