import assert from "node:assert/strict";
import test from "node:test";

import { createAgentEventReducer } from "../scripts/agent/agent-events.mjs";
import {
  AgentRuntimeCoordinator,
  TRUSTED_LOCAL_AGENT_POLICY_VERSION,
} from "../scripts/agent/agent-runtime-coordinator.mjs";

const IDENTITY = Object.freeze({
  projectId: `project_${"a".repeat(16)}`,
  documentId: `doc_${"b".repeat(16)}`,
  requestId: "req_runtime_contract",
  attemptId: "attempt_001",
  sourcePath: "/tmp/runtime-contract.html",
});

function registry({ run, verifyTicket } = {}) {
  const capabilities = Object.freeze({
    availability: true,
    preflight: true,
    execution: true,
    discussion: true,
    modelCatalog: true,
  });
  const selection = Object.freeze({
    providerId: "synthetic-provider",
    runtimeId: "synthetic-runtime",
    requestedModelId: null,
    resolvedModelId: null,
    reasoning: Object.freeze({
      requested: null,
      applied: null,
      resolution: "provider-default",
    }),
  });
  const prepared = (driver) => Object.freeze({
    ...(driver ? { driver } : {}),
    providerId: "synthetic-provider",
    runtimeId: "synthetic-runtime",
    securityProfile: "client-mediated",
    installation: Object.freeze({ generation: 1 }),
    installationDigest: `sha256:${"a".repeat(64)}`,
    capabilities,
    evidence: Object.freeze({ version: "1.0.0", modelCount: 1, models: [] }),
    selection,
  });
  return {
    resolveDriver(driver) {
      if (driver !== "synthetic-driver") throw Object.assign(new Error("unsupported"), {
        code: "AGENT_DRIVER_UNSUPPORTED",
      });
      return {};
    },
    selectionFromDriver(driver) {
      this.resolveDriver(driver);
      return selection;
    },
    resolveSelection(received) {
      if (received?.providerId !== selection.providerId
        || received?.runtimeId !== selection.runtimeId) {
        throw Object.assign(new Error("unsupported"), { code: "AGENT_PROVIDER_UNSUPPORTED" });
      }
      return {};
    },
    assertCapabilityForSelection(received) {
      this.resolveSelection(received);
      return true;
    },
    availabilityForSelection: async () => ({ status: "ready" }),
    preflightForSelection: async (received) => {
      if (received?.providerId !== selection.providerId) throw new Error("selection mismatch");
      return prepared(null);
    },
    availability: async () => ({ status: "ready" }),
    preflight: async ({ driver }) => prepared(driver),
    verifyTicket: verifyTicket || (async (ticket) => ticket),
    loadExecutionPolicy: async (_ticket, input) => ({
      ...input,
      manifestPath: "/tmp/manifest.json",
      finalizer: { command: "/bin/false", args: [], cwd: "/tmp", env: {} },
    }),
    run: run || (async () => {}),
    classifyRunFailure: (_ticket, cause) => cause?.code || "AGENT_RUN_FAILED",
    failureMessage: (_ticket, code) => `failure:${code}`,
    failureMessageForDriver: (_driver, code) => `failure:${code}`,
    preflightFailureMessageForDriver: (_driver, code) => `preflight:${code}`,
    failureMessageForSelection: (_selection, code) => `failure:${code}`,
    preflightFailureMessageForSelection: (_selection, code) => `preflight:${code}`,
    createTurnRunner: () => async () => ({ stopReason: "end_turn" }),
  };
}

function executionAuthority() {
  return {
    run: {
      ...IDENTITY,
      status: "processing",
      requestPath: `/tmp/project/.pageroot/requests/${IDENTITY.requestId}`,
      promptPath: "/tmp/prompt.md",
      outputPath: "/tmp/output.html",
      completionPath: "/tmp/completion.json",
    },
    request: {
      request: {
        agentDelivery: {
          mode: "managed-agent",
          selection: {
            providerId: "synthetic-provider",
            runtimeId: "synthetic-runtime",
            requestedModelId: null,
            resolvedModelId: null,
            reasoning: {
              requested: null,
              applied: null,
              resolution: "provider-default",
            },
          },
          trustPolicyVersion: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
        },
      },
    },
  };
}

