import assert from "node:assert/strict";
import test from "node:test";

import {
  AGENT_PROTOCOL_ACCEPTANCE,
  formatUnverifiedAgentProtocolNotice,
  unverifiedAgentProtocolTargets,
} from "../shared/agent-protocol-acceptance.mjs";
import { publicOpenAiCompatibleVendors } from "../shared/openai-compatible-vendors.mjs";
import { SUPPORTED_AGENT_MODELS } from "../shared/supported-agent-models.mjs";

test("every built-in model and ACP provider is protocol-unverified until real proof", () => {
  const httpIds = SUPPORTED_AGENT_MODELS.map((model) => `pageroot:${model.modelId}`);
  const ids = AGENT_PROTOCOL_ACCEPTANCE.map((row) => row.id);
  for (const id of httpIds) assert.ok(ids.includes(id), id);
  assert.ok(ids.includes("qoder"));
  assert.ok(ids.includes("codex"));
  assert.equal(AGENT_PROTOCOL_ACCEPTANCE.every((row) => row.protocolAcceptance === "unverified"), true);
  assert.equal(AGENT_PROTOCOL_ACCEPTANCE.every((row) => row.evidence === "ci-synthetic"), true);
  assert.equal(unverifiedAgentProtocolTargets().length, AGENT_PROTOCOL_ACCEPTANCE.length);
});

test("product-visible DeepSeek is still marked 未验收 and mock catalogs cannot accept it", () => {
  const deepseek = AGENT_PROTOCOL_ACCEPTANCE.find((row) => row.id === "pageroot:deepseek-v4-pro");
  assert.equal(deepseek.productChannel, "stable");
  assert.equal(deepseek.protocolAcceptance, "unverified");
  assert.deepEqual(publicOpenAiCompatibleVendors().map(({ id }) => id), ["deepseek", "custom"]);
  const notice = formatUnverifiedAgentProtocolNotice();
  assert.equal(notice.heading, "Agent 真实协议未验收");
  assert.match(notice.lines.join("\n"), /deepseek-v4-pro：未验收/u);
  assert.match(notice.lines.join("\n"), /qoder：未验收/u);
  assert.match(notice.lines.join("\n"), /codex：未验收/u);
  assert.match(notice.lines.join("\n"), /smoke:agent-vendors:real/u);
});
