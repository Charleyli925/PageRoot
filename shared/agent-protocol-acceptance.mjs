// Product visibility (`releaseChannel`) is not protocol acceptance.
// CI fixtures, fake ACP servers and local HTTP agents never flip a row to
// `accepted`. Only `npm run smoke:agent-vendors:real` or a clean-machine
// install-login-first-round may do that.

import { SUPPORTED_AGENT_MODELS } from "./supported-agent-models.mjs";

export const AGENT_PROTOCOL_ACCEPTANCE_REVISION = "2026-09-06.1";

function httpRow(model) {
  return Object.freeze({
    id: `pageroot:${model.modelId}`,
    providerId: "pageroot",
    vendorId: model.vendorId,
    modelId: model.modelId,
    productChannel: model.releaseChannel,
    protocolAcceptance: "unverified",
    evidence: "ci-synthetic",
    requiredProof: "npm run smoke:agent-vendors:real",
  });
}

const HTTP_ROWS = SUPPORTED_AGENT_MODELS.map(httpRow);

const ACP_ROWS = Object.freeze([
  Object.freeze({
    id: "qoder",
    providerId: "qoder",
    vendorId: null,
    modelId: null,
    productChannel: "stable",
    protocolAcceptance: "unverified",
    evidence: "ci-synthetic",
    requiredProof: "clean-machine install, official login, first round, review",
  }),
  Object.freeze({
    id: "codex",
    providerId: "codex",
    vendorId: null,
    modelId: null,
    productChannel: "stable",
    protocolAcceptance: "unverified",
    evidence: "ci-synthetic",
    requiredProof: "clean-machine install, official login, first round, review",
  }),
]);

export const AGENT_PROTOCOL_ACCEPTANCE = Object.freeze([
  ...HTTP_ROWS,
  ...ACP_ROWS,
]);

export function unverifiedAgentProtocolTargets() {
  return AGENT_PROTOCOL_ACCEPTANCE.filter((row) => row.protocolAcceptance !== "accepted");
}

export function formatUnverifiedAgentProtocolNotice() {
  const lines = unverifiedAgentProtocolTargets().map((row) => {
    const name = row.vendorId
      ? `${row.vendorId} ${row.modelId}`
      : row.providerId;
    return `${name}：未验收（${row.evidence}；需要 ${row.requiredProof}）`;
  });
  return Object.freeze({
    revision: AGENT_PROTOCOL_ACCEPTANCE_REVISION,
    heading: "Agent 真实协议未验收",
    lines,
  });
}
