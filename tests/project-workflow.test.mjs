import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { CommentSession } from "../app/application/comment-session.js";
import { DocumentSession } from "../app/application/document-session.js";
import { DrainCoordinator } from "../app/application/drain-coordinator.js";
import { ExternalFileOpenSession } from "../app/application/external-file-open-session.js";
import { ProjectApplicationSession } from "../app/application/project-application-session.js";
import { ProjectSession } from "../app/application/project-session.js";
import { ProjectWorkflow } from "../app/application/project-workflow.js";
import { RunSession } from "../app/application/run-session.js";
import { VersionSession } from "../app/application/version-session.js";

const OLD_PATH = "/tmp/project-workflow-old.html";
const A_PATH = "/tmp/project-workflow-a.html";
const B_PATH = "/tmp/project-workflow-b.html";
const OLD_HTML = "<!doctype html><html><body><p>old</p></body></html>";
const A_HTML = "<!doctype html><html><body><p>A</p></body></html>";
const B_HTML = "<!doctype html><html><body><p>B</p></body></html>";

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function slug(sourcePath) {
  return sourcePath.split("/").at(-1).replace(/\W+/gu, "_");
}

function draftAuthority(revision = 0) {
  return {
    draftRevision: revision,
    comments: [],
    changeEvents: [],
    deletedCommentIds: [],
    appliedOperationIds: [],
  };
}

function workspacePayload(sourcePath, html) {
  const id = slug(sourcePath);
  return {
    projectId: `project_${id}`,
    documentId: `document_${id}`,
    sourcePath,
    currentHtmlSha256: sha256(html),
    project: { displayName: id },
    paths: { projectRecords: `/tmp/PageRoot/${id}` },
    versions: [{ id: `version_${id}` }],
    latestVersionId: `version_${id}`,
    currentBasedOnVersionId: `version_${id}`,
    currentExactVersionId: `version_${id}`,
    runtimeState: {
      editRevision: 0,
      lastPersistedRevision: 0,
      draft: draftAuthority(),
    },
  };
}

function sourcePayload(sourcePath, html) {
  const workspace = workspacePayload(sourcePath, html);
  return {
    projectId: workspace.projectId,
    documentId: workspace.documentId,
    sourcePath,
    content: html,
    sha256: sha256(html),
    currentBasedOnVersionId: workspace.currentBasedOnVersionId,
    currentExactVersionId: workspace.currentExactVersionId,
    lastModifiedAt: "2026-08-11T00:00:00.000Z",
  };
}

function succeeded(value) {
  return { status: "succeeded", value };
}

function sameContext(left, right) {
  return Boolean(
    left
    && right
    && left.epoch === right.epoch
    && left.projectId === right.projectId
    && left.documentId === right.documentId
    && left.sourcePath === right.sourcePath,
  );
}

function createDraftSession(initialContext) {
  return {
    context: initialContext,
    revision: 0,
    lastError: null,
    deactivate() {
      this.context = null;
      this.revision = 0;
    },
    activate(context, revision = 0) {
      this.context = { ...context };
      this.revision = Number(revision) || 0;
      return true;
    },
    replaceAuthority(context, revision = 0) {
      return this.activate(context, revision);
    },
    isActive(context) {
      return sameContext(this.context, context);
    },
    inspect() {
      return {
        active: Boolean(this.context),
        revision: this.revision,
        pending: false,
        writing: false,
        error: null,
      };
    },
    createSnapshot({ context, comments, changeEvents, deletedCommentIds }) {
      if (!this.isActive(context)) return null;
      return {
        ...context,
        operationId: "draftop_project_workflow_001",
        basedOnVersionId: null,
        expectedDraftRevision: this.revision,
        comments: [...comments],
        changeEvents: [...changeEvents],
        deletedCommentIds: [...deletedCommentIds],
      };
    },
    async drain() {
      return true;
    },
  };
}

async function waitFor(predicate, message = "condition did not settle") {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(message);
}

