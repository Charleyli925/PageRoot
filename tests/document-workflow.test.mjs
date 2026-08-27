import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { BridgeRequestError } from "../app/application/bridge-client.js";
import { CommentSession } from "../app/application/comment-session.js";
import { DocumentSession } from "../app/application/document-session.js";
import { DocumentWorkflow } from "../app/application/document-workflow.js";
import { ProjectSession } from "../app/application/project-session.js";
import { SourceHistorySession } from "../app/application/source-history-session.js";
import { VersionSession } from "../app/application/version-session.js";
import { auditEventKey, removeAcknowledgedAuditEvents } from "../app/lib/audit-events.js";
import { appendDirectEditEvent } from "../app/lib/direct-edit-events.js";
import {
  appendSourceHistoryOperations,
  applySourceHistoryAction,
  createEmptySourceHistory,
} from "../shared/source-history.mjs";

const SOURCE_PATH = "/tmp/document-workflow.html";
const PROJECT_ID = "project_document_workflow";
const DOCUMENT_ID = "document_document_workflow";

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function createScheduler() {
  let sequence = 0;
  const tasks = new Map();
  return {
    setTimeout(callback, delay) {
      const id = ++sequence;
      tasks.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) {
      tasks.delete(id);
    },
    run(id) {
      const task = tasks.get(id);
      tasks.delete(id);
      task?.callback();
    },
    get pending() {
      return [...tasks.entries()].map(([id, task]) => ({ id, ...task }));
    },
  };
}

function createRecoveryStore() {
  const values = new Map();
  const normalize = (keys) => (Array.isArray(keys) ? keys : [keys])
    .map(String)
    .filter(Boolean);
  return {
    readRecords(keys) {
      return normalize(keys)
        .filter((key) => values.has(key))
        .map((key) => ({ key, value: values.get(key) }));
    },
    write(keys, value) {
      for (const key of normalize(keys)) values.set(key, structuredClone(value));
      return true;
    },
    remove(keys) {
      for (const key of normalize(keys)) values.delete(key);
      return true;
    },
    get values() {
      return values;
    },
  };
}

function sourceHistory({ sourceSha256, entries = [] } = {}) {
  const history = createEmptySourceHistory({
    projectId: PROJECT_ID,
    documentId: DOCUMENT_ID,
    sourceSha256,
    now: () => "2026-08-11T00:00:00.000Z",
  });
  if (entries.length === 0) return history;
  return appendSourceHistoryOperations(history, entries, {
    projectId: PROJECT_ID,
    documentId: DOCUMENT_ID,
    sourceSha256,
    targetSourceSha256: entries.at(-1).afterSourceSha256,
    now: () => "2026-08-11T00:00:01.000Z",
  });
}

function operation(before, after) {
  const startOffset = before.indexOf("one");
  return {
    operationId: "sourceop_document_workflow_001",
    kind: "text",
    editRevision: 1,
    createdAt: "2026-08-11T00:00:00.000Z",
    beforeSourceSha256: sha256(before),
    afterSourceSha256: sha256(after),
    forwardPatches: [{
      startOffset,
      endOffset: startOffset + 3,
      before: "one",
      after: "two",
      kind: "text",
    }],
    reversePatches: [{
      startOffset,
      endOffset: startOffset + 3,
      before: "two",
      after: "one",
      kind: "inverse:text",
    }],
    beforeTarget: { id: "target-history", text: "one", resolution: "exact" },
    afterTarget: { id: "target-history", text: "two", resolution: "exact" },
    beforeSelection: { anchor: startOffset, focus: startOffset + 3, affinity: "right" },
    afterSelection: { anchor: startOffset + 3, focus: startOffset + 3, affinity: "right" },
  };
}

function createHarness({
  html = "<!doctype html><html><body><p>one</p></body></html>",
  bridge = {},
  codecOverrides = {},
  canvasOverrides = {},
  registered = true,
  ensureRegistered,
} = {}) {
  const projectSession = new ProjectSession();
  projectSession.openLocator(SOURCE_PATH);
  const context = {
    epoch: projectSession.epoch,
    projectId: PROJECT_ID,
    documentId: DOCUMENT_ID,
    sourcePath: SOURCE_PATH,
  };
  if (registered) projectSession.register(context);
  const documentSession = new DocumentSession({
    html,
    sourceSha256: sha256(html),
  });
  const commentSession = new CommentSession();
  const versionSession = new VersionSession();
  const sourceHistorySession = new SourceHistorySession();
  sourceHistorySession.activate(
    context,
    sha256(html),
    sourceHistory({ sourceSha256: sha256(html) }),
  );
  const scheduler = createScheduler();
  const recoveryStore = createRecoveryStore();
  const canvas = {
    invalidations: 0,
    history: [],
    invalidateRenderAcks() {
      this.invalidations += 1;
    },
    adoptHistorySource(htmlValue, target, selection) {
      this.history.push({ html: htmlValue, target, selection });
    },
    ...canvasOverrides,
  };
  const client = {
    async autosave() {
      throw new Error("autosave test double was not configured");
    },
    async source() {
      throw new Error("source test double was not configured");
    },
    async workspace() {
      return {};
    },
    async sourceHistoryAction() {
      throw new Error("history test double was not configured");
    },
    async resolveConflict() {
      return {};
    },
    ...bridge,
  };
  const workflow = new DocumentWorkflow({
    bridgeClient: client,
    ensureRegistered: ensureRegistered || (async () => ({
      status: "succeeded",
      value: context,
    })),
    projectSession,
    documentSession,
    commentSession,
    versionSession,
    sourceHistorySession,
    codecs: {
      isRecord,
      sameSourcePath: (left, right) => Boolean(left && right && left === right),
      persistedChangeEvent: (value) => value,
      recoveryIdentityFromRecord: (value) => value || null,
      sourceHistoryOperationsFromRecord: (value) => Array.isArray(value) ? value : [],
      changesFromRecords: (value) => Array.isArray(value) ? value : [],
      historyTextSelectionFromRecord: (value) => value || null,
      selectionFromRecord: (value) => value || null,
      rebindTargetsPreservingGlobal: (_html, targets) => targets,
      rebindTargetsAcrossHistoryPreservingGlobal: (_before, _after, targets) => targets,
      canLocateTarget: () => true,
      appendDirectEditEvent,
      auditEventKey,
      removeAcknowledgedAuditEvents,
      errorMessage: (cause, fallback) => String(cause?.message || fallback),
      ...codecOverrides,
    },
    ports: {
      hash: { sha256: async (value) => sha256(value) },
      recoveryStore,
      canvas,
    },
    scheduler,
    clock: { now: () => Date.parse("2026-08-11T00:00:00.000Z") },
  });
  return {
    workflow,
    context,
    projectSession,
    client,
    documentSession,
    commentSession,
    versionSession,
    sourceHistorySession,
    scheduler,
    recoveryStore,
    canvas,
  };
}

