import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { CommentSession } from "../app/application/comment-session.js";
import { DocumentSession } from "../app/application/document-session.js";
import { ProjectSession } from "../app/application/project-session.js";
import { RunSession } from "../app/application/run-session.js";
import { RunWorkflow } from "../app/application/run-workflow.js";
import { VersionSession } from "../app/application/version-session.js";
import {
  activeRunFromRecord,
  canonicalLifecycleState,
} from "../app/domain/run-lifecycle.js";

const SOURCE_A = "/tmp/run-workflow-a.html";
const SOURCE_B = "/tmp/run-workflow-b.html";
const HTML_A = "<main>source A</main>";
const HTML_B = "<main>source B</main>";

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function succeeded(value) {
  return { status: "succeeded", value };
}

function runRecord({
  sourcePath = SOURCE_A,
  projectId = sourcePath === SOURCE_A ? "project_a" : "project_b",
  documentId = sourcePath === SOURCE_A ? "document_a" : "document_b",
  requestId = sourcePath === SOURCE_A ? "request_a" : "request_b",
  attemptId = "attempt_001",
  status = "processing",
  handoffMessage = "请执行本轮 Request。",
  ...overrides
} = {}) {
  return {
    projectId,
    documentId,
    requestId,
    attemptId,
    requestPath: `/tmp/${requestId}`,
    attemptPath: `/tmp/${requestId}/${attemptId}`,
    handoffMessage,
    status,
    sourcePath,
    baseSnapshotSha256: sha256(sourcePath === SOURCE_A ? HTML_A : HTML_B),
    previousVersionId: "version_001",
    basedOnVersionId: "version_001",
    freezeCutoffRevision: 0,
    candidateVersionId: "version_002",
    candidateDisplayVersionLabel: "版本 2",
    submittedAt: "2026-08-11T00:00:00.000Z",
    ...overrides,
  };
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

function createScheduler() {
  let nextId = 0;
  const callbacks = new Map();
  return {
    setInterval(callback, delayMs) {
      const id = ++nextId;
      callbacks.set(id, { callback, delayMs });
      return id;
    },
    clearInterval(id) {
      callbacks.delete(id);
    },
    ids() {
      return [...callbacks.keys()];
    },
    fire(id) {
      callbacks.get(id)?.callback();
    },
  };
}

function codecs() {
  return {
    isRecord: (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value),
    sameSourcePath: (left, right) => Boolean(left && right && left === right),
    activeRunFromRecord,
    canonicalLifecycleState,
    commentHasContent: (comment) => Boolean(
      String(comment?.text || "").trim() || comment?.attachments?.length,
    ),
    commentEditSessionHasChanges: (session) => session?.dirty === true,
    canLocateTarget: (target) => Boolean(target?.id && target?.selector),
    persistedComment: (comment) => ({ ...comment }),
    persistedChangeEvent: (event) => ({ ...event }),
    persistedTargetRef: (target) => ({ ...target }),
    uniqueTargets: (comments) => {
      const targets = new Map();
      for (const comment of comments) targets.set(comment.target.id, comment.target);
      return [...targets.values()];
    },
    fileStem: (name) => String(name).replace(/\.html?$/iu, "") || "未命名页面",
    projectMarkdown: (name) => `# ${name}`,
    operationKey: (run) => `${run.sourcePath}\n${run.requestId}\n${run.attemptId}`,
    errorMessage: (cause, fallback) => String(cause?.message || fallback),
  };
}

function createHarness({
  sourcePath = SOURCE_A,
  html = HTML_A,
  bridge = {},
  copy = async () => ({ status: "copied", copied: true }),
  freeze = null,
  drain = async () => ({ ok: true }),
} = {}) {
  const projectSession = new ProjectSession();
  projectSession.openLocator(sourcePath);
  const context = projectSession.register({
    epoch: projectSession.epoch,
    sourcePath,
    projectId: sourcePath === SOURCE_A ? "project_a" : "project_b",
    documentId: sourcePath === SOURCE_A ? "document_a" : "document_b",
  });
  const documentSession = new DocumentSession({
    html,
    sourceSha256: sha256(html),
  });
  const commentSession = new CommentSession();
  commentSession.setComments([{
    commentId: "comment_001",
    text: "把标题改得更清晰",
    target: {
      id: "target_001",
      selector: "main",
      sourceAnchor: { sourceSha256: sha256(html) },
    },
    attachments: [],
  }]);
  const versionSession = new VersionSession();
  versionSession.hydrate({
    versions: [],
    latestVersionId: "version_001",
    currentBasedOnVersionId: "version_001",
  });
  const runSession = new RunSession({ sourcePath });
  const scheduler = createScheduler();
  const calls = {
    createRequest: [],
    workspace: [],
    status: [],
    cancel: [],
    resolve: [],
    handoff: [],
    unlock: 0,
    fence: 0,
  };
  const client = {
    async createRequest(request) {
      calls.createRequest.push(request);
      return { activeRun: runRecord({ sourcePath }) };
    },
    async workspace(nextSourcePath) {
      calls.workspace.push(nextSourcePath);
      return {};
    },
    async status(nextSourcePath, requestId, attemptId) {
      calls.status.push([nextSourcePath, requestId, attemptId]);
      return { status: "processing" };
    },
    async cancelActiveRun(request) {
      calls.cancel.push(request);
      return {};
    },
    async resolveConflict(request) {
      calls.resolve.push(request);
      return { activeRun: runRecord({ ...request, status: "committing" }) };
    },
    ...bridge,
  };
  const frozen = freeze || (() => ({
    ok: true,
    html,
    sourceSha256: sha256(html),
    pendingMutation: null,
  }));
  const documentWorkflow = {
    enqueueEdit({ html: nextHtml }) {
      const revision = documentSession.beginEdit(nextHtml);
      documentSession.update({
        sourceSha256: sha256(nextHtml),
        lastPersistedRevision: revision,
        persistState: "idle",
      });
      return succeeded({ revision, queued: true });
    },
  };
  const workflow = new RunWorkflow({
    bridgeClient: client,
    ensureRegistered: async () => succeeded(context),
    projectSession,
    documentSession,
    commentSession,
    versionSession,
    runSession,
    documentWorkflow,
    drain,
    codecs: codecs(),
    ports: {
      canvas: {
        fencePendingEdit() {
          calls.fence += 1;
          return { ok: true };
        },
        freeze: frozen,
        unlock() {
          calls.unlock += 1;
        },
        normalizeComments: () => commentSession.comments,
      },
      handoff: {
        async copy(input) {
          calls.handoff.push(input);
          return copy(input);
        },
      },
      hash: { sha256: async (value) => sha256(value) },
    },
    scheduler,
    clock: { now: () => Date.parse("2026-08-11T00:00:00.000Z") },
  });
  return {
    workflow,
    projectSession,
    documentSession,
    commentSession,
    versionSession,
    runSession,
    scheduler,
    calls,
    client,
    context,
  };
}

test("submit freezes the exact source, creates one Request, and confirms handoff without renderer HTML", async () => {
  const harness = createHarness();

  const outcome = await harness.workflow.submit({ projectName: "landing.html" });

  assert.equal(outcome.status, "succeeded");
  assert.equal(harness.calls.fence, 1);
  assert.equal(harness.calls.createRequest.length, 1);
  assert.equal(harness.calls.handoff.length, 1);
  assert.equal(harness.runSession.activeRun?.requestId, "request_a");
  assert.equal(harness.runSession.activeHandoff?.status, "copied");
  const request = harness.calls.createRequest[0];
  assert.equal(request.expectedSourceSha256, sha256(HTML_A));
  assert.equal(request.projectName, "landing");
  assert.equal("html" in request, false);
  assert.equal("baseHtml" in request, false);
  assert.equal("projection" in request, false);

  const duplicate = await harness.workflow.submit({ projectName: "landing.html" });
  assert.equal(duplicate.status, "blocked");
  assert.equal(harness.calls.createRequest.length, 1);
});

test("an unknown create Request response only reads workspace authority and never replays POST", async () => {
  const durable = runRecord();
  let createCount = 0;
  const harness = createHarness({
    bridge: {
      async createRequest() {
        createCount += 1;
        throw new Error("network disconnected after dispatch");
      },
      async workspace(sourcePath) {
        return { runtimeState: { activeRun: { ...durable, sourcePath } } };
      },
    },
  });

  const outcome = await harness.workflow.submit();

  assert.equal(outcome.status, "succeeded");
  assert.equal(createCount, 1);
  assert.equal(harness.runSession.activeRun?.requestId, "request_a");
  assert.equal(harness.runSession.activeSubmission, null);
});

test("a malformed create Request response reconciles authority without replaying POST", async () => {
  const durable = runRecord();
  let createCount = 0;
  let workspaceCount = 0;
  const harness = createHarness({
    bridge: {
      async createRequest() {
        createCount += 1;
        return {
          activeRun: {
            requestId: "response-without-project-identity",
            sourcePath: SOURCE_A,
          },
        };
      },
      async workspace(sourcePath) {
        workspaceCount += 1;
        return { runtimeState: { activeRun: { ...durable, sourcePath } } };
      },
    },
  });

  const outcome = await harness.workflow.submit();

  assert.equal(outcome.status, "succeeded");
  assert.equal(createCount, 1);
  assert.equal(workspaceCount, 1);
  assert.equal(harness.runSession.activeRun?.requestId, "request_a");
  assert.equal(harness.runSession.activeSubmission, null);
});

test("a verified no-run reconciliation unlocks without replaying an unknown POST", async () => {
  let createCount = 0;
  const harness = createHarness({
    bridge: {
      async createRequest() {
        createCount += 1;
        throw new Error("response lost");
      },
      async workspace() {
        return {};
      },
    },
  });

  const outcome = await harness.workflow.submit();

  assert.equal(outcome.status, "unknown");
  assert.equal(createCount, 1);
  assert.equal(harness.runSession.activeRun, null);
  assert.equal(harness.runSession.activeSubmission, null);
  assert.equal(harness.calls.unlock, 1);
});

test("a failed authority read keeps the Request uncertain until a later read recovers it", async () => {
  const laterAuthority = deferred();
  let createCount = 0;
  let workspaceCount = 0;
  const harness = createHarness({
    bridge: {
      async createRequest() {
        createCount += 1;
        throw new Error("POST response lost");
      },
      async workspace(sourcePath) {
        workspaceCount += 1;
        if (workspaceCount === 1) throw new Error("workspace temporarily unavailable");
        return laterAuthority.promise.then((payload) => ({
          runtimeState: { activeRun: { ...payload, sourcePath } },
        }));
      },
    },
  });

  const submitted = await harness.workflow.submit();
  assert.equal(submitted.status, "unknown");
  assert.equal(createCount, 1);
  assert.equal(harness.runSession.activeSubmission?.phase, "uncertain");

  laterAuthority.resolve(runRecord());
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(createCount, 1);
  assert.equal(harness.runSession.activeRun?.requestId, "request_a");
  assert.equal(harness.runSession.activeSubmission, null);
});

test("clipboard failure retains the durable Request and a retry copies without another Request POST", async () => {
  let copyAttempts = 0;
  const harness = createHarness({
    copy: async () => {
      copyAttempts += 1;
      if (copyAttempts === 1) throw new Error("clipboard readback mismatch");
      return { status: "copied", copied: true };
    },
  });

  const submitted = await harness.workflow.submit();
  assert.equal(submitted.status, "succeeded");
  assert.equal(harness.runSession.activeHandoff?.status, "failed");
  assert.equal(harness.calls.createRequest.length, 1);

  const retried = await harness.workflow.copyHandoff();
  assert.equal(retried.status, "succeeded");
  assert.equal(harness.runSession.activeHandoff?.status, "copied");
  assert.equal(harness.calls.createRequest.length, 1);
});

test("a terminal no-change poll unlocks the current project and remains reopenable", async () => {
  const harness = createHarness({
    bridge: {
      async status() {
        return {
          status: "no-change",
          completionObserved: true,
          candidateVersionId: "version_002",
        };
      },
    },
  });
  const run = runRecord();
  harness.runSession.trackRun(run, { activate: "always" });

  const outcome = await harness.workflow.pollNow();

  assert.equal(outcome.status, "succeeded");
  assert.equal(harness.runSession.runForSource(SOURCE_A), null);
  assert.equal(harness.runSession.activeRun?.status, "no-change");
  assert.equal(harness.runSession.outcomeForSource(SOURCE_A)?.status, "no-change");
  assert.equal(harness.calls.unlock, 1);
});

test("parallel polling keeps projects isolated and rejects a late result after its run is removed", async () => {
  const delayedA = deferred();
  const harness = createHarness({
    bridge: {
      async status(sourcePath) {
        if (sourcePath === SOURCE_A) return delayedA.promise;
        return { status: "ready", versionId: "version_b" };
      },
    },
  });
  const runA = runRecord({ sourcePath: SOURCE_A, requestId: "request_a" });
  const runB = runRecord({ sourcePath: SOURCE_B, requestId: "request_b" });
  harness.runSession.trackRun(runA, { activate: "always" });
  harness.runSession.trackRun(runB, { activate: "never" });

  const polling = harness.workflow.pollNow();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.runSession.runForSource(SOURCE_B)?.status, "ready-to-open");
  assert.equal(harness.runSession.activeRun?.requestId, "request_a");

  harness.runSession.removeRun(runA);
  delayedA.resolve({ status: "ready", versionId: "version_a" });
  await polling;

  assert.equal(harness.runSession.runForSource(SOURCE_A), null);
  assert.equal(harness.runSession.runForSource(SOURCE_B)?.requestId, "request_b");
});