function createHarness({
  bridge = {},
  canvas = {},
  projectOpen = {},
  policies = {},
  initialProject = true,
} = {}) {
  const projectSession = new ProjectSession();
  const locator = initialProject ? projectSession.openLocator(OLD_PATH) : null;
  const oldContext = locator
    ? projectSession.register({
        ...locator,
        projectId: "project_old",
        documentId: "document_old",
      })
    : null;
  const documentSession = new DocumentSession({
    html: OLD_HTML,
    sourceSha256: sha256(OLD_HTML),
  });
  const commentSession = new CommentSession();
  const draftSession = createDraftSession(oldContext);
  const versionSession = new VersionSession();
  if (initialProject) {
    versionSession.hydrate({
      versions: [{ id: "version_old" }],
      latestVersionId: "version_old",
      currentBasedOnVersionId: "version_old",
      currentExactVersionId: "version_old",
    });
  }
  const runSession = new RunSession({
    sourcePath: initialProject ? OLD_PATH : null,
  });
  const events = [];
  const calls = [];
  const client = {
    async workspace(sourcePath) {
      calls.push(["workspace", sourcePath]);
      const html = sourcePath === A_PATH ? A_HTML
        : sourcePath === B_PATH ? B_HTML
          : OLD_HTML;
      return workspacePayload(sourcePath, html);
    },
    async source(sourcePath) {
      calls.push(["source", sourcePath]);
      const html = sourcePath === A_PATH ? A_HTML
        : sourcePath === B_PATH ? B_HTML
          : OLD_HTML;
      return sourcePayload(sourcePath, html);
    },
    async projectFile(_sourcePath, relativePath) {
      return { content: `file:${relativePath}` };
    },
    async openFolder() {
      return { ok: true };
    },
    async conflictCandidate() {
      return {};
    },
    ...bridge,
  };
  const documentWorkflow = {
    hasHistoryAction: false,
    resetCount: 0,
    resetForProjectTransition() {
      this.resetCount += 1;
    },
    async flush({ throughRevision } = {}) {
      documentSession.update({ lastPersistedRevision: throughRevision });
      return succeeded({ revision: throughRevision });
    },
    async waitForHistoryAction() {
      return succeeded({ idle: true });
    },
    async ensureCurrentCanvas() {
      return succeeded({ ready: true });
    },
    enqueueEdit() {
      return succeeded({ revision: documentSession.editRevision, queued: true });
    },
    async reconcileBoundary() {
      return succeeded({ ready: true, lastModifiedAt: "" });
    },
    replaceRecoveryIdentity() {},
    activateSourceHistory() {
      return succeeded({ active: true });
    },
    async recoverAutosave() {
      return succeeded({ recovered: false });
    },
    adoptConflictCandidate() {
      return succeeded({ adopted: true });
    },
  };
  let unlockCount = 0;
  const canvasPort = {
    deferCommand: () => false,
    fencePendingEdit: () => ({
      ok: true,
      html: documentSession.html,
      sourceSha256: documentSession.sourceSha256,
    }),
    freeze: () => ({
      ok: true,
      html: documentSession.html,
      sourceSha256: documentSession.sourceSha256,
      pendingMutation: null,
    }),
    async verifyRendered() {},
    invalidateRenderAcks() {},
    showCommitBlocked() {},
    unlock() {
      unlockCount += 1;
    },
    clearSelection() {},
    applyPageViewContext() {},
    hasPendingNativeEdit: () => false,
    requestFrame: (callback) => callback(),
    ...canvas,
  };
  const openPort = {
    mode: () => "desktop-dialog",
    async openLocal() {
      return null;
    },
    async openRecent() {
      return null;
    },
    async getActive() {
      return null;
    },
    async listRecent() {
      return [];
    },
    async acceptExternal() {
      return null;
    },
    ...projectOpen,
  };
  const legacy = {
    isHistoryView: () => false,
    isViewTransitioning: () => false,
    attachmentUploadCount: () => 0,
    saveProjectRules: async () => true,
    draftRecoveryOperationId: () => null,
    clearDraftRecoveryOperationId() {},
    persistDraftRecovery() {},
    recoverDraft({ serverComments, serverEvents }) {
      return {
        comments: serverComments,
        changeEvents: serverEvents,
        composerDraft: "",
        composerCommentId: null,
        composerAttachments: [],
        composerTarget: null,
        commentEdit: null,
      };
    },
    async hydrateRecentRuns() {},
    emit: (event) => events.push(event),
  };
  const workflow = new ProjectWorkflow({
    bridgeClient: client,
    ensureRegistered: async () => succeeded(projectSession.context),
    projectSession,
    documentSession,
    commentSession,
    draftSession,
    versionSession,
    runSession,
    projectRulesSession: {
      close() {},
      inspect: () => ({ state: "resolved" }),
    },
    externalFileOpenSession: new ExternalFileOpenSession(),
    projectApplicationSession: new ProjectApplicationSession(),
    documentWorkflow,
    drainCoordinator: new DrainCoordinator(),
    codecs: {
      isRecord,
      sameSourcePath: (left, right) => Boolean(left && right && left === right),
      versionsFromWorkspace: (payload) => Array.isArray(payload.versions)
        ? payload.versions
        : [],
      draftAuthorityFromWorkspace: (payload) => (
        isRecord(payload.runtimeState) && isRecord(payload.runtimeState.draft)
          ? payload.runtimeState.draft
          : draftAuthority()
      ),
      authoritativeDraftRevision: (draft) => Number(draft.draftRevision || 0),
      commentsFromRecords: (value) => Array.isArray(value) ? value : [],
      changesFromDraftRecords: (value) => Array.isArray(value) ? value : [],
      rebindTargetsPreservingGlobal: (_html, targets) => targets,
      activeRunFromRecord: () => null,
      isLockedLifecycleState: () => false,
      commentEditSessionHasChanges: () => false,
      recoveryIdentityFromRecord: (value) => value || null,
      errorMessage: (cause, fallback) => String(cause?.message || fallback),
    },
    ports: {
      hash: { sha256: async (value) => sha256(value) },
      canvas: canvasPort,
      projectOpen: openPort,
      legacy,
    },
    policies: {
      canCloseDuringHydration: (state) => Boolean(
        state.projectHydrating
        && !state.viewTransitioning
        && !state.submissionPending
        && !state.pendingWrite
        && !state.flushInProgress
        && !state.draftPending
        && !state.draftFlushInProgress
        && state.editRevision === state.lastPersistedRevision
      ),
      shouldRecoverAfterCloseAbort: (state) => Boolean(
        state.approvedRequestId === state.abortedRequestId
        && state.imposedEditorFreeze
        && !state.projectLocked
        && !state.projectHydrating
        && !state.projectLoadError
        && !state.viewTransitioning
        && !state.submissionPending
        && !state.pendingWrite
        && !state.flushInProgress
        && !state.draftPending
        && !state.draftFlushInProgress
        && !state.draftPersistError
        && state.editRevision === state.lastPersistedRevision
      ),
      ...policies,
    },
    clock: { now: Date.now },
  });
  return {
    workflow,
    client,
    calls,
    events,
    projectSession,
    documentSession,
    commentSession,
    draftSession,
    versionSession,
    runSession,
    documentWorkflow,
    canvasPort,
    oldContext,
    get unlockCount() {
      return unlockCount;
    },
  };
}

