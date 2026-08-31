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
import {
  INITIAL_QODER_AVAILABILITY,
  qoderAvailabilityFromLocalResult,
  qoderAvailabilityPresentation,
} from "../app/domain/qoder-availability.js";

const SOURCE_A = "/tmp/run-workflow-a.html";
const SOURCE_B = "/tmp/run-workflow-b.html";
const ACTIVATED_SOURCE = "/tmp/run-workflow-a-activated.html";
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

function operationKey(run) {
  return `${run.sourcePath}\n${run.requestId}\n${run.attemptId}`;
}

function createScheduler() {
  let nextId = 0;
  const callbacks = new Map();
  return {
    setTimeout(callback, delayMs) {
      const id = ++nextId;
      callbacks.set(id, { callback, delayMs });
      return id;
    },
    clearTimeout(id) {
      callbacks.delete(id);
    },
    ids() {
      return [...callbacks.keys()];
    },
    fire(id) {
      const timer = callbacks.get(id);
      callbacks.delete(id);
      timer?.callback();
    },
    delay(id) {
      return callbacks.get(id)?.delayMs;
    },
  };
}

function createVisibility(initialState = "visible") {
  let visibilityState = initialState;
  const listeners = new Set();
  return {
    get visibilityState() {
      return visibilityState;
    },
    addEventListener(type, listener) {
      if (type === "visibilitychange") listeners.add(listener);
    },
    removeEventListener(type, listener) {
      if (type === "visibilitychange") listeners.delete(listener);
    },
    set(nextState) {
      visibilityState = nextState;
      for (const listener of listeners) listener();
    },
  };
}

async function fireNextTimer(scheduler) {
  const [timer] = scheduler.ids();
  assert.ok(timer, "expected the polling loop to own a next timer");
  scheduler.fire(timer);
  await new Promise((resolve) => setImmediate(resolve));
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
    operationKey,
    errorMessage: (cause, fallback) => String(cause?.message || fallback),
  };
}