async function ready(coordinator, purpose = "execution") {
  return coordinator.preflight({
    driver: "synthetic-driver",
    purpose,
    trustPolicyAccepted: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
  });
}

test("preflight tickets are purpose-bound, one-use, TTL-bound, and reverify installation", async () => {
  let now = 1_000;
  let drifted = false;
  const coordinator = new AgentRuntimeCoordinator({
    clock: { now: () => now },
    providerRegistry: registry({
      verifyTicket: async (ticket) => {
        if (drifted) throw Object.assign(new Error("installation drift"), {
          code: "AGENT_COMMAND_CHANGED",
        });
        return ticket;
      },
    }),
  });
  const discussion = await ready(coordinator, "discussion");
  await assert.rejects(
    coordinator.redeemCommandTicket(discussion.preflightId, {
      purpose: "execution",
      driver: "synthetic-driver",
    }),
    (error) => error?.code === "AGENT_PREFLIGHT_PURPOSE_MISMATCH",
  );
  await assert.rejects(
    coordinator.redeemCommandTicket(discussion.preflightId, { purpose: "discussion" }),
    (error) => error?.code === "AGENT_PREFLIGHT_EXPIRED",
  );

  const expired = await ready(coordinator);
  now += 2 * 60_000;
  await assert.rejects(
    coordinator.redeemCommandTicket(expired.preflightId),
    (error) => error?.code === "AGENT_PREFLIGHT_EXPIRED",
  );

  const changed = await ready(coordinator);
  drifted = true;
  await assert.rejects(
    coordinator.redeemCommandTicket(changed.preflightId),
    (error) => error?.code === "AGENT_COMMAND_CHANGED",
  );
  await coordinator.shutdown();
});

