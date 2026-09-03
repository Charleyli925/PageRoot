import assert from "node:assert/strict";
import test from "node:test";

import {
  AgentCatalogState,
  CODEX_AGENT_PROVIDER,
  PAGEROOT_AGENT_PROVIDER,
  QODER_AGENT_PROVIDER,
  agentProviderCardsFromCatalog,
  defaultAgentProviders,
} from "../app/application/agent-provider-catalog.js";
import {
  agentPreflightKey,
  freezeAgentSelection,
} from "../app/domain/agent-provider-state.js";

const TRUST = "trusted-local-agent-v1";

test("the shared Agent chooser exposes 源页 Agent plus both ACP providers without unverified built-ins", () => {
  assert.deepEqual(
    defaultAgentProviders().map(({ providerId }) => providerId),
    ["pageroot", "qoder", "codex"],
  );
  assert.equal(PAGEROOT_AGENT_PROVIDER.runtimeId, "http");
  assert.equal(PAGEROOT_AGENT_PROVIDER.securityProfile, "client-mediated");
  assert.equal(PAGEROOT_AGENT_PROVIDER.installable, false);
  assert.equal(PAGEROOT_AGENT_PROVIDER.presentation.credentialKind, "api-token");
  assert.equal(PAGEROOT_AGENT_PROVIDER.presentation.logoSrc, "./brand-logo.png");
  assert.equal(PAGEROOT_AGENT_PROVIDER.presentation.supportsReasoning, true);
  assert.equal(PAGEROOT_AGENT_PROVIDER.presentation.reasoningChoices, undefined);
  assert.notEqual(QODER_AGENT_PROVIDER.presentation.supportsReasoning, true);
  assert.notEqual(CODEX_AGENT_PROVIDER.presentation.supportsReasoning, true);
  assert.deepEqual(
    PAGEROOT_AGENT_PROVIDER.presentation.vendors.map(({ id }) => id),
    ["custom"],
  );
  assert.equal(
    CODEX_AGENT_PROVIDER.presentation.localReadDisclosure,
    "Codex 修改时可能读取这台 Mac 上的本机文件。",
  );
  assert.equal(QODER_AGENT_PROVIDER.installable, true);
  assert.equal(CODEX_AGENT_PROVIDER.presentation.settingsSupported, true);
  assert.notEqual(CODEX_AGENT_PROVIDER.presentation.supportsApiKey, true);
  assert.equal(CODEX_AGENT_PROVIDER.runtimeId, "acp");
  assert.equal(CODEX_AGENT_PROVIDER.securityProfile, "client-mediated");
  assert.equal(
    agentProviderCardsFromCatalog({
      providers: {
        qoder: {
          ...QODER_AGENT_PROVIDER,
          availability: { status: "unavailable", reason: "account-capacity" },
        },
      },
    })[0].presentation.availability({ status: "unavailable", reason: "account-capacity" }).statusLabel,
    "连接失败",
  );
  assert.equal(PAGEROOT_AGENT_PROVIDER.failureReason("AGENT_BALANCE_INSUFFICIENT"), "account-capacity");
  assert.equal(PAGEROOT_AGENT_PROVIDER.failureReason("AGENT_MODEL_ACCESS_DENIED"), "model-unavailable");
  assert.equal(
    PAGEROOT_AGENT_PROVIDER.failureReason("AGENT_ENDPOINT_REGION_MISMATCH"),
    "endpoint-region-mismatch",
  );
  assert.equal(
    agentProviderCardsFromCatalog({
      providers: {
        pageroot: {
          ...PAGEROOT_AGENT_PROVIDER,
          availability: { status: "unavailable", reason: "endpoint-region-mismatch" },
        },
      },
    })[0].presentation.availability({
      status: "unavailable",
      reason: "endpoint-region-mismatch",
    }).statusLabel,
    "连接失败",
  );
});

test("Settings cards include every installable provider without provider-id branches", () => {
  const cards = agentProviderCardsFromCatalog({
    providers: {
      qoder: {
        ...QODER_AGENT_PROVIDER,
        availability: { status: "ready" },
      },
      blocked: {
        providerId: "blocked",
        installable: false,
        selection: selection("blocked"),
        presentation: { displayName: "Blocked" },
        availability: { status: "unavailable" },
      },
      codex: {
        ...CODEX_AGENT_PROVIDER,
        availability: { status: "not-installed" },
      },
    },
  });
  assert.deepEqual(cards.map((card) => card.selection.providerId), ["qoder", "codex"]);
  assert.equal(cards[1].presentation.actions.install.label, "安装 Codex");
});