test("disposing the owned scheduler fences a late timer callback", async () => {
  const harness = createHarness();
  harness.runSession.trackRun(runRecord(), { activate: "always" });
  harness.workflow.syncPolling();
  const [timer] = harness.scheduler.ids();
  assert.ok(timer);
  const statusBeforeDispose = harness.calls.status.length;
  harness.workflow.dispose();
  harness.scheduler.fire(timer);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.calls.status.length, statusBeforeDispose);
});

test("cancel and conflict commands keep their scoped identities and do not alter another project", async () => {
  const resolveCalls = [];
  const harness = createHarness({
    bridge: {
      async resolveConflict(request) {
        resolveCalls.push(request);
        return {
          activeRun: runRecord({
            sourcePath: request.sourcePath,
            requestId: request.requestId,
            attemptId: request.attemptId,
            status: "committing",
          }),
        };
      },
    },
  });
  const conflict = runRecord({ status: "awaiting-conflict-resolution", conflictId: "conflict_a" });
  const background = runRecord({ sourcePath: SOURCE_B, requestId: "request_b" });
  harness.runSession.trackRun(conflict, { activate: "always" });
  harness.runSession.trackRun(background, { activate: "never" });

  const resolved = await harness.workflow.resolveConflict({ action: "adopt-ai" });
  assert.equal(resolved.status, "succeeded");
  assert.deepEqual(resolveCalls[0], {
    projectId: "project_a",
    documentId: "document_a",
    sourcePath: SOURCE_A,
    requestId: "request_a",
    attemptId: "attempt_001",
    conflictId: "conflict_a",
    action: "adopt-ai",
  });
  assert.equal(harness.runSession.runForSource(SOURCE_B)?.requestId, "request_b");

  const cancelled = await harness.workflow.cancel({ run: background });
  assert.equal(cancelled.status, "succeeded");
  assert.equal(harness.runSession.runForSource(SOURCE_B), null);
  assert.equal(harness.runSession.activeRun?.requestId, "request_a");
  assert.equal(harness.calls.cancel[0].sourcePath, SOURCE_B);
});
