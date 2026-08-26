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
const RENAMED_PATH = "/tmp/project-workflow-renamed.html";
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
  projectRulesWorkflow: rulesWorkflow = {},
  initialProject = true,
  openTarget = null,
} = {}) {
  const projectSession = new ProjectSession();
  const locator = initialProject ? projectSession.openLocator(OLD_PATH) : null;
  const oldContext = locator
    ? projectSession.register({
        ...locator,
        projectId: "project_old",
        documentId: "document_old",
        ...(openTarget ? { openTarget } : {}),
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
    projectTransitionAuthority: Object.freeze({
      recoveryIdentity: {
        token: "recovery_old",
        projectId: "project_old",
        documentId: "document_old",
        sourcePath: OLD_PATH,
      },
      sourceHistory: {
        schemaVersion: "1.0.0",
        projectId: "project_old",
        documentId: "document_old",
        baseSourceSha256: sha256(OLD_HTML),
        cursor: 0,
        revision: 0,
        entries: [],
        appliedActions: [],
        updatedAt: "2026-08-11T00:00:00.000Z",
      },
      sourceHistoryOperations: [],
    }),
    restoredProjectTransitionAuthority: null,
    resetForProjectTransition() {
      this.resetCount += 1;
      this.projectTransitionAuthority = null;
    },
    clearRecovery() {},
    captureProjectTransitionAuthority() {
      return this.projectTransitionAuthority;
    },
    restoreProjectTransitionAuthority(input) {
      this.projectTransitionAuthority = input.authority;
      this.restoredProjectTransitionAuthority = input;
      return true;
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
    observeCount: 0,
    observeResult: { unchanged: true },
    async observeExternalSourceChange() {
      this.observeCount += 1;
      return succeeded(this.observeResult);
    },
  };
  let unlockCount = 0;
  let fenceCount = 0;
  const canvasPort = {
    deferCommand: () => false,
    fencePendingEdit: () => {
      fenceCount += 1;
      return {
        ok: true,
        html: documentSession.html,
        sourceSha256: documentSession.sourceSha256,
      };
    },
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
  const viewState = {
    isTransitioning: () => false,
  };
  const recentRuns = {
    async hydrate() {},
  };
  const commentWorkflow = {
    resetCount: 0,
    resetForProjectTransition() {
      this.resetCount += 1;
    },
    inspectAttachment: () => ({ state: "resolved" }),
    async waitForAttachments() {
      return true;
    },
    inspectDraft: () => ({ state: "resolved" }),
    async drainDraft() {
      return true;
    },
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
  };
  const workflow = new ProjectWorkflow({
    bridgeClient: client,
    ensureRegistered: async () => succeeded(projectSession.context),
    projectSession,
    documentSession,
    commentSession,
    draftSession,
    versionSession,
    commentWorkflow,
    runSession,
    projectRulesWorkflow: {
      drainCount: 0,
      resetForProjectTransition() {},
      inspect: () => ({ state: "resolved" }),
      async drain() {
        this.drainCount += 1;
        return true;
      },
      ...rulesWorkflow,
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
      viewState,
      recentRuns,
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
  workflow.subscribeEvents((event) => events.push(event));
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
    commentWorkflow,
    canvasPort,
    oldContext,
    get unlockCount() {
      return unlockCount;
    },
    get fenceCount() {
      return fenceCount;
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

test("a startup catalog read cannot delay or supersede a newer local open", async (t) => {
  let resolveActive;
  let catalogRequested = false;
  const harness = createHarness({
    initialProject: false,
    projectOpen: {
      getActive: () => new Promise((resolve) => {
        resolveActive = resolve;
      }),
      listRegistered: () => {
        catalogRequested = true;
        return new Promise(() => {});
      },
      async openLocal() {
        return {
          name: "B",
          sourcePath: B_PATH,
          html: B_HTML,
          sha256: sha256(B_HTML),
        };
      },
    },
  });
  t.after(() => harness.workflow.dispose());

  const startup = harness.workflow.openProject({ kind: "startup" });
  await waitFor(() => Boolean(resolveActive), "startup active read did not begin");
  const local = await harness.workflow.openProject({ kind: "local" });
  assert.equal(local.status, "succeeded");

  resolveActive({
    name: "A",
    sourcePath: A_PATH,
    html: A_HTML,
    sha256: sha256(A_HTML),
  });
  let startupDeadline;
  const startupOutcome = await Promise.race([
    startup,
    new Promise((_, reject) => {
      startupDeadline = setTimeout(
        () => reject(new Error("startup waited for the read-only project catalog")),
        500,
      );
    }),
  ]).finally(() => clearTimeout(startupDeadline));
  assert.equal(startupOutcome.status, "succeeded");
  assert.equal(startupOutcome.value.opened, false);
  await waitFor(
    () => harness.projectSession.context?.sourcePath === B_PATH
      && !harness.workflow.projectHydrating,
    "newer local open did not remain current after startup settled",
  );
  await waitFor(() => catalogRequested === true, "catalog refresh did not run after the project settled");
  assert.equal(harness.documentSession.html, B_HTML);
});

test("the read-only catalog refresh waits until project hydration settles", async (t) => {
  let resolveWorkspace;
  let catalogCalls = 0;
  const harness = createHarness({
    initialProject: false,
    bridge: {
      workspace: () => new Promise((resolve) => {
        resolveWorkspace = resolve;
      }),
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
      listRegistered: () => {
        catalogCalls += 1;
        return Promise.resolve([{ projectId: "project_catalog_a", availability: "ready" }]);
      },
    },
  });
  t.after(() => harness.workflow.dispose());

  const startup = await harness.workflow.openProject({ kind: "startup" });
  assert.equal(startup.status, "succeeded");
  await waitFor(() => Boolean(resolveWorkspace), "hydration did not begin");
  assert.equal(catalogCalls, 0);

  resolveWorkspace(workspacePayload(A_PATH, A_HTML));
  await waitFor(
    () => harness.projectSession.context?.sourcePath === A_PATH
      && !harness.workflow.projectHydrating,
    "project did not settle hydration",
  );
  await waitFor(() => catalogCalls === 1, "deferred catalog refresh did not run");

  const stageNames = harness.events
    .filter((event) => event.type === "project-hydration-stage")
    .map((event) => event.stage);
  assert.ok(stageNames.includes("apply-authority:sessions-reset"));
});

test("concurrent catalog refreshes coalesce into one in-flight read", async (t) => {
  let resolveCatalog;
  let catalogCalls = 0;
  const harness = createHarness({
    projectOpen: {
      listRegistered: () => {
        catalogCalls += 1;
        return new Promise((resolve) => {
          resolveCatalog = resolve;
        });
      },
    },
  });
  t.after(() => harness.workflow.dispose());

  const first = harness.workflow.refreshRegisteredProjects();
  const second = harness.workflow.refreshRegisteredProjects();

  resolveCatalog([{ projectId: "project_catalog_a", availability: "ready" }]);
  const [firstOutcome, secondOutcome] = await Promise.all([first, second]);
  assert.equal(firstOutcome.status, "succeeded");
  assert.equal(secondOutcome.status, "succeeded");
  assert.equal(firstOutcome, secondOutcome);
  assert.equal(catalogCalls, 1);
});

test("two post-settlement refreshes coalesce into one catalog read", async (t) => {
  let resolveCatalog;
  let catalogCalls = 0;
  const harness = createHarness({
    projectOpen: {
      listRegistered: () => {
        catalogCalls += 1;
        return new Promise((resolve) => {
          resolveCatalog = resolve;
        });
      },
    },
  });
  t.after(() => harness.workflow.dispose());

  const context = harness.projectSession.context;
  harness.workflow.scheduleProjectListRefreshAfterSettlement(context);
  harness.workflow.scheduleProjectListRefreshAfterSettlement(context);
  await waitFor(() => catalogCalls === 1, "scheduled refreshes did not coalesce");
  resolveCatalog([{ projectId: "project_catalog_a", availability: "ready" }]);
  await waitFor(
    () => harness.events.some((event) => event.type === "project-catalog-loaded"),
    "catalog projection did not load",
  );
  assert.equal(catalogCalls, 1);
});

test("a post-settlement refresh is fenced by the current Project context", async (t) => {
  let catalogCalls = 0;
  const harness = createHarness({
    projectOpen: {
      listRegistered: () => {
        catalogCalls += 1;
        return Promise.resolve([]);
      },
    },
  });
  t.after(() => harness.workflow.dispose());

  const staleContext = harness.projectSession.context;
  harness.projectSession.openLocator(B_PATH);
  const currentContext = harness.projectSession.register({
    ...harness.projectSession.locator,
    projectId: "project_b",
    documentId: "document_b",
  });

  harness.workflow.scheduleProjectListRefreshAfterSettlement(staleContext);
  assert.equal(catalogCalls, 0);

  harness.workflow.scheduleProjectListRefreshAfterSettlement(currentContext);
  await waitFor(() => catalogCalls === 1, "current project refresh did not start");
  assert.equal(catalogCalls, 1);
});

test("source rename settles before the catalog refresh and never downgrades on catalog failure", async (t) => {
  let settleCatalog;
  let catalogCalls = 0;
  const harness = createHarness({
    bridge: {
      async workspace(sourcePath) {
        if (sourcePath !== RENAMED_PATH) return workspacePayload(sourcePath, OLD_HTML);
        return {
          ...workspacePayload(RENAMED_PATH, OLD_HTML),
          projectId: "project_old",
          documentId: "document_old",
          sourcePath: RENAMED_PATH,
          project: { displayName: "renamed" },
        };
      },
    },
    projectOpen: {
      async renameSource(payload) {
        return {
          operationId: payload.operationId,
          previousSourcePath: OLD_PATH,
          sourcePath: RENAMED_PATH,
          sha256: sha256(OLD_HTML),
          stem: "renamed",
          lastModifiedAt: "2026-08-12T00:00:00.000Z",
        };
      },
      listRegistered: () => {
        catalogCalls += 1;
        return new Promise((resolve, reject) => {
          settleCatalog = { resolve, reject };
        });
      },
    },
  });
  t.after(() => harness.workflow.dispose());

  const pending = harness.workflow.renameSource({ stem: "renamed" });
  await waitFor(() => catalogCalls === 1, "catalog refresh did not follow rename settlement");
  const outcome = await pending;
  assert.equal(outcome.status, "succeeded");
  assert.equal(harness.projectSession.context?.sourcePath, RENAMED_PATH);
  assert.equal(harness.documentSession.sourceSha256, sha256(OLD_HTML));

  settleCatalog.reject(new Error("catalog unavailable"));
  await waitFor(
    () => harness.events.some((event) => event.type === "project-catalog-failed"),
    "catalog failure did not surface a projection event",
  );
  assert.equal(outcome.status, "succeeded");
});

test("a Registry project open routes only its projectId through the desktop authority", async (t) => {
  const openedProjectIds = [];
  const harness = createHarness({
    projectOpen: {
      async openRegistered(projectId) {
        openedProjectIds.push(projectId);
        return {
          name: "B",
          sourcePath: B_PATH,
          html: B_HTML,
          sha256: sha256(B_HTML),
        };
      },
      async listRegistered() {
        return [{ projectId: "project_catalog_b", availability: "ready" }];
      },
    },
  });
  t.after(() => harness.workflow.dispose());

  const catalog = await harness.workflow.refreshRegisteredProjects();
  assert.equal(catalog.status, "succeeded");
  assert.deepEqual(openedProjectIds, []);

  const opening = await harness.workflow.openProject({
    kind: "registered",
    projectId: "project_catalog_b",
  });
  assert.equal(opening.status, "succeeded");
  await waitFor(
    () => harness.projectSession.context?.sourcePath === B_PATH
      && !harness.workflow.projectHydrating,
    "registered project did not finish its safe transition",
  );
  assert.deepEqual(openedProjectIds, ["project_catalog_b"]);
  assert.equal(harness.documentSession.html, B_HTML);
});

test("a Registry project opens from Start without fencing an unmounted Canvas", async (t) => {
  let fenceCount = 0;
  const harness = createHarness({
    initialProject: false,
    canvas: {
      isMounted: () => false,
      fencePendingEdit: () => {
        fenceCount += 1;
        return null;
      },
    },
    projectOpen: {
      async openRegistered() {
        return {
          name: "B",
          sourcePath: B_PATH,
          html: B_HTML,
          sha256: sha256(B_HTML),
        };
      },
    },
  });
  t.after(() => harness.workflow.dispose());

  const opening = await harness.workflow.openProject({
    kind: "registered",
    projectId: "project_catalog_b",
  });
  assert.equal(opening.status, "succeeded");
  await waitFor(
    () => harness.projectSession.context?.sourcePath === B_PATH
      && !harness.workflow.projectHydrating,
    "registered project did not publish from Start",
  );
  assert.equal(fenceCount, 0);
  assert.equal(harness.documentSession.html, B_HTML);
});

test("a retained Controller can switch Registry projects while Start owns the unmounted outlet", async (t) => {
  let fenceCount = 0;
  let freezeCount = 0;
  const harness = createHarness({
    canvas: {
      isMounted: () => false,
      fencePendingEdit: () => {
        fenceCount += 1;
        return null;
      },
      freeze: () => {
        freezeCount += 1;
        return null;
      },
    },
    projectOpen: {
      async openRegistered() {
        return {
          name: "B",
          sourcePath: B_PATH,
          html: B_HTML,
          sha256: sha256(B_HTML),
        };
      },
    },
  });
  t.after(() => harness.workflow.dispose());

  const opening = await harness.workflow.openProject({
    kind: "registered",
    projectId: "project_catalog_b",
  });
  assert.equal(opening.status, "succeeded");
  await waitFor(
    () => harness.projectSession.context?.sourcePath === B_PATH
      && !harness.workflow.projectHydrating,
    "retained Controller did not publish the Registry project from Start",
  );
  assert.equal(fenceCount, 0);
  assert.equal(freezeCount, 0);
  assert.equal(harness.documentSession.html, B_HTML);
});

test("a v4 Working Copy transition uses the exact managed desktop activation", async (t) => {
  const calls = [];
  const managedTarget = {
    projectId: "project_old",
    documentId: "document_old",
    projectRootPath: "/tmp/PageRoot/项目/managed",
    targetKind: "working-copy",
    workingCopyId: "work_ver_0002",
    versionId: "ver_0002",
    exactSourcePath: B_PATH,
    sourceSha256: sha256(B_HTML),
  };
  const harness = createHarness({
    projectOpen: {
      async activateManagedWorkingCopy(input) {
        calls.push(input);
        return {
          sourcePath: B_PATH,
          sha256: sha256(B_HTML),
          html: B_HTML,
        };
      },
      async listRecent() {
        return [];
      },
    },
  });
  t.after(() => harness.workflow.dispose());

  const prepared = await harness.workflow.prepareGeneratedSourceTransition({
    previousSourcePath: OLD_PATH,
    nextSourcePath: B_PATH,
    expectedSha256: sha256(B_HTML),
    nextProjectId: "project_old",
    nextDocumentId: "document_old",
    versionId: "ver_0002",
    openTarget: managedTarget,
  });

  assert.equal(prepared.updatesCurrentProject, true);
  assert.equal(prepared.activatedProject?.sourcePath, B_PATH);
  assert.deepEqual(calls, [{
    previousSourcePath: OLD_PATH,
    nextSourcePath: B_PATH,
    expectedSha256: sha256(B_HTML),
    projectId: "project_old",
    documentId: "document_old",
    workingCopyId: "work_ver_0002",
    versionId: "ver_0002",
    projectRootPath: "/tmp/PageRoot/项目/managed",
  }]);
});

test("v4 exposes no relocation workflow that can retarget a moved project", (t) => {
  const harness = createHarness();
  t.after(() => harness.workflow.dispose());
  assert.equal("relocateCurrentProject" in harness.workflow, false);
  assert.equal("rebindRelocatedOpenTarget" in harness.documentWorkflow, false);
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
  assert.equal(harness.documentSession.sourceSha256, sha256(A_HTML));
});

test("a second in-memory browser file can switch after the first HTML is applied", async (t) => {
  const harness = createHarness();
  t.after(() => harness.workflow.dispose());

  assert.equal(harness.workflow.acceptBrowserProject({
    project: {
      name: "browser-first.html",
      sourcePath: null,
      html: A_HTML,
    },
  }).status, "succeeded");
  await waitFor(
    () => harness.documentSession.html === A_HTML
      && harness.documentSession.sourceSha256 === sha256(A_HTML)
      && harness.workflow.getSnapshot().projectApplication.status === "idle",
    "first in-memory HTML did not publish its Hash",
  );

  assert.equal(harness.workflow.acceptBrowserProject({
    project: {
      name: "browser-second.html",
      sourcePath: null,
      html: B_HTML,
    },
  }).status, "succeeded");
  await waitFor(
    () => harness.documentSession.html === B_HTML
      && harness.workflow.getSnapshot().projectApplication.status === "idle",
    "second in-memory HTML did not complete the switch fence",
  );
  assert.equal(harness.documentSession.sourceSha256, sha256(B_HTML));
  assert.equal(harness.projectSession.sourcePath, null);
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
  assert.match(readiness.reason, /HTML 打开/u);
  assert.equal(harness.workflow.getSnapshot().close.phase, "idle");
  await waitFor(() => Boolean(resolveExternal));
  resolveExternal(null);
  await waitFor(() => harness.workflow.getSnapshot().externalOpen.status === "idle");
});

test("two unregistered OS opens keep confirmation and acknowledgement order", async (t) => {
  const order = [];
  const harness = createHarness({
    initialProject: false,
    projectOpen: {
      async acceptExternal(requestId) {
        order.push(`accept:${requestId}`);
        return {
          openKind: "confirmation",
          requestId,
          classification: "new-external",
          sourceFileName: `${requestId}.html`,
          visibleV1FileName: `${requestId}-V1.html`,
          projectsRootLabel: "文稿 › PageRoot › 项目",
        };
      },
      async ackExternal(requestId) {
        order.push(`ack:${requestId}`);
        return { acknowledged: true, requestId };
      },
      async cancelPrepared() {
        return { canceled: true };
      },
    },
  });
  t.after(() => harness.workflow.dispose());

  assert.equal(harness.workflow.acceptExternalProject({
    requestId: "external_first",
    sourcePath: A_PATH,
  }).status, "succeeded");
  assert.equal(harness.workflow.acceptExternalProject({
    requestId: "external_second",
    sourcePath: B_PATH,
  }).status, "succeeded");
  await waitFor(() => (
    harness.workflow.getSnapshot().openConfirmation?.requestId === "external_first"
  ));
  assert.deepEqual(order, ["accept:external_first"]);
  assert.equal(harness.workflow.getSnapshot().externalOpen.queuedRequestId, "external_second");

  assert.equal((await harness.workflow.cancelExternalOpen({ requestId: "external_first" })).status, "succeeded");
  await waitFor(() => (
    harness.workflow.getSnapshot().openConfirmation?.requestId === "external_second"
  ));
  assert.deepEqual(order, [
    "accept:external_first",
    "ack:external_first",
    "accept:external_second",
  ]);
  assert.equal((await harness.workflow.cancelExternalOpen({ requestId: "external_second" })).status, "succeeded");
  await waitFor(() => order.at(-1) === "ack:external_second");
});

test("direct external ack rejection defers the head and retry never accepts or enqueues it twice", async (t) => {
  const accepted = [];
  const acknowledgements = [];
  let rejectFirstAck = true;
  const harness = createHarness({
    projectOpen: {
      async acceptExternal(requestId) {
        accepted.push(requestId);
        return requestId === "external_ack_first"
          ? { name: "A", sourcePath: A_PATH, html: A_HTML, sha256: sha256(A_HTML) }
          : { name: "B", sourcePath: B_PATH, html: B_HTML, sha256: sha256(B_HTML) };
      },
      async ackExternal(requestId) {
        acknowledgements.push(requestId);
        if (requestId === "external_ack_first" && rejectFirstAck) {
          rejectFirstAck = false;
          throw new Error("ack unavailable");
        }
        return { acknowledged: true, requestId };
      },
    },
  });
  t.after(() => harness.workflow.dispose());

  harness.workflow.acceptExternalProject({
    requestId: "external_ack_first",
    sourcePath: A_PATH,
  });
  harness.workflow.acceptExternalProject({
    requestId: "external_ack_second",
    sourcePath: B_PATH,
  });
  await waitFor(() => harness.workflow.getSnapshot().externalOpen.status === "deferred");
  assert.deepEqual(accepted, ["external_ack_first"]);
  assert.deepEqual(acknowledgements, ["external_ack_first"]);

  assert.equal(harness.workflow.resumeDeferredExternalProject().status, "succeeded");
  await waitFor(() => (
    harness.workflow.getSnapshot().externalOpen.status === "idle"
    && accepted.length === 2
  ));
  assert.deepEqual(accepted, ["external_ack_first", "external_ack_second"]);
  assert.deepEqual(acknowledgements, [
    "external_ack_first",
    "external_ack_first",
    "external_ack_second",
  ]);
  assert.equal(harness.projectSession.context?.sourcePath, B_PATH);
});

test("terminal external failure remains deferred until ack retry without reopening", async (t) => {
  let acceptCount = 0;
  let ackCount = 0;
  const harness = createHarness({
    projectOpen: {
      async acceptExternal() {
        acceptCount += 1;
        return { invalid: true };
      },
      async ackExternal(requestId) {
        ackCount += 1;
        if (ackCount === 1) throw new Error("ack unavailable");
        return { acknowledged: true, requestId };
      },
    },
  });
  t.after(() => harness.workflow.dispose());

  harness.workflow.acceptExternalProject({
    requestId: "external_terminal_ack",
    sourcePath: A_PATH,
  });
  await waitFor(() => harness.workflow.getSnapshot().externalOpen.status === "deferred");
  assert.equal(acceptCount, 1);
  assert.equal(ackCount, 1);
  assert.equal(harness.workflow.resumeDeferredExternalProject().status, "succeeded");
  await waitFor(() => harness.workflow.getSnapshot().externalOpen.status === "idle");
  assert.equal(acceptCount, 1);
  assert.equal(ackCount, 2);
  assert.equal(harness.projectSession.context?.sourcePath, OLD_PATH);
});

test("confirmed external open retries only its failed ack and never commits twice", async (t) => {
  let commitCount = 0;
  let ackCount = 0;
  const harness = createHarness({
    initialProject: false,
    projectOpen: {
      async acceptExternal(requestId) {
        return {
          openKind: "confirmation",
          requestId,
          classification: "new-external",
          sourceFileName: "confirm.html",
          visibleV1FileName: "confirm-V1.html",
          projectsRootLabel: "文稿 › PageRoot › 项目",
        };
      },
      async commitPrepared() {
        commitCount += 1;
        return { name: "A", sourcePath: A_PATH, html: A_HTML, sha256: sha256(A_HTML) };
      },
      async finalizePrepared() {
        return { disposition: "kept" };
      },
      async ackExternal(requestId) {
        ackCount += 1;
        if (ackCount === 1) throw new Error("ack unavailable");
        return { acknowledged: true, requestId };
      },
    },
  });
  t.after(() => harness.workflow.dispose());
  harness.workflow.acceptExternalProject({
    requestId: "external_confirm_ack",
    sourcePath: A_PATH,
  });
  await waitFor(() => harness.workflow.getSnapshot().openConfirmation?.requestId === "external_confirm_ack");
  const first = await harness.workflow.confirmExternalOpen({
    requestId: "external_confirm_ack",
    action: "import-new",
  });
  assert.equal(first.code, "EXTERNAL_OPEN_ACK_REJECTED");
  assert.equal(commitCount, 1);
  assert.equal(harness.workflow.getSnapshot().externalOpen.status, "awaiting-confirmation");
  const retried = await harness.workflow.retryExternalOpen({ requestId: "external_confirm_ack" });
  assert.equal(retried.status, "succeeded");
  assert.equal(commitCount, 1);
  assert.equal(ackCount, 2);
  assert.equal(harness.workflow.getSnapshot().externalOpen.status, "idle");
  assert.equal(harness.workflow.getSnapshot().openConfirmation, null);
});

test("close drains and acknowledges every queued external confirmation", async (t) => {
  const order = [];
  const harness = createHarness({
    initialProject: false,
    projectOpen: {
      async acceptExternal(requestId) {
        order.push(`accept:${requestId}`);
        return {
          openKind: "confirmation",
          requestId,
          classification: "new-external",
          sourceFileName: `${requestId}.html`,
          visibleV1FileName: `${requestId}-V1.html`,
          projectsRootLabel: "文稿 › PageRoot › 项目",
        };
      },
      async ackExternal(requestId) {
        order.push(`ack:${requestId}`);
        return { acknowledged: true, requestId };
      },
      async cancelPrepared() {
        return { canceled: true };
      },
    },
  });
  t.after(() => harness.workflow.dispose());
  for (const requestId of ["close_confirmation_1", "close_confirmation_2", "close_confirmation_3"]) {
    harness.workflow.acceptExternalProject({ requestId, sourcePath: A_PATH });
  }
  await waitFor(() => harness.workflow.getSnapshot().openConfirmation?.requestId === "close_confirmation_1");
  const closed = await harness.workflow.prepareClose({
    requestId: "close_all_confirmations",
    deadlineAt: Date.now() + 2_000,
  });
  assert.deepEqual(closed, { ready: true });
  assert.deepEqual(order, [
    "accept:close_confirmation_1",
    "ack:close_confirmation_1",
    "accept:close_confirmation_2",
    "ack:close_confirmation_2",
    "accept:close_confirmation_3",
    "ack:close_confirmation_3",
  ]);
  assert.equal(harness.workflow.getSnapshot().externalOpen.status, "idle");
  assert.equal(harness.workflow.getSnapshot().openConfirmation, null);
});

test("close drains an in-flight local picker before it commits", async (t) => {
  let resolveLocal;
  const harness = createHarness({
    projectOpen: {
      openLocal: () => new Promise((resolve) => {
        resolveLocal = resolve;
      }),
    },
  });
  t.after(() => harness.workflow.dispose());

  const opening = harness.workflow.openProject({ kind: "local" });
  await waitFor(
    () => Boolean(resolveLocal) && harness.workflow.getSnapshot().open.phase === "opening",
    "local picker did not enter the open operation",
  );
  let closeSettled = false;
  const closing = harness.workflow.prepareClose({
    requestId: "close_pending_local_picker",
    deadlineAt: Date.now() + 2_000,
  }).then((outcome) => {
    closeSettled = true;
    return outcome;
  });

  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(closeSettled, false);
  assert.equal(harness.workflow.getSnapshot().close.phase, "preparing");

  resolveLocal(null);
  const [opened, readiness] = await Promise.all([opening, closing]);
  assert.equal(opened.status, "succeeded");
  assert.equal(opened.value.opened, false);
  assert.deepEqual(readiness, { ready: true });
  assert.equal(harness.workflow.getSnapshot().close.phase, "ready");
});

test("close drains project switch preparation before it commits", async (t) => {
  const harness = createHarness({
    projectOpen: {
      async openLocal() {
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
  let canvasReleased = false;
  let resolveCanvas;
  harness.documentWorkflow.ensureCurrentCanvas = () => {
    if (canvasReleased) return Promise.resolve(succeeded({ ready: true }));
    return new Promise((resolve) => {
      resolveCanvas = () => {
        canvasReleased = true;
        resolve(succeeded({ ready: true }));
      };
    });
  };

  const opening = harness.workflow.openProject({ kind: "local" });
  await waitFor(
    () => Boolean(resolveCanvas) && harness.workflow.getSnapshot().open.phase === "opening",
    "project switch preparation did not enter the open operation",
  );
  let closeSettled = false;
  const closing = harness.workflow.prepareClose({
    requestId: "close_pending_switch_preparation",
    deadlineAt: Date.now() + 2_000,
  }).then((outcome) => {
    closeSettled = true;
    return outcome;
  });

  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(closeSettled, false);
  assert.equal(harness.workflow.getSnapshot().close.phase, "preparing");

  resolveCanvas();
  const [opened, readiness] = await Promise.all([opening, closing]);
  assert.equal(opened.status, "succeeded");
  assert.equal(opened.value.opened, true);
  assert.deepEqual(readiness, { ready: true });
  assert.equal(harness.workflow.getSnapshot().close.phase, "ready");
});

test("close drains an in-flight startup active-project read before it commits", async (t) => {
  let resolveActive;
  const harness = createHarness({
    projectOpen: {
      getActive: () => new Promise((resolve) => {
        resolveActive = resolve;
      }),
    },
  });
  t.after(() => harness.workflow.dispose());

  const opening = harness.workflow.openProject({ kind: "startup" });
  await waitFor(
    () => Boolean(resolveActive) && harness.workflow.getSnapshot().open.phase === "opening",
    "startup active-project read did not enter the open operation",
  );
  let closeSettled = false;
  const closing = harness.workflow.prepareClose({
    requestId: "close_pending_startup_read",
    deadlineAt: Date.now() + 2_000,
  }).then((outcome) => {
    closeSettled = true;
    return outcome;
  });

  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(closeSettled, false);
  assert.equal(harness.workflow.getSnapshot().close.phase, "preparing");

  resolveActive(null);
  const [opened, readiness] = await Promise.all([opening, closing]);
  assert.equal(opened.status, "succeeded");
  assert.equal(opened.value.opened, false);
  assert.deepEqual(readiness, { ready: true });
  assert.equal(harness.workflow.getSnapshot().close.phase, "ready");
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

test("close trusts the prior Start navigation fence when the Canvas outlet is unmounted", async (t) => {
  let freezeCount = 0;
  const harness = createHarness({
    canvas: {
      isMounted: () => false,
      freeze: () => {
        freezeCount += 1;
        return null;
      },
    },
  });
  t.after(() => harness.workflow.dispose());

  const readiness = await harness.workflow.prepareClose({
    requestId: "close_from_start_outlet",
    deadlineAt: Date.now() + 2_000,
  });
  assert.deepEqual(readiness, { ready: true });
  assert.equal(freezeCount, 0);
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
  assert.deepEqual(
    harness.documentWorkflow.projectTransitionAuthority,
    {
      recoveryIdentity: {
        token: "recovery_old",
        projectId: "project_old",
        documentId: "document_old",
        sourcePath: OLD_PATH,
      },
      sourceHistory: {
        schemaVersion: "1.0.0",
        projectId: "project_old",
        documentId: "document_old",
        baseSourceSha256: sha256(OLD_HTML),
        cursor: 0,
        revision: 0,
        entries: [],
        appliedActions: [],
        updatedAt: "2026-08-11T00:00:00.000Z",
      },
      sourceHistoryOperations: [],
    },
  );
  assert.equal(
    harness.documentWorkflow.restoredProjectTransitionAuthority.context.sourcePath,
    OLD_PATH,
  );
  assert.equal(
    harness.documentWorkflow.restoredProjectTransitionAuthority.sourceSha256,
    sha256(OLD_HTML),
  );
});

test("source rename is a typed ProjectWorkflow transition with one synchronous Session publication", async (t) => {
  let renamePayload = null;
  const harness = createHarness({
    bridge: {
      async workspace(sourcePath) {
        if (sourcePath !== RENAMED_PATH) return workspacePayload(sourcePath, OLD_HTML);
        return {
          ...workspacePayload(RENAMED_PATH, OLD_HTML),
          projectId: "project_old",
          documentId: "document_old",
          sourcePath: RENAMED_PATH,
          project: { displayName: "renamed" },
        };
      },
    },
    projectOpen: {
      async renameSource(payload) {
        renamePayload = payload;
        return {
          operationId: payload.operationId,
          previousSourcePath: OLD_PATH,
          sourcePath: RENAMED_PATH,
          sha256: sha256(OLD_HTML),
          stem: "renamed",
          lastModifiedAt: "2026-08-12T00:00:00.000Z",
        };
      },
    },
  });
  t.after(() => harness.workflow.dispose());

  const outcome = await harness.workflow.renameSource({ stem: "renamed" });

  assert.equal(outcome.status, "succeeded");
  assert.deepEqual(renamePayload, {
    operationId: renamePayload.operationId,
    sourcePath: OLD_PATH,
    stem: "renamed",
    expectedSha256: sha256(OLD_HTML),
  });
  assert.equal(harness.projectSession.context?.sourcePath, RENAMED_PATH);
  assert.equal(harness.projectSession.context?.projectId, "project_old");
  assert.equal(harness.documentSession.sourceSha256, sha256(OLD_HTML));
  assert.equal(harness.runSession.snapshot.activeSourcePath, RENAMED_PATH);
  assert.equal(harness.documentWorkflow.resetCount, 1);
  assert.equal(harness.commentWorkflow.resetCount, 1);
  assert.ok(harness.unlockCount >= 1);
});

test("title-bar rename keeps the managed OpenTarget so a later Finder rename can rebind", async (t) => {
  const finderPath = "/tmp/project-workflow-finder.html";
  const reconcileCalls = [];
  const harness = createHarness({
    openTarget: managedOpenTarget(OLD_PATH),
    bridge: {
      async workspace(sourcePath) {
        const nextPath = sourcePath === finderPath
          ? finderPath
          : sourcePath === RENAMED_PATH
            ? RENAMED_PATH
            : OLD_PATH;
        return {
          ...workspacePayload(nextPath, OLD_HTML),
          projectId: "project_old",
          documentId: "document_old",
          sourcePath: nextPath,
          project: { displayName: nextPath.split("/").at(-1).replace(/\.html$/u, "") },
        };
      },
    },
    projectOpen: {
      async renameSource(payload) {
        return {
          operationId: payload.operationId,
          previousSourcePath: payload.sourcePath,
          sourcePath: RENAMED_PATH,
          sha256: sha256(OLD_HTML),
          stem: "project-workflow-renamed",
          lastModifiedAt: "2026-08-12T00:00:00.000Z",
        };
      },
      async reconcileActiveManagedSource(payload) {
        reconcileCalls.push(payload);
        if (payload.previousSourcePath === RENAMED_PATH) {
          return locatorResult(payload, { sourcePath: finderPath });
        }
        return locatorResult(payload, {
          sourcePath: OLD_PATH,
          status: "unchanged",
        });
      },
      async listRecent() {
        return [];
      },
      async listRegistered() {
        return [];
      },
    },
  });
  t.after(() => harness.workflow.dispose());

  const renamed = await harness.workflow.renameSource({ stem: "project-workflow-renamed" });
  assert.equal(renamed.status, "succeeded");
  assert.equal(harness.projectSession.context?.sourcePath, RENAMED_PATH);
  assert.equal(harness.projectSession.openTarget?.exactSourcePath, RENAMED_PATH);
  assert.equal(harness.projectSession.openTarget?.workingCopyId, "work_ver_0001");

  const relocated = await harness.workflow.reconcileExternalSourceLocator({
    reason: "watch",
    previousSourcePath: RENAMED_PATH,
    sourceMissing: true,
  });
  assert.equal(relocated.status, "succeeded");
  assert.equal(relocated.value.relocated, true);
  assert.equal(harness.projectSession.openTarget?.exactSourcePath, finderPath);
  assert.equal(harness.projectSession.openTarget?.workingCopyId, "work_ver_0001");
  assert.equal(reconcileCalls.at(-1)?.previousSourcePath, RENAMED_PATH);
});

test("Finder relocate prefers Bridge exactSourcePath over a private-prefixed desktop path", async (t) => {
  const privateRenamed = "/private/tmp/project-workflow-renamed.html";
  const harness = createHarness({
    openTarget: managedOpenTarget(),
    projectOpen: {
      async reconcileActiveManagedSource(payload) {
        return {
          ...locatorResult(payload, { sourcePath: RENAMED_PATH }),
          sourcePath: privateRenamed,
        };
      },
      async listRecent() {
        return [];
      },
      async listRegistered() {
        return [];
      },
    },
  });
  t.after(() => harness.workflow.dispose());

  const outcome = await harness.workflow.reconcileExternalSourceLocator({
    reason: "watch",
    previousSourcePath: OLD_PATH,
    sourceMissing: true,
  });

  assert.equal(outcome.status, "succeeded");
  assert.equal(outcome.value.relocated, true);
  assert.equal(outcome.value.sourcePath, RENAMED_PATH);
  assert.equal(harness.projectSession.context?.sourcePath, RENAMED_PATH);
  assert.equal(harness.projectSession.openTarget?.exactSourcePath, RENAMED_PATH);
});

test("source rename reconciles a lost desktop response only against the expected new file identity", async (t) => {
  let renameCount = 0;
  const harness = createHarness({
    bridge: {
      async workspace(sourcePath) {
        return {
          ...workspacePayload(sourcePath, OLD_HTML),
          projectId: "project_old",
          documentId: "document_old",
          sourcePath,
        };
      },
    },
    projectOpen: {
      async renameSource() {
        renameCount += 1;
        throw new Error("desktop response lost");
      },
      async getActive() {
        return {
          name: "project-workflow-renamed.html",
          sourcePath: RENAMED_PATH,
          html: OLD_HTML,
          sha256: sha256(OLD_HTML),
        };
      },
    },
  });
  t.after(() => harness.workflow.dispose());

  const first = harness.workflow.renameSource({ stem: "project-workflow-renamed" });
  const second = harness.workflow.renameSource({ stem: "project-workflow-renamed" });
  assert.equal(first, second);
  const outcome = await first;

  assert.equal(outcome.status, "succeeded");
  assert.equal(renameCount, 1);
  assert.equal(harness.projectSession.context?.sourcePath, RENAMED_PATH);
});

test("a late source rename result cannot rebase a newer project Session", async (t) => {
  let resolveRename;
  let renamePayload;
  const harness = createHarness({
    projectOpen: {
      renameSource(payload) {
        renamePayload = payload;
        return new Promise((resolve) => {
          resolveRename = resolve;
        });
      },
    },
  });
  t.after(() => harness.workflow.dispose());

  const pending = harness.workflow.renameSource({ stem: "renamed" });
  await waitFor(() => Boolean(resolveRename));
  harness.projectSession.openLocator(B_PATH);
  harness.documentSession.reset({ html: B_HTML, sourceSha256: sha256(B_HTML) });
  resolveRename({
    operationId: renamePayload.operationId,
    previousSourcePath: OLD_PATH,
    sourcePath: RENAMED_PATH,
    sha256: sha256(OLD_HTML),
    stem: "renamed",
  });

  const outcome = await pending;
  assert.equal(outcome.status, "stale");
  assert.equal(harness.projectSession.sourcePath, B_PATH);
  assert.equal(harness.runSession.snapshot.activeSourcePath, OLD_PATH);
});

test("a pending source rename blocks another project transition at the workflow boundary", async (t) => {
  let resolveRename;
  const harness = createHarness({
    projectOpen: {
      renameSource(payload) {
        return new Promise((resolve) => {
          resolveRename = () => resolve({
            operationId: payload.operationId,
            previousSourcePath: OLD_PATH,
            sourcePath: RENAMED_PATH,
            sha256: sha256(OLD_HTML),
            stem: "renamed",
          });
        });
      },
    },
  });
  t.after(() => harness.workflow.dispose());

  const rename = harness.workflow.renameSource({ stem: "renamed" });
  await waitFor(() => Boolean(resolveRename));
  const transition = await harness.workflow.prepareSwitch();

  assert.deepEqual(transition, {
    status: "blocked",
    code: "PROJECT_SWITCH_BLOCKED",
    reason: "正在安全修改 HTML 文件名，请等待本次操作完成后再继续。",
  });
  resolveRename();
  assert.equal((await rename).status, "succeeded");
});

function managedOpenTarget(sourcePath = OLD_PATH) {
  return {
    projectId: "project_old",
    documentId: "document_old",
    projectRootPath: "/tmp/project-root",
    targetKind: "working-copy",
    workingCopyId: "work_ver_0001",
    versionId: "ver_0001",
    exactSourcePath: sourcePath,
    sourceSha256: sha256(OLD_HTML),
  };
}

function locatorResult(payload, {
  sourcePath = RENAMED_PATH,
  status = "relocated",
  watcherGeneration = 4,
  sha = sha256(OLD_HTML),
} = {}) {
  return {
    operationId: payload.operationId,
    status,
    previousSourcePath: payload.previousSourcePath,
    sourcePath,
    sourceSha256: sha,
    watcherGeneration,
    openTarget: {
      ...managedOpenTarget(sourcePath),
      sourceSha256: sha,
    },
  };
}


test("Finder locator rebase keeps IDs, publishes the new path, and does not load disk HTML", async (t) => {
  const reconcileCalls = [];
  const harness = createHarness({
    openTarget: managedOpenTarget(),
    projectOpen: {
      async reconcileActiveManagedSource(payload) {
        reconcileCalls.push(payload);
        return locatorResult(payload);
      },
      async listRecent() {
        return [];
      },
      async listRegistered() {
        return [];
      },
    },
  });
  t.after(() => harness.workflow.dispose());

  const outcome = await harness.workflow.reconcileExternalSourceLocator({
    reason: "watch",
    watcherGeneration: 3,
    previousSourcePath: OLD_PATH,
  });

  assert.equal(outcome.status, "succeeded");
  assert.equal(outcome.value.relocated, true);
  assert.equal(outcome.value.sourcePath, RENAMED_PATH);
  assert.equal(harness.projectSession.context?.sourcePath, RENAMED_PATH);
  assert.equal(harness.projectSession.context?.projectId, "project_old");
  assert.equal(harness.projectSession.context?.documentId, "document_old");
  assert.equal(harness.projectSession.openTarget?.workingCopyId, "work_ver_0001");
  assert.equal(harness.projectSession.openTarget?.versionId, "ver_0001");
  assert.equal(harness.documentSession.html, OLD_HTML);
  assert.equal(harness.documentSession.sourceSha256, sha256(OLD_HTML));
  assert.equal(harness.runSession.snapshot.activeSourcePath, RENAMED_PATH);
  assert.equal(harness.documentWorkflow.observeCount, 1);
  assert.equal(reconcileCalls.length, 1);
  assert.equal(reconcileCalls[0].previousSourcePath, OLD_PATH);
  assert.equal(reconcileCalls[0].reason, "watch");
  assert.ok(!("nextSourcePath" in reconcileCalls[0]));
  assert.ok(harness.events.some((event) => event.type === "project-source-relocated"));
});

test("present-file watch hints only hash-observe and do not drain switch", async (t) => {
  const reconcileCalls = [];
  const rulesWorkflow = {
    drainCount: 0,
    inspect: () => ({ state: "pending", reason: "unsaved project rules" }),
    async drain() {
      this.drainCount += 1;
      return true;
    },
  };
  const harness = createHarness({
    openTarget: managedOpenTarget(),
    projectRulesWorkflow: rulesWorkflow,
    projectOpen: {
      async reconcileActiveManagedSource(payload) {
        reconcileCalls.push(payload);
        return locatorResult(payload);
      },
      async listRecent() {
        return [];
      },
      async listRegistered() {
        return [];
      },
    },
  });
  t.after(() => harness.workflow.dispose());

  const outcome = await harness.workflow.reconcileExternalSourceLocator({
    reason: "watch",
    watcherGeneration: 3,
    previousSourcePath: OLD_PATH,
    sourceMissing: false,
  });

  assert.equal(outcome.status, "succeeded");
  assert.equal(outcome.value.relocated, false);
  assert.equal(outcome.value.sourcePath, OLD_PATH);
  assert.equal(harness.projectSession.context?.sourcePath, OLD_PATH);
  assert.equal(harness.documentWorkflow.observeCount, 1);
  assert.equal(reconcileCalls.length, 0);
  assert.equal(rulesWorkflow.drainCount, 0);
  assert.equal(harness.fenceCount, 0);
  assert.ok(!harness.events.some((event) => event.type === "project-source-relocated"));
});

test("a later present-file hint does not drop a pending missing-path rebase", async (t) => {
  let releaseObserve;
  const observeGate = new Promise((resolve) => {
    releaseObserve = resolve;
  });
  const reconcileCalls = [];
  const harness = createHarness({
    openTarget: managedOpenTarget(),
    projectOpen: {
      async reconcileActiveManagedSource(payload) {
        reconcileCalls.push(payload);
        return locatorResult(payload);
      },
      async listRecent() {
        return [];
      },
      async listRegistered() {
        return [];
      },
    },
  });
  t.after(() => harness.workflow.dispose());
  harness.documentWorkflow.observeExternalSourceChange = async function observeExternalSourceChange() {
    this.observeCount += 1;
    await observeGate;
    return succeeded(this.observeResult);
  };

  const first = harness.workflow.reconcileExternalSourceLocator({
    reason: "watch",
    watcherGeneration: 1,
    previousSourcePath: OLD_PATH,
    sourceMissing: false,
  });
  await waitFor(
    () => harness.documentWorkflow.observeCount === 1,
    "present-file observe did not start",
  );
  const missing = harness.workflow.reconcileExternalSourceLocator({
    reason: "watch",
    watcherGeneration: 2,
    previousSourcePath: OLD_PATH,
    sourceMissing: true,
  });
  const present = harness.workflow.reconcileExternalSourceLocator({
    reason: "watch",
    watcherGeneration: 3,
    previousSourcePath: OLD_PATH,
    sourceMissing: false,
  });
  assert.equal(reconcileCalls.length, 0);
  releaseObserve();
  assert.equal((await first).status, "succeeded");
  assert.equal((await missing).status, "succeeded");
  assert.equal((await present).status, "succeeded");
  assert.equal(reconcileCalls.length, 1);
  assert.equal(harness.projectSession.context?.sourcePath, RENAMED_PATH);
});

test("Finder directory events coalesce to one rebase and late old-path events are ignored", async (t) => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const reconcileCalls = [];
  const harness = createHarness({
    openTarget: managedOpenTarget(),
    projectOpen: {
      async reconcileActiveManagedSource(payload) {
        reconcileCalls.push(payload);
        await gate;
        return locatorResult(payload, { watcherGeneration: 5 });
      },
      async listRecent() {
        return [];
      },
      async listRegistered() {
        return [];
      },
    },
  });
  t.after(() => harness.workflow.dispose());

  const first = harness.workflow.reconcileExternalSourceLocator({
    reason: "watch",
    watcherGeneration: 1,
    previousSourcePath: OLD_PATH,
  });
  await waitFor(() => reconcileCalls.length === 1, "first locator reconcile did not start");
  const second = harness.workflow.reconcileExternalSourceLocator({
    reason: "watch",
    watcherGeneration: 2,
    previousSourcePath: OLD_PATH,
  });
  const third = harness.workflow.reconcileExternalSourceLocator({
    reason: "watch",
    watcherGeneration: 3,
    previousSourcePath: OLD_PATH,
  });
  assert.equal(reconcileCalls.length, 1);
  release();
  assert.equal((await first).status, "succeeded");
  assert.equal((await second).value.ignored, true);
  assert.equal((await third).value.ignored, true);
  assert.equal(reconcileCalls.length, 1);
  assert.equal(harness.projectSession.context?.sourcePath, RENAMED_PATH);

  const stale = await harness.workflow.reconcileExternalSourceLocator({
    reason: "watch",
    watcherGeneration: 1,
    previousSourcePath: RENAMED_PATH,
  });
  assert.equal(stale.value.ignored, true);
  assert.equal(stale.value.reason, "stale-generation");
  assert.equal(reconcileCalls.length, 1);
});

test("Finder content-changed rebase keeps editor HTML and asks DocumentWorkflow to compare hashes", async (t) => {
  const harness = createHarness({
    openTarget: managedOpenTarget(),
    projectOpen: {
      async reconcileActiveManagedSource(payload) {
        return locatorResult(payload, {
          status: "content-changed",
          sha: sha256(A_HTML),
        });
      },
      async listRecent() {
        return [];
      },
      async listRegistered() {
        return [];
      },
    },
  });
  t.after(() => harness.workflow.dispose());
  harness.documentWorkflow.observeResult = { conflict: true };

  const outcome = await harness.workflow.reconcileExternalSourceLocator({
    reason: "watch",
    previousSourcePath: OLD_PATH,
  });

  assert.equal(outcome.status, "succeeded");
  assert.equal(outcome.value.relocated, true);
  assert.equal(outcome.value.contentChanged, true);
  assert.equal(harness.documentSession.html, OLD_HTML);
  assert.equal(harness.documentSession.sourceSha256, sha256(OLD_HTML));
  assert.equal(harness.documentWorkflow.observeCount, 1);
});

test("PageRoot rename after Finder rebase uses the recovered path", async (t) => {
  let renamePayload = null;
  const harness = createHarness({
    openTarget: managedOpenTarget(),
    bridge: {
      async workspace(sourcePath) {
        return {
          ...workspacePayload(sourcePath, OLD_HTML),
          projectId: "project_old",
          documentId: "document_old",
          sourcePath,
          project: { displayName: "pageroot-new" },
        };
      },
    },
    projectOpen: {
      async reconcileActiveManagedSource(payload) {
        if (payload.previousSourcePath === OLD_PATH) {
          return locatorResult(payload);
        }
        return locatorResult(payload, {
          status: "unchanged",
          sourcePath: RENAMED_PATH,
        });
      },
      async renameSource(payload) {
        renamePayload = payload;
        return {
          operationId: payload.operationId,
          previousSourcePath: RENAMED_PATH,
          sourcePath: "/tmp/project-workflow-pageroot-new.html",
          sha256: sha256(OLD_HTML),
          stem: "pageroot-new",
          lastModifiedAt: "2026-08-12T00:00:00.000Z",
        };
      },
      async listRecent() {
        return [];
      },
      async listRegistered() {
        return [];
      },
    },
  });
  t.after(() => harness.workflow.dispose());

  await harness.workflow.reconcileExternalSourceLocator({
    reason: "watch",
    previousSourcePath: OLD_PATH,
  });
  const outcome = await harness.workflow.renameSource({ stem: "pageroot-new" });

  assert.equal(outcome.status, "succeeded");
  assert.equal(renamePayload.sourcePath, RENAMED_PATH);
  assert.equal(renamePayload.stem, "pageroot-new");
  assert.equal(
    harness.projectSession.context?.sourcePath,
    "/tmp/project-workflow-pageroot-new.html",
  );
});

test("browser local open requests the hidden picker without draining first", async (t) => {
  let canvasWaiters = 0;
  const harness = createHarness({
    projectOpen: {
      mode: () => "browser-file",
    },
  });
  t.after(() => harness.workflow.dispose());
  harness.documentWorkflow.ensureCurrentCanvas = () => {
    canvasWaiters += 1;
    return new Promise(() => {});
  };

  const pending = harness.workflow.openProject({ kind: "local" });
  const requested = harness.events.filter(
    (event) => event.type === "project-browser-file-requested",
  );
  assert.equal(requested.length, 1);
  assert.equal(typeof requested[0].operationId, "string");
  assert.notEqual(requested[0].operationId, "");
  assert.equal(canvasWaiters, 0);
  assert.equal(harness.fenceCount, 0);

  const outcome = await Promise.race([
    pending,
    new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error("browser open awaited switch before requesting the picker"));
      }, 50);
    }),
  ]);
  assert.equal(outcome.status, "succeeded");
  assert.equal(outcome.value.awaitingFile, true);
  assert.equal(outcome.value.operationId, requested[0].operationId);
  assert.equal(canvasWaiters, 0);
  assert.equal(harness.fenceCount, 0);
  assert.equal(harness.projectSession.sourcePath, OLD_PATH);
});

test("cancelling the local picker does not drain the current project", async (t) => {
  let fenced = 0;
  const harness = createHarness({
    canvas: {
      fencePendingEdit: () => {
        fenced += 1;
        return {
          ok: true,
          html: OLD_HTML,
          sourceSha256: sha256(OLD_HTML),
        };
      },
    },
    projectOpen: {
      async openLocal() {
        return null;
      },
    },
  });
  t.after(() => harness.workflow.dispose());
  const outcome = await harness.workflow.openProject({ kind: "local" });
  assert.equal(outcome.status, "succeeded");
  assert.equal(outcome.value.opened, false);
  assert.equal(fenced, 0);
  assert.equal(harness.projectSession.sourcePath, OLD_PATH);
});

test("startup confirmation commits without fencing a nonexistent Canvas", async (t) => {
  let fenced = 0;
  let ackCount = 0;
  const harness = createHarness({
    initialProject: false,
    canvas: {
      fencePendingEdit: () => {
        fenced += 1;
        return null;
      },
    },
    projectOpen: {
      async getActive() {
        return {
          openKind: "confirmation",
          requestId: "req_startup_new",
          classification: "new-external",
          sourceFileName: "page.html",
          visibleV1FileName: "page-V1.html",
          projectsRootLabel: "文稿 › PageRoot › 项目",
        };
      },
      async commitPrepared() {
        return {
          name: "page-V1.html",
          sourcePath: A_PATH,
          html: A_HTML,
          sha256: sha256(A_HTML),
        };
      },
      async finalizePrepared() {
        return { disposition: "kept" };
      },
      async ackExternal() {
        ackCount += 1;
        throw new Error("startup confirmation has no external mailbox head");
      },
    },
  });
  t.after(() => harness.workflow.dispose());

  const started = await harness.workflow.openProject({ kind: "startup" });
  assert.equal(started.status, "succeeded");
  assert.equal(started.value.awaitingConfirmation, true);
  assert.equal(harness.projectSession.epoch, 0);
  assert.equal(fenced, 0);

  const confirmed = await harness.workflow.confirmExternalOpen({
    requestId: "req_startup_new",
    action: "import-new",
  });
  assert.equal(confirmed.status, "succeeded");
  assert.equal(ackCount, 0);
  assert.equal(fenced, 0);
  await waitFor(
    () => harness.projectSession.sourcePath === A_PATH
      && !harness.workflow.projectHydrating
      && harness.workflow.getSnapshot().openConfirmation === null,
    "startup confirmation did not finish hydration",
  );
  assert.equal(harness.documentSession.html, A_HTML);
});

test("a local Start confirmation cancel or commit failure never publishes the retained Controller", async (t) => {
  let commitShouldFail = false;
  let appliedCount = 0;
  let canceledCount = 0;
  const harness = createHarness({
    initialProject: false,
    projectOpen: {
      async openLocal() {
        return {
          openKind: "confirmation",
          requestId: "req_local_start",
          classification: "new-external",
          sourceFileName: "local.html",
          visibleV1FileName: "local-V1.html",
          projectsRootLabel: "文稿 › PageRoot › 项目",
        };
      },
      async cancelPrepared() {
        canceledCount += 1;
        return { canceled: true };
      },
      async commitPrepared() {
        if (commitShouldFail) throw new Error("commit rejected");
        return { name: "A", sourcePath: A_PATH, html: A_HTML, sha256: sha256(A_HTML) };
      },
    },
  });
  t.after(() => harness.workflow.dispose());
  const unsubscribe = harness.workflow.subscribeEvents((event) => {
    if (event.type === "project-applied") appliedCount += 1;
  });
  t.after(unsubscribe);

  await harness.workflow.openProject({ kind: "local" });
  const canceled = await harness.workflow.cancelExternalOpen({ requestId: "req_local_start" });
  assert.equal(canceled.status, "succeeded");
  assert.equal(canceledCount, 1);
  assert.equal(harness.projectSession.epoch, 0);
  assert.equal(appliedCount, 0);

  commitShouldFail = true;
  await harness.workflow.openProject({ kind: "local" });
  const failed = await harness.workflow.confirmExternalOpen({
    requestId: "req_local_start",
    action: "import-new",
  });
  assert.equal(failed.status, "rejected");
  assert.equal(harness.projectSession.epoch, 0);
  assert.equal(appliedCount, 0);
});

test("a new-external picker result shows confirmation without switching", async (t) => {
  let fenced = 0;
  let committed = null;
  const harness = createHarness({
    canvas: {
      fencePendingEdit: () => {
        fenced += 1;
        return {
          ok: true,
          html: OLD_HTML,
          sourceSha256: sha256(OLD_HTML),
        };
      },
    },
    projectOpen: {
      async openLocal() {
        return {
          openKind: "confirmation",
          requestId: "req_new",
          classification: "new-external",
          sourceFileName: "page.html",
          visibleV1FileName: "page-V1.html",
          projectsRootLabel: "文稿 › PageRoot › 项目",
        };
      },
      async commitPrepared(payload) {
        committed = payload;
        return {
          name: "page-V1.html",
          sourcePath: A_PATH,
          html: A_HTML,
          sha256: sha256(A_HTML),
        };
      },
      async finalizePrepared() {
        return { disposition: "kept" };
      },
    },
  });
  t.after(() => harness.workflow.dispose());

  const opened = await harness.workflow.openProject({ kind: "local" });
  assert.equal(opened.status, "succeeded");
  assert.equal(opened.value.awaitingConfirmation, true);
  assert.equal(fenced, 0);
  assert.equal(
    harness.workflow.getSnapshot().openConfirmation?.classification,
    "new-external",
  );
  assert.equal(harness.projectSession.sourcePath, OLD_PATH);

  assert.equal(
    (await harness.workflow.confirmExternalOpen({
      requestId: "req_new",
      action: "view-initial",
    })).status,
    "rejected",
  );

  const confirmed = await harness.workflow.confirmExternalOpen({
    requestId: "req_new",
    action: "import-new",
  });
  assert.equal(confirmed.status, "succeeded");
  assert.deepEqual(committed, {
    requestId: "req_new",
    action: "import-new",
  });
  assert.equal(harness.projectSession.sourcePath, A_PATH);
  assert.equal(harness.workflow.getSnapshot().openConfirmation, null);
});

test("canvas failure after import rolls back and never finalizes a trash request", async (t) => {
  let finalized = 0;
  let rolledBack = 0;
  const harness = createHarness({
    projectOpen: {
      async openLocal() {
        return {
          openKind: "confirmation",
          requestId: "req_canvas_fail",
          classification: "new-external",
          sourceFileName: "page.html",
          visibleV1FileName: "page-V1.html",
          projectsRootLabel: "文稿 › PageRoot › 项目",
        };
      },
      async commitPrepared() {
        return {
          name: "page-V1.html",
          sourcePath: A_PATH,
          html: A_HTML,
          sha256: sha256(A_HTML),
        };
      },
      async rollbackPrepared() {
        rolledBack += 1;
        return { rolledBack: true };
      },
      async finalizePrepared() {
        finalized += 1;
        return { disposition: "trashed" };
      },
    },
  });
  t.after(() => harness.workflow.dispose());
  let canvasCalls = 0;
  harness.documentWorkflow.ensureCurrentCanvas = async () => {
    canvasCalls += 1;
    if (canvasCalls === 1) return succeeded({ ready: true });
    return {
      status: "rejected",
      code: "DOCUMENT_CANVAS_AUTHORITY_REJECTED",
      reason: "当前画布尚未完成自动恢复。",
    };
  };

  await harness.workflow.openProject({ kind: "local" });
  harness.workflow.setExternalOpenDeleteOriginal({
    requestId: "req_canvas_fail",
    deleteOriginal: true,
  });
  const confirmed = await harness.workflow.confirmExternalOpen({
    requestId: "req_canvas_fail",
    action: "import-new",
    deleteOriginal: true,
  });
  assert.equal(confirmed.status, "rejected");
  assert.equal(canvasCalls, 2);
  assert.equal(finalized, 0);
  assert.equal(rolledBack, 1);
  assert.equal(
    harness.workflow.getSnapshot().openConfirmation?.requestId,
    "req_canvas_fail",
  );
  assert.equal(
    harness.events.some((event) => event.type === "external-open-canvas-failed"),
    true,
  );
});

test("continue-current opens the bound project without importing again", async (t) => {
  let committed = null;
  let finalized = 0;
  const harness = createHarness({
    projectOpen: {
      async openLocal() {
        return {
          openKind: "confirmation",
          requestId: "req_known",
          classification: "known-external",
          sourceFileName: "page.html",
          projectName: "page",
          currentBasedOnOrdinal: 6,
          latestOfficialOrdinal: 6,
          currentDiffersFromBase: true,
          sourceRelation: "unchanged",
        };
      },
      async commitPrepared(payload) {
        committed = payload;
        return {
          name: "page-V1.html",
          sourcePath: A_PATH,
          html: A_HTML,
          sha256: sha256(A_HTML),
        };
      },
      async finalizePrepared() {
        finalized += 1;
        return { disposition: "kept" };
      },
    },
  });
  t.after(() => harness.workflow.dispose());

  await harness.workflow.openProject({ kind: "local" });
  assert.equal(
    harness.workflow.setExternalOpenDeleteOriginal({
      requestId: "req_known",
      deleteOriginal: true,
    }).status,
    "rejected",
  );
  const confirmed = await harness.workflow.confirmExternalOpen({
    requestId: "req_known",
    action: "continue-current",
  });
  assert.equal(confirmed.status, "succeeded");
  assert.deepEqual(committed, {
    requestId: "req_known",
    action: "continue-current",
  });
  assert.equal(finalized, 1);
  assert.equal(harness.projectSession.sourcePath, A_PATH);
});