test("startup publishes the initial active project without fencing a nonexistent Canvas", async (t) => {
  const harness = createHarness({
    initialProject: false,
    canvas: {
      fencePendingEdit: () => null,
    },
    projectOpen: {
      async getActive() {
        return {
          name: "A",
          sourcePath: A_PATH,
          html: A_HTML,
          sha256: sha256(A_HTML),
        };
      },
    },
  });
  t.after(() => harness.workflow.dispose());

  const outcome = await harness.workflow.openProject({ kind: "startup" });
  assert.equal(outcome.status, "succeeded");
  await waitFor(
    () => harness.projectSession.context?.sourcePath === A_PATH
      && !harness.workflow.projectHydrating,
    "initial startup project did not finish hydration",
  );
  assert.equal(harness.documentSession.html, A_HTML);
  assert.equal(harness.projectSession.context.projectId, `project_${slug(A_PATH)}`);
});

test("a trusted direct browser file submission still enters the accepted FIFO", async (t) => {
  const harness = createHarness();
  t.after(() => harness.workflow.dispose());

  const outcome = harness.workflow.acceptBrowserProject({
    project: {
      name: "browser-fixture.html",
      sourcePath: null,
      html: A_HTML,
    },
  });
  assert.equal(outcome.status, "succeeded");
  await waitFor(
    () => harness.projectSession.epoch === 2
      && harness.workflow.getSnapshot().projectApplication.status === "idle",
    "direct browser file did not pass the accepted project boundary",
  );
  assert.equal(harness.projectSession.sourcePath, null);
  assert.equal(harness.documentSession.html, A_HTML);
});

test("a stale hydration result cannot publish into a newer project locator", async (t) => {
  let resolveWorkspace;
  const harness = createHarness({
    bridge: {
      workspace: () => new Promise((resolve) => {
        resolveWorkspace = resolve;
      }),
    },
  });
  t.after(() => harness.workflow.dispose());

  const pending = harness.workflow.refreshWorkspace({
    sourcePath: OLD_PATH,
    epoch: harness.projectSession.epoch,
  });
  await waitFor(() => Boolean(resolveWorkspace));
  harness.projectSession.openLocator(B_PATH);
  harness.documentSession.reset({ html: B_HTML, sourceSha256: sha256(B_HTML) });
  resolveWorkspace(workspacePayload(OLD_PATH, OLD_HTML));

  const outcome = await pending;
  assert.equal(outcome.status, "stale");
  assert.equal(harness.projectSession.sourcePath, B_PATH);
  assert.equal(harness.projectSession.context, null);
  assert.equal(harness.documentSession.html, B_HTML);
});