test("DocumentWorkflow restores source-history and recovery authority after a project transition reset", () => {
  const before = "<!doctype html><html><body><p>one</p></body></html>";
  const after = before.replace("one", "two");
  const harness = createHarness({ html: before });
  const recoveryIdentity = {
    schemaVersion: "1.0.0",
    token: sha256("transition-recovery"),
    projectId: PROJECT_ID,
    documentId: DOCUMENT_ID,
    sourcePath: SOURCE_PATH,
    basedOnVersionId: "version_001",
    sourceSha256: sha256(before),
    editRevision: 1,
  };
  const pending = operation(before, after);
  harness.workflow.replaceRecoveryIdentity(recoveryIdentity);
  harness.sourceHistorySession.restorePending(harness.context, [pending]);
  const authority = harness.workflow.captureProjectTransitionAuthority();

  harness.workflow.resetForProjectTransition();
  assert.equal(harness.workflow.recoveryIdentity, null);
  assert.equal(harness.sourceHistorySession.snapshot, null);
  assert.deepEqual(harness.sourceHistorySession.pendingOperations, []);

  assert.equal(harness.workflow.restoreProjectTransitionAuthority({
    authority,
    context: harness.context,
    sourceSha256: sha256(before),
  }), true);
  assert.deepEqual(harness.workflow.recoveryIdentity, recoveryIdentity);
  assert.deepEqual(harness.sourceHistorySession.snapshot, authority.sourceHistory);
  assert.deepEqual(harness.sourceHistorySession.pendingOperations, [pending]);
});

test("DocumentWorkflow coalesces a 100ms source write and only accepts exact HTML/Hash acknowledgement", async () => {
  const before = "<!doctype html><html><body><p>one</p></body></html>";
  const after = before.replace("one", "two");
  const history = sourceHistory({ sourceSha256: sha256(before) });
  const calls = [];
  const harness = createHarness({
    html: before,
    bridge: {
      async autosave(body) {
        calls.push(body);
        return {
          ok: true,
          content: body.html,
          sha256: sha256(body.html),
          persistedRevision: body.editRevision,
          lastModifiedAt: "2026-08-11T00:00:01.000Z",
          sourceHistory: history,
        };
      },
    },
  });

  const queued = harness.workflow.enqueueEdit({ html: after });
  assert.equal(queued.status, "succeeded");
  assert.equal(queued.value.revision, 1);
  assert.deepEqual(harness.scheduler.pending.map((task) => task.delay), [100]);
  assert.equal(harness.documentSession.persistState, "queued");
  assert.equal(harness.recoveryStore.values.size, 2);

  const outcome = await harness.workflow.flush({ throughRevision: 1 });
  assert.equal(outcome.status, "succeeded");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].html, after);
  assert.equal(harness.documentSession.sourceSha256, sha256(after));
  assert.equal(harness.documentSession.persistState, "idle");
  assert.equal(harness.recoveryStore.values.size, 0);
});

test("DocumentWorkflow flushes a native-edit checkpoint immediately", async () => {
  const before = "<!doctype html><html><body><p>one</p></body></html>";
  const after = before.replace("one", "two");
  const history = sourceHistory({ sourceSha256: sha256(before) });
  const calls = [];
  const harness = createHarness({
    html: before,
    bridge: {
      async autosave(body) {
        calls.push(body);
        return {
          ok: true,
          content: body.html,
          sha256: sha256(body.html),
          persistedRevision: body.editRevision,
          lastModifiedAt: "2026-08-11T00:00:01.000Z",
          sourceHistory: history,
        };
      },
    },
  });

  const queued = harness.workflow.enqueueEdit({
    html: after,
    mutation: {
      kind: "text",
      property: "editableIslandHtml",
      target: { id: "island" },
    },
  });
  assert.equal(queued.status, "succeeded");
  assert.deepEqual(harness.scheduler.pending.map((task) => task.delay), []);
  const outcome = await harness.workflow.flush();
  assert.equal(outcome.status, "succeeded");
  assert.equal(calls.length, 1);
  assert.equal(harness.documentSession.persistState, "idle");
});

