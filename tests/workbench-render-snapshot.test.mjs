import assert from "node:assert/strict";
import test from "node:test";

import {
  sameWorkbenchRenderSnapshot,
} from "../app/workbench/workspace-render-snapshot.js";

function snapshot(overrides = {}) {
  const stable = Object.freeze({ stable: true });
  return {
    registration: stable,
    projectSession: stable,
    document: stable,
    commentSession: {
      comments: stable,
      changeEvents: stable,
      deletedCommentIds: stable,
      composerDraft: "",
      composerCommentId: "comment_one",
      composerAttachments: stable,
      composerTarget: stable,
      editSession: null,
    },
    runSession: stable,
    versionSession: stable,
    editRuntime: stable,
    firstEditGuide: stable,
    comment: {
      attachmentUploadCount: 0,
      draft: { revision: 1, pending: false, writing: false, error: null },
    },
    projectRules: stable,
    project: stable,
    run: stable,
    version: stable,
    conversation: stable,
    workbenchTabs: stable,
    documentSurfaceCache: stable,
    workbenchTabsReady: true,
    workbenchNavigation: stable,
    workbenchTabsPersistence: stable,
    ...overrides,
  };
}

test("comment text and persistence progress stay off the root render path", () => {
  const before = snapshot();
  const after = snapshot({
    ...before,
    commentSession: { ...before.commentSession, composerDraft: "typed text" },
    comment: {
      ...before.comment,
      draft: { ...before.comment.draft, revision: 2, pending: true },
    },
  });

  assert.equal(sameWorkbenchRenderSnapshot(before, after), true);
});

test("saved comments, edit structure, upload count and errors publish to Workbench", () => {
  const before = snapshot();
  assert.equal(sameWorkbenchRenderSnapshot(before, snapshot({
    ...before,
    commentSession: {
      ...before.commentSession,
      comments: Object.freeze([{ commentId: "comment_two" }]),
    },
  })), false);
  assert.equal(sameWorkbenchRenderSnapshot(before, snapshot({
    ...before,
    commentSession: {
      ...before.commentSession,
      editSession: { commentId: "comment_one", draftText: "editing" },
    },
  })), false);
  assert.equal(sameWorkbenchRenderSnapshot(before, snapshot({
    ...before,
    comment: { ...before.comment, attachmentUploadCount: 1 },
  })), false);
  assert.equal(sameWorkbenchRenderSnapshot(before, snapshot({
    ...before,
    comment: {
      ...before.comment,
      draft: { ...before.comment.draft, error: "write failed" },
    },
  })), false);
});

test("editing text alone stays local while attachment edits publish", () => {
  const attachments = Object.freeze([{ attachmentId: "attachment_one" }]);
  const before = snapshot();
  before.commentSession.editSession = {
    commentId: "comment_one",
    baselineText: "before",
    baselineAttachments: attachments,
    draftText: "before",
    draftAttachments: attachments,
  };
  const typed = snapshot({
    ...before,
    commentSession: {
      ...before.commentSession,
      editSession: { ...before.commentSession.editSession, draftText: "after" },
    },
  });
  const attachmentEdit = snapshot({
    ...before,
    commentSession: {
      ...before.commentSession,
      editSession: {
        ...before.commentSession.editSession,
        draftAttachments: Object.freeze([]),
      },
    },
  });

  assert.equal(sameWorkbenchRenderSnapshot(before, typed), true);
  assert.equal(sameWorkbenchRenderSnapshot(before, attachmentEdit), false);
});

test("PROJECT.md typing stays in the project container while save structure publishes", () => {
  const rules = Object.freeze({
    open: true,
    content: "before",
    savedContent: "before",
    saving: false,
    saveError: "",
  });
  const before = snapshot({ projectRules: rules });
  const typed = snapshot({
    ...before,
    projectRules: { ...rules, content: "after" },
  });
  const saving = snapshot({
    ...before,
    projectRules: { ...rules, content: "after", saving: true },
  });

  assert.equal(sameWorkbenchRenderSnapshot(before, typed), true);
  assert.equal(sameWorkbenchRenderSnapshot(before, saving), false);
});

test("Agent narration stays in the run outlet while lifecycle changes publish", () => {
  const handoff = Object.freeze({
    status: "running",
    phase: "agent-message",
    visibleText: "first",
    textTruncated: false,
    updatedAt: "2026-08-28T00:00:00.000Z",
  });
  const runSession = Object.freeze({
    activeRun: Object.freeze({ requestId: "run_1", attemptId: "attempt_1" }),
    activeHandoff: handoff,
  });
  const before = snapshot({ runSession });
  const narrated = snapshot({
    ...before,
    runSession: {
      ...runSession,
      activeHandoff: {
        ...handoff,
        visibleText: "first second",
        updatedAt: "2026-08-28T00:00:01.000Z",
      },
    },
  });
  const completed = snapshot({
    ...before,
    runSession: {
      ...runSession,
      activeHandoff: { ...handoff, status: "completed" },
    },
  });

  assert.equal(sameWorkbenchRenderSnapshot(before, narrated), true);
  assert.equal(sameWorkbenchRenderSnapshot(before, completed), false);
});

test("other capability snapshots always publish to Workbench", () => {
  const before = snapshot();
  assert.equal(sameWorkbenchRenderSnapshot(before, snapshot({
    ...before,
    runSession: Object.freeze({ revision: 2 }),
  })), false);
  assert.equal(sameWorkbenchRenderSnapshot(before, snapshot({
    ...before,
    futureCapability: Object.freeze({ revision: 1 }),
  })), false);
});
