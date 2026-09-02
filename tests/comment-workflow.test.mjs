import assert from "node:assert/strict";
import test from "node:test";

import { BridgeRequestError } from "../app/application/bridge-client.js";
import { CommentSession } from "../app/application/comment-session.js";
import { CommentWorkflow } from "../app/application/comment-workflow.js";
import { DocumentSession } from "../app/application/document-session.js";
import { DraftSession } from "../app/application/draft-session.js";
import { ProjectSession } from "../app/application/project-session.js";
import { RunSession } from "../app/application/run-session.js";
import { VersionSession } from "../app/application/version-session.js";

const SOURCE_PATH = "/tmp/comment-workflow.html";
const NEXT_SOURCE_PATH = "/tmp/comment-workflow-next.html";
const SOURCE_SHA256 = `sha256:${"a".repeat(64)}`;

function succeeded(value) {
  return { status: "succeeded", value };
}

function activeDraft(revision = 0, extra = {}) {
  return {
    draftRevision: revision,
    comments: [],
    changeEvents: [],
    deletedCommentIds: [],
    appliedOperationIds: [],
    ...extra,
  };
}

function target(id = "target_1") {
  return {
    id,
    elementId: "pr1_11111111111141118111111111111111",
    expectedSourceSha256: SOURCE_SHA256,
    label: "正文",
    selector: "main p",
    level: "part",
    tagName: "p",
    text: "正文",
    resolution: "exact",
  };
}

function runtimeTarget(sourceTarget, label, relativePath) {
  return {
    ...sourceTarget,
    id: `runtime-${sourceTarget.id}`,
    label,
    resolution: "ambiguous",
    commentAnchor: sourceTarget,
    visualHint: {
      runtimeGenerated: true,
      kind: "table",
      label,
      renderedText: `${label} 项目 2025Q1`,
      relativePath,
      relativeBox: { x: 0.1, y: 0.2, width: 0.7, height: 0.2 },
    },
  };
}

function attachment({
  attachmentId,
  commentId = "comment_1",
  fileName = "reference.png",
} = {}) {
  return {
    attachmentId,
    kind: "image",
    fileName,
    mediaType: "image/png",
    byteLength: 8,
    sha256: `sha256:${"b".repeat(64)}`,
    relativePath: `draft/attachments/${commentId}/${attachmentId}-${fileName}`,
    source: "file-picker",
  };
}

function memoryRecoveryStore() {
  const values = new Map();
  const keysFor = (keys) => [...new Set(
    (Array.isArray(keys) ? keys : [keys]).filter(Boolean),
  )];
  return {
    readRecords(keys) {
      return keysFor(keys).flatMap((key) => (
        values.has(key) ? [{ key, value: values.get(key) }] : []
      ));
    },
    write(keys, value) {
      for (const key of keysFor(keys)) values.set(key, value);
      return true;
    },
    remove(keys) {
      for (const key of keysFor(keys)) values.delete(key);
      return true;
    },
  };
}