test("accepted projects retain FIFO order while the predecessor hydrates slowly", async (t) => {
  let resolveA;
  const harness = createHarness({
    bridge: {
      workspace(sourcePath) {
        if (sourcePath === A_PATH) {
          return new Promise((resolve) => {
            resolveA = resolve;
          });
        }
        return Promise.resolve(workspacePayload(sourcePath, B_HTML));
      },
    },
  });
  t.after(() => harness.workflow.dispose());

  assert.equal(harness.workflow.acceptProject({
    name: "A",
    sourcePath: A_PATH,
    html: A_HTML,
    sha256: sha256(A_HTML),
  }).status, "succeeded");
  await waitFor(() => Boolean(resolveA));
  assert.equal(harness.workflow.acceptProject({
    name: "B",
    sourcePath: B_PATH,
    html: B_HTML,
    sha256: sha256(B_HTML),
  }).status, "succeeded");
  await waitFor(
    () => harness.projectSession.sourcePath === B_PATH
      && harness.workflow.getSnapshot().projectApplication.status === "idle",
    "fast FIFO successor did not publish",
  );
  assert.deepEqual(
    harness.events
      .filter((event) => event.type === "project-applied")
      .map((event) => event.project.name),
    ["A", "B"],
  );
  assert.equal(harness.documentSession.html, B_HTML);
  assert.equal(harness.projectSession.context.projectId, `project_${slug(B_PATH)}`);
  resolveA(workspacePayload(A_PATH, A_HTML));
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(harness.projectSession.sourcePath, B_PATH);
  assert.equal(harness.documentSession.html, B_HTML);
});

test("native input delivered after the switch drain defers without losing the accepted project", async (t) => {
  let firstFreeze = true;
  const harness = createHarness({
    canvas: {
      freeze() {
        const frozen = {
          ok: true,
          html: harness.documentSession.html,
          sourceSha256: harness.documentSession.sourceSha256,
          pendingMutation: null,
        };
        if (firstFreeze) {
          firstFreeze = false;
          harness.documentSession.update({ editRevision: 1 });
        }
        return frozen;
      },
    },
  });
  t.after(() => harness.workflow.dispose());

  harness.workflow.acceptProject({
    name: "A",
    sourcePath: A_PATH,
    html: A_HTML,
    sha256: sha256(A_HTML),
  });
  await waitFor(
    () => harness.workflow.getSnapshot().projectApplication.status === "deferred",
    "post-drain native input did not retain the accepted project",
  );
  assert.equal(harness.projectSession.sourcePath, OLD_PATH);
  assert.ok(harness.unlockCount >= 1);

  harness.documentSession.update({ lastPersistedRevision: 1 });
  harness.workflow.reconcileDeferred();
  await waitFor(
    () => harness.projectSession.sourcePath === A_PATH
      && harness.workflow.getSnapshot().projectApplication.status === "idle",
    "retained accepted project did not resume",
  );
  assert.equal(harness.documentSession.html, A_HTML);
});

