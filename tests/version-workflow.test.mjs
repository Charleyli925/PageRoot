import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { CommentSession } from "../app/application/comment-session.js";
import { BridgeRequestError } from "../app/application/bridge-client.js";
import { DocumentSession } from "../app/application/document-session.js";
import { ProjectSession } from "../app/application/project-session.js";
import { RunSession } from "../app/application/run-session.js";
import { VersionSession } from "../app/application/version-session.js";
import { VersionWorkflow } from "../app/application/version-workflow.js";

const SOURCE_A = "/tmp/version-workflow-a.html";
const SOURCE_B = "/tmp/version-workflow-b.html";
const BASE_HTML = "<!doctype html><html><body><p>base</p></body></html>";
const CANDIDATE_HTML = "<!doctype html><html><body><p>candidate</p></body></html>";
const HISTORY_HTML = "<!doctype html><html><body><p>history</p></body></html>";
const DRAINED_HTML = "<!doctype html><html><body><p>drained</p></body></html>";
const B_HTML = "<!doctype html><html><body><p>B</p></body></html>";
const HISTORY_WORKING_COPY_PATH = "/tmp/version-workflow-v2.html";

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function sameSourcePath(left, right) {
  return Boolean(left && right && String(left) === String(right));
}

function operationKey(run) {
  return [run.requestId, run.attemptId, run.sourcePath].join("::");
}

function versionRecord({
  id = "ver_0002",
  content = CANDIDATE_HTML,
  projectId = "project_a",
  documentId = "document_a",
} = {}) {
  return {
    id,
    versionId: id,
    projectId,
    documentId,
    contentSha256: sha256(content),
    generatedAt: "2026-08-12T00:00:00.000Z",
  };
}