test("release false keeps the lease fence and blocks shutdown", async () => {
  const coordinator = new AgentRuntimeCoordinator({
    providerRegistry: registry(),
    resolveTask: async () => executionAuthority(),
    leaseStore: {
      acquire: async ({ ownerToken }) => ({ key: "lease", path: "memory", ownerToken }),
      release: async () => false,
    },
    cancelTimeoutMs: 50,
  });
  const ticket = await ready(coordinator);
  await coordinator.submit({
    ...IDENTITY,
    driver: "synthetic-driver",
    trustPolicyAccepted: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
    preflightId: ticket.preflightId,
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(coordinator.executionStatus(IDENTITY).errorCode, "AGENT_RESTART_RECOVERY_REQUIRED");
  await assert.rejects(
    coordinator.shutdown(),
    (error) => error?.code === "AGENT_SHUTDOWN_UNCONFIRMED",
  );
});

test("durable cancellation is never written after cleanup or lease release fails", async () => {
  let durableWrites = 0;
  const coordinator = new AgentRuntimeCoordinator({
    providerRegistry: registry({
      run: async ({ cancellationSignal }) => new Promise((_resolve, reject) => {
        cancellationSignal.addEventListener("abort", () => reject(Object.assign(
          new Error("cancelled"),
          { code: "AGENT_CANCELLED" },
        )), { once: true });
      }),
    }),
    resolveTask: async () => executionAuthority(),
    leaseStore: {
      acquire: async ({ ownerToken }) => ({ key: "lease", path: "memory", ownerToken }),
      release: async () => false,
    },
    cancelTimeoutMs: 50,
  });
  const ticket = await ready(coordinator);
  await coordinator.submit({
    ...IDENTITY,
    driver: "synthetic-driver",
    trustPolicyAccepted: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
    preflightId: ticket.preflightId,
  });
  await assert.rejects(
    coordinator.cancelDurableExecution({
      identity: IDENTITY,
      cancelRequest: async () => { durableWrites += 1; },
    }),
    (error) => error?.code === "AGENT_CANCEL_UNCONFIRMED",
  );
  assert.equal(durableWrites, 0);
});

test("canonical events reject reorder and duplicates while preserving bounded terminal evidence", () => {
  const reducer = createAgentEventReducer({ maxEvents: 2, maxTextLength: 5 });
  const accept = (eventId, sequence, kind, text, timestamp = sequence) => reducer.accept({
    eventId,
    turnId: "turn_contract",
    sequence,
    timestamp,
    kind,
    ...(text ? { text } : {}),
  });
  assert.equal(accept("one", 1, "visible-text", "abcdef").accepted, true);
  assert.equal(accept("one", 2, "completion").reason, "duplicate");
  assert.equal(accept("late", 0, "session-update").reason, "late");
  accept("two", 2, "session-update");
  const completed = accept("three", 3, "completion");
  assert.equal(completed.projection.visibleText, "abcde");
  assert.equal(completed.projection.textTruncated, true);
  assert.ok(completed.projection.retainedEvents.some((event) => event.kind === "completion"));
});

test("discussion ticket failure seals the already-recorded question", async () => {
  const sealed = [];
  const coordinator = new AgentRuntimeCoordinator({
    providerRegistry: registry(),
    redeemCommandTicket: async () => {
      throw Object.assign(new Error("spent elsewhere"), { code: "AGENT_PREFLIGHT_EXPIRED" });
    },
  });
  coordinator.configureDiscussion({
    readWorkingCopy: async () => ({
      target: {
        projectId: IDENTITY.projectId,
        documentId: IDENTITY.documentId,
        projectRootPath: "/tmp/project",
      },
      sourceSha256: `sha256:${"c".repeat(64)}`,
      content: "<!doctype html><html></html>",
    }),
    recordQuestion: async () => ({ conversationId: "conversation_recorded" }),
    sealReply: async (input) => { sealed.push(input); },
  });
  await assert.rejects(
    coordinator.discussionStart({
      driver: "synthetic-driver",
      trustPolicyAccepted: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
      preflightId: "preflight_missing",
      projectId: IDENTITY.projectId,
      documentId: IDENTITY.documentId,
      sourcePath: IDENTITY.sourcePath,
      conversationId: "conversation_1",
      question: "Explain this page",
    }),
    (error) => error?.code === "AGENT_PREFLIGHT_EXPIRED",
  );
  assert.equal(sealed.length, 1);
  assert.equal(sealed[0].status, "failed");
  await coordinator.shutdown();
});

test("a start racing shutdown fails closed before recording or spawning", async () => {
  let releaseRead;
  let readStarted;
  const readGate = new Promise((resolve) => { releaseRead = resolve; });
  const startedReading = new Promise((resolve) => { readStarted = resolve; });
  let records = 0;
  const coordinator = new AgentRuntimeCoordinator({ providerRegistry: registry() });
  coordinator.configureDiscussion({
    readWorkingCopy: async () => {
      readStarted();
      await readGate;
      return {
        target: {
          projectId: IDENTITY.projectId,
          documentId: IDENTITY.documentId,
          projectRootPath: "/tmp/project",
        },
        sourceSha256: `sha256:${"d".repeat(64)}`,
        content: "<!doctype html><html></html>",
      };
    },
    recordQuestion: async () => { records += 1; },
    sealReply: async () => {},
  });
  const start = coordinator.discussionStart({
    driver: "synthetic-driver",
    trustPolicyAccepted: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
    preflightId: "preflight_unused",
    projectId: IDENTITY.projectId,
    documentId: IDENTITY.documentId,
    sourcePath: IDENTITY.sourcePath,
    conversationId: "conversation_1",
    question: "Explain this page",
  });
  await startedReading;
  const shutdown = coordinator.shutdown();
  releaseRead();
  await assert.rejects(start, (error) => error?.code === "AGENT_BRIDGE_DISPOSED");
  await shutdown;
  assert.equal(records, 0);
});

test("shutdown drains a discussion start waiting on lease acquisition", async () => {
  for (const releaseResult of [true, false]) {
    let resolveAcquire;
    let acquireStarted;
    const acquireGate = new Promise((resolve) => { resolveAcquire = resolve; });
    const acquiring = new Promise((resolve) => { acquireStarted = resolve; });
    let releaseCalls = 0;
    let runCalls = 0;
    const coordinator = new AgentRuntimeCoordinator({
      providerRegistry: registry(),
      leaseStore: {
        acquire: async ({ ownerToken }) => {
          acquireStarted();
          await acquireGate;
          return { key: "discussion-lease", path: "memory", ownerToken };
        },
        release: async () => {
          releaseCalls += 1;
          return releaseResult;
        },
      },
      cancelTimeoutMs: 100,
    });
    coordinator.configureDiscussion({
      readWorkingCopy: async () => ({
        target: {
          projectId: IDENTITY.projectId,
          documentId: IDENTITY.documentId,
          projectRootPath: "/tmp/project",
        },
        sourceSha256: `sha256:${"e".repeat(64)}`,
        content: "<!doctype html><html></html>",
      }),
      recordQuestion: async () => ({ conversationId: "conversation_recorded" }),
      sealReply: async () => {},
      runDiscussion: async () => { runCalls += 1; },
      createTurnRunner: () => async () => {},
    });
    const ticket = await ready(coordinator, "discussion");
    const start = coordinator.discussionStart({
      driver: "synthetic-driver",
      trustPolicyAccepted: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
      preflightId: ticket.preflightId,
      projectId: IDENTITY.projectId,
      documentId: IDENTITY.documentId,
      sourcePath: IDENTITY.sourcePath,
      conversationId: "conversation_1",
      question: "Explain this page",
    });
    await acquiring;
    const shutdown = coordinator.shutdown();
    resolveAcquire();
    await assert.rejects(start, (error) => error?.code === "AGENT_BRIDGE_DISPOSED");
    if (releaseResult) await shutdown;
    else await assert.rejects(
      shutdown,
      (error) => error?.code === "AGENT_SHUTDOWN_UNCONFIRMED",
    );
    assert.equal(releaseCalls, 1);
    assert.equal(runCalls, 0);
  }
});

test("a synchronous discussion runner failure still seals and releases", async () => {
  const sealed = [];
  let releases = 0;
  const coordinator = new AgentRuntimeCoordinator({
    providerRegistry: registry(),
    leaseStore: {
      acquire: async ({ ownerToken }) => ({ key: "sync-throw", path: "memory", ownerToken }),
      release: async () => { releases += 1; return true; },
    },
  });
  coordinator.configureDiscussion({
    readWorkingCopy: async () => ({
      target: {
        projectId: IDENTITY.projectId,
        documentId: IDENTITY.documentId,
        projectRootPath: "/tmp/project",
      },
      sourceSha256: `sha256:${"f".repeat(64)}`,
      content: "<!doctype html><html></html>",
    }),
    recordQuestion: async () => ({ conversationId: "conversation_recorded" }),
    sealReply: async (input) => { sealed.push(input); },
    createTurnRunner: () => { throw Object.assign(new Error("sync failure"), {
      code: "DISCUSSION_RUNNER_FAILED",
    }); },
  });
  const ticket = await ready(coordinator, "discussion");
  await coordinator.discussionStart({
    driver: "synthetic-driver",
    trustPolicyAccepted: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
    preflightId: ticket.preflightId,
    projectId: IDENTITY.projectId,
    documentId: IDENTITY.documentId,
    sourcePath: IDENTITY.sourcePath,
    conversationId: "conversation_1",
    question: "Explain this page",
  });
  await coordinator.shutdown();
  assert.equal(sealed.length, 1);
  assert.equal(sealed[0].status, "failed");
  assert.equal(releases, 1);
});