function createHarness({
  sourcePath = SOURCE_A,
  html = HTML_A,
  comments = null,
  bridge = {},
  copy = async () => ({ status: "copied", copied: true }),
  freeze = null,
  drain = async () => ({ ok: true }),
  ensureRegistered = null,
  visibility = null,
  clock = { now: () => Date.parse("2026-08-11T00:00:00.000Z") },
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
  commentSession.setComments(comments || [{
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
    availability: [],
    preflight: [],
    startAgent: [],
    handoff: [],
    unlock: 0,
    fence: 0,
    freeze: 0,
  };
  const client = {
    async createRequest(request) {
      calls.createRequest.push(request);
      return { activeRun: runRecord({ sourcePath, agentDelivery: request.agentDelivery }) };
    },
    async workspace(nextSourcePath) {
      calls.workspace.push(nextSourcePath);
      return {};
    },
    async status(nextSourcePath, requestId, attemptId) {
      calls.status.push([nextSourcePath, requestId, attemptId]);
      return { status: "processing" };
    },
    async qoderAvailability() {
      calls.availability.push(true);
      return { status: "ready" };
    },
    async preflightAgent(request) {
      calls.preflight.push(request);
      return {
        status: "ready",
        preflightId: "preflight_test",
        expiresAt: "2026-08-11T00:02:00.000Z",
      };
    },
    async startAgent(request) {
      calls.startAgent.push(request);
      return {
        accepted: true,
        session: { state: "starting", phase: "launching" },
      };
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
    ensureRegistered: async (input) => ensureRegistered
      ? ensureRegistered(input, context)
      : succeeded(context),
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
        freeze(...args) {
          calls.freeze += 1;
          return frozen(...args);
        },
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
    visibility,
    clock,
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
  assert.equal("instructions" in request, false);

  const duplicate = await harness.workflow.submit({ projectName: "landing.html" });
  assert.equal(duplicate.status, "blocked");
  assert.equal(harness.calls.createRequest.length, 1);
});

test("submit refreshes a unique text quote against the final saved HTML before creating the Request", async () => {
  const elementId = "pr1_11111111111141118111111111111111";
  const originalHtml = `<!doctype html><html><body><p data-pageroot-id="${elementId}">目标内容</p></body></html>`;
  const finalHtml = `<!doctype html><html><body><p data-pageroot-id="${elementId}">新目标内容</p></body></html>`;
  const harness = createHarness({
    html: finalHtml,
    comments: [{
      commentId: "comment_001",
      text: "请检查选中文字",
      target: {
        id: "target_001",
        elementId,
        selector: "p",
        resolution: "exact",
        sourceAnchor: { sourceSha256: sha256(originalHtml) },
        textLocator: {
          quote: "目标",
          startOffset: 0,
          endOffset: 2,
          affinity: "forward",
        },
      },
      attachments: [],
    }],
  });

  const outcome = await harness.workflow.submit();

  assert.equal(outcome.status, "succeeded");
  assert.equal(harness.calls.createRequest.length, 1);
  assert.deepEqual(
    harness.calls.createRequest[0].comments[0].target.textLocator,
    {
      quote: "目标",
      startOffset: 1,
      endOffset: 3,
      affinity: "forward",
    },
  );
});

test("submit blocks a stale or ambiguous text quote without creating a Request", async () => {
  const elementId = "pr1_11111111111141118111111111111111";
  const originalHtml = `<!doctype html><html><body><p data-pageroot-id="${elementId}">目标内容</p></body></html>`;
  for (const finalText of ["已改写", "新目标和目标", "目标在别的元素"]) {
    const finalHtml = finalText === "目标在别的元素"
      ? `<!doctype html><html><body><p data-pageroot-id="${elementId}">已删除</p><aside>目标</aside></body></html>`
      : `<!doctype html><html><body><p data-pageroot-id="${elementId}">${finalText}</p></body></html>`;
    const harness = createHarness({
      html: finalHtml,
      comments: [{
        commentId: "comment_001",
        text: "请检查选中文字",
        target: {
          id: "target_001",
          elementId,
          selector: "p",
          resolution: "exact",
          sourceAnchor: { sourceSha256: sha256(originalHtml) },
          textLocator: {
            quote: "目标",
            startOffset: 0,
            endOffset: 2,
            affinity: "forward",
          },
        },
      }],
    });

    const outcome = await harness.workflow.submit();

    assert.equal(outcome.status, "rejected", finalText);
    assert.equal(outcome.code, "RUN_SUBMISSION_TEXT_LOCATOR_STALE", finalText);
    assert.match(outcome.reason, /重新选择文字/u, finalText);
    assert.equal(harness.calls.createRequest.length, 0, finalText);
  }
});

test("submission planning is side-effect free and derives current comment authority", () => {
  const harness = createHarness();

  const ready = harness.workflow.planSubmission();
  assert.deepEqual(ready, { kind: "ready" });
  assert.equal(Object.isFrozen(ready), true);
  assert.equal(harness.calls.fence, 0);
  assert.equal(harness.calls.freeze, 0);
  assert.equal(harness.calls.createRequest.length, 0);

  harness.commentSession.update({
    composerTarget: { id: "target_draft" },
    composerDraft: "unsaved",
  });
  assert.equal(
    harness.workflow.planSubmission().code,
    "RUN_SUBMISSION_COMMENT_DRAFT",
  );
  harness.commentSession.update({
    composerTarget: null,
    composerDraft: "",
    editSession: { commentId: "comment_001", dirty: true },
  });
  assert.equal(
    harness.workflow.planSubmission().code,
    "RUN_SUBMISSION_COMMENT_EDIT",
  );
  assert.equal(harness.calls.fence, 0);
  assert.equal(harness.calls.createRequest.length, 0);
  harness.workflow.dispose();
});

test("submit keeps its frozen context and revalidates after the drain await", async () => {
  const drainEntered = deferred();
  const drainResult = deferred();
  const harness = createHarness({
    drain: async () => {
      drainEntered.resolve();
      return drainResult.promise;
    },
  });
  const events = [];
  harness.workflow.subscribeEvents((event) => events.push(event));

  const submitted = harness.workflow.submit();
  await drainEntered.promise;
  harness.projectSession.openLocator(SOURCE_B);
  harness.projectSession.register({
    epoch: harness.projectSession.epoch,
    sourcePath: SOURCE_B,
    projectId: "project_b",
    documentId: "document_b",
  });
  drainResult.resolve({ ok: true });

  const outcome = await submitted;
  assert.equal(outcome.status, "rejected");
  assert.equal(outcome.code, "RUN_SUBMISSION_CONTEXT_STALE");
  assert.equal(harness.calls.createRequest.length, 0);
  assert.equal(
    events.find((event) => event.type === "run-submission-started")?.context.sourcePath,
    SOURCE_A,
  );
  assert.equal(harness.projectSession.sourcePath, SOURCE_B);
  harness.workflow.dispose();
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

test("a reconciled Qoder Request reserves Agent start before polling becomes visible", async () => {
  const start = deferred();
  const durable = runRecord({
    agentDelivery: {
      mode: "managed-agent",
      selection: {
        providerId: "qoder",
        runtimeId: "acp",
        requestedModelId: null,
        resolvedModelId: null,
        reasoning: { requested: null, applied: null, resolution: "provider-default" },
      },
      trustPolicyVersion: "trusted-local-agent-v1",
    },
  });
  let createCount = 0;
  let workspaceCount = 0;
  let harness;
  harness = createHarness({
    bridge: {
      async createRequest() {
        createCount += 1;
        throw new Error("network disconnected after the durable POST");
      },
      async workspace(sourcePath) {
        workspaceCount += 1;
        return { runtimeState: { activeRun: { ...durable, sourcePath } } };
      },
      async startAgent(request) {
        harness.calls.startAgent.push(request);
        return start.promise;
      },
    },
  });

  const submitted = harness.workflow.submit({ deliveryMode: "qoder-acp" });
  for (let index = 0; index < 10 && harness.calls.startAgent.length === 0; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(createCount, 1);
  assert.equal(workspaceCount, 1);
  assert.equal(harness.calls.startAgent.length, 1);
  assert.equal(
    harness.calls.status.length,
    0,
    "reconciliation publication must not poll before the recovered Request starts its Agent",
  );

  start.resolve({
    accepted: true,
    session: { state: "starting", phase: "launching" },
  });
  assert.equal((await submitted).status, "succeeded");
  await fireNextTimer(harness.scheduler);
  assert.equal(harness.calls.status.length, 1);
  harness.workflow.dispose();
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

  await fireNextTimer(harness.scheduler);
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

test("Qoder ACP preflights before one durable Request and never touches the clipboard", async () => {
  const harness = createHarness();
  const outcome = await harness.workflow.submit({ deliveryMode: "qoder-acp" });

  assert.equal(outcome.status, "succeeded");
  assert.equal(harness.calls.preflight.length, 1);
  assert.equal(harness.calls.createRequest.length, 1);
  assert.deepEqual(harness.calls.createRequest[0].agentDelivery, {
    mode: "managed-agent",
    selection: {
      providerId: "qoder",
      runtimeId: "acp",
      requestedModelId: null,
      resolvedModelId: null,
      reasoning: {
        requested: null,
        applied: null,
        resolution: "provider-default",
      },
    },
    trustPolicyVersion: "trusted-local-agent-v1",
  });
  assert.equal(harness.calls.startAgent.length, 1);
  assert.equal(harness.calls.startAgent[0].preflightId, "preflight_test");
  assert.equal(harness.calls.handoff.length, 0);
  assert.equal(harness.runSession.activeHandoff.mode, "managed-agent");
  assert.equal(harness.runSession.activeHandoff.status, "starting");
  harness.workflow.dispose();
});

test("provider-resolved default model is frozen into the durable Request and runtime start", async () => {
  let harness;
  harness = createHarness({
    bridge: {
      async preflightAgent(request) {
        harness.calls.preflight.push(request);
        return {
          status: "ready",
          preflightId: "preflight_resolved_default",
          selection: {
            ...request.selection,
            resolvedModelId: "qoder:resolved-default",
          },
          expiresAt: "2026-08-11T00:02:00.000Z",
        };
      },
    },
  });

  const outcome = await harness.workflow.submit({ deliveryMode: "managed-agent" });

  assert.equal(outcome.status, "succeeded");
  assert.equal(
    harness.calls.createRequest[0].agentDelivery.selection.resolvedModelId,
    "qoder:resolved-default",
  );
  assert.deepEqual(
    harness.calls.startAgent[0].selection,
    harness.calls.createRequest[0].agentDelivery.selection,
  );
  harness.workflow.dispose();
});

test("a selection changed during preflight affects only the next Request", async () => {
  const nextSelection = Object.freeze({
    providerId: "qoder",
    runtimeId: "acp",
    requestedModelId: "qoder:next-model",
    resolvedModelId: "qoder:next-model",
    reasoning: Object.freeze({ requested: "high", applied: "high", resolution: "exact" }),
  });
  let harness;
  harness = createHarness({
    bridge: {
      async preflightAgent(request) {
        harness.calls.preflight.push(request);
        harness.workflow.selectAgent(nextSelection);
        return {
          status: "ready",
          preflightId: "preflight_frozen_selection",
          selection: request.selection,
          expiresAt: "2026-08-11T00:02:00.000Z",
        };
      },
    },
  });

  const outcome = await harness.workflow.submit({ deliveryMode: "managed-agent" });
  assert.equal(outcome.status, "succeeded");
  const frozen = harness.calls.preflight[0].selection;
  assert.deepEqual(harness.calls.createRequest[0].agentDelivery.selection, frozen);
  assert.deepEqual(harness.calls.startAgent[0].selection, frozen);
  assert.notDeepEqual(frozen, nextSelection);
  assert.deepEqual(harness.workflow.freezeAgentSelection(), nextSelection);
  harness.workflow.dispose();
});

test("local Qoder refresh changes only shared availability state", async () => {
  const harness = createHarness({
    bridge: {
      async qoderAvailability() {
        harness.calls.availability.push(true);
        return { status: "not-installed" };
      },
    },
  });

  const outcome = await harness.workflow.refreshQoderAvailability();

  assert.equal(outcome.status, "succeeded");
  assert.equal(harness.workflow.getSnapshot().qoderAvailability.status, "not-installed");
  assert.equal(harness.calls.availability.length, 1);
  assert.equal(harness.calls.preflight.length, 0);
  assert.equal(harness.calls.createRequest.length, 0);
  assert.equal(harness.calls.fence, 0);
  assert.equal(harness.calls.freeze, 0);
  assert.equal(harness.calls.unlock, 0);
  assert.equal(harness.calls.handoff.length, 0);
  harness.workflow.dispose();
});

test("local Qoder discovery never creates a green state without a real preflight", async () => {
  const deferredPreflight = deferred();
  const harness = createHarness({
    bridge: {
      async qoderAvailability() {
        harness.calls.availability.push(true);
        return { status: "ready" };
      },
      async preflightAgent(request) {
        harness.calls.preflight.push(request);
        return deferredPreflight.promise;
      },
    },
  });
  const localOnly = qoderAvailabilityFromLocalResult(
    { status: "ready" },
    INITIAL_QODER_AVAILABILITY,
    "2026-08-11T00:00:00.000Z",
  );
  assert.notEqual(localOnly.status, "ready");

  const refreshing = harness.workflow.refreshQoderAvailability();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.calls.preflight.length, 1);
  assert.equal(harness.workflow.getSnapshot().qoderAvailability.status, "checking");
  deferredPreflight.resolve({
    status: "ready",
    preflightId: "preflight_after_local",
    expiresAt: "2026-08-11T00:02:00.000Z",
  });
  const outcome = await refreshing;
  assert.equal(outcome.status, "succeeded");
  assert.equal(harness.workflow.getSnapshot().qoderAvailability.status, "ready");
  harness.workflow.dispose();
});

test("a Settings usability check does not authorize a later Qoder submission", async () => {
  const harness = createHarness();

  const checked = await harness.workflow.checkQoderUsability();
  assert.equal(checked.status, "succeeded");
  assert.equal(harness.calls.preflight.length, 1);
  assert.equal(harness.calls.createRequest.length, 0);
  assert.equal(harness.workflow.getSnapshot().qoderAvailability.status, "ready");
  assert.equal(harness.calls.fence, 0);
  assert.equal(harness.calls.freeze, 0);
  assert.equal(harness.calls.unlock, 0);

  const submitted = await harness.workflow.submit({ deliveryMode: "qoder-acp" });
  assert.equal(submitted.status, "succeeded");
  assert.equal(harness.calls.preflight.length, 2);
  assert.equal(harness.calls.startAgent[0].preflightId, "preflight_test");
  harness.workflow.dispose();
});

test("Settings keeps checking and guiding Qoder while Codex is selected", async () => {
  const harness = createHarness();
  const codex = harness.workflow.getSnapshot().agentCatalog.providers.codex.selection;
  harness.workflow.selectAgent(codex);

  const checked = await harness.workflow.checkQoderUsability();
  assert.equal(checked.status, "succeeded");
  assert.equal(harness.calls.preflight.at(-1).selection.providerId, "qoder");
  assert.equal(harness.workflow.freezeAgentSelection().providerId, "codex");
  assert.equal(
    harness.workflow.getSnapshot().agentCatalog.providers.qoder.availability.status,
    "ready",
  );

  const copied = await harness.workflow.copyQoderGuidance({ kind: "install" });
  assert.equal(copied.status, "succeeded");
  assert.equal(harness.calls.handoff.at(-1).purpose, "qoder-install-guidance");
  assert.equal(harness.workflow.freezeAgentSelection().providerId, "codex");
  harness.workflow.dispose();
});

test("Settings rechecks the resolved current Qoder selection", async () => {
  const authError = Object.assign(new Error("Qoder CLI 尚未登录。"), {
    code: "QODER_AUTH_REQUIRED",
  });
  let preflightCount = 0;
  let harness;
  harness = createHarness({
    bridge: {
      async preflightAgent(request) {
        harness.calls.preflight.push(request);
        preflightCount += 1;
        if (preflightCount > 1) throw authError;
        return {
          status: "ready",
          preflightId: "preflight_resolved_qoder",
          selection: {
            ...request.selection,
            resolvedModelId: "qoder:qoder-default",
          },
          expiresAt: "2026-08-11T00:02:00.000Z",
        };
      },
    },
  });

  const first = await harness.workflow.checkQoderUsability();
  assert.equal(first.status, "succeeded");
  assert.equal(
    harness.workflow.freezeAgentSelection().resolvedModelId,
    "qoder:qoder-default",
  );

  const refreshed = await harness.workflow.refreshQoderAvailability();
  assert.equal(refreshed.status, "rejected");
  assert.equal(
    harness.calls.preflight.at(-1).selection.resolvedModelId,
    "qoder:qoder-default",
  );
  assert.equal(harness.workflow.getSnapshot().qoderAvailability.status, "auth-required");
  harness.workflow.dispose();
});

test("Qoder guidance copy is isolated from Request and Canvas authority", async () => {
  const harness = createHarness();

  const copied = await harness.workflow.copyQoderGuidance({ kind: "install" });

  assert.equal(copied.status, "succeeded");
  assert.equal(harness.calls.handoff.length, 1);
  assert.equal(harness.calls.handoff[0].run, null);
  assert.equal(harness.calls.handoff[0].purpose, "qoder-install-guidance");
  assert.match(harness.calls.handoff[0].message, /@qoder-ai\/qodercli@latest/u);
  assert.equal(harness.calls.handoff[0].message.includes(SOURCE_A), false);
  assert.equal(harness.calls.createRequest.length, 0);
  assert.equal(harness.calls.freeze, 0);
  assert.equal(
    harness.workflow.getSnapshot().qoderAvailability.guidanceCopied,
    "install",
  );
  harness.workflow.dispose();
});

test("one-click Qoder install refreshes availability and only then preflights", async () => {
  const installCalls = [];
  const harness = createHarness({
    bridge: {
      async installAgent(request) {
        installCalls.push(request);
        return { ok: true, providerId: "qoder", installSource: "managed" };
      },
      async qoderAvailability() {
        return { status: "ready" };
      },
    },
  });
  const installed = await harness.workflow.installQoder();
  assert.equal(installed.status, "succeeded");
  assert.deepEqual(installCalls, [{ providerId: "qoder" }]);
  assert.equal(harness.calls.preflight.length, 1);
  assert.equal(harness.calls.handoff.length, 0);
  assert.equal(harness.calls.createRequest.length, 0);
  assert.equal(harness.workflow.getSnapshot().qoderAvailability.status, "ready");
  const codex = harness.workflow.getSnapshot().agentCatalog.providers.codex.selection;
  const alsoInstalled = await harness.workflow.installAgent(codex);
  assert.equal(alsoInstalled.status, "succeeded");
  harness.workflow.dispose();
});

test("a successful use-time check retires the one-time install continuation marker", async () => {
  const harness = createHarness();

  await harness.workflow.copyQoderGuidance({ kind: "install" });
  assert.equal(
    harness.workflow.getSnapshot().qoderAvailability.guidanceCopied,
    "install",
  );

  const checked = await harness.workflow.checkQoderUsability();

  assert.equal(checked.status, "succeeded");
  assert.equal(harness.workflow.getSnapshot().qoderAvailability.status, "ready");
  assert.equal(harness.workflow.getSnapshot().qoderAvailability.guidanceCopied, null);
  assert.equal(harness.calls.createRequest.length, 0);
  assert.equal(harness.calls.freeze, 0);
  harness.workflow.dispose();
});

test("a local disk refresh preserves a known authentication requirement", async () => {
  const authError = Object.assign(new Error("Qoder CLI 尚未登录。"), {
    code: "QODER_AUTH_REQUIRED",
  });
  const harness = createHarness({
    bridge: {
      async preflightAgent() {
        throw authError;
      },
    },
  });

  const checked = await harness.workflow.checkQoderUsability();
  assert.equal(checked.status, "rejected");
  assert.equal(harness.workflow.getSnapshot().qoderAvailability.status, "auth-required");

  const refreshed = await harness.workflow.refreshQoderAvailability();
  assert.equal(refreshed.status, "rejected");
  assert.equal(harness.workflow.getSnapshot().qoderAvailability.status, "auth-required");
  assert.equal(harness.calls.createRequest.length, 0);
  assert.equal(harness.calls.freeze, 0);
  harness.workflow.dispose();
});

test("a changed Qoder installation asks for a PageRoot restart in shared state", async () => {
  const mismatch = Object.assign(new Error("version changed"), {
    code: "QODER_VERSION_MISMATCH",
  });
  const harness = createHarness({
    bridge: {
      async preflightAgent() {
        throw mismatch;
      },
    },
  });

  const checked = await harness.workflow.checkQoderUsability();

  assert.equal(checked.status, "rejected");
  assert.equal(harness.workflow.getSnapshot().qoderAvailability.status, "unavailable");
  assert.equal(
    harness.workflow.getSnapshot().qoderAvailability.reason,
    "restart-required",
  );
  assert.equal(harness.calls.createRequest.length, 0);
  harness.workflow.dispose();
});

test("Qoder polling waits until the managed Agent start is registered", async () => {
  const start = deferred();
  let harness;
  harness = createHarness({
    bridge: {
      async startAgent(request) {
        harness.calls.startAgent.push(request);
        return start.promise;
      },
    },
  });

  const submitted = harness.workflow.submit({ deliveryMode: "qoder-acp" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.calls.createRequest.length, 1);
  assert.equal(harness.calls.startAgent.length, 1);
  assert.equal(
    harness.calls.status.length,
    0,
    "a pre-start status read would falsely classify the new Request as an interrupted old session",
  );

  start.resolve({
    accepted: true,
    session: { state: "starting", phase: "launching" },
  });
  assert.equal((await submitted).status, "succeeded");
  await fireNextTimer(harness.scheduler);
  assert.equal(harness.calls.status.length, 1);
  harness.workflow.dispose();
});

test("a failed Qoder preflight creates no Request and leaves editing recoverable", async () => {
  const message = "Qoder 账号当前没有可用模型容量。PageRoot 尚未创建本轮 Request；当前 HTML 和评论保持不变，可稍后重试或改用复制任务。";
  const error = new Error(message);
  error.code = "QODER_CAPACITY_UNAVAILABLE";
  const harness = createHarness({
    bridge: {
      async preflightAgent() {
        throw error;
      },
    },
  });
  const outcome = await harness.workflow.submit({ deliveryMode: "qoder-acp" });

  assert.equal(outcome.status, "rejected");
  assert.equal(outcome.code, "QODER_CAPACITY_UNAVAILABLE");
  assert.equal(outcome.reason, message);
  assert.equal(outcome.reason.includes("Request 已保留"), false);
  assert.equal(harness.calls.createRequest.length, 0);
  assert.equal(harness.calls.startAgent.length, 0);
  assert.equal(harness.calls.handoff.length, 0);
  assert.equal(harness.runSession.activeRun, null);
  assert.equal(harness.runSession.submissionPending, false);
  assert.equal(harness.calls.freeze, 0);
  assert.equal(harness.calls.unlock, 0);
  assert.equal(harness.workflow.getSnapshot().qoderAvailability.status, "unavailable");
  assert.equal(
    harness.workflow.getSnapshot().qoderAvailability.reason,
    "account-capacity",
  );
  harness.workflow.dispose();
});

test("capacity and timeout preflight failures keep truthful recovery reasons", async () => {
  for (const [code, reason, statusLabel] of [
    ["QODER_ACCOUNT_CAPACITY_UNAVAILABLE", "account-capacity", "暂不可用 · Qoder 额度已用完"],
    ["QODER_PREFLIGHT_TIMEOUT", "timeout", "暂不可用 · 连接超时"],
  ]) {
    const error = Object.assign(new Error(code), { code });
    const harness = createHarness({
      bridge: {
        async preflightAgent() {
          throw error;
        },
      },
    });
    const outcome = await harness.workflow.checkQoderUsability();
    assert.equal(outcome.status, "rejected");
    const availability = harness.workflow.getSnapshot().qoderAvailability;
    assert.equal(availability.reason, reason);
    assert.equal(qoderAvailabilityPresentation(availability).statusLabel, statusLabel);
    assert.equal(harness.calls.createRequest.length, 0);
    assert.equal(harness.calls.freeze, 0);
    assert.equal(harness.calls.fence, 0);
    assert.equal(harness.calls.unlock, 0);
    harness.workflow.dispose();
  }
});

test("concurrent automatic Qoder checks share one preflight promise", async () => {
  const preflight = deferred();
  const harness = createHarness({
    bridge: {
      async preflightAgent(request) {
        harness.calls.preflight.push(request);
        return preflight.promise;
      },
    },
  });
  const first = harness.workflow.checkQoderUsability();
  const second = harness.workflow.checkQoderUsability();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.calls.preflight.length, 1);
  preflight.resolve({
    status: "ready",
    preflightId: "preflight_shared",
    expiresAt: "2026-08-11T00:02:00.000Z",
  });
  assert.equal((await first).status, "succeeded");
  assert.equal((await second).status, "succeeded");
  assert.equal(harness.calls.createRequest.length, 0);
  harness.workflow.dispose();
});

test("a recovery-required Qoder Request cannot restart or fall back to clipboard", async () => {
  const harness = createHarness();
  const run = runRecord({ agentDelivery: { mode: "qoder-acp" } });
  harness.runSession.trackRun(run, { activate: "always", recovered: true });
  harness.runSession.publishHandoff({
    ...run,
    mode: "qoder-acp",
    status: "interrupted",
    retryable: false,
    errorCode: "AGENT_RESTART_RECOVERY_REQUIRED",
  });

  const restarted = await harness.workflow.startAgent({ run });
  const copied = await harness.workflow.copyHandoff({ run });

  assert.equal(restarted.status, "blocked");
  assert.equal(restarted.code, "RUN_AGENT_RECOVERY_REQUIRED");
  assert.equal(copied.status, "blocked");
  assert.equal(copied.code, "RUN_AGENT_RECOVERY_REQUIRED");
  assert.equal(harness.calls.preflight.length, 0);
  assert.equal(harness.calls.startAgent.length, 0);
  assert.equal(harness.calls.handoff.length, 0);
  harness.workflow.dispose();
});

test("an unknown durable provider can end but cannot restart or fall back", async () => {
  const harness = createHarness();
  const run = runRecord({
    agentDelivery: {
      mode: "managed-agent",
      selection: {
        providerId: "future-agent",
        runtimeId: "future-runtime",
        requestedModelId: "future-agent:model-a",
        resolvedModelId: "future-agent:model-a",
        reasoning: { requested: null, applied: null, resolution: "provider-default" },
      },
      trustPolicyVersion: "trusted-local-agent-v1",
    },
  });
  harness.runSession.trackRun(run, { activate: "always", recovered: true });

  const restarted = await harness.workflow.startAgent({ run });
  const copied = await harness.workflow.copyHandoff({ run });
  const ended = await harness.workflow.cancel({ run });

  assert.equal(restarted.status, "blocked");
  assert.equal(restarted.code, "RUN_AGENT_RECOVERY_REQUIRED");
  assert.equal(copied.status, "blocked");
  assert.equal(copied.code, "RUN_AGENT_PROVIDER_UNAVAILABLE");
  assert.equal(ended.status, "succeeded");
  assert.equal(harness.calls.preflight.length, 0);
  assert.equal(harness.calls.startAgent.length, 0);
  assert.equal(harness.calls.handoff.length, 0);
  harness.workflow.dispose();
});

test("Qoder output residue is projected as non-retryable", async () => {
  const error = new Error("safe residue recovery copy");
  error.code = "AGENT_RETRY_OUTPUT_PRESENT";
  const harness = createHarness({
    bridge: {
      async startAgent(request) {
        harness.calls.startAgent.push(request);
        throw error;
      },
    },
  });

  await harness.workflow.submit({ deliveryMode: "qoder-acp" });

  assert.equal(harness.runSession.activeHandoff?.status, "failed");
  assert.equal(harness.runSession.activeHandoff?.retryable, false);
  assert.equal((await harness.workflow.copyHandoff()).code, "RUN_AGENT_RECOVERY_REQUIRED");
  assert.equal(harness.calls.handoff.length, 0);
  harness.workflow.dispose();
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

test("recursive polling is single-flight and speeds up only after public Agent text arrives", async () => {
  const pendingStatus = deferred();
  let statusCalls = 0;
  const harness = createHarness({
    bridge: {
      async status() {
        statusCalls += 1;
        return pendingStatus.promise;
      },
    },
  });
  const run = runRecord({
    agentDelivery: {
      mode: "managed-agent",
      selection: harness.workflow.getSnapshot().agentCatalog.providers.codex.selection,
      trustPolicyVersion: "trusted-local-agent-v1",
    },
  });
  harness.runSession.trackRun(run, { activate: "always" });

  harness.workflow.syncPolling();
  const [initialTimer] = harness.scheduler.ids();
  assert.equal(harness.scheduler.delay(initialTimer), 0);
  harness.scheduler.fire(initialTimer);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(statusCalls, 1);
  assert.deepEqual(
    harness.scheduler.ids(),
    [],
    "the next pass is not scheduled until the in-flight status read settles",
  );
  assert.equal(harness.workflow.getSnapshot().polling, true);

  pendingStatus.resolve({
    status: "processing",
    agentSession: {
      providerId: "codex",
      runtimeId: "acp",
      state: "running",
      phase: "reading-task",
      agentName: "runtime-internal-name",
      visibleText: "正在读取冻结任务。",
      visibleTextUpdates: [{
        id: "message-read",
        sequence: 3,
        text: "正在读取冻结任务。",
      }],
      updatedAt: "2026-08-11T00:00:00.000Z",
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  const [nextTimer] = harness.scheduler.ids();
  assert.equal(harness.scheduler.delay(nextTimer), 250);
  assert.equal(harness.runSession.activeHandoff?.visibleText, "正在读取冻结任务。");
  assert.deepEqual(harness.runSession.activeHandoff?.visibleTextUpdates, [{
    id: "message-read",
    sequence: 3,
    text: "正在读取冻结任务。",
  }]);
  assert.equal(harness.runSession.activeHandoff?.providerId, "codex");
  assert.equal(harness.runSession.activeHandoff?.agentName, "Codex");
  harness.workflow.dispose();
});

test("visibility changes reschedule the owned polling timer without creating another loop", () => {
  const visibility = createVisibility();
  const harness = createHarness({ visibility });
  harness.runSession.trackRun(runRecord(), { activate: "always" });

  harness.workflow.syncPolling();
  const [visibleTimer] = harness.scheduler.ids();
  assert.equal(harness.scheduler.delay(visibleTimer), 0);
  visibility.set("hidden");
  const [hiddenTimer] = harness.scheduler.ids();
  assert.notEqual(hiddenTimer, visibleTimer);
  assert.equal(harness.scheduler.delay(hiddenTimer), 1_400);
  assert.equal(harness.scheduler.ids().length, 1);
  harness.workflow.dispose();
});

test("an automatic terminal poll stops its recursive loop", async () => {
  const harness = createHarness({
    bridge: {
      async status() {
        return { status: "no-change", completionObserved: true };
      },
    },
  });
  harness.runSession.trackRun(runRecord(), { activate: "always" });

  harness.workflow.syncPolling();
  await fireNextTimer(harness.scheduler);
  assert.equal(harness.workflow.getSnapshot().polling, false);
  assert.deepEqual(harness.scheduler.ids(), []);
  assert.equal(harness.runSession.activeRun?.status, "no-change");
  harness.workflow.dispose();
});

test("a transient status failure preserves the last public Agent narration", async () => {
  let statusReads = 0;
  const harness = createHarness({
    bridge: {
      async status() {
        statusReads += 1;
        if (statusReads === 1) {
          return {
            status: "processing",
            agentSession: {
              state: "running",
              phase: "writing-candidate",
              visibleText: "正在写入 Candidate。",
              textTruncated: false,
            },
          };
        }
        throw new Error("temporary bridge error");
      },
    },
  });
  harness.runSession.trackRun(runRecord(), { activate: "always" });

  await harness.workflow.pollNow();
  await harness.workflow.pollNow();
  assert.equal(statusReads, 2);
  assert.equal(harness.runSession.activeHandoff?.visibleText, "正在写入 Candidate。");
  assert.equal(harness.runSession.activeHandoff?.status, "running");
  harness.workflow.dispose();
});

test("polling does not start a ready-run status read while activation owns it", async () => {
  let statusCalls = 0;
  const harness = createHarness({
    bridge: {
      async status() {
        statusCalls += 1;
        return { status: "version-created", sourcePath: ACTIVATED_SOURCE };
      },
    },
  });
  const run = runRecord({ status: "ready-to-open", completionObserved: true });
  harness.runSession.trackRun(run, { activate: "always" });
  const activationKey = operationKey(run);
  assert.equal(harness.runSession.beginOperation("activate", activationKey), true);

  await harness.workflow.pollNow();

  assert.equal(statusCalls, 0);
  assert.equal(harness.runSession.runForSource(SOURCE_A)?.sourcePath, SOURCE_A);
  assert.equal(harness.runSession.runForSource(ACTIVATED_SOURCE), null);
  harness.runSession.endOperation("activate", activationKey);
  harness.workflow.dispose();
});

test("polling discards a ready-run status response that overlaps activation", async () => {
  const pendingStatus = deferred();
  let statusCalls = 0;
  const harness = createHarness({
    bridge: {
      async status() {
        statusCalls += 1;
        return pendingStatus.promise;
      },
    },
  });
  const run = runRecord({ status: "ready-to-open", completionObserved: true });
  harness.runSession.trackRun(run, { activate: "always" });

  const polling = harness.workflow.pollNow();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(statusCalls, 1);
  const activationKey = operationKey(run);
  assert.equal(harness.runSession.beginOperation("activate", activationKey), true);
  pendingStatus.resolve({
    status: "version-created",
    sourcePath: ACTIVATED_SOURCE,
    versionId: "version_002",
  });

  await polling;

  assert.equal(harness.runSession.runForSource(SOURCE_A)?.sourcePath, SOURCE_A);
  assert.equal(harness.runSession.runForSource(ACTIVATED_SOURCE), null);
  assert.equal(harness.runSession.activeRun?.sourcePath, SOURCE_A);
  harness.runSession.endOperation("activate", activationKey);
  harness.workflow.dispose();
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

test("a late cancel result cannot unlock or clear a reopened project generation", async () => {
  const cancellation = deferred();
  const harness = createHarness({
    bridge: {
      async cancelActiveRun() {
        return cancellation.promise;
      },
    },
  });
  const run = runRecord();
  const events = [];
  harness.workflow.subscribeEvents((event) => events.push(event));
  harness.runSession.trackRun(run, { activate: "always" });

  const cancelling = harness.workflow.cancel({ run });
  await new Promise((resolve) => setImmediate(resolve));

  harness.projectSession.openLocator(SOURCE_B);
  harness.projectSession.register({
    epoch: harness.projectSession.epoch,
    sourcePath: SOURCE_B,
    projectId: "project_b",
    documentId: "document_b",
  });
  harness.projectSession.openLocator(SOURCE_A);
  const reopened = harness.projectSession.register({
    epoch: harness.projectSession.epoch,
    sourcePath: SOURCE_A,
    projectId: "project_a",
    documentId: "document_a",
  });
  assert.notEqual(reopened.epoch, harness.context.epoch);
  const newerRun = runRecord({
    requestId: "request_reopened",
    attemptId: "attempt_002",
  });
  harness.runSession.trackRun(newerRun, { activate: "always" });
  harness.runSession.publishHandoff({
    sourcePath: SOURCE_A,
    requestId: newerRun.requestId,
    attemptId: newerRun.attemptId,
    status: "copied",
  });

  cancellation.resolve({});
  const outcome = await cancelling;

  assert.equal(outcome.status, "succeeded");
  assert.equal(outcome.value.current, false);
  assert.equal(harness.runSession.activeRun?.requestId, newerRun.requestId);
  assert.equal(harness.runSession.runForSource(SOURCE_A)?.requestId, newerRun.requestId);
  assert.equal(harness.runSession.handoffForSource(SOURCE_A)?.requestId, newerRun.requestId);
  assert.equal(harness.calls.unlock, 0);
  const event = events.find((entry) => entry.type === "run-cancelled");
  assert.equal(event?.current, false);
});

test("a late keep-external result cannot reload a reopened project generation", async () => {
  const resolution = deferred();
  const harness = createHarness({
    bridge: {
      async resolveConflict() {
        return resolution.promise;
      },
    },
  });
  const conflict = runRecord({
    status: "awaiting-conflict-resolution",
    conflictId: "conflict_a",
  });
  const events = [];
  harness.workflow.subscribeEvents((event) => events.push(event));
  harness.runSession.trackRun(conflict, { activate: "always" });

  const resolving = harness.workflow.resolveConflict({
    run: conflict,
    action: "keep-external",
  });
  await new Promise((resolve) => setImmediate(resolve));

  harness.projectSession.openLocator(SOURCE_B);
  harness.projectSession.register({
    epoch: harness.projectSession.epoch,
    sourcePath: SOURCE_B,
    projectId: "project_b",
    documentId: "document_b",
  });
  harness.projectSession.openLocator(SOURCE_A);
  const reopened = harness.projectSession.register({
    epoch: harness.projectSession.epoch,
    sourcePath: SOURCE_A,
    projectId: "project_a",
    documentId: "document_a",
  });
  assert.notEqual(reopened.epoch, harness.context.epoch);

  resolution.resolve({});
  const outcome = await resolving;

  assert.equal(outcome.status, "succeeded");
  assert.equal(outcome.value.current, false);
  assert.equal(outcome.value.reloadCurrentSource, false);
  assert.equal(harness.calls.unlock, 0);
  const event = events.find((entry) => entry.type === "run-conflict-resolved");
  assert.equal(event?.current, false);
  assert.equal(event?.reloadCurrentSource, false);
});