test("DocumentWorkflow rebinds a moved Working Copy before the next autosave", async () => {
  const before = "<!doctype html><html><body><p>one</p></body></html>";
  const after = before.replace("one", "two");
  const final = after.replace("two", "three");
  const movedPath = "/tmp/project-renamed/document-V1.html";
  const initialTarget = {
    projectId: PROJECT_ID,
    documentId: DOCUMENT_ID,
    projectRootPath: "/tmp/project-original",
    targetKind: "working-copy",
    workingCopyId: "work_ver_0001",
    versionId: "ver_0001",
    exactSourcePath: SOURCE_PATH,
    sourceSha256: sha256(before),
  };
  const calls = [];
  const harness = createHarness({
    html: before,
    bridge: {
      async autosave(body) {
        calls.push(body);
        const currentTarget = {
          ...initialTarget,
          projectRootPath: "/tmp/project-renamed",
          exactSourcePath: movedPath,
          sourceSha256: sha256(body.html),
        };
        return {
          ok: true,
          content: body.html,
          sha256: sha256(body.html),
          persistedRevision: body.editRevision,
          lastModifiedAt: "2026-08-11T00:00:01.000Z",
          sourceHistory: sourceHistory({ sourceSha256: sha256(body.html) }),
          openTarget: currentTarget,
          activeDraft: {
            draftRevision: 0,
            comments: [],
            changeEvents: [],
            deletedCommentIds: [],
          },
        };
      },
    },
  });
  const registered = harness.projectSession.register({
    ...harness.context,
    openTarget: initialTarget,
  });
  assert.equal(registered?.exactSourcePath, SOURCE_PATH);
  const events = [];
  harness.workflow.subscribeEvents((event) => events.push(event));

  harness.workflow.enqueueEdit({ html: after });
  assert.equal((await harness.workflow.flush()).status, "succeeded");
  assert.equal(harness.projectSession.context?.sourcePath, movedPath);
  assert.equal(harness.projectSession.context?.projectRootPath, "/tmp/project-renamed");
  assert.equal(
    events.find((event) => event.type === "document-open-target-rebound")?.context?.sourcePath,
    movedPath,
  );

  harness.workflow.enqueueEdit({ html: final });
  assert.equal((await harness.workflow.flush()).status, "succeeded");
  assert.equal(calls.length, 2);
  assert.equal(calls[1].sourcePath, movedPath);
  assert.equal(calls[1].exactSourcePath, movedPath);
  assert.equal(calls[1].projectRootPath, "/tmp/project-renamed");
  assert.equal(calls[1].expectedSourceSha256, sha256(after));
});

test("DocumentWorkflow exposes no user-selected moved-project rebinding API", () => {
  const harness = createHarness();
  assert.equal("rebindRelocatedOpenTarget" in harness.workflow, false);
});

test("DocumentWorkflow rejects an unchainable source transaction without publishing the canvas edit", () => {
  const before = "<!doctype html><html><body><p>one</p></body></html>";
  const after = before.replace("one", "two");
  const harness = createHarness({ html: before });
  const transaction = {
    ...operation(before, after),
    beforeSourceSha256: sha256("a different authoritative source"),
  };

  const outcome = harness.workflow.enqueueEdit({
    html: after,
    sourceTransaction: transaction,
  });

  assert.deepEqual(outcome, {
    status: "rejected",
    code: "SOURCE_HISTORY_RECORD_REJECTED",
    reason: "源码历史与当前画布补丁链不一致。",
  });
  assert.equal(harness.documentSession.html, before);
  assert.equal(harness.documentSession.editRevision, 0);
  assert.equal(harness.documentSession.pendingWrite, null);
  assert.deepEqual(harness.sourceHistorySession.pendingOperations, []);
  assert.equal(harness.canvas.invalidations, 0);
});

test("DocumentWorkflow drains a newer queued write after an earlier acknowledgement", async () => {
  const before = "<!doctype html><html><body><p>one</p></body></html>";
  const middle = before.replace("one", "two");
  const after = before.replace("one", "three");
  const calls = [];
  let resolveFirst;
  const harness = createHarness({
    html: before,
    bridge: {
      autosave(body) {
        calls.push(body);
        if (calls.length === 1) {
          return new Promise((resolve) => { resolveFirst = resolve; });
        }
        return Promise.resolve({
          ok: true,
          content: body.html,
          sha256: sha256(body.html),
          persistedRevision: body.editRevision,
          lastModifiedAt: "2026-08-11T00:00:02.000Z",
          sourceHistory: sourceHistory({ sourceSha256: sha256(before) }),
        });
      },
    },
  });

  harness.workflow.enqueueEdit({ html: middle });
  const flushing = harness.workflow.flush();
  await Promise.resolve();
  assert.equal(calls.length, 1);
  harness.workflow.enqueueEdit({ html: after });
  resolveFirst({
    ok: true,
    content: middle,
    sha256: sha256(middle),
    persistedRevision: 1,
    lastModifiedAt: "2026-08-11T00:00:01.000Z",
    sourceHistory: sourceHistory({ sourceSha256: sha256(before) }),
  });

  assert.equal((await flushing).status, "succeeded");
  assert.equal(calls.length, 2);
  assert.equal(calls[1].html, after);
  assert.equal(calls[1].expectedSourceSha256, sha256(middle));
  assert.equal(harness.documentSession.html, after);
  assert.equal(harness.documentSession.persistState, "idle");
});

