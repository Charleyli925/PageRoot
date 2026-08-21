import assert from "node:assert/strict";
import test from "node:test";

import {
  activeDraftSnapshot,
  applyDraftCommand,
} from "../scripts/draft-service.mjs";

const operationId = "draftop_123456789012";
const now = () => "2026-07-26T00:00:00.000Z";
const randomUUID = () => "11111111-2222-4333-8444-555555555555";

function draft(revision = 4, extra = {}) {
  return {
    draftRevision: revision,
    comments: [],
    changeEvents: [],
    deletedCommentIds: [],
    appliedOperationIds: [],
    ...extra,
  };
}

test("draft command owns CAS conflict details and does not mutate authority", () => {
  const current = draft(106, {
    comments: [{ commentId: "comment_server", text: "server" }],
  });
  assert.throws(() => applyDraftCommand(current, {
    operationId,
    expectedDraftRevision: 104,
  }, { randomUUID, now }), (error) => {
    assert.equal(error.status, 409);
    assert.equal(error.code, "DRAFT_REVISION_CONFLICT");
    assert.equal(error.details.currentDraftRevision, 106);
    assert.equal(error.details.activeDraft.comments[0].text, "server");
    return true;
  });
  assert.equal(current.draftRevision, 106);
});

test("draft command makes tombstones dominant and operations idempotent", () => {
  const first = applyDraftCommand(draft(4, {
    comments: [{ commentId: "comment_deleted", text: "old" }],
  }), {
    operationId,
    expectedDraftRevision: 4,
    comments: [
      { commentId: "comment_deleted", text: "resurrect" },
      { commentId: "comment_kept", text: "keep" },
    ],
    changeEvents: [{ eventId: "edit_1" }],
    deletedCommentIds: ["comment_deleted"],
  }, { randomUUID, now });

  assert.equal(first.next.draftRevision, 5);
  assert.deepEqual(
    first.next.comments.map((comment) => comment.commentId),
    ["comment_kept"],
  );
  assert.deepEqual(first.next.deletedCommentIds, ["comment_deleted"]);

  const replay = applyDraftCommand(first.next, {
    operationId,
    expectedDraftRevision: 4,
  }, { randomUUID, now });
  assert.equal(replay.replayed, true);
  assert.equal(replay.next.draftRevision, 5);
});

test("active draft snapshot exposes only one authoritative aggregate", () => {
  assert.deepEqual(activeDraftSnapshot({
    draftRevision: 2,
    editEvents: [{ eventId: "edit_1" }],
  }, now), {
    annotationsRelativePath: "draft/annotations.json",
    annotationsSha256: "",
    commentIds: [],
    editEventIds: ["edit_1"],
    draftRevision: 2,
    updatedAt: "2026-07-26T00:00:00.000Z",
    comments: [],
    changeEvents: [{ eventId: "edit_1" }],
    deletedCommentIds: [],
    appliedOperationIds: [],
  });
});

// A newer PageRoot may add members to the stored Draft. An older build must
// carry them through its snapshot instead of deleting them on the next write.
test("unknown draft members survive an older build's snapshot", () => {
  const snapshot = activeDraftSnapshot(draft(7, {
    conversation: { turnId: "turn_future" },
    comments: [{ commentId: "comment_a", text: "a", provenance: { seq: 1 } }],
  }), now);

  assert.deepEqual(snapshot.conversation, { turnId: "turn_future" });
  assert.deepEqual(snapshot.comments[0].provenance, { seq: 1 });
  assert.equal(snapshot.draftRevision, 7);
});
