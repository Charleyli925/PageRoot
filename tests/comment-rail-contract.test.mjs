import assert from "node:assert/strict";
import test from "node:test";

import {
  composerViewFields,
  deriveComposerState,
} from "../app/workbench/comment-rail-state.js";

const target = Object.freeze({
  id: "target_draft",
  label: "Draft target",
  selector: "main > p",
  level: "part",
  tagName: "p",
  text: "Draft target",
  resolution: "exact",
});
const attachment = Object.freeze({
  attachmentId: "attachment_1",
  kind: "image",
  fileName: "draft.png",
  mediaType: "image/png",
  byteLength: 12,
  sha256: "sha256",
  relativePath: "attachments/draft.png",
});
const editSession = Object.freeze({
  commentId: "comment_edit",
  baselineText: "before",
  baselineAttachments: [],
  draftText: "after",
  draftAttachments: [attachment],
});

function baseInput(overrides = {}) {
  return {
    relinkingTarget: null,
    editingCommentId: null,
    commentEditSession: null,
    commentEditDraft: "",
    commentEditAttachments: [],
    composerOpen: false,
    draftTarget: null,
    draft: "",
    draftCommentId: null,
    draftAttachments: [],
    hasCollapsedCommentDraft: false,
    ...overrides,
  };
}

test("deriveComposerState covers relinking, editing, new and closed authority", () => {
  assert.deepEqual(
    deriveComposerState(baseInput({ relinkingTarget: "comment_relink" })),
    { kind: "relinking", commentId: "comment_relink" },
  );

  const editing = deriveComposerState(baseInput({
    editingCommentId: "comment_edit",
    commentEditSession: editSession,
    commentEditDraft: "after",
    commentEditAttachments: [attachment],
  }));
  assert.equal(editing.kind, "editing");
  assert.equal(editing.session, editSession);
  assert.deepEqual(editing.draft.attachments, [attachment]);

  const opened = deriveComposerState(baseInput({
    composerOpen: true,
    draftTarget: target,
    draft: "new draft",
    draftCommentId: "comment_new",
    draftAttachments: [attachment],
  }));
  assert.equal(opened.kind, "new");
  assert.equal(opened.target, target);

  assert.deepEqual(
    deriveComposerState(baseInput()),
    { kind: "closed", collapsedDraft: null },
  );
});

test("closed composer preserves and restores the collapsed draft target", () => {
  const closed = deriveComposerState(baseInput({
    draftTarget: target,
    draft: "parked draft",
    draftCommentId: "comment_parked",
    draftAttachments: [attachment],
    hasCollapsedCommentDraft: true,
  }));
  assert.equal(closed.kind, "closed");
  assert.equal(closed.collapsedDraft?.target, target);

  const fields = composerViewFields(closed);
  assert.equal(fields.composerOpen, false);
  assert.equal(fields.hasCollapsedCommentDraft, true);
  assert.equal(fields.draftTarget, target);
  assert.equal(fields.draft, "parked draft");
  assert.equal(fields.draftCommentId, "comment_parked");
  assert.deepEqual(fields.draftAttachments, [attachment]);
});

test("composerViewFields projects every composer union branch", () => {
  const opened = deriveComposerState(baseInput({
    composerOpen: true,
    draftTarget: target,
    draft: "new draft",
    draftCommentId: "comment_new",
  }));
  assert.deepEqual(composerViewFields(opened), {
    composerOpen: true,
    draftTarget: target,
    draft: "new draft",
    draftCommentId: "comment_new",
    draftAttachments: [],
    hasCollapsedCommentDraft: false,
    editingCommentId: null,
    commentEditSession: null,
    commentEditDraft: "",
    commentEditAttachments: [],
    relinkingTarget: null,
  });

  const editing = deriveComposerState(baseInput({
    editingCommentId: "comment_edit",
    commentEditSession: editSession,
    commentEditDraft: "after",
    commentEditAttachments: [attachment],
  }));
  assert.equal(composerViewFields(editing).editingCommentId, "comment_edit");
  assert.equal(composerViewFields(editing).commentEditSession, editSession);
  assert.equal(composerViewFields(editing).commentEditDraft, "after");

  const relinking = deriveComposerState(baseInput({
    relinkingTarget: "comment_relink",
  }));
  assert.deepEqual(composerViewFields(relinking), {
    composerOpen: false,
    draftTarget: null,
    draft: "",
    draftCommentId: null,
    draftAttachments: [],
    hasCollapsedCommentDraft: false,
    editingCommentId: null,
    commentEditSession: null,
    commentEditDraft: "",
    commentEditAttachments: [],
    relinkingTarget: "comment_relink",
  });
});