test("DocumentWorkflow reconstructs a missing pending write and rebinds comment targets after acknowledgement", async () => {
  const before = "<!doctype html><html><body><p>one</p></body></html>";
  const after = before.replace("one", "two");
  const harness = createHarness({
    html: before,
    codecOverrides: {
      rebindTargetsPreservingGlobal: (_html, targets) => targets.map((target) => ({
        ...target,
        selector: "[data-rebound]",
      })),
    },
    bridge: {
      async autosave(body) {
        return {
          ok: true,
          content: body.html,
          sha256: sha256(body.html),
          persistedRevision: body.editRevision,
          lastModifiedAt: "2026-08-11T00:00:01.000Z",
          sourceHistory: sourceHistory({ sourceSha256: sha256(before) }),
          currentExactVersionId: "version_002",
        };
      },
    },
  });
  harness.commentSession.setComments([{
    commentId: "comment_rebind",
    text: "keep target",
    target: { id: "target_rebind", selector: "p", resolution: "exact" },
    attachments: [],
  }]);
  harness.documentSession.beginEdit(after);

  const outcome = await harness.workflow.flush({ throughRevision: 1 });

  assert.equal(outcome.status, "succeeded");
  assert.equal(harness.documentSession.pendingWrite, null);
  assert.equal(harness.commentSession.comments[0].target.selector, "[data-rebound]");
  assert.equal(harness.versionSession.snapshot.currentExactVersionId, "version_002");
});

test("DocumentWorkflow registers an unbound source write before its first autosave", async () => {
  const before = "<!doctype html><html><body><p>one</p></body></html>";
  const after = before.replace("one", "two");
  let registrations = 0;
  const harness = createHarness({
    html: before,
    registered: false,
    ensureRegistered: async () => {
      registrations += 1;
      const context = harness.projectSession.register({
        epoch: harness.projectSession.epoch,
        projectId: PROJECT_ID,
        documentId: DOCUMENT_ID,
        sourcePath: SOURCE_PATH,
      });
      return { status: "succeeded", value: context };
    },
    bridge: {
      async autosave(body) {
        return {
          ok: true,
          content: body.html,
          sha256: sha256(body.html),
          persistedRevision: body.editRevision,
          lastModifiedAt: "2026-08-11T00:00:01.000Z",
          sourceHistory: sourceHistory({ sourceSha256: sha256(before) }),
        };
      },
    },
  });

  harness.workflow.enqueueEdit({ html: after });
  const outcome = await harness.workflow.flush();

  assert.equal(outcome.status, "succeeded");
  assert.equal(registrations, 1);
  assert.equal(harness.documentSession.sourceSha256, sha256(after));
});

test("DocumentWorkflow settles a failed first registration as a retryable persistence failure", async () => {
  const before = "<!doctype html><html><body><p>one</p></body></html>";
  const after = before.replace("one", "two");
  let registrationAttempts = 0;
  let autosaves = 0;
  const events = [];
  const harness = createHarness({
    html: before,
    registered: false,
    ensureRegistered: async () => {
      registrationAttempts += 1;
      if (registrationAttempts === 1) {
        return {
          status: "blocked",
          code: "PROJECT_REGISTRATION_UNAVAILABLE",
          reason: "项目资料暂时无法建立，修改已保留在恢复记录中。",
        };
      }
      const context = harness.projectSession.register({
        epoch: harness.projectSession.epoch,
        projectId: PROJECT_ID,
        documentId: DOCUMENT_ID,
        sourcePath: SOURCE_PATH,
      });
      return { status: "succeeded", value: context };
    },
    bridge: {
      async autosave(body) {
        autosaves += 1;
        return {
          ok: true,
          content: body.html,
          sha256: sha256(body.html),
          persistedRevision: body.editRevision,
          lastModifiedAt: "2026-08-11T00:00:01.000Z",
          sourceHistory: sourceHistory({ sourceSha256: sha256(before) }),
        };
      },
    },
  });
  harness.workflow.subscribeEvents((event) => events.push(event));

  harness.workflow.enqueueEdit({ html: after });
  const first = await harness.workflow.flush();

  assert.deepEqual(first, {
    status: "blocked",
    code: "PROJECT_REGISTRATION_UNAVAILABLE",
    reason: "项目资料暂时无法建立，修改已保留在恢复记录中。",
  });
  assert.equal(autosaves, 0);
  assert.equal(harness.documentSession.persistState, "failed");
  assert.equal(harness.documentSession.pendingWrite?.html, after);
  assert.equal(harness.recoveryStore.values.size, 1);
  const failure = events.find((event) => event.type === "document-persistence-failed");
  assert.equal(failure?.code, "PROJECT_REGISTRATION_UNAVAILABLE");
  assert.equal(failure?.fatal, false);

  const second = await harness.workflow.flush();

  assert.equal(second.status, "succeeded");
  assert.equal(registrationAttempts, 2);
  assert.equal(autosaves, 1);
  assert.equal(harness.documentSession.persistState, "idle");
});

