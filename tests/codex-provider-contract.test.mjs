import assert from "node:assert/strict";
import test from "node:test";

import {
  createCodexProvider,
  normalizeCodexError,
} from "../scripts/agent/providers/codex-provider.mjs";
import {
  createDefaultProviderRegistry,
  createProviderRegistry,
} from "../scripts/agent/providers/provider-registry.mjs";
import { defineAgentRuntime } from "../scripts/agent/runtimes/agent-runtime-contract.mjs";
import { createRuntimeRegistry } from "../scripts/agent/runtimes/runtime-registry.mjs";

const selection = Object.freeze({
  providerId: "codex",
  runtimeId: "acp",
  requestedModelId: null,
  resolvedModelId: null,
  reasoning: Object.freeze({
    requested: null,
    applied: null,
    resolution: "provider-default",
  }),
});

function fixture() {
  const calls = [];
  const installation = Object.freeze({ fixture: "codex-installation", codexVersion: "0.148.0" });
  const provider = createCodexProvider({
    capabilities: { discussion: true },
    installationResolver: async () => {
      calls.push("installation");
      return installation;
    },
    installationVerifier: async (received) => {
      calls.push("verify");
      assert.equal(received, installation);
    },
    installationDigester: () => `sha256:${"b".repeat(64)}`,
  });
  const runtime = defineAgentRuntime({
    runtimeId: "acp",
    async probe(launch) {
      calls.push("probe");
      assert.equal(launch.securityProfile, "agent-native");
      assert.equal(launch.purpose, "discussion");
      return Object.freeze({
        protocolVersion: 1,
        auth: Object.freeze({ status: "ready", type: "chat-gpt" }),
        models: Object.freeze([
          Object.freeze({ id: "gpt-synthetic", displayName: "GPT Synthetic" }),
        ]),
        reasoningEfforts: Object.freeze([
          Object.freeze({ id: "high", displayName: "High" }),
        ]),
        modes: Object.freeze([
          Object.freeze({ id: "read-only", displayName: "Read-only" }),
        ]),
        currentModelId: "gpt-synthetic",
        currentReasoning: "high",
        currentMode: "read-only",
      });
    },
    async run() {
      calls.push("run");
      return {};
    },
  });
  return {
    calls,
    registry: createProviderRegistry({
      providers: [provider],
      runtimeRegistry: createRuntimeRegistry([runtime]),
    }),
  };
}

test("Codex provider probes through ACP without a legacy driver and freezes agent-native evidence", async () => {
  const { calls, registry } = fixture();
  const prepared = await registry.preflightForSelection(selection, "discussion", {
    environment: {},
  });
  assert.equal(prepared.providerId, "codex");
  assert.equal(prepared.securityProfile, "agent-native");
  assert.equal("driver" in prepared, false);
  assert.deepEqual(prepared.evidence.models, [
    { id: "codex:gpt-synthetic", displayName: "GPT Synthetic", description: "" },
  ]);
  assert.deepEqual(prepared.selection, {
    providerId: "codex",
    runtimeId: "acp",
    requestedModelId: null,
    resolvedModelId: "codex:gpt-synthetic",
    reasoning: { requested: null, applied: "high", resolution: "provider-default" },
  });
  assert.deepEqual(calls, ["installation", "probe", "verify"]);

  const ticket = Object.freeze({
    ...prepared,
    purpose: "discussion",
    preflightId: "preflight_codex_fixture",
  });
  await registry.verifyTicket(ticket, { purpose: "discussion" });
  assert.deepEqual(calls, ["installation", "probe", "verify", "verify"]);
});

test("Codex model and reasoning selections must resolve exactly against the live catalog", async () => {
  const { registry } = fixture();
  const exact = await registry.preflightForSelection({
    ...selection,
    requestedModelId: "codex:gpt-synthetic",
    resolvedModelId: "codex:gpt-synthetic",
    reasoning: { requested: "high", applied: "high", resolution: "exact" },
  }, "discussion", { environment: {} });
  assert.equal(exact.selection.resolvedModelId, "codex:gpt-synthetic");
  assert.deepEqual(exact.selection.reasoning, {
    requested: "high",
    applied: "high",
    resolution: "exact",
  });
  await assert.rejects(
    registry.preflightForSelection({
      ...selection,
      requestedModelId: "codex:unknown",
      resolvedModelId: "codex:unknown",
    }, "discussion", { environment: {} }),
    { code: "CODEX_MODEL_UNAVAILABLE" },
  );
});

test("Codex execution remains disabled at registry and ticket boundaries", async () => {
  const { registry } = fixture();
  await assert.rejects(
    registry.preflightForSelection(selection, "execution", { environment: {} }),
    { code: "AGENT_CAPABILITY_UNSUPPORTED" },
  );
});

test("Codex feature flags are closed by default and ordinary environment cannot force them", () => {
  const production = createDefaultProviderRegistry({
    environment: {
      PAGEROOT_CODEX_DISCUSSION: "1",
      PAGEROOT_CODEX_EXECUTION: "1",
    },
  });
  assert.deepEqual(production.catalog().map((provider) => provider.providerId), ["qoder"]);

  const testRegistry = createDefaultProviderRegistry({
    environment: {
      PAGEROOT_E2E: "1",
      PAGEROOT_CODEX_ALLOW_TEST_FLAGS: "1",
      PAGEROOT_CODEX_DISCUSSION: "1",
    },
  });
  assert.deepEqual(testRegistry.catalog().map((provider) => provider.providerId), ["qoder", "codex"]);
  assert.equal(testRegistry.catalog()[1].capabilities.discussion, true);
  assert.equal(testRegistry.catalog()[1].capabilities.execution, false);
});

test("Codex failures classify capacity and erase raw secret-bearing fields", () => {
  const secret = "secret-canary-do-not-surface";
  const error = Object.assign(new Error(`quota exceeded ${secret}`), {
    data: { details: `rate limit ${secret}` },
    stderr: secret,
    details: { raw: secret },
  });
  const normalized = normalizeCodexError(error);
  assert.equal(normalized.code, "CODEX_ACCOUNT_CAPACITY_UNAVAILABLE");
  assert.doesNotMatch(JSON.stringify(normalized), new RegExp(secret, "u"));
  assert.doesNotMatch(normalized.message, new RegExp(secret, "u"));
});
