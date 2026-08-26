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

function registry({ run, verifyTicket, preflight } = {}) {
  const capabilities = Object.freeze({
    availability: true,
    preflight: true,
    execution: true,
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
    preflightForSelection: preflight || (async (received) => {
      if (received?.providerId !== selection.providerId) throw new Error("selection mismatch");
      return prepared(null);
    }),
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
    failureMessageForSelection(received, code) {
      this.resolveSelection(received);
      return `failure:${code}`;
    },
    preflightFailureMessageForSelection(received, code) {
      this.resolveSelection(received);
      return `preflight:${code}`;
    },
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

test("preflight rejects removed purposes and execution tickets are one-use, TTL-bound, and reverified", async () => {
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
  await assert.rejects(
    ready(coordinator, "discussion"),
    (error) => error?.code === "AGENT_TICKET_PURPOSE_INVALID",
  );
  const singleUse = await ready(coordinator);
  await coordinator.redeemCommandTicket(singleUse.preflightId, {
    purpose: "execution",
    driver: "synthetic-driver",
  });
  await assert.rejects(
    coordinator.redeemCommandTicket(singleUse.preflightId, { purpose: "execution" }),
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

test("shutdown drains an in-flight provider preflight before confirming exit", async () => {
  let releasePreflight;
  let markPreflightStarted;
  const preflightGate = new Promise((resolve) => { releasePreflight = resolve; });
  const preflightStarted = new Promise((resolve) => { markPreflightStarted = resolve; });
  const coordinator = new AgentRuntimeCoordinator({
    providerRegistry: registry({
      preflight: async (selection) => {
        markPreflightStarted();
        await preflightGate;
        return {
          providerId: selection.providerId,
          runtimeId: selection.runtimeId,
          securityProfile: "client-mediated",
          installation: Object.freeze({ generation: 1 }),
          installationDigest: `sha256:${"a".repeat(64)}`,
          capabilities: Object.freeze({ execution: true }),
          evidence: Object.freeze({ version: "1.0.0", modelCount: 1, models: [] }),
          selection,
        };
      },
    }),
    cancelTimeoutMs: 500,
  });
  const preflight = ready(coordinator);
  await preflightStarted;
  const shutdown = coordinator.shutdown();
  releasePreflight();
  await assert.rejects(preflight, (error) => error?.code === "AGENT_BRIDGE_DISPOSED");
  await shutdown;
});

test("an unknown historical provider stays readable but cannot become start authority", () => {
  const coordinator = new AgentRuntimeCoordinator({ providerRegistry: registry() });
  const selection = {
    providerId: "future-provider",
    runtimeId: "future-runtime",
    requestedModelId: null,
    resolvedModelId: null,
    reasoning: { requested: null, applied: null, resolution: "provider-default" },
  };
  const interrupted = coordinator.interrupted(IDENTITY, { selection });
  assert.equal(interrupted.driver, "future-provider");
  assert.equal(interrupted.state, "interrupted");
  assert.equal(interrupted.errorCode, "AGENT_RESTART_RECOVERY_REQUIRED");
  assert.match(interrupted.errorMessage, /无法恢复此 Agent 会话/u);
  assert.throws(
    () => coordinator.assertSelection(selection, "execution"),
    (error) => error?.code === "AGENT_PROVIDER_UNSUPPORTED",
  );
});