test("provider cards use the resolved current selection only for the selected provider", () => {
  const qoderRequested = selection("qoder", { modelId: "requested" });
  const qoderResolved = freezeAgentSelection({
    ...qoderRequested,
    resolvedModelId: "qoder:resolved",
  });
  const qoder = {
    ...provider("qoder", qoderRequested),
    installable: true,
    availability: { status: "ready" },
  };
  const codex = {
    ...provider("codex"),
    presentation: CODEX_AGENT_PROVIDER.presentation,
    installable: true,
    availability: { status: "not-installed" },
  };
  const cards = agentProviderCardsFromCatalog({
    selected: qoderResolved,
    providers: { qoder, codex },
  });

  assert.deepEqual(cards.map((card) => card.selection), [qoderResolved, codex.selection]);
  assert.equal(cards[1].presentation.brandIcon, "openai");
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

test("switching away and back starts a fresh Provider preflight", async () => {
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

  const staleFirst = catalog.preflight(first, { purpose: "execution" });
  catalog.select(second);
  const secondCheck = catalog.preflight(second, { purpose: "execution" });
  catalog.select(first);
  const currentFirst = catalog.preflight(first, { purpose: "execution" });
  assert.equal(starts.length, 3);
  assert.notEqual(currentFirst, staleFirst);

  const staleResolvedFirst = freezeAgentSelection({
    ...first,
    resolvedModelId: "first:stale-default",
  });
  const currentResolvedFirst = freezeAgentSelection({
    ...first,
    resolvedModelId: "first:current-default",
  });

  starts[0].pending.resolve({
    status: "ready",
    preflightId: "ticket_stale_first",
    selection: staleResolvedFirst,
    expiresAt: new Date(20_000).toISOString(),
  });
  await staleFirst;
  assert.equal(catalog.availability(first).status, "checking");
  assert.equal(catalog.freezeSelected().resolvedModelId, null);
  assert.equal(
    Object.values(catalog.getSnapshot().preflightBySelection)
      .some((preflight) => preflight.preflightId === "ticket_stale_first"),
    false,
  );

  starts[2].pending.resolve({
    status: "ready",
    preflightId: "ticket_current_first",
    selection: currentResolvedFirst,
    expiresAt: new Date(20_000).toISOString(),
  });
  assert.equal((await currentFirst).preflightId, "ticket_current_first");
  assert.equal(catalog.freezeSelected().resolvedModelId, "first:current-default");
  assert.equal(catalog.availability(first).status, "ready");

  starts[1].pending.resolve({
    status: "ready",
    preflightId: "ticket_stale_second",
    selection: second,
    expiresAt: new Date(20_000).toISOString(),
  });
  await secondCheck;
  assert.equal(catalog.availability(first).status, "ready");
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
    runtimeId: "acp",
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
    runtimeId: "acp",
    securityProfile: "client-mediated",
    selection: requested,
  });
  const catalog = new AgentCatalogState({
    bridgeClient: {
      async preflightAgent() {
        return {
          status: "ready",
          preflightId: "ticket_codex_default",
          selection: resolved,
          securityProfile: "client-mediated",
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
    runtimeId: "acp",
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
    runtimeId: "acp",
    securityProfile: "client-mediated",
    selection: pinned,
  });
  const catalog = new AgentCatalogState({
    bridgeClient: {
      async preflightAgent() {
        return {
          status: "ready",
          preflightId: "ticket_changed_default",
          selection: changed,
          securityProfile: "client-mediated",
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

test("one-click install is gated to installable providers and then refreshes availability", async () => {
  const qoder = freezeAgentSelection(QODER_AGENT_PROVIDER.selection);
  const blocked = Object.freeze({
    ...provider("blocked"),
    installable: false,
  });
  const calls = [];
  const catalog = new AgentCatalogState({
    bridgeClient: {
      async preflightAgent() {
        return {
          status: "ready",
          preflightId: "ticket_after_install",
          selection: qoder,
          expiresAt: new Date(20_000).toISOString(),
        };
      },
      async installAgent(body) {
        calls.push(body);
        return { ok: true, providerId: "qoder", installSource: "managed" };
      },
      async agentAvailability() {
        return { status: "ready" };
      },
      async agentProviders() {
        return {
          providers: [{
            providerId: "qoder",
            installable: true,
            installSource: "managed",
            installState: "idle",
          }],
        };
      },
    },
    providers: [QODER_AGENT_PROVIDER, blocked, CODEX_AGENT_PROVIDER],
    selected: qoder,
    clock: { now: () => 10 },
  });
  await assert.rejects(
    catalog.install(blocked.selection),
    (error) => error?.code === "AGENT_INSTALL_UNSUPPORTED",
  );
  const refreshed = await catalog.install(qoder);
  assert.deepEqual(calls, [{ providerId: "qoder" }]);
  assert.equal(refreshed.result.status, "ready");
  assert.equal(refreshed.availability.status, "checking");
  assert.equal(catalog.provider(qoder).installSource, "managed");
  assert.equal(catalog.provider(qoder).installState, "idle");
});

test("post-install availability rechecks the provider's resolved selected authority", async () => {
  const requested = freezeAgentSelection({
    ...QODER_AGENT_PROVIDER.selection,
    resolvedModelId: null,
  });
  const resolved = freezeAgentSelection({
    ...requested,
    resolvedModelId: "qoder:qoder-default",
  });
  const availabilitySelections = [];
  const catalog = new AgentCatalogState({
    bridgeClient: {
      async preflightAgent() {
        return {
          status: "ready",
          preflightId: "ticket_resolved_before_install",
          selection: resolved,
          expiresAt: new Date(20_000).toISOString(),
        };
      },
      async installAgent() {
        return { ok: true, providerId: "qoder", installSource: "managed" };
      },
      async agentAvailability({ selection: current }) {
        availabilitySelections.push(current);
        return { status: "ready" };
      },
    },
    providers: [QODER_AGENT_PROVIDER],
    selected: requested,
    clock: { now: () => 10 },
  });

  await catalog.preflight(requested);
  await catalog.install(requested);
  assert.equal(availabilitySelections.at(-1).resolvedModelId, "qoder:qoder-default");
  assert.equal(catalog.freezeSelected().resolvedModelId, "qoder:qoder-default");
});

test("diagnosis is side-effect free and does not create a preflight ticket or mutate selection", async () => {
  const selected = freezeAgentSelection(QODER_AGENT_PROVIDER.selection);
  let diagnoseCalls = 0;
  let preflightCalls = 0;
  const catalog = new AgentCatalogState({
    bridgeClient: {
      async preflightAgent() {
        preflightCalls += 1;
        return { status: "ready", preflightId: "unused" };
      },
      async agentDiagnose(request) {
        diagnoseCalls += 1;
        assert.deepEqual(request.selection, selected);
        return {
          status: "ready",
          diagnostic: {
            readiness: "ready",
            cause: null,
            operation: "diagnose",
            checkedAt: "2026-08-11T00:00:00.000Z",
            activeInstallation: null,
          },
        };
      },
    },
    providers: [QODER_AGENT_PROVIDER],
    selected,
    clock: { now: () => Date.parse("2026-08-11T00:00:00.000Z") },
  });

  const before = catalog.freezeSelected();
  const result = await catalog.diagnose();
  assert.equal(diagnoseCalls, 1);
  assert.equal(preflightCalls, 0);
  assert.equal(result.diagnostic.activeInstallation, null);
  assert.deepEqual(catalog.getSnapshot().preflightBySelection, {});
  assert.deepEqual(catalog.freezeSelected(), before);
  assert.equal(catalog.availability().status, "ready");
});

test("install cancellation projects cancelling state and uses the existing Bridge route", async () => {
  const selected = freezeAgentSelection(QODER_AGENT_PROVIDER.selection);
  const states = [];
  let cancelled;
  const catalog = new AgentCatalogState({
    bridgeClient: {
      async preflightAgent() { return { status: "ready" }; },
      async cancelAgentInstall(body) {
        cancelled = body;
        states.push(catalog.provider(selected).installState);
        return { ok: true, providerId: "qoder", installState: "idle" };
      },
      async agentDiagnose() {
        return {
          status: "not-installed",
          diagnostic: {
            readiness: "not-installed",
            cause: "not-installed",
            operation: "diagnose",
            checkedAt: "2026-08-11T00:00:00.000Z",
            activeInstallation: null,
          },
        };
      },
    },
    providers: [QODER_AGENT_PROVIDER],
    selected,
    clock: { now: () => Date.parse("2026-08-11T00:00:00.000Z") },
  });
  catalog.provider(selected);
  const outcome = await catalog.cancelInstall();
  assert.deepEqual(cancelled, { providerId: "qoder" });
  assert.deepEqual(states, ["cancelling"]);
  assert.equal(outcome.installState, "idle");
  assert.equal(catalog.provider(selected).installState, "idle");
});

test("selectModel changes only the selected model identity", () => {
  const catalog = new AgentCatalogState({
    bridgeClient: {
      async preflightAgent() {
        return { status: "ready" };
      },
    },
    providers: [QODER_AGENT_PROVIDER],
    selected: QODER_AGENT_PROVIDER.selection,
  });
  const next = catalog.selectModel("qoder:PageRoot-E2E");
  assert.equal(next.providerId, "qoder");
  assert.equal(next.runtimeId, "acp");
  assert.equal(next.requestedModelId, "qoder:PageRoot-E2E");
  assert.equal(catalog.freezeSelected().requestedModelId, "qoder:PageRoot-E2E");
});

test("selectReasoning changes only PageRoot thinking depth", () => {
  const catalog = new AgentCatalogState({
    bridgeClient: {
      async preflightAgent() {
        return { status: "ready" };
      },
    },
    providers: [PAGEROOT_AGENT_PROVIDER],
    selected: PAGEROOT_AGENT_PROVIDER.selection,
  });
  const next = catalog.selectReasoning("low");
  assert.equal(next.providerId, "pageroot");
  assert.equal(next.runtimeId, "http");
  assert.deepEqual(next.reasoning, {
    requested: "low",
    applied: "low",
    resolution: "exact",
  });
  assert.equal(catalog.selectReasoning("not-a-depth").reasoning.resolution, "exact");
  assert.equal(catalog.freezeSelected().reasoning.requested, "low");
});

test("late model and reasoning commits cannot mutate a newly selected provider", () => {
  const catalog = new AgentCatalogState({
    bridgeClient: {
      async preflightAgent() {
        return { status: "ready" };
      },
    },
    providers: [QODER_AGENT_PROVIDER, CODEX_AGENT_PROVIDER],
    selected: QODER_AGENT_PROVIDER.selection,
  });
  const expectedQoder = catalog.freezeSelected();
  const selectedCodex = catalog.select(CODEX_AGENT_PROVIDER.selection);

  assert.equal(catalog.selectModel("qoder:late-model", expectedQoder), null);
  assert.equal(catalog.selectReasoning("high", expectedQoder), null);
  assert.deepEqual(catalog.freezeSelected(), selectedCodex);
  assert.equal(catalog.selectModel("qoder:cross-provider", selectedCodex), null);
  assert.deepEqual(catalog.freezeSelected(), selectedCodex);
});

test("Token replacement publishes atomically, clears old model state, and can disconnect", async () => {
  const requests = [];
  let failNext = false;
  const initial = PAGEROOT_AGENT_PROVIDER.selection;
  const catalog = new AgentCatalogState({
    bridgeClient: {
      async preflightAgent() { throw new Error("not used"); },
      async setAgentSessionCredential(request) {
        requests.push(request);
        if (request.disconnect === true) return { ok: true, configured: false };
        if (failNext) throw Object.assign(new Error("Token 无效"), { code: "AGENT_AUTH_REQUIRED" });
        return {
          ok: true,
          status: "ready",
          vendorId: request.vendorId,
          vendorDisplayName: request.vendorId === "openai" ? "OpenAI" : "DeepSeek",
          baseUrl: request.vendorId === "openai"
            ? "https://api.openai.com/v1"
            : "https://api.deepseek.com/v1",
          installationDigest: `sha256:${"a".repeat(64)}`,
          selection: {
            ...initial,
            resolvedModelId: request.vendorId === "openai"
              ? "pageroot:gpt-5"
              : "pageroot:deepseek-v4-pro",
          },
          models: [{
            id: request.vendorId === "openai" ? "pageroot:gpt-5" : "pageroot:deepseek-v4-pro",
            isDefault: true,
            reasoningChoices: [{ id: "auto", label: "自动" }],
          }],
        };
      },
    },
    providers: [PAGEROOT_AGENT_PROVIDER],
    selected: initial,
    clock: { now: () => 10 },
  });

  await catalog.connectWithApiKey(initial, "sk-old", { vendorId: "deepseek" });
  assert.equal(catalog.freezeSelected().resolvedModelId, "pageroot:deepseek-v4-pro");
  assert.equal(catalog.provider().connection.vendorDisplayName, "DeepSeek");
  failNext = true;
  await assert.rejects(
    catalog.connectWithApiKey(catalog.freezeSelected(), "sk-bad", { vendorId: "openai" }),
    (error) => error?.code === "AGENT_AUTH_REQUIRED",
  );
  assert.equal(catalog.freezeSelected().resolvedModelId, "pageroot:deepseek-v4-pro");
  assert.equal(catalog.provider().connection.vendorDisplayName, "DeepSeek");
  failNext = false;
  await catalog.connectWithApiKey(catalog.freezeSelected(), "sk-new", { vendorId: "openai" });
  assert.equal(catalog.freezeSelected().resolvedModelId, "pageroot:gpt-5");
  assert.deepEqual(catalog.provider().models.map((model) => model.id), ["pageroot:gpt-5"]);
  await catalog.disconnectApiKey(catalog.freezeSelected());
  assert.equal(catalog.availability().status, "auth-required");
  assert.equal(catalog.provider().credentialConfigured, false);
  assert.deepEqual(catalog.provider().models, []);
  assert.equal(catalog.freezeSelected().resolvedModelId, null);
  assert.equal(requests.at(-1).disconnect, true);
});
