import assert from "node:assert/strict";
import test from "node:test";

import { CommentSession } from "../app/application/comment-session.js";

test("comment session publishes one atomic working-copy snapshot", () => {
  const session = new CommentSession();
  const observed = [];
  session.setObserver((snapshot) => observed.push(snapshot));

  session.update({
    comments: [{ commentId: "comment_one" }],
    changeEvents: [{ eventId: "event_one" }],
    composerDraft: "draft",
    composerCommentId: "comment_two",
    composerAttachments: [{ attachmentId: "attachment_one" }],
    composerTarget: { id: "target_one" },
    editSession: { commentId: "comment_one" },
  });

  assert.equal(observed.length, 1);
  assert.equal(session.comments[0].commentId, "comment_one");
  assert.equal(session.changeEvents[0].eventId, "event_one");
  assert.equal(session.composerDraft, "draft");
  assert.equal(session.composerTarget.id, "target_one");
  assert.equal(session.editSession.commentId, "comment_one");
});

test("comment deletion tombstones can only change through session methods", () => {
  const session = new CommentSession();
  assert.equal(session.markDeleted("comment_one"), true);
  const leakedCopy = session.deletedCommentIds;
  leakedCopy.add("comment_two");

  assert.deepEqual([...session.deletedCommentIds], ["comment_one"]);
  assert.equal(session.unmarkDeleted("comment_one"), true);
  assert.equal(session.deletedCommentIds.size, 0);
});

test("clearing the composer preserves saved comments and edit events", () => {
  const session = new CommentSession();
  session.update({
    comments: [{ commentId: "comment_one" }],
    changeEvents: [{ eventId: "event_one" }],
    composerDraft: "draft",
    composerCommentId: "comment_two",
    composerAttachments: [{ attachmentId: "attachment_one" }],
    composerTarget: { id: "target_one" },
  });

  session.clearComposer();

  assert.equal(session.comments.length, 1);
  assert.equal(session.changeEvents.length, 1);
  assert.equal(session.composerDraft, "");
  assert.equal(session.composerCommentId, null);
  assert.deepEqual(session.composerAttachments, []);
  assert.equal(session.composerTarget, null);
});

test("reset retires the complete comment working copy", () => {
  const session = new CommentSession();
  session.update({
    comments: [{ commentId: "comment_one" }],
    deletedCommentIds: ["comment_two"],
    editSession: { commentId: "comment_one" },
  });

  session.reset();

  assert.deepEqual(session.comments, []);
  assert.equal(session.deletedCommentIds.size, 0);
  assert.equal(session.editSession, null);
});
