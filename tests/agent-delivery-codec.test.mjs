import test from "node:test";
import assert from "node:assert/strict";

import {
  defaultManagedAgentDelivery,
  legacyDriverForAgentDelivery,
  normalizeAgentDelivery,
  normalizeNewAgentDelivery,
} from "../shared/agent-delivery.mjs";

test("legacy qoder-acp projects to the canonical managed Agent delivery without mutating input", () => {
  const legacy = {
    mode: "qoder-acp",
    trustPolicyVersion: "trusted-local-agent-v1",
  };
  const bytes = JSON.stringify(legacy);
  assert.deepEqual(normalizeAgentDelivery(legacy), defaultManagedAgentDelivery());
  assert.equal(JSON.stringify(legacy), bytes);
});

test("canonical writer shape and clipboard delivery remain exact", () => {
  assert.deepEqual(defaultManagedAgentDelivery(), {
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
  assert.deepEqual(normalizeAgentDelivery({ mode: "clipboard" }), { mode: "clipboard" });
});

test("malformed policy, reasoning and cross-provider model ids fail closed", () => {
  const base = structuredClone(defaultManagedAgentDelivery());
  assert.throws(
    () => normalizeAgentDelivery({ ...base, trustPolicyVersion: "future-policy" }),
    { code: "AGENT_DELIVERY_INVALID" },
  );
  assert.throws(
    () => normalizeAgentDelivery({
      ...base,
      selection: {
        ...base.selection,
        requestedModelId: "other:model-a",
      },
    }),
    { code: "AGENT_DELIVERY_INVALID" },
  );
  for (const reasoning of [
    { requested: "high", applied: null, resolution: "exact" },
    { requested: null, applied: null, resolution: "unsupported" },
    { requested: "high", applied: "low", resolution: "provider-default" },
  ]) {
    assert.throws(
      () => normalizeAgentDelivery({
        ...base,
        selection: { ...base.selection, reasoning },
      }),
      { code: "AGENT_DELIVERY_INVALID" },
    );
  }
});

test("delivery codecs preserve unknown selections while legacy projection stays Qoder-only", () => {
  const delivery = normalizeAgentDelivery({
    mode: "managed-agent",
    selection: {
      providerId: "future-agent",
      runtimeId: "future-runtime",
      requestedModelId: "future-agent:model-a",
      resolvedModelId: "future-agent:model-a",
      reasoning: { requested: "high", applied: "high", resolution: "exact" },
    },
    trustPolicyVersion: "trusted-local-agent-v1",
  });
  assert.equal(delivery.selection.providerId, "future-agent");
  assert.throws(() => legacyDriverForAgentDelivery(delivery), {
    code: "AGENT_PROVIDER_UNSUPPORTED",
  });
  assert.deepEqual(normalizeNewAgentDelivery(delivery), delivery);
});

test("new writers reject legacy delivery while its historical projection stays readable", () => {
  const legacy = {
    mode: "qoder-acp",
    trustPolicyVersion: "trusted-local-agent-v1",
  };
  assert.equal(normalizeAgentDelivery(legacy).mode, "managed-agent");
  assert.throws(() => normalizeNewAgentDelivery(legacy), {
    code: "AGENT_DELIVERY_INVALID",
  });
});