test("an external request arriving during close preparation cancels that exact close", async (t) => {
  let resolveExternal;
  const harness = createHarness({
    projectOpen: {
      acceptExternal: () => new Promise((resolve) => {
        resolveExternal = resolve;
      }),
    },
  });
  t.after(() => harness.workflow.dispose());
  const submission = harness.runSession.beginSubmission({ sourcePath: OLD_PATH });
  assert.ok(submission);

  const closing = harness.workflow.prepareClose({
    requestId: "close_external_race",
    deadlineAt: Date.now() + 2_000,
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(harness.workflow.acceptExternalProject({
    requestId: "external_during_close",
    sourcePath: A_PATH,
  }).status, "succeeded");
  await waitFor(
    () => harness.workflow.getSnapshot().externalOpen.status === "opening",
  );
  harness.runSession.releaseSubmission(submission);

  const readiness = await closing;
  assert.equal(readiness.ready, false);
  assert.match(readiness.reason, /外部 HTML/u);
  assert.equal(harness.workflow.getSnapshot().close.phase, "idle");
  await waitFor(() => Boolean(resolveExternal));
  resolveExternal(null);
  await waitFor(() => harness.workflow.getSnapshot().externalOpen.status === "idle");
});

test("committed close rejects new external work and abort unlocks only its own freeze", async (t) => {
  const harness = createHarness();
  t.after(() => harness.workflow.dispose());
  const readiness = await harness.workflow.prepareClose({
    requestId: "close_owned_freeze",
    deadlineAt: Date.now() + 2_000,
  });
  assert.deepEqual(readiness, { ready: true });
  assert.equal(harness.workflow.getSnapshot().close.phase, "ready");
  assert.equal(harness.workflow.acceptExternalProject({
    requestId: "external_after_commit",
    sourcePath: A_PATH,
  }).status, "blocked");

  harness.workflow.abortClose({ requestId: "close_other" });
  assert.equal(harness.unlockCount, 0);
  assert.equal(harness.workflow.getSnapshot().close.phase, "ready");
  harness.workflow.abortClose({ requestId: "close_owned_freeze" });
  assert.equal(harness.unlockCount, 1);
  assert.equal(harness.workflow.getSnapshot().close.phase, "idle");
});

test("a stuck immutable hydration can close without waiting for the remote read", async (t) => {
  const harness = createHarness({
    bridge: {
      workspace: () => new Promise(() => {}),
    },
  });
  t.after(() => harness.workflow.dispose());
  harness.workflow.acceptProject({
    name: "A",
    sourcePath: A_PATH,
    html: A_HTML,
    sha256: sha256(A_HTML),
  });
  await waitFor(() => (
    harness.workflow.projectHydrating
    && harness.workflow.getSnapshot().projectApplication.status === "idle"
  ));
  const unlocksBeforeClose = harness.unlockCount;

  const readiness = await harness.workflow.prepareClose({
    requestId: "close_stuck_hydration",
    deadlineAt: Date.now() + 500,
  });
  assert.deepEqual(readiness, { ready: true });
  assert.equal(harness.unlockCount, unlocksBeforeClose);
});

test("load, source-integrity and project-resource races preserve current authority", async (t) => {
  let resolveProjectFile;
  const harness = createHarness({
    bridge: {
      async workspace(sourcePath) {
        if (sourcePath === OLD_PATH) throw new Error("workspace unavailable");
        return workspacePayload(sourcePath, B_HTML);
      },
      projectFile: () => new Promise((resolve) => {
        resolveProjectFile = resolve;
      }),
    },
  });
  t.after(() => harness.workflow.dispose());

  const failed = await harness.workflow.refreshWorkspace({
    sourcePath: OLD_PATH,
    epoch: harness.projectSession.epoch,
  });
  assert.equal(failed.status, "rejected");
  assert.equal(harness.workflow.projectLoadError, "workspace unavailable");
  assert.equal(harness.documentSession.html, OLD_HTML);
  assert.equal(harness.projectSession.context.projectId, "project_old");

  const context = harness.projectSession.context;
  const reading = harness.workflow.readProjectFile({
    context,
    relativePath: "REQUESTS/index.json",
  });
  await waitFor(() => Boolean(resolveProjectFile));
  harness.projectSession.openLocator(B_PATH);
  resolveProjectFile({ content: "old project bytes" });
  const resource = await reading;
  assert.equal(resource.status, "stale");
  assert.equal(harness.projectSession.sourcePath, B_PATH);
});

test("a Canvas acknowledgement failure rolls the hydration publication back", async (t) => {
  const canonicalHtml = "<!doctype html><html><body><p>canonical</p></body></html>";
  const harness = createHarness({
    bridge: {
      async workspace() {
        return workspacePayload(OLD_PATH, canonicalHtml);
      },
      async source() {
        return sourcePayload(OLD_PATH, canonicalHtml);
      },
    },
    canvas: {
      async verifyRendered() {
        throw new Error("canvas acknowledgement missing");
      },
    },
  });
  t.after(() => harness.workflow.dispose());

  const outcome = await harness.workflow.refreshWorkspace({
    sourcePath: OLD_PATH,
    epoch: harness.projectSession.epoch,
  });
  assert.equal(outcome.status, "rejected");
  assert.equal(harness.workflow.projectLoadError, "canvas acknowledgement missing");
  assert.equal(harness.documentSession.html, OLD_HTML);
  assert.equal(harness.documentSession.sourceSha256, sha256(OLD_HTML));
  assert.equal(harness.projectSession.context.projectId, "project_old");
  assert.equal(harness.versionSession.snapshot.latestVersionId, "version_old");
});