test("DocumentWorkflow rekeys recovery to registered identity before the first autosave resolves", async () => {
  const before = "<!doctype html><html><body><p>one</p></body></html>";
  const after = before.replace("one", "two");
  let resolveAutosave;
  let enteredAutosave;
  const autosaveEntered = new Promise((resolve) => { enteredAutosave = resolve; });
  const harness = createHarness({
    html: before,
    registered: false,
    ensureRegistered: async () => {
      const context = harness.projectSession.register({
        epoch: harness.projectSession.epoch,
        projectId: PROJECT_ID,
        documentId: DOCUMENT_ID,
        sourcePath: SOURCE_PATH,
      });
      return { status: "succeeded", value: context };
    },
    bridge: {
      autosave() {
        enteredAutosave();
        return new Promise((resolve) => { resolveAutosave = resolve; });
      },
    },
  });

  harness.workflow.enqueueEdit({ html: after });
  const flushing = harness.workflow.flush();
  await autosaveEntered;

  assert.equal(harness.recoveryStore.values.size, 2);
  for (const record of harness.recoveryStore.values.values()) {
    assert.equal(record.projectId, PROJECT_ID);
    assert.equal(record.documentId, DOCUMENT_ID);
    assert.equal(record.sourcePath, SOURCE_PATH);
    assert.equal(record.html, after);
  }

  resolveAutosave({
    ok: true,
    content: after,
    sha256: sha256(after),
    persistedRevision: 1,
    lastModifiedAt: "2026-08-11T00:00:01.000Z",
    sourceHistory: sourceHistory({ sourceSha256: sha256(before) }),
  });
  assert.equal((await flushing).status, "succeeded");
});

test("DocumentWorkflow returns stale after a durable acknowledgement races a new project locator", async () => {
  const before = "<!doctype html><html><body><p>one</p></body></html>";
  const after = before.replace("one", "two");
  let resolveWrite;
  const harness = createHarness({
    html: before,
    bridge: {
      autosave() {
        return new Promise((resolve) => { resolveWrite = resolve; });
      },
    },
  });
  harness.workflow.enqueueEdit({ html: after });
  const flushing = harness.workflow.flush();
  await Promise.resolve();
  // The public Session transition, rather than the old write, is the stale authority.
  harness.projectSession.openLocator("/tmp/other.html");
  resolveWrite({
    ok: true,
    content: after,
    sha256: sha256(after),
    persistedRevision: 1,
    lastModifiedAt: "2026-08-11T00:00:01.000Z",
    sourceHistory: sourceHistory({ sourceSha256: sha256(before) }),
  });

  assert.equal((await flushing).status, "stale");
});

test("DocumentWorkflow preserves recovery and fails closed when autosave acknowledgement bytes differ", async () => {
  const before = "<!doctype html><html><body><p>one</p></body></html>";
  const after = before.replace("one", "two");
  const harness = createHarness({
    html: before,
    bridge: {
      async autosave(body) {
        return {
          ok: true,
          content: body.html.replace("two", "three"),
          sha256: sha256(body.html.replace("two", "three")),
          persistedRevision: body.editRevision,
          lastModifiedAt: "2026-08-11T00:00:01.000Z",
          sourceHistory: sourceHistory({ sourceSha256: sha256(before) }),
        };
      },
    },
  });

  harness.workflow.enqueueEdit({ html: after });
  const outcome = await harness.workflow.flush();

  assert.equal(outcome.status, "rejected");
  assert.equal(outcome.code, "INVALID_AUTOSAVE_ACK");
  assert.equal(harness.documentSession.persistState, "failed");
  assert.equal(harness.documentSession.pendingWrite?.html, after);
  assert.equal(harness.recoveryStore.values.size, 2);
});

test("DocumentWorkflow keeps an externally accepted source fail-closed when its canvas cannot render", async () => {
  const before = "<!doctype html><html><body><p>one</p></body></html>";
  const external = before.replace("one", "external");
  const conflictResolutions = [];
  const events = [];
  const harness = createHarness({
    html: before,
    canvasOverrides: {
      async verifyRendered() {
        throw new Error("canvas did not render external source");
      },
    },
    bridge: {
      async resolveConflict(request) {
        conflictResolutions.push(request);
        return { ok: true };
      },
      async source() {
        return {
          projectId: PROJECT_ID,
          documentId: DOCUMENT_ID,
          sourcePath: SOURCE_PATH,
          content: external,
          sha256: sha256(external),
          lastModifiedAt: "2026-08-11T00:00:01.000Z",
        };
      },
    },
  });
  harness.workflow.subscribeEvents((event) => events.push(event));

  const outcome = await harness.workflow.reloadAuthority({
    context: harness.context,
    acceptExternalConflict: true,
  });

  assert.equal(outcome.status, "rejected");
  assert.equal(outcome.code, "SOURCE_RELOAD_REJECTED");
  assert.deepEqual(conflictResolutions, [{
    ...harness.context,
    action: "force-unlock",
  }]);
  assert.equal(harness.documentSession.html, external);
  assert.equal(harness.documentSession.sourceSha256, sha256(external));
  assert.equal(harness.documentSession.pendingWrite, null);
  assert.equal(harness.documentSession.persistState, "failed");
  assert.equal(
    harness.documentSession.persistError,
    "外部 HTML 已被保留，但编辑画布未能安全显示该版本。当前项目已锁定，请重试读取或重新打开文件。",
  );
  const failure = events.find((event) => event.type === "document-authority-reload-failed");
  assert.equal(failure?.externalAccepted, true);
  assert.equal(failure?.fatal, true);
  assert.equal(failure?.code, "SOURCE_RELOAD_REJECTED");
});

