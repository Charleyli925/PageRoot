import assert from "node:assert/strict";
import test from "node:test";

import { readFile } from "node:fs/promises";

import {
  AGENT_PROTOCOL_ACCEPTANCE,
  agentProtocolReleaseSnapshot,
  assertAgentProtocolReleaseSnapshot,
  formatUnverifiedAgentProtocolNotice,
  inspectAgentProtocolAcceptance,
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

test("accepted rows cannot use synthetic CI evidence and must bind real proof", () => {
  assert.equal(inspectAgentProtocolAcceptance().ok, true);
  const forged = inspectAgentProtocolAcceptance([
    {
      id: "pageroot:deepseek-v4-pro",
      protocolAcceptance: "accepted",
      evidence: "ci-synthetic",
    },
  ]);
  assert.equal(forged.ok, false);
  assert.match(forged.problems.join("\n"), /ci-synthetic/u);
  assert.match(forged.problems.join("\n"), /proof/u);
});

test("release snapshots bind the checkout and stay unverified until real proof", () => {
  const snapshot = agentProtocolReleaseSnapshot({
    commitSha: "a".repeat(40),
    packageVersion: "0.9.8",
    platform: "macos-arm64",
  });
  assert.equal(snapshot.revision, "2026-09-06.2");
  assert.ok(snapshot.unverifiedCount > 0);
  assert.equal(snapshot.unverified.some((row) => row.evidence === "ci-synthetic"), true);
  assert.doesNotThrow(() => {
    assertAgentProtocolReleaseSnapshot(snapshot, {
      commitSha: "a".repeat(40),
      packageVersion: "0.9.8",
      platform: "macos-arm64",
    });
  });
  assert.throws(
    () => assertAgentProtocolReleaseSnapshot(null, {
      commitSha: "a".repeat(40),
      packageVersion: "0.9.8",
    }),
    /synthetic CI green is not vendor proof/u,
  );
});

test("source-gate and Candidate provenance read the Agent protocol ledger", async () => {
  const [sourceGate, candidate] = await Promise.all([
    readFile(new URL("../scripts/source-gate-provenance.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/release-candidate-provenance.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(sourceGate, /agent-protocol-acceptance\.mjs/u);
  assert.match(sourceGate, /agentProtocol/u);
  assert.match(candidate, /assertAgentProtocolReleaseSnapshot/u);
  assert.match(candidate, /"agentProtocol"/u);
});
