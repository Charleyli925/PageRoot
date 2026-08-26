import assert from "node:assert/strict";
import test from "node:test";

import {
  AgentCatalogState,
  CODEX_AGENT_PROVIDER,
  QODER_AGENT_PROVIDER,
  defaultAgentProviders,
} from "../app/application/agent-provider-catalog.js";
import {
  agentPreflightKey,
  freezeAgentSelection,
} from "../app/domain/agent-provider-state.js";

const TRUST = "trusted-local-agent-v1";

test("the source-owned hard gate exposes Codex through the shared Agent chooser", () => {
  assert.deepEqual(
    defaultAgentProviders().map(({ providerId }) => providerId),
    ["qoder", "codex"],
  );
  assert.deepEqual(
    defaultAgentProviders({ codexExecution: false }).map(({ providerId }) => providerId),
    ["qoder"],
  );
  assert.equal(
    CODEX_AGENT_PROVIDER.presentation.localReadDisclosure,
    "Codex 修改时可能读取这台 Mac 上的本机文件。",
  );
});

function selection(providerId, {
  modelId = null,
  reasoning = null,
  installationDigest = null,
} = {}) {
  return freezeAgentSelection({
    providerId,
    runtimeId: "synthetic-runtime",
    requestedModelId: modelId && `${providerId}:${modelId}`,
    resolvedModelId: modelId && `${providerId}:${modelId}`,
    reasoning: reasoning
      ? { requested: reasoning, applied: reasoning, resolution: "exact" }
      : { requested: null, applied: null, resolution: "provider-default" },
    ...(installationDigest ? { installationDigest } : {}),
  });
}