test("DocumentWorkflow preserves a prior external acceptance when reloading its authority", async () => {
  const before = "<!doctype html><html><body><p>one</p></body></html>";
  const external = before.replace("one", "external");
  let conflictResolutions = 0;
  const events = [];
  const harness = createHarness({
    html: before,
    canvasOverrides: {
      async verifyRendered() {
        throw new Error("canvas did not render external source");
      },
    },
    bridge: {
      async resolveConflict() {
        conflictResolutions += 1;
        return { ok: true };
      },
      async source() {
        return {
          projectId: PROJECT_ID,
          documentId: DOCUMENT_ID,
          sourcePath: SOURCE_PATH,
          content: external,
          sha256: sha256(external),
        };
      },
    },
  });
  harness.workflow.subscribeEvents((event) => events.push(event));

  const outcome = await harness.workflow.reloadAuthority({
    context: harness.context,
    externalAuthorityAccepted: true,
  });

  assert.equal(outcome.status, "rejected");
  assert.equal(conflictResolutions, 0);
  assert.equal(harness.documentSession.html, external);
  assert.equal(harness.documentSession.persistState, "failed");
  assert.equal(
    events.find((event) => event.type === "document-authority-reload-failed")?.fatal,
    true,
  );
});

test("DocumentWorkflow reconciles an unknown autosave only after reading matching authority", async () => {
  const before = "<!doctype html><html><body><p>one</p></body></html>";
  const after = before.replace("one", "two");
  const history = sourceHistory({ sourceSha256: sha256(after) });
  const calls = [];
  const harness = createHarness({
    html: before,
    bridge: {
      async autosave(body) {
        calls.push(body);
        throw new BridgeRequestError("timeout", { status: 503, outcome: "unknown" });
      },
      async workspace() {
        return {
          projectId: PROJECT_ID,
          documentId: DOCUMENT_ID,
          sourcePath: SOURCE_PATH,
          currentHtmlSha256: sha256(after),
          lastPersistedRevision: 1,
          lastModifiedAt: "2026-08-11T00:00:01.000Z",
          sourceHistory: history,
        };
      },
      async source() {
        return {
          projectId: PROJECT_ID,
          documentId: DOCUMENT_ID,
          sourcePath: SOURCE_PATH,
          content: after,
          sha256: sha256(after),
          lastModifiedAt: "2026-08-11T00:00:01.000Z",
        };
      },
    },
  });

  harness.workflow.enqueueEdit({ html: after });
  const outcome = await harness.workflow.flush();

  assert.equal(outcome.status, "succeeded");
  assert.equal(outcome.value.reconciled, true);
  assert.equal(calls.length, 1);
  assert.equal(harness.documentSession.sourceSha256, sha256(after));
  assert.equal(harness.documentSession.persistState, "idle");
  assert.equal(harness.recoveryStore.values.size, 0);
});

test("DocumentWorkflow restores a matching crash record into the same durable queue", async () => {
  const before = "<!doctype html><html><body><p>one</p></body></html>";
  const after = before.replace("one", "two");
  const harness = createHarness({ html: before });
  const recoveryIdentity = {
    schemaVersion: "1.0.0",
    token: sha256("recovery"),
    projectId: PROJECT_ID,
    documentId: DOCUMENT_ID,
    sourcePath: SOURCE_PATH,
    basedOnVersionId: "version_001",
    sourceSha256: sha256(before),
    editRevision: 2,
  };
  harness.workflow.replaceRecoveryIdentity(recoveryIdentity);
  harness.recoveryStore.write(
    `html-ai-recovery:${DOCUMENT_ID}`,
    {
      schemaVersion: "2.0.0",
      projectId: PROJECT_ID,
      documentId: DOCUMENT_ID,
      sourcePath: SOURCE_PATH,
      recoveryIdentity,
      expectedSourceSha256: sha256(before),
      revision: 2,
      html: after,
      changeEvents: [],
      sourceHistoryOperations: [],
    },
  );
  harness.client.autosave = async (body) => ({
    ok: true,
    content: body.html,
    sha256: sha256(body.html),
    persistedRevision: body.editRevision,
    lastModifiedAt: "2026-08-11T00:00:03.000Z",
    sourceHistory: sourceHistory({ sourceSha256: sha256(before) }),
  });

  const recovered = await harness.workflow.recoverAutosave({
    context: harness.context,
    currentSourceSha256: sha256(before),
    serverRevision: 2,
  });

  assert.equal(recovered.status, "succeeded");
  assert.equal(recovered.value.queued, true);
  assert.equal(harness.documentSession.html, after);
  assert.equal(harness.documentSession.editRevision, 3);
  assert.equal(harness.documentSession.persistState, "queued");
  assert.deepEqual(harness.scheduler.pending.map((task) => task.delay), [0]);
  assert.equal((await harness.workflow.flush()).status, "succeeded");
  assert.equal(harness.documentSession.persistState, "idle");
});

