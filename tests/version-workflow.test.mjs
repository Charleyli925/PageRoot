import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { CommentSession } from "../app/application/comment-session.js";
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
  verifyRendered = null,
  onDrain = null,
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
  };
  const projectWorkflow = {
    projectHydrating: false,
    projectLoadError: null,
    async drain(boundary, input) {
      calls.drain.push([boundary, input]);
      if (onDrain) return onDrain({ boundary, input, documentSession });
      return { ok: true };
    },
    async prepareGeneratedSourceTransition(input) {
      calls.prepare.push(input);
      return Object.freeze({
        previousSourcePath: input.previousSourcePath,
        nextSourcePath: input.nextSourcePath,
        projectId: input.nextProjectId,
        documentId: input.nextDocumentId,
        updatesCurrentProject: projectSession.projectId === input.nextProjectId,
        activatedProject: null,
      });
    },
    commitGeneratedSourceTransition({ prepared, html, sourceSha256, publishVersion }) {
      calls.commit.push({ prepared, html, sourceSha256 });
      let nextContext = projectSession.context;
      if (!sameSourcePath(projectSession.sourcePath, prepared.nextSourcePath)) {
        nextContext = projectSession.transitionSource({
          previousSourcePath: prepared.previousSourcePath,
          sourcePath: prepared.nextSourcePath,
          projectId: prepared.projectId,
          documentId: prepared.documentId,
        });
      }
      if (!nextContext || !projectSession.context) return null;
      documentSession.publishAuthority({ html, sourceSha256, pendingWrite: null });
      publishVersion();
      calls.invalidate += 1;
      return projectSession.context;
    },
    async refreshWorkspace(input) {
      calls.refresh.push(input);
      return { status: "succeeded", value: { hydrated: true } };
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
    replaceAuthority() {
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
    documentWorkflow,
    commentWorkflow,
    commentSession,
    draftSession,
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

test("activation validates all content and synchronously publishes Project, Document and Version", async () => {
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
  assert.equal(harness.calls.resetComments, 1);
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