function provider(providerId, selected = selection(providerId)) {
  return Object.freeze({
    providerId,
    runtimeId: selected.runtimeId,
    securityProfile: "client-mediated",
    trustPolicyVersion: TRUST,
    selection: selected,
    presentation: Object.freeze({ displayName: providerId }),
    failureReason: () => "service-unavailable",
  });
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test("two providers keep separate in-flight preflights and one-use tickets", async () => {
  const starts = [];
  const bridgeClient = {
    preflightAgent(body) {
      const pending = deferred();
      starts.push({ body, pending });
      return pending.promise;
    },
  };
  const first = selection("first");
  const second = selection("second");
  const catalog = new AgentCatalogState({
    bridgeClient,
    providers: [provider("first", first), provider("second", second)],
    selected: first,
    clock: { now: () => 10 },
  });

  const firstPromise = catalog.preflight(first, { purpose: "execution" });
  catalog.select(second);
  const secondPromise = catalog.preflight(second, { purpose: "execution" });
  assert.notEqual(firstPromise, secondPromise);
  assert.equal(starts.length, 2);

  starts[1].pending.resolve({
    status: "ready",
    preflightId: "ticket_second",
    selection: second,
    expiresAt: new Date(20_000).toISOString(),
  });
  assert.equal((await secondPromise).preflightId, "ticket_second");
  starts[0].pending.reject(Object.assign(new Error("first failed"), { code: "FAIL" }));
  await assert.rejects(firstPromise, /first failed/u);
  assert.equal(catalog.availability(first).status, "unavailable");
  assert.equal(catalog.availability(second).status, "ready");

  const spent = await catalog.spendTicket(second, { purpose: "execution" });
  assert.equal(spent.preflightId, "ticket_second");
  assert.deepEqual(catalog.getSnapshot().preflightBySelection, {});
});

test("model, reasoning, installation, trust and purpose are all preflight key authority", () => {
  const base = selection("first");
  const variants = [
    selection("first", { modelId: "model-a" }),
    selection("first", { reasoning: "high" }),
  ];
  const baseKey = agentPreflightKey(base, {
    installationDigest: "sha256:one",
    trustPolicyVersion: TRUST,
    purpose: "execution",
  });
  for (const variant of variants) {
    assert.notEqual(agentPreflightKey(variant, {
      installationDigest: "sha256:one",
      trustPolicyVersion: TRUST,
      purpose: "execution",
    }), baseKey);
  }
  assert.notEqual(agentPreflightKey(base, {
    installationDigest: "sha256:two",
    trustPolicyVersion: TRUST,
    purpose: "execution",
  }), baseKey);
  assert.notEqual(agentPreflightKey(base, {
    installationDigest: "sha256:one",
    trustPolicyVersion: "trusted-local-agent-v2",
    purpose: "execution",
  }), baseKey);
});

test("same provider model and purpose share only their exact in-flight promise", async () => {
  const pending = deferred();
  let calls = 0;
  const first = selection("first", { modelId: "model-a", reasoning: "high" });
  const catalog = new AgentCatalogState({
    bridgeClient: {
      preflightAgent() {
        calls += 1;
        return pending.promise;
      },
    },
    providers: [provider("first", first)],
    selected: first,
    clock: { now: () => 10 },
  });
  const left = catalog.preflight(first, { purpose: "execution" });
  const right = catalog.preflight(first, { purpose: "execution" });
  assert.equal(left, right);
  assert.equal(calls, 1);
  pending.resolve({
    status: "ready",
    preflightId: "ticket_execution",
    selection: first,
    expiresAt: new Date(20_000).toISOString(),
  });
  await left;

  const execution = catalog.preflight(first, { purpose: "execution", force: true });
  assert.notEqual(execution, left);
  assert.equal(calls, 2);
});

test("concurrent consumers cannot spend the same preflight ticket twice", async () => {
  const pending = deferred();
  const first = selection("first");
  const catalog = new AgentCatalogState({
    bridgeClient: { preflightAgent: () => pending.promise },
    providers: [provider("first", first)],
    selected: first,
    clock: { now: () => 10 },
  });
  const left = catalog.spendTicket(first, { purpose: "execution" });
  const right = catalog.spendTicket(first, { purpose: "execution" });
  pending.resolve({
    status: "ready",
    preflightId: "ticket_single_use",
    selection: first,
    expiresAt: new Date(20_000).toISOString(),
  });
  const results = await Promise.allSettled([left, right]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const rejected = results.find((result) => result.status === "rejected");
  assert.equal(rejected?.reason?.code, "AGENT_PREFLIGHT_TICKET_SPENT");
});

test("late availability and mismatched preflight results cannot replace newer authority", async () => {
  const oldAvailability = deferred();
  const newAvailability = deferred();
  const availabilityCalls = [oldAvailability, newAvailability];
  const first = selection("first");
  const catalog = new AgentCatalogState({
    bridgeClient: {
      preflightAgent: async () => ({
        status: "ready",
        preflightId: "ticket_wrong",
        selection: selection("first", { modelId: "wrong" }),
        expiresAt: new Date(20_000).toISOString(),
      }),
      qoderAvailability() {
        return availabilityCalls.shift().promise;
      },
    },
    providers: [provider("first", first)],
    selected: first,
    clock: { now: () => 10 },
  });
  const oldRefresh = catalog.refreshAvailability(first);
  const newRefresh = catalog.refreshAvailability(first);
  newAvailability.resolve({ status: "not-installed" });
  await newRefresh;
  oldAvailability.resolve({ status: "ready" });
  assert.equal(await oldRefresh, null);
  assert.equal(catalog.availability(first).status, "not-installed");
  const mismatch = catalog.preflight(first);
  await assert.rejects(mismatch, (error) => error?.code === "AGENT_PREFLIGHT_SELECTION_MISMATCH");
});

test("descriptor runtime and security profile stay part of dispatch authority", async () => {
  assert.equal(QODER_AGENT_PROVIDER.securityProfile, "client-mediated");
  const first = selection("first");
  const catalog = new AgentCatalogState({
    bridgeClient: {
      async preflightAgent() {
        return {
          status: "ready",
          preflightId: "ticket_wrong_security",
          selection: first,
          securityProfile: "agent-native",
          expiresAt: new Date(20_000).toISOString(),
        };
      },
    },
    providers: [provider("first", first)],
    selected: first,
    clock: { now: () => 10 },
  });
  assert.throws(
    () => catalog.select({ ...first, runtimeId: "other-runtime" }),
    (error) => error?.code === "AGENT_RUNTIME_UNSUPPORTED",
  );
  await assert.rejects(
    catalog.preflight(first),
    (error) => error?.code === "AGENT_SECURITY_PROFILE_MISMATCH",
  );
});

test("a provider-resolved default model becomes the selected durable execution authority", async () => {
  const requested = freezeAgentSelection({
    providerId: "codex",
    runtimeId: "app-server",
    requestedModelId: null,
    resolvedModelId: null,
    reasoning: { requested: null, applied: null, resolution: "provider-default" },
  });
  const resolved = freezeAgentSelection({
    ...requested,
    resolvedModelId: "codex:gpt-synthetic",
  });
  const codex = Object.freeze({
    ...provider("codex", requested),
    runtimeId: "app-server",
    securityProfile: "agent-native",
    selection: requested,
  });
  const catalog = new AgentCatalogState({
    bridgeClient: {
      async preflightAgent() {
        return {
          status: "ready",
          preflightId: "ticket_codex_default",
          selection: resolved,
          securityProfile: "agent-native",
          expiresAt: new Date(20_000).toISOString(),
        };
      },
    },
    providers: [codex],
    selected: requested,
    clock: { now: () => 10 },
  });
  const preflight = await catalog.preflight(requested);
  assert.deepEqual(preflight.selection, resolved);
  assert.deepEqual(catalog.freezeSelected(), resolved);
});

test("a resolved default model stays pinned during later preflight", async () => {
  const pinned = freezeAgentSelection({
    providerId: "codex",
    runtimeId: "app-server",
    requestedModelId: null,
    resolvedModelId: "codex:model-a",
    reasoning: { requested: null, applied: null, resolution: "provider-default" },
  });
  const changed = freezeAgentSelection({
    ...pinned,
    resolvedModelId: "codex:model-b",
  });
  const codex = Object.freeze({
    ...provider("codex", pinned),
    runtimeId: "app-server",
    securityProfile: "agent-native",
    selection: pinned,
  });
  const catalog = new AgentCatalogState({
    bridgeClient: {
      async preflightAgent() {
        return {
          status: "ready",
          preflightId: "ticket_changed_default",
          selection: changed,
          securityProfile: "agent-native",
          expiresAt: new Date(20_000).toISOString(),
        };
      },
    },
    providers: [codex],
    selected: pinned,
    clock: { now: () => 10 },
  });

  await assert.rejects(
    catalog.preflight(pinned),
    (error) => error?.code === "AGENT_PREFLIGHT_SELECTION_MISMATCH",
  );
  assert.deepEqual(catalog.freezeSelected(), pinned);
});