test("DocumentWorkflow reconciles an unknown history action before replaying its stable actionId", async () => {
  const before = "<!doctype html><html><body><p>one</p></body></html>";
  const after = before.replace("one", "two");
  const entry = operation(before, after);
  const history = sourceHistory({
    sourceSha256: sha256(before),
    entries: [entry],
  });
  const calls = [];
  const harness = createHarness({ html: after });
  harness.documentSession.update({
    sourceSha256: sha256(after),
    editRevision: 1,
    lastPersistedRevision: 1,
  });
  harness.sourceHistorySession.activate(
    harness.context,
    sha256(after),
    history,
  );
  let first = true;
  harness.client.workspace = async () => ({
    projectId: PROJECT_ID,
    documentId: DOCUMENT_ID,
    sourcePath: SOURCE_PATH,
    currentHtmlSha256: sha256(after),
    sourceHistory: {
      ...history,
      capabilities: { revision: 1, cursor: 1 },
    },
  });
  harness.client.sourceHistoryAction = async (body) => {
    calls.push(body);
    if (first) {
      first = false;
      throw new BridgeRequestError("timeout", { status: 503, outcome: "unknown" });
    }
    const undone = applySourceHistoryAction(history, after, {
      projectId: PROJECT_ID,
      documentId: DOCUMENT_ID,
      direction: "undo",
      actionId: body.actionId,
      expectedRevision: body.expectedHistoryRevision,
      expectedCursor: body.expectedHistoryCursor,
      sha256,
      now: () => "2026-08-11T00:00:02.000Z",
    });
    return {
      content: undone.html,
      sha256: sha256(undone.html),
      persistedRevision: 2,
      lastModifiedAt: "2026-08-11T00:00:02.000Z",
      sourceHistory: undone.history,
      target: undone.target,
      targetTransition: undone.targetTransition,
      selection: undone.selection,
    };
  };

  const outcome = await harness.workflow.performHistoryAction({
    direction: "undo",
    context: harness.context,
  });

  assert.equal(outcome.status, "succeeded");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].actionId, calls[1].actionId);
  assert.equal(harness.documentSession.html, before);
  assert.equal(harness.documentSession.sourceSha256, sha256(before));
  assert.equal(harness.canvas.history.length, 1);
});

test("DocumentWorkflow force-unlock adopts disk HTML and clears persistence conflict", async () => {
  const before = "<!doctype html><html><body><p>one</p></body></html>";
  const external = before.replace("one", "external");
  const harness = createHarness({
    html: before,
    bridge: {
      async resolveConflict(body) {
        assert.equal(body.action, "force-unlock");
        return { ok: true, status: "force-unlocked" };
      },
      async source() {
        return {
          projectId: PROJECT_ID,
          documentId: DOCUMENT_ID,
          sourcePath: SOURCE_PATH,
          content: external,
          sha256: sha256(external),
          lastModifiedAt: "2026-08-11T00:00:02.000Z",
        };
      },
    },
  });
  harness.documentSession.setPersistence({
    state: "conflict",
    error: "源文件在磁盘上被其他程序修改了。",
  });
  harness.documentSession.setEditRevision(3);

  const outcome = await harness.workflow.forceUnlockConflict({
    context: harness.context,
  });

  assert.equal(outcome.status, "succeeded");
  assert.equal(harness.documentSession.html, external);
  assert.equal(harness.documentSession.sourceSha256, sha256(external));
  assert.equal(harness.documentSession.persistState, "idle");
  assert.equal(harness.documentSession.pendingWrite, null);
  assert.equal(harness.documentSession.lastPersistedRevision, 3);
});

test("DocumentWorkflow reloadAuthority adopts a Working Copy conflict through force-unlock", async () => {
  const before = "<!doctype html><html><body><p>one</p></body></html>";
  const external = before.replace("one", "external");
  const conflictResolutions = [];
  const harness = createHarness({
    html: before,
    bridge: {
      async resolveConflict(request) {
        conflictResolutions.push(request);
        return { ok: true, status: "force-unlocked" };
      },
      async source() {
        return {
          projectId: PROJECT_ID,
          documentId: DOCUMENT_ID,
          sourcePath: SOURCE_PATH,
          content: external,
          sha256: sha256(external),
          lastModifiedAt: "2026-08-11T00:00:03.000Z",
        };
      },
    },
  });
  harness.documentSession.setPersistence({
    state: "conflict",
    error: "源文件在磁盘上被其他程序修改了。",
  });

  const outcome = await harness.workflow.reloadAuthority({
    context: harness.context,
    acceptExternalConflict: true,
  });

  assert.equal(outcome.status, "succeeded");
  assert.deepEqual(conflictResolutions, [{
    ...harness.context,
    action: "force-unlock",
  }]);
  assert.equal(harness.documentSession.html, external);
  assert.equal(harness.documentSession.persistState, "idle");
  assert.equal(harness.documentSession.pendingWrite, null);
});

test("DocumentWorkflow treats matching source-stat hashes as a save echo", async () => {
  const html = "<!doctype html><html><body><p>one</p></body></html>";
  const harness = createHarness({
    html,
    bridge: {
      async sourceStat() {
        return { sha256: sha256(html), lastModifiedAt: "2026-08-11T00:00:02.000Z", size: 40 };
      },
    },
  });

  const outcome = await harness.workflow.observeExternalSourceChange({
    sourcePath: SOURCE_PATH,
  });

  assert.equal(outcome.status, "succeeded");
  assert.equal(outcome.value.changed, false);
  assert.equal(outcome.value.unchanged, true);
  assert.equal(harness.documentSession.persistState, "idle");
});