function commentEditSessionHasChanges(session) {
  if (!session) return false;
  const attachmentIds = (items) => items
    .map((item) => item.attachmentId)
    .sort()
    .join("\u0000");
  return session.baselineText !== session.draftText
    || attachmentIds(session.baselineAttachments)
      !== attachmentIds(session.draftAttachments);
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function createHarness({
  registered = true,
  registrationGate = null,
  runSession = new RunSession({ sourcePath: SOURCE_PATH }),
  documentSession = new DocumentSession({
    html: "<main><p>正文</p></main>",
    sourceSha256: SOURCE_SHA256,
  }),
  bridge = {},
} = {}) {
  const projectSession = new ProjectSession();
  const locator = projectSession.openLocator(SOURCE_PATH);
  let context = registered
    ? projectSession.register({
        ...locator,
        projectId: "project_comment",
        documentId: "document_comment",
      })
    : null;
  const commentSession = new CommentSession();
  let serverDraft = activeDraft();
  const draftWrites = [];
  const attachmentWrites = [];
  const attachmentDeletes = [];
  const client = {
    async workspace() {
      return { runtimeState: { draft: serverDraft } };
    },
    async saveDraft(write) {
      draftWrites.push(write);
      serverDraft = activeDraft(write.expectedDraftRevision + 1, {
        comments: write.comments,
        changeEvents: write.changeEvents,
        deletedCommentIds: write.deletedCommentIds,
        appliedOperationIds: [write.operationId],
      });
      return { ok: true, activeDraft: serverDraft };
    },
    async saveAttachment(input) {
      attachmentWrites.push(input);
      return { attachment: attachment({
        attachmentId: input.attachmentId,
        commentId: input.commentId,
        fileName: input.fileName,
      }) };
    },
    async deleteAttachment(input) {
      attachmentDeletes.push(input);
      return { ok: true, removed: true };
    },
    async attachment() {
      return new Blob(["attachment"]);
    },
    ...bridge,
  };
  const draftSession = new DraftSession({
    bridgeClient: client,
    encodeComment: (value) => value,
    encodeChangeEvent: (value) => value,
  });
  if (context) draftSession.activate(context, 0, serverDraft);
  const versionSession = new VersionSession();
  versionSession.hydrate({
    versions: [{ id: "V1" }],
    latestVersionId: "V1",
    currentBasedOnVersionId: "V1",
    currentExactVersionId: "V1",
  });
  let registrations = 0;
  const ensureRegistered = async () => {
    registrations += 1;
    if (registrationGate) await registrationGate.promise;
    if (!context) {
      context = projectSession.register({
        epoch: projectSession.epoch,
        projectId: "project_comment",
        documentId: "document_comment",
        sourcePath: projectSession.sourcePath,
      });
      draftSession.activate(context, 0, serverDraft);
    }
    return succeeded(context);
  };
  const workflow = new CommentWorkflow({
    bridgeClient: client,
    ensureRegistered,
    projectSession,
    documentSession,
    commentSession,
    draftSession,
    versionSession,
    runSession,
    codecs: {
      isRecord: (value) => Boolean(value) && typeof value === "object"
        && !Array.isArray(value),
      sameSourcePath: (left, right) => left === right,
      persistedComment: (value) => value,
      persistedChangeEvent: (value) => value,
      persistedAttachment: (value) => value,
      persistedTargetRef: (value) => value,
      commentsFromRecords: (value) => Array.isArray(value) ? value : [],
      changesFromDraftRecords: (value) => Array.isArray(value) ? value : [],
      attachmentFromRecord: (value) => value || null,
      selectionFromRecord: (value) => value || null,
      independentCommentTarget: (value, commentId) => ({
        ...value,
        id: `target_${commentId}`,
      }),
      commentEditSessionHasChanges,
      errorMessage: (cause, fallback) => String(cause?.message || fallback),
    },
    ports: {
      recoveryStore: memoryRecoveryStore(),
      attachmentBinary: {
        async prepare(file, { includeDataBase64 }) {
          return {
            fileName: file.name,
            mediaType: file.type || "application/octet-stream",
            byteLength: file.size,
            kind: file.type?.startsWith("image/") ? "image" : "file",
            ...(includeDataBase64 ? { dataBase64: "YXR0YWNobWVudA==" } : {}),
            sourceFile: file,
          };
        },
      },
    },
    clock: { now: () => 1_726_000_000_000 },
  });
  return {
    workflow,
    client,
    projectSession,
    documentSession,
    commentSession,
    draftSession,
    draftWrites,
    attachmentWrites,
    attachmentDeletes,
    get registrations() {
      return registrations;
    },
  };
}

test("workflow construction permits a pre-hydration DocumentSession", () => {
  const harness = createHarness({ documentSession: new DocumentSession() });
  assert.equal(harness.workflow.getSnapshot().draft.active, true);
  harness.workflow.dispose();
});

test("first comment lazily registers once and commits one durable Draft", async () => {
  const harness = createHarness({ registered: false });
  harness.commentSession.update({
    composerCommentId: "comment_first",
    composerTarget: target(),
    composerDraft: "请调整这个段落。",
  });

  const outcome = await harness.workflow.commitComment({
    commentId: "comment_first",
  });
  assert.equal(outcome.status, "succeeded");
  assert.equal(harness.registrations, 1);
  assert.equal(harness.commentSession.comments.length, 1);
  assert.equal(harness.commentSession.comments[0].commentId, "comment_first");

  const flushed = await harness.workflow.flushDraft();
  assert.equal(flushed.status, "succeeded");
  assert.equal(harness.draftWrites.length, 1);
  assert.equal(harness.draftWrites[0].comments[0].commentId, "comment_first");
});

test("lazy registration preserves composer changes that arrive before the save resumes", async () => {
  const registrationGate = deferred();
  const harness = createHarness({ registered: false, registrationGate });
  const initialAttachment = attachment({
    attachmentId: "attachment_late",
    commentId: "comment_race",
    fileName: "late.png",
  });
  harness.commentSession.update({
    composerCommentId: "comment_race",
    composerTarget: target(),
    composerDraft: "初始评论。",
  });

  const pending = harness.workflow.commitComment({ commentId: "comment_race" });
  assert.equal(harness.registrations, 1);
  harness.commentSession.update({
    composerDraft: "初始评论，加上的新内容。",
    composerAttachments: [initialAttachment],
  });
  registrationGate.resolve();

  const stale = await pending;
  assert.equal(stale.status, "stale");
  assert.equal(stale.identity.operationId, "composer_changed");
  assert.equal(harness.commentSession.comments.length, 0);
  assert.equal(harness.commentSession.composerDraft, "初始评论，加上的新内容。");
  assert.deepEqual(harness.commentSession.composerAttachments, [initialAttachment]);

  const retried = await harness.workflow.commitComment({ commentId: "comment_race" });
  assert.equal(retried.status, "succeeded");
  assert.equal(retried.value.comment.text, "初始评论，加上的新内容。");
  assert.deepEqual(retried.value.comment.attachments, [initialAttachment]);
});

test("lazy registration ignores a non-composer working-copy refresh", async () => {
  const registrationGate = deferred();
  const harness = createHarness({ registered: false, registrationGate });
  harness.commentSession.update({
    composerCommentId: "comment_refresh",
    composerTarget: target(),
    composerDraft: "不会被无关同步取消。",
  });

  const pending = harness.workflow.commitComment({ commentId: "comment_refresh" });
  assert.equal(harness.registrations, 1);
  harness.commentSession.setComments([]);
  registrationGate.resolve();

  const outcome = await pending;
  assert.equal(outcome.status, "succeeded");
  assert.equal(outcome.value.comment.text, "不会被无关同步取消。");
});

test("attachment batches retain successful files while reporting individual failures", async () => {
  const harness = createHarness({
    bridge: {
      async saveAttachment(input) {
        if (input.fileName === "bad.bin") throw new Error("写入失败");
        return { attachment: attachment({
          attachmentId: input.attachmentId,
          commentId: input.commentId,
          fileName: input.fileName,
        }) };
      },
    },
  });
  harness.commentSession.update({
    composerCommentId: "comment_batch",
    composerTarget: target(),
  });

  const outcome = await harness.workflow.uploadAttachments({
    files: [
      { name: "good.png", type: "image/png", size: 8 },
      { name: "bad.bin", type: "application/octet-stream", size: 8 },
    ],
    target: { kind: "composer", commentId: "comment_batch" },
    source: "file-picker",
    persistence: "bridge",
  });

  assert.equal(outcome.status, "succeeded");
  assert.equal(outcome.value.attachments.length, 1);
  assert.equal(outcome.value.failures.length, 1);
  assert.equal(outcome.value.failures[0].fileName, "bad.bin");
  assert.equal(harness.commentSession.composerAttachments.length, 1);
  assert.equal(harness.commentSession.composerAttachments[0].fileName, "good.png");
});

test("browser-memory attachments never invoke Bridge storage or deletion", async () => {
  let bridgeAttachmentCalls = 0;
  const harness = createHarness({
    bridge: {
      async saveAttachment() {
        bridgeAttachmentCalls += 1;
        throw new Error("browser memory must not write through Bridge");
      },
      async deleteAttachment() {
        bridgeAttachmentCalls += 1;
        throw new Error("browser memory must not delete through Bridge");
      },
      async attachment() {
        bridgeAttachmentCalls += 1;
        throw new Error("browser memory must not read through Bridge");
      },
    },
  });
  harness.commentSession.update({
    composerCommentId: "comment_memory",
    composerTarget: target(),
  });

  const uploaded = await harness.workflow.uploadAttachments({
    files: [{ name: "memory.png", type: "image/png", size: 8 }],
    target: { kind: "composer", commentId: "comment_memory" },
    source: "clipboard",
    persistence: "memory",
  });
  assert.equal(uploaded.status, "succeeded");
  const memoryAttachment = uploaded.value.attachments[0].attachment;
  assert.match(memoryAttachment.relativePath, /^memory\//u);
  assert.equal(bridgeAttachmentCalls, 0);

  const removed = harness.workflow.removeComposerAttachment({
    attachmentId: memoryAttachment.attachmentId,
  });
  assert.equal(removed.status, "succeeded");
  const read = await harness.workflow.readAttachment({
    attachment: memoryAttachment,
  });
  assert.equal(read.status, "blocked");
  assert.equal(bridgeAttachmentCalls, 0);
});

test("disabled or unknown attachment persistence never registers or writes through Bridge", async () => {
  let bridgeAttachmentCalls = 0;
  const harness = createHarness({
    registered: false,
    bridge: {
      async saveAttachment() {
        bridgeAttachmentCalls += 1;
        throw new Error("disabled persistence must not write through Bridge");
      },
    },
  });
  harness.commentSession.update({
    composerCommentId: "comment_disabled_persistence",
    composerTarget: target(),
  });

  for (const persistence of ["none", "unknown"]) {
    const outcome = await harness.workflow.uploadAttachments({
      files: [{ name: "disabled.png", type: "image/png", size: 8 }],
      target: { kind: "composer", commentId: "comment_disabled_persistence" },
      source: "file-picker",
      persistence,
    });
    assert.equal(outcome.status, "blocked");
    assert.equal(outcome.code, "ATTACHMENT_PERSISTENCE_UNAVAILABLE");
  }

  assert.equal(harness.registrations, 0);
  assert.equal(bridgeAttachmentCalls, 0);
  assert.equal(harness.commentSession.composerAttachments.length, 0);
});

test("a stale upload result is compensated against its captured project identity", async () => {
  const write = deferred();
  const started = deferred();
  let attachmentInput;
  const harness = createHarness({
    bridge: {
      async saveAttachment(input) {
        attachmentInput = input;
        started.resolve();
        return write.promise;
      },
    },
  });
  harness.commentSession.update({
    composerCommentId: "comment_stale",
    composerTarget: target(),
  });
  const pending = harness.workflow.uploadAttachments({
    files: [{ name: "late.png", type: "image/png", size: 8 }],
    target: { kind: "composer", commentId: "comment_stale" },
    source: "file-picker",
    persistence: "bridge",
  });
  await started.promise;

  harness.workflow.resetForProjectTransition();
  harness.projectSession.openLocator(NEXT_SOURCE_PATH);
  harness.draftSession.deactivate();
  write.resolve({ attachment: attachment({
    attachmentId: attachmentInput.attachmentId,
    commentId: "comment_stale",
    fileName: "late.png",
  }) });

  const outcome = await pending;
  assert.equal(outcome.status, "stale");
  assert.equal(harness.commentSession.composerAttachments.length, 0);
  assert.equal(harness.attachmentDeletes.length, 1);
  assert.equal(harness.attachmentDeletes[0].projectId, "project_comment");
  assert.equal(harness.attachmentDeletes[0].documentId, "document_comment");
  assert.equal(harness.attachmentDeletes[0].sourcePath, SOURCE_PATH);
});

test("cancelling an edit cleans only attachments staged during that edit", () => {
  const harness = createHarness();
  const baseline = attachment({
    attachmentId: "attachment_baseline",
    commentId: "comment_edit",
  });
  const staged = attachment({
    attachmentId: "attachment_staged",
    commentId: "comment_edit",
  });
  harness.commentSession.update({
    comments: [{
      commentId: "comment_edit",
      createdAt: "2026-08-11T00:00:00.000Z",
      updatedAt: "2026-08-11T00:00:00.000Z",
      target: target("target_comment_edit"),
      text: "原评论",
      attachments: [baseline],
      baseVersionId: "V1",
    }],
    editSession: {
      commentId: "comment_edit",
      baselineText: "原评论",
      baselineAttachments: [baseline],
      draftText: "原评论",
      draftAttachments: [baseline, staged],
    },
  });

  const outcome = harness.workflow.cancelCommentEdit({
    commentId: "comment_edit",
  });
  assert.equal(outcome.status, "succeeded");
  assert.equal(harness.commentSession.editSession, null);
  assert.deepEqual(
    harness.attachmentDeletes.map((item) => item.relativePath),
    [staged.relativePath],
  );
});

test("an unknown Draft POST reconciles authority without a second mutation", async () => {
  let attempted = null;
  let saveAttempts = 0;
  const lockedRunSession = { activeLocked: true };
  const harness = createHarness({
    runSession: lockedRunSession,
    bridge: {
      async saveDraft(write) {
        saveAttempts += 1;
        attempted = write;
        throw new BridgeRequestError("timeout", { outcome: "unknown" });
      },
      async workspace() {
        return {
          runtimeState: {
            draft: activeDraft(1, {
              comments: attempted?.comments || [],
              changeEvents: attempted?.changeEvents || [],
              deletedCommentIds: attempted?.deletedCommentIds || [],
              appliedOperationIds: attempted ? [attempted.operationId] : [],
            }),
          },
        };
      },
    },
  });
  harness.commentSession.setComments([{
    commentId: "comment_unknown",
    createdAt: "2026-08-11T00:00:00.000Z",
    updatedAt: "2026-08-11T00:00:00.000Z",
    target: target("target_unknown"),
    text: "保留这条评论",
    baseVersionId: "V1",
  }]);

  const outcome = await harness.workflow.flushDraft({ boundary: "submit" });
  assert.equal(outcome.status, "succeeded");
  assert.equal(saveAttempts, 1);
  assert.ok(attempted);
  assert.equal(harness.draftSession.revision, 1);
});

test("beginComposer and updateDraft are the only writer for a new comment draft", () => {
  const harness = createHarness();
  const started = harness.workflow.beginComposer({
    target: target("target_composer"),
    commentId: "comment_new",
  });
  assert.equal(started.status, "succeeded");
  assert.equal(harness.commentSession.composerCommentId, "comment_new");
  assert.equal(harness.commentSession.composerTarget.id, "target_composer");
  assert.equal(harness.commentSession.composerDraft, "");

  const drafted = harness.workflow.updateDraft("请改标题");
  assert.equal(drafted.status, "succeeded");
  assert.equal(harness.commentSession.composerDraft, "请改标题");

  const resumed = harness.workflow.beginComposer({
    target: target("target_composer_2"),
    commentId: "comment_new",
    resume: true,
  });
  assert.equal(resumed.status, "succeeded");
  assert.equal(harness.commentSession.composerDraft, "请改标题");
  assert.equal(harness.commentSession.composerTarget.id, "target_composer_2");
});

test("rebindCommentTarget is the unique comment-location commit path", () => {
  const harness = createHarness();
  harness.commentSession.setComments([{
    commentId: "comment_rebind",
    createdAt: "2026-08-11T00:00:00.000Z",
    updatedAt: "2026-08-11T00:00:00.000Z",
    target: target("target_old"),
    text: "位置失效",
    baseVersionId: "V1",
  }]);

  const outcome = harness.workflow.rebindCommentTarget({
    commentId: "comment_rebind",
    target: { ...target("target_new"), resolution: "exact" },
  });
  assert.equal(outcome.status, "succeeded");
  assert.equal(outcome.value.target.id, "target_old");
  assert.equal(outcome.value.target.selector, "main p");
  assert.equal(harness.commentSession.comments[0].target.id, "target_old");
  assert.equal(outcome.value.comment.target.resolution, "exact");
});

test("relinking a runtime comment to a source target clears the old visual hint", () => {
  const harness = createHarness();
  const sourceHost = target("target_runtime_host");
  harness.commentSession.setComments([{
    commentId: "comment_runtime_to_source",
    createdAt: "2026-08-11T00:00:00.000Z",
    updatedAt: "2026-08-11T00:00:00.000Z",
    target: {
      ...runtimeTarget(sourceHost, "财务数据表", "table:nth-of-type(1)"),
      id: "target_runtime_to_source",
    },
    sourceAnchor: sourceHost,
    visualHint: runtimeTarget(sourceHost, "财务数据表", "table:nth-of-type(1)").visualHint,
    text: "运行时评论",
    baseVersionId: "V1",
  }]);

  const outcome = harness.workflow.rebindCommentTarget({
    commentId: "comment_runtime_to_source",
    target: target("target_new_source"),
  });
  assert.equal(outcome.status, "succeeded");
  const rebound = harness.commentSession.comments[0];
  assert.equal(rebound.target.selector, "main p");
  assert.equal(rebound.sourceAnchor.selector, "main p");
  assert.equal(Object.hasOwn(rebound, "visualHint"), false);
  assert.equal(Object.hasOwn(rebound.target, "visualHint"), false);
});

test("relinking between runtime objects replaces the visual hint", () => {
  const harness = createHarness();
  const sourceHost = target("target_runtime_host_pair");
  const firstRuntime = runtimeTarget(sourceHost, "财务数据表", "table:nth-of-type(1)");
  const secondRuntime = runtimeTarget(sourceHost, "利润数据表", "table:nth-of-type(2)");
  harness.commentSession.setComments([{
    commentId: "comment_runtime_pair",
    createdAt: "2026-08-11T00:00:00.000Z",
    updatedAt: "2026-08-11T00:00:00.000Z",
    target: { ...firstRuntime, id: "target_runtime_pair" },
    sourceAnchor: sourceHost,
    visualHint: firstRuntime.visualHint,
    text: "运行时评论",
    baseVersionId: "V1",
  }]);

  const outcome = harness.workflow.rebindCommentTarget({
    commentId: "comment_runtime_pair",
    target: secondRuntime,
  });
  assert.equal(outcome.status, "succeeded");
  const rebound = harness.commentSession.comments[0];
  assert.equal(rebound.visualHint.label, "利润数据表");
  assert.equal(rebound.visualHint.relativePath, "table:nth-of-type(2)");
  assert.equal(rebound.target.label, "利润数据表");
});

test("relinking a source comment to a runtime object adds a new visual hint", () => {
  const harness = createHarness();
  const sourceHost = target("target_source_to_runtime");
  harness.commentSession.setComments([{
    commentId: "comment_source_to_runtime",
    createdAt: "2026-08-11T00:00:00.000Z",
    updatedAt: "2026-08-11T00:00:00.000Z",
    target: sourceHost,
    sourceAnchor: sourceHost,
    text: "源码评论",
    baseVersionId: "V1",
  }]);

  const runtime = runtimeTarget(sourceHost, "财务数据表", "table:nth-of-type(1)");
  const outcome = harness.workflow.rebindCommentTarget({
    commentId: "comment_source_to_runtime",
    target: runtime,
  });
  assert.equal(outcome.status, "succeeded");
  const rebound = harness.commentSession.comments[0];
  assert.equal(rebound.visualHint.kind, "table");
  assert.equal(rebound.target.visualHint.relativePath, "table:nth-of-type(1)");
  assert.equal(rebound.sourceAnchor.elementId, sourceHost.elementId);
});

test("beginEdit and confirmEdit keep an exclusive editing session", () => {
  const harness = createHarness();
  harness.commentSession.setComments([{
    commentId: "comment_edit_intent",
    createdAt: "2026-08-11T00:00:00.000Z",
    updatedAt: "2026-08-11T00:00:00.000Z",
    target: target("target_edit_intent"),
    text: "原评论",
    baseVersionId: "V1",
  }]);

  const started = harness.workflow.beginEdit({ commentId: "comment_edit_intent" });
  assert.equal(started.status, "succeeded");
  assert.equal(harness.commentSession.editSession.commentId, "comment_edit_intent");
  assert.equal(harness.commentSession.editSession.draftText, "原评论");

  const drafted = harness.workflow.updateEditDraft("改后的评论");
  assert.equal(drafted.status, "succeeded");
  assert.equal(harness.commentSession.editSession.draftText, "改后的评论");

  const confirmed = harness.workflow.confirmEdit({ commentId: "comment_edit_intent" });
  assert.equal(confirmed.status, "succeeded");
  assert.equal(harness.commentSession.editSession, null);
  assert.equal(harness.commentSession.comments[0].text, "改后的评论");
});

test("missing edit or comment targets fail closed on intent commands", () => {
  const harness = createHarness();
  assert.equal(harness.workflow.beginComposer({}).status, "blocked");
  assert.equal(harness.workflow.rebindCommentTarget({
    commentId: "missing",
    target: target(),
  }).status, "blocked");
  assert.equal(
    harness.workflow.beginEdit({ commentId: "missing" }).status,
    "blocked",
  );
  assert.equal(harness.workflow.updateEditDraft("x").status, "blocked");
});

test("deleting a source subtree removes its saved comments and draft in one durable update", async () => {
  const harness = createHarness();
  const removedRootId = "pr1_aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa";
  const removedChildId = "pr1_bbbbbbbbbbbb4bbb8bbbbbbbbbbbbbbb";
  const survivingId = "pr1_cccccccccccc4ccc8ccccccccccccccc";
  const rootAttachment = attachment({
    attachmentId: "attachment_removed_root",
    commentId: "comment_removed_root",
  });
  const draftAttachment = attachment({
    attachmentId: "attachment_removed_draft",
    commentId: "comment_removed_draft",
  });
  harness.commentSession.update({
    comments: [
      {
        commentId: "comment_removed_root",
        target: { ...target("target_removed_root"), elementId: removedRootId },
        sourceAnchor: { ...target("target_removed_root"), elementId: removedRootId },
        text: "删除根元素时一起删除",
        attachments: [rootAttachment],
      },
      {
        commentId: "comment_removed_child",
        target: { ...target("target_removed_child"), elementId: removedChildId },
        sourceAnchor: { ...target("target_removed_child"), elementId: removedChildId },
        text: "删除后代元素时一起删除",
      },
      {
        commentId: "comment_survives",
        target: { ...target("target_survives"), elementId: survivingId },
        sourceAnchor: { ...target("target_survives"), elementId: survivingId },
        text: "保留",
      },
    ],
    composerCommentId: "comment_removed_draft",
    composerTarget: { ...target("target_removed_draft"), elementId: removedChildId },
    composerDraft: "尚未保存",
    composerAttachments: [draftAttachment],
    editSession: {
      commentId: "comment_removed_root",
      baselineText: "删除根元素时一起删除",
      draftText: "正在编辑",
      baselineAttachments: [rootAttachment],
      draftAttachments: [rootAttachment],
    },
  });

  const outcome = harness.workflow.deleteCommentsForElementIds({
    elementIds: [removedRootId, removedChildId],
  });

  assert.equal(outcome.status, "succeeded");
  assert.deepEqual(
    harness.commentSession.comments.map((comment) => comment.commentId),
    ["comment_survives"],
  );
  assert.deepEqual(
    [...harness.commentSession.deletedCommentIds].sort(),
    ["comment_removed_child", "comment_removed_draft", "comment_removed_root"],
  );
  assert.equal(harness.commentSession.composerTarget, null);
  assert.equal(harness.commentSession.composerDraft, "");
  assert.equal(harness.commentSession.editSession, null);
  assert.deepEqual(
    harness.attachmentDeletes.map((write) => write.relativePath).sort(),
    [draftAttachment.relativePath, rootAttachment.relativePath].sort(),
  );
  const flushed = await harness.workflow.flushDraft();
  assert.equal(flushed.status, "succeeded");
  assert.deepEqual(
    harness.draftWrites.at(-1).comments.map((comment) => comment.commentId),
    ["comment_survives"],
  );
});