function readyRun(overrides = {}) {
  const version = versionRecord();
  return {
    projectId: "project_a",
    documentId: "document_a",
    requestId: "req_0001",
    attemptId: "attempt_001",
    requestPath: "/tmp/req_0001",
    attemptPath: "/tmp/req_0001/attempt_001",
    handoffMessage: "request",
    status: "ready-to-open",
    sourcePath: SOURCE_A,
    baseSnapshotSha256: sha256(BASE_HTML),
    previousVersionId: "ver_0001",
    basedOnVersionId: "ver_0001",
    freezeCutoffRevision: 0,
    candidateVersionId: version.id,
    candidateVersionLabel: "版本 2",
    submittedAt: "2026-08-12T00:00:00.000Z",
    completionObserved: true,
    readyPayload: {
      projectId: "project_a",
      documentId: "document_a",
      requestId: "req_0001",
      attemptId: "attempt_001",
      versionId: version.id,
      contentSha256: version.contentSha256,
      candidateDisplayVersionLabel: "版本 2",
      version,
      openTarget: {
        projectId: "project_a",
        documentId: "document_a",
        projectRootPath: "/tmp/project-a",
        targetKind: "working-copy",
        workingCopyId: "work_ver_0001",
        versionId: "ver_0001",
        exactSourcePath: SOURCE_A,
        sourceSha256: sha256(BASE_HTML),
      },
      completion: { completedAt: "2026-08-12T00:00:01.000Z" },
      outcome: {
        projectId: "project_a",
        documentId: "document_a",
        requestId: "req_0001",
        attemptId: "attempt_001",
        versionId: version.id,
        contentSha256: version.contentSha256,
        generatedAt: version.generatedAt,
      },
    },
    ...overrides,
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function createHarness({
  currentPath = SOURCE_A,
  versionRead = null,
  sourceRead = null,
  activation = null,
  continueHistory = null,
  confirmHistory = null,
  verifyRendered = null,
  onDrain = null,
  onCatalogAfterSettlement = null,
} = {}) {
  const projectSession = new ProjectSession();
  const locator = projectSession.openLocator(currentPath);
  const projectId = currentPath === SOURCE_B ? "project_b" : "project_a";
  const documentId = currentPath === SOURCE_B ? "document_b" : "document_a";
  const context = projectSession.register({
    ...locator,
    projectId,
    documentId,
  });
  const initialHtml = currentPath === SOURCE_B ? B_HTML : BASE_HTML;
  const documentSession = new DocumentSession({
    html: initialHtml,
    sourceSha256: sha256(initialHtml),
  });
  const versionSession = new VersionSession();
  versionSession.hydrate({
    versions: [versionRecord({ id: "ver_0001", content: BASE_HTML })],
    latestVersionId: "ver_0001",
    currentBasedOnVersionId: "ver_0001",
    currentExactVersionId: "ver_0001",
  });
  const runSession = new RunSession({ sourcePath: SOURCE_A });
  const commentSession = new CommentSession();
  const calls = {
    activate: 0,
    activateInputs: [],
    continueHistory: [],
    versionFile: [],
    source: [],
    drain: [],
    prepare: [],
    commit: [],
    refresh: [],
    render: [],
    invalidate: 0,
    unlock: 0,
    clearRecovery: 0,
    clearAudit: 0,
    resetComments: 0,
    queueDraft: 0,
    draftAuthorities: [],
    confirmHistory: [],
    catalogAfterSettlement: [],
    order: [],
  };
  const bridgeClient = {
    async versionFile(sourcePath, versionId) {
      calls.versionFile.push([sourcePath, versionId]);
      if (versionRead) return versionRead(sourcePath, versionId);
      const content = versionId === "ver_0001" ? HISTORY_HTML : CANDIDATE_HTML;
      return {
        projectId: "project_a",
        documentId: "document_a",
        versionId,
        content,
        sha256: sha256(content),
      };
    },
    async source(sourcePath) {
      calls.source.push(sourcePath);
      if (sourceRead) return sourceRead(sourcePath);
      const content = sourcePath === SOURCE_B ? B_HTML : CANDIDATE_HTML;
      return {
        projectId: sourcePath === SOURCE_B ? "project_b" : "project_a",
        documentId: sourcePath === SOURCE_B ? "document_b" : "document_a",
        sourcePath,
        content,
        sha256: sha256(content),
        currentBasedOnVersionId: "ver_0002",
        currentExactVersionId: "ver_0002",
        restoredFromVersionId: null,
        lastModifiedAt: "2026-08-12T00:00:02.000Z",
      };
    },
    async activateReadyVersion(input) {
      calls.activate += 1;
      calls.activateInputs.push(input);
      if (activation) return activation(input);
      const version = versionRecord({ id: input.versionId });
      return {
        projectId: input.projectId,
        documentId: input.documentId,
        requestId: input.requestId,
        attemptId: input.attemptId,
        versionId: input.versionId,
        contentSha256: version.contentSha256,
        sourceSha256: version.contentSha256,
        currentHtmlSha256: version.contentSha256,
        candidateDisplayVersionLabel: "版本 2",
        version,
      };
    },
    async continueEditingHistoryVersion(input) {
      calls.continueHistory.push(input);
      if (continueHistory) return continueHistory(input);
      return {
        ok: true,
        status: "history-working-copy-activated",
        projectId: "project_a",
        documentId: "document_a",
        sourcePath: SOURCE_A,
        openTarget: {
          projectId: "project_a",
          documentId: "document_a",
          projectRootPath: "/tmp/project-a",
          targetKind: "working-copy",
          workingCopyId: "work_ver_0001",
          versionId: "ver_0001",
          exactSourcePath: SOURCE_A,
          sourceSha256: sha256(BASE_HTML),
        },
        currentHtmlSha256: sha256(BASE_HTML),
        currentBasedOnVersionId: "ver_0001",
        currentExactVersionId: "ver_0001",
        restoredFromVersionId: null,
        latestVersionId: "ver_0001",
        versions: [versionRecord({ id: "ver_0001", content: BASE_HTML })],
        content: BASE_HTML,
        lastModifiedAt: "2026-08-12T00:00:02.000Z",
        historyActivation: {
          operationId: input.operationId,
          projectId: "project_a",
          documentId: "document_a",
          previousWorkingCopyId: "work_ver_0001",
          activatedWorkingCopyId: "work_ver_0001",
          versionId: "ver_0001",
          state: "desktop-pending",
          createdAt: "2026-08-12T00:00:03.000Z",
        },
        operationId: input.operationId,
        activeDraft: {
          draftRevision: 0,
          comments: [],
          changeEvents: [],
          deletedCommentIds: [],
          appliedOperationIds: [],
        },
      };
    },
    async confirmEditingHistoryVersion(input) {
      calls.confirmHistory.push(input);
      calls.order.push("confirm");
      if (confirmHistory) return confirmHistory(input);
      return {
        ok: true,
        status: "history-working-copy-desktop-confirmed",
        projectId: input.projectId,
        documentId: input.documentId,
        operationId: input.operationId,
        confirmed: true,
        historyActivation: {
          operationId: input.operationId,
          projectId: input.projectId,
          documentId: input.documentId,
          previousWorkingCopyId: input.previousWorkingCopyId,
          activatedWorkingCopyId: input.activatedWorkingCopyId,
          versionId: input.versionId,
          state: "desktop-confirmed",
          createdAt: "2026-08-12T00:00:03.000Z",
        },
      };
    },
  };
  const projectWorkflow = {
    projectHydrating: false,
    projectLoadError: null,
    async drain(boundary, input) {
      calls.drain.push([boundary, input]);
      if (onDrain) return onDrain({ boundary, input, documentSession });
      return { ok: true };
    },
    async prepareManagedSourceTransition(input) {
      calls.prepare.push(input);
      return Object.freeze({
        previousSourcePath: input.previousSourcePath,
        nextSourcePath: input.nextSourcePath,
        projectId: input.nextProjectId,
        documentId: input.nextDocumentId,
        openTarget: input.openTarget || null,
        updatesCurrentProject: projectSession.projectId === input.nextProjectId,
        activatedProject: null,
      });
    },
    commitManagedSourceTransition({ prepared, html, sourceSha256, publishVersion, publishSessions }) {
      calls.commit.push({ prepared, html, sourceSha256 });
      let nextContext = projectSession.context;
      if (!sameSourcePath(projectSession.sourcePath, prepared.nextSourcePath)) {
        nextContext = projectSession.transitionSource({
          previousSourcePath: prepared.previousSourcePath,
          sourcePath: prepared.nextSourcePath,
          projectId: prepared.projectId,
          documentId: prepared.documentId,
          openTarget: prepared.openTarget || null,
        });
      }
      if (!nextContext || !projectSession.context) return null;
      if (!sameSourcePath(projectSession.sourcePath, prepared.previousSourcePath)) {
        commentWorkflow.resetForProjectTransition();
      }
      documentSession.publishAuthority({ html, sourceSha256, pendingWrite: null });
      if (publishSessions) publishSessions(projectSession.context);
      else publishVersion();
      calls.invalidate += 1;
      return projectSession.context;
    },
    captureManagedSourceTransitionAuthority() {
      return {
        context: projectSession.context,
        document: documentSession.snapshot,
        version: versionSession.captureSnapshot(),
        comment: commentSession.snapshot,
      };
    },
    restoreManagedSourceTransitionAuthority(previous) {
      if (!previous?.context) return null;
      const locator = projectSession.openLocator(previous.context.sourcePath);
      const restored = projectSession.register({
        ...locator,
        projectId: previous.context.projectId,
        documentId: previous.context.documentId,
      });
      documentSession.publishAuthority({
        html: previous.document.html,
        sourceSha256: previous.document.sourceSha256,
      });
      versionSession.restoreSnapshot(previous.version);
      commentSession.update(previous.comment);
      return restored;
    },
    async refreshWorkspace(input) {
      calls.refresh.push(input);
      return { status: "succeeded", value: { hydrated: true } };
    },
    scheduleProjectListRefreshAfterSettlement(context) {
      calls.order.push("catalog");
      calls.catalogAfterSettlement.push(context);
      if (onCatalogAfterSettlement) onCatalogAfterSettlement(context);
    },
  };
  const documentWorkflow = {
    clearRecovery() {
      calls.clearRecovery += 1;
    },
    clearAudit() {
      calls.clearAudit += 1;
    },
  };
  const commentWorkflow = {
    resetForProjectTransition() {
      calls.resetComments += 1;
    },
    queueDraft() {
      calls.queueDraft += 1;
      return { status: "succeeded", value: { queued: true } };
    },
  };
  const draftSession = {
    replaceAuthority(context, draftRevision, authority) {
      calls.draftAuthorities.push({ context, draftRevision, authority });
      return true;
    },
  };
  const workflow = new VersionWorkflow({
    bridgeClient,
    projectSession,
    documentSession,
    versionSession,
    runSession,
    projectWorkflow,
    commentSession,
    draftSession,
    documentWorkflow,
    commentWorkflow,
    codecs: {
      isRecord: (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value),
      sameSourcePath,
      operationKey,
      errorMessage: (cause, fallback) => String(cause?.message || fallback),
    },
    ports: {
      hash: { sha256: async (html) => sha256(html) },
      canvas: {
        fencePendingEdit: () => ({ ok: true }),
        freeze: () => ({ ok: true, html: documentSession.html }),
        async verifyRendered(html, hash, nextContext) {
          calls.render.push({ html, hash, context: nextContext });
          if (verifyRendered) await verifyRendered(html, hash, nextContext);
        },
        invalidateRenderAcks() {
          calls.invalidate += 1;
        },
        unlock() {
          calls.unlock += 1;
        },
      },
    },
    clock: { now: () => Date.parse("2026-08-12T00:00:03.000Z") },
  });
  return {
    workflow,
    projectSession,
    documentSession,
    versionSession,
    runSession,
    projectWorkflow,
    commentSession,
    draftSession,
    calls,
    context,
  };
}

test("review preparation returns an immutable candidate without activating or publishing source", async () => {
  const harness = createHarness();
  const run = readyRun();
  harness.runSession.trackRun(run, { activate: "always" });

  const outcome = await harness.workflow.prepareReviewCandidate({ run });

  assert.equal(outcome.status, "succeeded");
  assert.equal(Object.isFrozen(outcome.value), true);
  assert.equal(outcome.value.content, CANDIDATE_HTML);
  assert.equal(outcome.value.sha256, sha256(CANDIDATE_HTML));
  assert.equal(harness.calls.activate, 0);
  assert.equal(harness.calls.source.length, 0);
  assert.equal(harness.documentSession.html, BASE_HTML);
  assert.equal(harness.versionSession.snapshot.currentExactVersionId, "ver_0001");
});

test("review preparation fences a late candidate read after cancellation", async () => {
  const delayed = deferred();
  const harness = createHarness({
    versionRead: async () => delayed.promise,
  });
  const run = readyRun();
  harness.runSession.trackRun(run, { activate: "always" });

  const reviewing = harness.workflow.prepareReviewCandidate({ run });
  harness.runSession.removeRun(run);
  delayed.resolve({
    projectId: run.projectId,
    documentId: run.documentId,
    versionId: run.candidateVersionId,
    content: CANDIDATE_HTML,
    sha256: sha256(CANDIDATE_HTML),
  });

  const outcome = await reviewing;
  assert.equal(outcome.status, "stale");
  assert.equal(harness.calls.activate, 0);
  assert.equal(harness.documentSession.html, BASE_HTML);
});

test("activation validates all content and synchronously publishes every Session authority", async () => {
  const harness = createHarness();
  const run = readyRun();
  harness.runSession.trackRun(run, { activate: "always" });

  const outcome = await harness.workflow.activateReadyVersion({ run });

  assert.equal(outcome.status, "succeeded");
  assert.equal(outcome.value.current, true);
  assert.equal(harness.calls.activate, 1);
  assert.equal(harness.calls.commit.length, 1);
  assert.equal(harness.documentSession.html, CANDIDATE_HTML);
  assert.equal(harness.versionSession.snapshot.currentExactVersionId, "ver_0002");
  assert.equal(harness.versionSession.snapshot.viewMode, "current");
  assert.equal(harness.runSession.activeRun?.status, "complete");
  assert.equal(harness.calls.render.at(-1)?.html, CANDIDATE_HTML);
  assert.equal(harness.calls.clearAudit, 1);
  assert.equal(harness.calls.resetComments, 0);
  assert.equal(harness.calls.draftAuthorities.length, 1);
  assert.equal(harness.calls.draftAuthorities[0].draftRevision, 0);
  assert.deepEqual(harness.commentSession.snapshot.comments, []);
  assert.equal(harness.calls.catalogAfterSettlement.length, 1);
});

test("activation keeps the Canvas locked when rendered-byte verification fails", async () => {
  const harness = createHarness({
    verifyRendered: async (html) => {
      if (html === CANDIDATE_HTML) throw new Error("canvas did not acknowledge candidate");
    },
  });
  const run = readyRun();
  harness.runSession.trackRun(run, { activate: "always" });

  const outcome = await harness.workflow.activateReadyVersion({ run });

  assert.equal(outcome.status, "rejected");
  assert.equal(harness.calls.activate, 1);
  assert.equal(harness.calls.commit.length, 1);
  assert.equal(harness.documentSession.html, CANDIDATE_HTML);
  assert.equal(harness.versionSession.snapshot.currentExactVersionId, "ver_0002");
  assert.equal(harness.runSession.activeRun?.status, "ready-to-open");
  assert.equal(harness.runSession.activeLocked, true);
  assert.equal(harness.calls.unlock, 0);
  assert.equal(harness.calls.clearAudit, 0);
  assert.equal(harness.calls.resetComments, 0);
  assert.equal(harness.calls.draftAuthorities.length, 1);
  assert.equal(harness.calls.queueDraft, 0);
  assert.equal(harness.calls.refresh.length, 0);
});

test("activation rejects completion/version hash drift before publishing current source", async () => {
  const harness = createHarness({
    activation: async (input) => ({
      projectId: input.projectId,
      documentId: input.documentId,
      requestId: input.requestId,
      attemptId: input.attemptId,
      versionId: input.versionId,
      contentSha256: sha256("tampered"),
      sourceSha256: sha256("tampered"),
      version: {
        ...versionRecord({ id: input.versionId }),
        contentSha256: sha256("tampered"),
      },
    }),
  });
  const run = readyRun();
  harness.runSession.trackRun(run, { activate: "always" });

  const outcome = await harness.workflow.activateReadyVersion({ run });

  assert.equal(outcome.status, "rejected");
  assert.equal(harness.documentSession.html, BASE_HTML);
  assert.equal(harness.versionSession.snapshot.currentExactVersionId, "ver_0001");
  assert.equal(harness.calls.commit.length, 0);
  assert.equal(harness.runSession.activeRun?.status, "ready-to-open");
});

test("activation rejects malformed ready identity before the explicit Bridge mutation", async () => {
  const harness = createHarness();
  const run = readyRun();
  run.readyPayload = {
    ...run.readyPayload,
    outcome: {
      ...run.readyPayload.outcome,
      versionId: "ver_9999",
    },
  };
  harness.runSession.trackRun(run, { activate: "always" });

  const outcome = await harness.workflow.activateReadyVersion({ run });

  assert.equal(outcome.status, "rejected");
  assert.equal(harness.calls.activate, 0);
  assert.equal(harness.documentSession.html, BASE_HTML);
  assert.equal(harness.versionSession.snapshot.currentExactVersionId, "ver_0001");
});

test("activation remains read-only while project hydration is in flight", async () => {
  const harness = createHarness();
  const run = readyRun();
  harness.runSession.trackRun(run, { activate: "always" });
  harness.projectWorkflow.projectHydrating = true;

  const outcome = await harness.workflow.activateReadyVersion({ run });

  assert.equal(outcome.status, "blocked");
  assert.equal(outcome.code, "VERSION_ACTIVATION_PROJECT_UNAVAILABLE");
  assert.equal(harness.calls.activate, 0);
  assert.equal(harness.calls.commit.length, 0);
  assert.equal(harness.documentSession.html, BASE_HTML);
  assert.equal(harness.versionSession.snapshot.currentExactVersionId, "ver_0001");
  assert.equal(harness.runSession.activeRun?.status, "ready-to-open");
});

test("background activation never replaces the active Canvas", async () => {
  const harness = createHarness({ currentPath: SOURCE_B });
  const run = readyRun();
  harness.runSession.trackRun(run, { activate: "always" });

  const outcome = await harness.workflow.activateReadyVersion({ run });

  assert.equal(outcome.status, "succeeded");
  assert.equal(outcome.value.current, false);
  assert.equal(harness.documentSession.html, B_HTML);
  assert.equal(harness.versionSession.snapshot.currentExactVersionId, "ver_0001");
  assert.equal(harness.calls.commit.length, 0);
  assert.equal(harness.calls.activateInputs[0].projectRootPath, "/tmp/project-a");
  assert.equal(harness.calls.activateInputs[0].workingCopyId, "work_ver_0001");
  assert.equal(harness.calls.activateInputs[0].sourcePath, SOURCE_A);
  assert.equal(harness.calls.catalogAfterSettlement.length, 1);
});

test("activation reuses activation-response bytes without a Bridge read-back", async () => {
  const harness = createHarness({
    activation: async (input) => ({
      ok: true,
      status: "version-activated",
      projectId: input.projectId,
      documentId: input.documentId,
      requestId: input.requestId,
      attemptId: input.attemptId,
      versionId: input.versionId,
      contentSha256: sha256(CANDIDATE_HTML),
      sourceSha256: sha256(CANDIDATE_HTML),
      currentHtmlSha256: sha256(CANDIDATE_HTML),
      sourcePath: SOURCE_A,
      content: CANDIDATE_HTML,
      lastModifiedAt: "2026-08-12T00:00:02.000Z",
      candidateDisplayVersionLabel: "版本 2",
      version: versionRecord({ id: input.versionId }),
    }),
  });
  const run = readyRun();
  harness.runSession.trackRun(run, { activate: "always" });

  const outcome = await harness.workflow.activateReadyVersion({ run });

  assert.equal(outcome.status, "succeeded");
  assert.equal(outcome.value.current, true);
  assert.equal(harness.calls.versionFile.length, 0);
  assert.equal(harness.calls.source.length, 0);
  assert.equal(harness.documentSession.html, CANDIDATE_HTML);
  assert.equal(harness.calls.render.at(-1)?.html, CANDIDATE_HTML);
  assert.equal(harness.versionSession.snapshot.currentExactVersionId, "ver_0002");
});

test("activation rejects activation-response bytes whose hash does not match", async () => {
  const harness = createHarness({
    activation: async (input) => ({
      ok: true,
      status: "version-activated",
      projectId: input.projectId,
      documentId: input.documentId,
      requestId: input.requestId,
      attemptId: input.attemptId,
      versionId: input.versionId,
      contentSha256: sha256(CANDIDATE_HTML),
      sourceSha256: sha256(CANDIDATE_HTML),
      currentHtmlSha256: sha256(CANDIDATE_HTML),
      sourcePath: SOURCE_A,
      content: CANDIDATE_HTML.replace("candidate", "tampered"),
      lastModifiedAt: "2026-08-12T00:00:02.000Z",
      candidateDisplayVersionLabel: "版本 2",
      version: versionRecord({ id: input.versionId }),
    }),
  });
  const run = readyRun();
  harness.runSession.trackRun(run, { activate: "always" });

  const outcome = await harness.workflow.activateReadyVersion({ run });

  assert.equal(outcome.status, "rejected");
  assert.equal(harness.calls.commit.length, 0);
  assert.equal(harness.documentSession.html, BASE_HTML);
  assert.equal(harness.versionSession.snapshot.currentExactVersionId, "ver_0001");
  assert.equal(harness.runSession.activeRun?.status, "ready-to-open");
});

test("a failed workspace refresh never blocks activation and reports through events", async () => {
  const harness = createHarness();
  const refreshDeferred = deferred();
  harness.projectWorkflow.refreshWorkspace = async (input) => {
    harness.calls.refresh.push(input);
    return refreshDeferred.promise;
  };
  const events = [];
  harness.workflow.subscribeEvents((event) => events.push(event));
  const run = readyRun();
  harness.runSession.trackRun(run, { activate: "always" });

  const outcome = await harness.workflow.activateReadyVersion({ run });

  assert.equal(outcome.status, "succeeded");
  assert.equal(outcome.value.refreshWarning, undefined);
  assert.equal(harness.calls.refresh.length, 1);
  assert.equal(
    events.some((event) => event.type === "version-refresh-warning"),
    false,
  );

  refreshDeferred.resolve({ status: "blocked", reason: "复核未完成" });
  await new Promise((resolve) => setTimeout(resolve, 0));

  const warning = events.find((event) => event.type === "version-refresh-warning");
  assert.ok(warning);
  assert.equal(warning.reason, "复核未完成");
  assert.equal(warning.candidateLabel, "版本 2");
});

test("history failure restores the complete prior Document and Version snapshot", async () => {
  const harness = createHarness({
    verifyRendered: async (html) => {
      if (html === HISTORY_HTML) throw new Error("history canvas failed");
    },
  });

  const outcome = await harness.workflow.viewHistory({
    version: {
      id: "ver_0001",
      contentSha256: sha256(HISTORY_HTML),
    },
    context: harness.context,
  });

  assert.equal(outcome.status, "rejected");
  assert.equal(harness.documentSession.html, BASE_HTML);
  assert.equal(harness.documentSession.sourceSha256, sha256(BASE_HTML));
  assert.equal(harness.versionSession.snapshot.viewMode, "current");
  assert.equal(harness.versionSession.snapshot.currentExactVersionId, "ver_0001");
  assert.equal(harness.calls.render.at(-1)?.html, BASE_HTML);
});

test("history rollback retains persistence advanced by a successful drain", async () => {
  const harness = createHarness({
    onDrain: async ({ documentSession }) => {
      documentSession.publishAuthority({
        html: DRAINED_HTML,
        sourceSha256: sha256(DRAINED_HTML),
        editRevision: 1,
        lastPersistedRevision: 1,
        persistState: "idle",
        persistError: "",
        pendingWrite: null,
      });
      return { ok: true };
    },
    verifyRendered: async (html) => {
      if (html === HISTORY_HTML) throw new Error("history canvas failed");
    },
  });
  harness.documentSession.publishAuthority({
    html: DRAINED_HTML,
    sourceSha256: sha256(BASE_HTML),
    editRevision: 1,
    lastPersistedRevision: 0,
    persistState: "writing",
    pendingWrite: {
      revision: 1,
      targetHtmlSha256: sha256(DRAINED_HTML),
    },
  });

  const outcome = await harness.workflow.viewHistory({
    version: {
      id: "ver_0001",
      contentSha256: sha256(HISTORY_HTML),
    },
    context: harness.context,
  });

  assert.equal(outcome.status, "rejected");
  assert.equal(harness.documentSession.html, DRAINED_HTML);
  assert.equal(harness.documentSession.sourceSha256, sha256(DRAINED_HTML));
  assert.equal(harness.documentSession.editRevision, 1);
  assert.equal(harness.documentSession.lastPersistedRevision, 1);
  assert.equal(harness.documentSession.persistState, "idle");
  assert.equal(harness.documentSession.pendingWrite, null);
  assert.equal(harness.calls.render.at(-1)?.html, DRAINED_HTML);
});

test("history rollback retains persistence advanced before a later drain failure", async () => {
  const harness = createHarness({
    onDrain: async ({ documentSession }) => {
      documentSession.publishAuthority({
        html: DRAINED_HTML,
        sourceSha256: sha256(DRAINED_HTML),
        editRevision: 1,
        lastPersistedRevision: 1,
        persistState: "idle",
        persistError: "",
        pendingWrite: null,
      });
      return { ok: false, reason: "draft persistence failed" };
    },
  });
  harness.documentSession.publishAuthority({
    html: DRAINED_HTML,
    sourceSha256: sha256(BASE_HTML),
    editRevision: 1,
    lastPersistedRevision: 0,
    persistState: "writing",
    pendingWrite: {
      revision: 1,
      targetHtmlSha256: sha256(DRAINED_HTML),
    },
  });

  const outcome = await harness.workflow.viewHistory({
    version: {
      id: "ver_0001",
      contentSha256: sha256(HISTORY_HTML),
    },
    context: harness.context,
  });

  assert.equal(outcome.status, "rejected");
  assert.equal(harness.calls.versionFile.length, 0);
  assert.equal(harness.documentSession.html, DRAINED_HTML);
  assert.equal(harness.documentSession.sourceSha256, sha256(DRAINED_HTML));
  assert.equal(harness.documentSession.editRevision, 1);
  assert.equal(harness.documentSession.lastPersistedRevision, 1);
  assert.equal(harness.documentSession.persistState, "idle");
  assert.equal(harness.documentSession.pendingWrite, null);
  assert.equal(harness.calls.render.at(-1)?.html, DRAINED_HTML);
});

test("history stays read-only and return-current validates canonical source identity", async () => {
  const harness = createHarness();
  const history = await harness.workflow.viewHistory({
    version: {
      id: "ver_0001",
      contentSha256: sha256(HISTORY_HTML),
    },
    context: harness.context,
  });
  assert.equal(history.status, "succeeded");
  assert.equal(harness.versionSession.snapshot.viewMode, "history");
  assert.equal(harness.documentSession.html, HISTORY_HTML);

  const mismatched = createHarness({
    sourceRead: async () => ({
      projectId: "other_project",
      documentId: "document_a",
      sourcePath: SOURCE_A,
      content: BASE_HTML,
      sha256: sha256(BASE_HTML),
    }),
  });
  mismatched.versionSession.enterHistory("ver_0001");
  mismatched.documentSession.publishAuthority({
    html: HISTORY_HTML,
    sourceSha256: sha256(BASE_HTML),
  });
  const returned = await mismatched.workflow.returnToCurrent({
    context: mismatched.context,
  });
  assert.equal(returned.status, "rejected");
  assert.equal(mismatched.versionSession.snapshot.viewMode, "history");
  assert.equal(mismatched.documentSession.html, HISTORY_HTML);
});

test("history continuation synchronously publishes the V2 Working Copy authority to every Session", async () => {
  const v2 = versionRecord({ id: "ver_0002", content: HISTORY_HTML });
  const v6 = versionRecord({ id: "ver_0006", content: CANDIDATE_HTML });
  const historyDraft = {
    draftRevision: 4,
    comments: [{ id: "comment_v2", text: "V2 draft comment" }],
    changeEvents: [{ id: "change_v2", type: "edit" }],
    deletedCommentIds: ["comment_deleted_v2"],
    appliedOperationIds: ["operation_v2"],
  };
  const harness = createHarness({
    onCatalogAfterSettlement: () => new Promise(() => {}),
    versionRead: async (sourcePath, versionId) => ({
      projectId: "project_a",
      documentId: "document_a",
      versionId,
      content: versionId === "ver_0002" ? HISTORY_HTML : CANDIDATE_HTML,
      sha256: sha256(versionId === "ver_0002" ? HISTORY_HTML : CANDIDATE_HTML),
      sourcePath,
    }),
    continueHistory: async (input) => ({
      ok: true,
      status: "history-working-copy-activated",
      projectId: "project_a",
      documentId: "document_a",
      sourcePath: HISTORY_WORKING_COPY_PATH,
      openTarget: {
        projectId: "project_a",
        documentId: "document_a",
        projectRootPath: "/tmp/project-a",
        targetKind: "working-copy",
        workingCopyId: "work_ver_0002",
        versionId: "ver_0002",
        exactSourcePath: HISTORY_WORKING_COPY_PATH,
        sourceSha256: sha256(HISTORY_HTML),
      },
      currentHtmlSha256: sha256(HISTORY_HTML),
      currentBasedOnVersionId: "ver_0002",
      currentExactVersionId: "ver_0002",
      restoredFromVersionId: null,
      latestVersionId: "ver_0006",
      versions: [v2, v6],
      content: HISTORY_HTML,
      lastModifiedAt: "2026-08-14T00:00:00.000Z",
      historyActivation: {
        operationId: input.operationId,
        projectId: "project_a",
        documentId: "document_a",
        previousWorkingCopyId: "work_ver_0006",
        activatedWorkingCopyId: "work_ver_0002",
        versionId: "ver_0002",
        state: "desktop-pending",
        createdAt: "2026-08-14T00:00:00.000Z",
      },
      operationId: input.operationId,
      activeDraft: historyDraft,
    }),
  });
  harness.versionSession.hydrate({
    versions: [v2, v6],
    latestVersionId: "ver_0006",
    currentBasedOnVersionId: "ver_0006",
    currentExactVersionId: "ver_0006",
  });

  const viewed = await harness.workflow.viewHistory({
    version: v2,
    context: harness.context,
  });
  assert.equal(viewed.status, "succeeded");
  assert.equal(harness.versionSession.snapshot.viewMode, "history");
  assert.equal(harness.documentSession.html, HISTORY_HTML);
  assert.equal(harness.versionSession.snapshot.latestVersionId, "ver_0006");

  const continued = await harness.workflow.continueEditingHistoryVersion({
    context: harness.projectSession.context,
  });
  assert.equal(continued.status, "succeeded");
  assert.equal(continued.value.workingCopyId, "work_ver_0002");
  assert.equal(harness.projectSession.context.sourcePath, HISTORY_WORKING_COPY_PATH);
  assert.equal(harness.projectSession.context.workingCopyId, "work_ver_0002");
  assert.equal(harness.documentSession.html, HISTORY_HTML);
  assert.equal(harness.versionSession.snapshot.viewMode, "current");
  assert.equal(harness.versionSession.snapshot.currentBasedOnVersionId, "ver_0002");
  assert.equal(harness.versionSession.snapshot.currentExactVersionId, "ver_0002");
  assert.equal(harness.versionSession.snapshot.latestVersionId, "ver_0006");
  assert.deepEqual(harness.commentSession.snapshot.comments, historyDraft.comments);
  assert.deepEqual(harness.commentSession.snapshot.changeEvents, historyDraft.changeEvents);
  assert.deepEqual(
    harness.commentSession.snapshot.deletedCommentIds,
    historyDraft.deletedCommentIds,
  );
  assert.equal(harness.calls.draftAuthorities.length, 1);
  assert.equal(harness.calls.draftAuthorities[0].draftRevision, historyDraft.draftRevision);
  assert.deepEqual(harness.calls.draftAuthorities[0].authority.comments, historyDraft.comments);
  assert.equal(harness.calls.continueHistory.length, 1);
  assert.equal(harness.calls.continueHistory[0].versionId, "ver_0002");
  assert.equal(harness.calls.prepare[0].openTarget.workingCopyId, "work_ver_0002");
  assert.equal(harness.calls.prepare[0].operationId, harness.calls.confirmHistory[0].operationId);
  assert.equal(harness.calls.confirmHistory.length, 1);
  assert.equal(harness.calls.render.at(-1)?.html, HISTORY_HTML);
  assert.deepEqual(harness.calls.order, ["confirm", "catalog"]);
  assert.equal(harness.calls.catalogAfterSettlement.length, 1);
  assert.equal(harness.calls.catalogAfterSettlement[0].sourcePath, HISTORY_WORKING_COPY_PATH);
});

test("history continuation retries one lost Bridge response with the same receipt operation", async () => {
  const v2 = versionRecord({ id: "ver_0002", content: HISTORY_HTML });
  const v6 = versionRecord({ id: "ver_0006", content: CANDIDATE_HTML });
  let attempts = 0;
  const harness = createHarness({
    versionRead: async (_sourcePath, versionId) => ({
      projectId: "project_a",
      documentId: "document_a",
      versionId,
      content: versionId === "ver_0002" ? HISTORY_HTML : CANDIDATE_HTML,
      sha256: sha256(versionId === "ver_0002" ? HISTORY_HTML : CANDIDATE_HTML),
    }),
    continueHistory: async (input) => {
      attempts += 1;
      if (attempts === 1) {
        throw new BridgeRequestError("response lost", { outcome: "unknown" });
      }
      return {
        ok: true,
        status: "history-working-copy-activated",
        projectId: "project_a",
        documentId: "document_a",
        sourcePath: HISTORY_WORKING_COPY_PATH,
        openTarget: {
          projectId: "project_a",
          documentId: "document_a",
          projectRootPath: "/tmp/project-a",
          targetKind: "working-copy",
          workingCopyId: "work_ver_0002",
          versionId: "ver_0002",
          exactSourcePath: HISTORY_WORKING_COPY_PATH,
          sourceSha256: sha256(HISTORY_HTML),
        },
        currentHtmlSha256: sha256(HISTORY_HTML),
        currentBasedOnVersionId: "ver_0002",
        currentExactVersionId: "ver_0002",
        restoredFromVersionId: null,
        latestVersionId: "ver_0006",
        versions: [v2, v6],
        content: HISTORY_HTML,
        lastModifiedAt: "2026-08-14T00:00:00.000Z",
        historyActivation: {
          operationId: input.operationId,
          projectId: "project_a",
          documentId: "document_a",
          previousWorkingCopyId: "work_ver_0006",
          activatedWorkingCopyId: "work_ver_0002",
          versionId: "ver_0002",
          state: "desktop-pending",
          createdAt: "2026-08-14T00:00:00.000Z",
        },
        operationId: input.operationId,
        activeDraft: {
          draftRevision: 0,
          comments: [],
          changeEvents: [],
          deletedCommentIds: [],
          appliedOperationIds: [],
        },
      };
    },
  });
  harness.versionSession.hydrate({
    versions: [v2, v6],
    latestVersionId: "ver_0006",
    currentBasedOnVersionId: "ver_0006",
    currentExactVersionId: "ver_0006",
  });
  assert.equal((await harness.workflow.viewHistory({ version: v2, context: harness.context })).status, "succeeded");

  const outcome = await harness.workflow.continueEditingHistoryVersion({
    context: harness.projectSession.context,
  });

  assert.equal(outcome.status, "succeeded");
  assert.equal(harness.calls.continueHistory.length, 2);
  assert.equal(
    harness.calls.continueHistory[0].operationId,
    harness.calls.continueHistory[1].operationId,
  );
  assert.equal(harness.calls.prepare[0].operationId, harness.calls.continueHistory[0].operationId);
  assert.equal(harness.calls.confirmHistory[0].operationId, harness.calls.continueHistory[0].operationId);
});

test("history continuation keeps the V2 Working Copy active when Canvas validation fails", async () => {
  let failHistoryRender = false;
  const harness = createHarness({
    versionRead: async () => ({
      projectId: "project_a",
      documentId: "document_a",
      versionId: "ver_0002",
      content: HISTORY_HTML,
      sha256: sha256(HISTORY_HTML),
    }),
    continueHistory: async (input) => ({
      ok: true,
      status: "history-working-copy-activated",
      projectId: "project_a",
      documentId: "document_a",
      sourcePath: HISTORY_WORKING_COPY_PATH,
      openTarget: {
        projectId: "project_a",
        documentId: "document_a",
        projectRootPath: "/tmp/project-a",
        targetKind: "working-copy",
        workingCopyId: "work_ver_0002",
        versionId: "ver_0002",
        exactSourcePath: HISTORY_WORKING_COPY_PATH,
        sourceSha256: sha256(HISTORY_HTML),
      },
      currentHtmlSha256: sha256(HISTORY_HTML),
      currentBasedOnVersionId: "ver_0002",
      currentExactVersionId: "ver_0002",
      restoredFromVersionId: null,
      latestVersionId: "ver_0006",
      versions: [
        versionRecord({ id: "ver_0002", content: HISTORY_HTML }),
        versionRecord({ id: "ver_0006", content: CANDIDATE_HTML }),
      ],
      content: HISTORY_HTML,
      lastModifiedAt: "2026-08-14T00:00:00.000Z",
      historyActivation: {
        operationId: input.operationId,
        projectId: "project_a",
        documentId: "document_a",
        previousWorkingCopyId: "work_ver_0006",
        activatedWorkingCopyId: "work_ver_0002",
        versionId: "ver_0002",
        state: "desktop-pending",
        createdAt: "2026-08-14T00:00:00.000Z",
      },
      operationId: input.operationId,
      activeDraft: {
        draftRevision: 0,
        comments: [],
        changeEvents: [],
        deletedCommentIds: [],
        appliedOperationIds: [],
      },
    }),
    verifyRendered: async (html) => {
      if (failHistoryRender && html === HISTORY_HTML) throw new Error("history canvas failed");
    },
  });
  harness.versionSession.hydrate({
    versions: [
      versionRecord({ id: "ver_0002", content: HISTORY_HTML }),
      versionRecord({ id: "ver_0006", content: CANDIDATE_HTML }),
    ],
    latestVersionId: "ver_0006",
    currentBasedOnVersionId: "ver_0006",
    currentExactVersionId: "ver_0006",
  });
  const viewed = await harness.workflow.viewHistory({
    version: { id: "ver_0002", contentSha256: sha256(HISTORY_HTML) },
    context: harness.context,
  });
  assert.equal(viewed.status, "succeeded");
  failHistoryRender = true;

  const outcome = await harness.workflow.continueEditingHistoryVersion({
    context: harness.context,
  });

  assert.equal(outcome.status, "unknown");
  assert.equal(harness.calls.confirmHistory.length, 1);
  assert.equal(harness.projectSession.context.sourcePath, HISTORY_WORKING_COPY_PATH);
  assert.equal(harness.versionSession.snapshot.viewMode, "current");
  assert.equal(harness.versionSession.snapshot.currentBasedOnVersionId, "ver_0002");
  assert.equal(harness.documentSession.html, HISTORY_HTML);
});

test("return-current rereads canonical source and restores current Version authority", async () => {
  const harness = createHarness({
    sourceRead: async () => ({
      projectId: "project_a",
      documentId: "document_a",
      sourcePath: SOURCE_A,
      content: CANDIDATE_HTML,
      sha256: sha256(CANDIDATE_HTML),
      currentBasedOnVersionId: "ver_0002",
      currentExactVersionId: "ver_0002",
      restoredFromVersionId: null,
      lastModifiedAt: "2026-08-12T00:00:02.000Z",
    }),
  });
  harness.versionSession.enterHistory("ver_0001");
  harness.documentSession.publishAuthority({
    html: HISTORY_HTML,
    sourceSha256: sha256(BASE_HTML),
  });

  const outcome = await harness.workflow.returnToCurrent({
    context: harness.context,
  });

  assert.equal(outcome.status, "succeeded");
  assert.equal(harness.calls.source.length, 1);
  assert.equal(harness.documentSession.html, CANDIDATE_HTML);
  assert.equal(harness.versionSession.snapshot.viewMode, "current");
  assert.equal(harness.versionSession.snapshot.currentExactVersionId, "ver_0002");
  assert.equal(harness.calls.render.at(-1)?.html, CANDIDATE_HTML);
});