test("DocumentWorkflow projects a conflict when source-stat hash diverges", async () => {
  const html = "<!doctype html><html><body><p>one</p></body></html>";
  const harness = createHarness({
    html,
    bridge: {
      async sourceStat() {
        return {
          sha256: sha256(html.replace("one", "two")),
          lastModifiedAt: "2026-08-11T00:00:02.000Z",
          size: 40,
        };
      },
    },
  });

  const outcome = await harness.workflow.observeExternalSourceChange({
    sourcePath: SOURCE_PATH,
  });

  assert.equal(outcome.status, "succeeded");
  assert.equal(outcome.value.changed, true);
  assert.equal(outcome.value.conflict, true);
  assert.equal(harness.documentSession.persistState, "conflict");
  assert.equal(harness.documentSession.html, html);
});

test("observeExternalSourceChange keeps the editor when disk hash matches", async () => {
  const html = "<!doctype html><html><body><p>one</p></body></html>";
  const harness = createHarness({
    html,
    bridge: {
      async source(sourcePath) {
        return {
          projectId: PROJECT_ID,
          documentId: DOCUMENT_ID,
          sourcePath,
          content: html,
          sha256: sha256(html),
          lastModifiedAt: "2026-08-15T00:00:00.000Z",
        };
      },
    },
  });

  const outcome = await harness.workflow.observeExternalSourceChange({
    sourcePath: SOURCE_PATH,
  });

  assert.equal(outcome.status, "succeeded");
  assert.equal(outcome.value.unchanged, true);
  assert.equal(harness.documentSession.persistState, "idle");
  assert.equal(harness.documentSession.html, html);
});

test("observeExternalSourceChange enters conflict without adopting disk bytes", async () => {
  const html = "<!doctype html><html><body><p>one</p></body></html>";
  const disk = html.replace("one", "external");
  const harness = createHarness({
    html,
    bridge: {
      async source(sourcePath) {
        return {
          projectId: PROJECT_ID,
          documentId: DOCUMENT_ID,
          sourcePath,
          content: disk,
          sha256: sha256(disk),
        };
      },
    },
  });

  const outcome = await harness.workflow.observeExternalSourceChange({
    sourcePath: SOURCE_PATH,
  });

  assert.equal(outcome.status, "succeeded");
  assert.equal(outcome.value.conflict, true);
  assert.equal(harness.documentSession.persistState, "conflict");
  assert.equal(harness.documentSession.html, html);
  assert.equal(harness.documentSession.sourceSha256, sha256(html));
});

test("observeExternalSourceChange ignores stale paths and in-flight writes", async () => {
  const html = "<!doctype html><html><body><p>one</p></body></html>";
  let sourceCalls = 0;
  const harness = createHarness({
    html,
    bridge: {
      async source() {
        sourceCalls += 1;
        throw new Error("should not read while writing");
      },
    },
  });

  const stale = await harness.workflow.observeExternalSourceChange({
    sourcePath: "/tmp/other-document.html",
  });
  assert.equal(stale.status, "succeeded");
  assert.equal(stale.value.ignored, true);

  harness.documentSession.setPersistence({ state: "writing" });
  const deferred = await harness.workflow.observeExternalSourceChange({
    sourcePath: SOURCE_PATH,
  });
  assert.equal(deferred.status, "succeeded");
  assert.equal(deferred.value.deferred, true);
  assert.equal(sourceCalls, 0);
});

test("ensureCurrentCanvas records verified authority after a successful render", async () => {
  const html = "<!doctype html><html><body><p>one</p></body></html>";
  const harness = createHarness({ html });
  const outcome = await harness.workflow.ensureCurrentCanvas({
    context: harness.context,
  });
  assert.equal(outcome.status, "succeeded");
  assert.deepEqual(harness.documentSession.canvasAuthority, {
    status: "verified",
    generation: 0,
    renderedSha256: sha256(html),
    error: null,
  });
});

test("ensureCurrentCanvas reuses an exact clean verified Canvas without another render fence", async () => {
  const html = "<!doctype html><html><body><p>one</p></body></html>";
  let verifyCalls = 0;
  const harness = createHarness({
    html,
    canvasOverrides: {
      async verifyRendered() {
        verifyCalls += 1;
      },
    },
  });
  assert.equal((await harness.workflow.ensureCurrentCanvas({
    context: harness.context,
  })).status, "succeeded");

  const reused = await harness.workflow.ensureCurrentCanvas({
    context: harness.context,
  });
  assert.equal(reused.status, "succeeded");
  assert.equal(reused.value.reusedCanvasAuthority, true);
  assert.equal(verifyCalls, 1);
});

test("ensureCurrentCanvas fails closed when the canvas cannot render", async () => {
  const html = "<!doctype html><html><body><p>one</p></body></html>";
  const harness = createHarness({
    html,
    canvasOverrides: {
      async verifyRendered() {
        throw new Error("canvas did not render");
      },
    },
  });
  const outcome = await harness.workflow.ensureCurrentCanvas({
    context: harness.context,
  });
  assert.equal(outcome.status, "rejected");
  assert.equal(harness.documentSession.canvasAuthority.status, "failed");
  assert.equal(harness.documentSession.canvasAuthority.generation, 0);
});
