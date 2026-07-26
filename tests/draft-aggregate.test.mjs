import assert from "node:assert/strict";
import test from "node:test";

import {
  createDraftOperationId,
  operationWasApplied,
  rebaseDraftMutation,
} from "../app/domain/draft-aggregate.js";

test("draft rebase keeps independent server and local changes", () => {
  const rebased = rebaseDraftMutation({
    operationId: createDraftOperationId(() => "local_operation_123"),
    expectedDraftRevision: 104,
    comments: [
      {
        commentId: "comment_local",
        createdAt: "2026-07-26T01:00:00.000Z",
        updatedAt: "2026-07-26T01:00:00.000Z",
        text: "local",
      },
    ],
    changeEvents: [{ eventId: "edit_local", createdAt: "2026-07-26T01:00:00.000Z" }],
    deletedCommentIds: [],
  }, {
    draftRevision: 106,
    comments: [
      {
        commentId: "comment_server",
        createdAt: "2026-07-26T02:00:00.000Z",
        updatedAt: "2026-07-26T02:00:00.000Z",
        text: "server",
      },
    ],
    changeEvents: [{ eventId: "edit_server", createdAt: "2026-07-26T02:00:00.000Z" }],
  });

  assert.equal(rebased.expectedDraftRevision, 106);
  assert.deepEqual(
    rebased.comments.map((comment) => comment.commentId).sort(),
    ["comment_local", "comment_server"],
  );
  assert.deepEqual(
    rebased.changeEvents.map((event) => event.eventId).sort(),
    ["edit_local", "edit_server"],
  );
});
test("draft rebase makes deletion tombstones durable and dominant", () => {
  const rebased = rebaseDraftMutation({
    operationId: createDraftOperationId(() => "delete_operation_123"),
    expectedDraftRevision: 7,
    comments: [],
    changeEvents: [],
    deletedCommentIds: ["comment_removed"],
  }, {
    draftRevision: 8,
    comments: [{
      commentId: "comment_removed",
      updatedAt: "2026-07-26T02:00:00.000Z",
      text: "must not return",
    }],
    deletedCommentIds: [],
  });

  assert.deepEqual(rebased.comments, []);
  assert.deepEqual(rebased.deletedCommentIds, ["comment_removed"]);
});

test("draft rebase does not overwrite a newer same-comment server edit", () => {
  const rebased = rebaseDraftMutation({
    operationId: createDraftOperationId(() => "edit_operation_123"),
    expectedDraftRevision: 2,
    comments: [{
      commentId: "comment_1",
      updatedAt: "2026-07-26T01:00:00.000Z",
      text: "older local",
    }],
    changeEvents: [],
    deletedCommentIds: [],
  }, {
    draftRevision: 3,
    comments: [{
      commentId: "comment_1",
      updatedAt: "2026-07-26T02:00:00.000Z",
      text: "newer server",
    }],
  });

  assert.equal(rebased.comments[0].text, "newer server");
});

test("applied operation identity reconciles an unknown response", () => {
  const operationId = createDraftOperationId(() => "unknown_result_123");
  assert.equal(operationWasApplied({
    appliedOperationIds: [operationId],
  }, operationId), true);
  assert.equal(operationWasApplied({
    appliedOperationIds: [],
  }, operationId), false);
});
