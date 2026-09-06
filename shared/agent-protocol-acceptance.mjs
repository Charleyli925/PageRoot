// Product visibility (`releaseChannel`) is not protocol acceptance.
// CI fixtures, fake ACP servers and local HTTP agents never flip a row to
// `accepted`. Only `npm run smoke:agent-vendors:real` or a clean-machine
// install-login-first-round may do that. Source-gate and Candidate
// attestations must list remaining unverified rows; a green synthetic suite
// is not vendor proof.

import { SUPPORTED_AGENT_MODELS } from "./supported-agent-models.mjs";

export const AGENT_PROTOCOL_ACCEPTANCE_REVISION = "2026-09-06.2";
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u;

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

function inspectProof(proof) {
  if (!proof || typeof proof !== "object" || Array.isArray(proof)) {
    return "accepted rows require proof bound to commit, package, platform, components and scenarios";
  }
  if (!SHA_PATTERN.test(String(proof.commitSha || ""))) {
    return "accepted proof.commitSha must be a 40-character Git SHA";
  }
  if (!VERSION_PATTERN.test(String(proof.packageVersion || ""))) {
    return "accepted proof.packageVersion must be a semantic version";
  }
  if (!String(proof.platform || "").trim()) {
    return "accepted proof.platform is required";
  }
  if (!Array.isArray(proof.components) || proof.components.length === 0) {
    return "accepted proof.components must list the verified Agent components";
  }
  if (!Array.isArray(proof.scenarios) || proof.scenarios.length === 0) {
    return "accepted proof.scenarios must list the real vendor paths that passed";
  }
  return null;
}

export function inspectAgentProtocolAcceptance(rows = AGENT_PROTOCOL_ACCEPTANCE) {
  const problems = [];
  for (const row of rows || []) {
    const id = String(row?.id || "unknown");
    if (!["unverified", "accepted"].includes(String(row?.protocolAcceptance || ""))) {
      problems.push(`${id}: protocolAcceptance must be unverified or accepted`);
      continue;
    }
    if (row.protocolAcceptance === "accepted") {
      if (row.evidence === "ci-synthetic") {
        problems.push(`${id}: ci-synthetic evidence cannot mark a vendor accepted`);
      }
      const proofProblem = inspectProof(row.proof);
      if (proofProblem) problems.push(`${id}: ${proofProblem}`);
    }
  }
  return Object.freeze({
    ok: problems.length === 0,
    problems: Object.freeze(problems),
  });
}

export function unverifiedAgentProtocolTargets(rows = AGENT_PROTOCOL_ACCEPTANCE) {
  return rows.filter((row) => row.protocolAcceptance !== "accepted");
}

export function formatUnverifiedAgentProtocolNotice(rows = AGENT_PROTOCOL_ACCEPTANCE) {
  const lines = unverifiedAgentProtocolTargets(rows).map((row) => {
    const name = row.vendorId
      ? `${row.vendorId} ${row.modelId}`
      : row.providerId;
    return `${name}：未验收（${row.evidence}；需要 ${row.requiredProof}）`;
  });
  return Object.freeze({
    revision: AGENT_PROTOCOL_ACCEPTANCE_REVISION,
    heading: "Agent 真实协议未验收",
    lines: Object.freeze(lines),
  });
}

function publicUnverifiedRow(row) {
  return Object.freeze({
    id: row.id,
    providerId: row.providerId,
    vendorId: row.vendorId,
    modelId: row.modelId,
    productChannel: row.productChannel,
    protocolAcceptance: row.protocolAcceptance,
    evidence: row.evidence,
    requiredProof: row.requiredProof,
  });
}

export function agentProtocolReleaseSnapshot({
  commitSha = null,
  packageVersion = null,
  platform = null,
  rows = AGENT_PROTOCOL_ACCEPTANCE,
} = {}) {
  const inspected = inspectAgentProtocolAcceptance(rows);
  if (!inspected.ok) {
    throw new Error(`Agent protocol ledger is not releaseable: ${inspected.problems.join("; ")}`);
  }
  const notice = formatUnverifiedAgentProtocolNotice(rows);
  return Object.freeze({
    schemaVersion: 1,
    revision: AGENT_PROTOCOL_ACCEPTANCE_REVISION,
    commitSha,
    packageVersion,
    platform,
    unverifiedCount: notice.lines.length,
    unverified: Object.freeze(unverifiedAgentProtocolTargets(rows).map(publicUnverifiedRow)),
    heading: notice.heading,
    lines: notice.lines,
  });
}

export function assertAgentProtocolReleaseSnapshot(snapshot, {
  commitSha,
  packageVersion,
  platform = null,
} = {}) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new Error(
      "Release evidence must list Agent protocol acceptance; synthetic CI green is not vendor proof.",
    );
  }
  const expected = agentProtocolReleaseSnapshot({ commitSha, packageVersion, platform });
  if (snapshot.schemaVersion !== 1) {
    throw new Error("agentProtocol.schemaVersion must be 1.");
  }
  if (snapshot.revision !== expected.revision) {
    throw new Error("agentProtocol.revision does not match the current ledger.");
  }
  if (snapshot.commitSha !== expected.commitSha) {
    throw new Error("agentProtocol.commitSha does not match the attested checkout.");
  }
  if (snapshot.packageVersion !== expected.packageVersion) {
    throw new Error("agentProtocol.packageVersion does not match the attested checkout.");
  }
  if (platform != null && snapshot.platform !== platform) {
    throw new Error("agentProtocol.platform does not match the attested target.");
  }
  if (snapshot.unverifiedCount !== expected.unverifiedCount) {
    throw new Error("agentProtocol.unverifiedCount does not match the current unverified ledger.");
  }
  if (!Array.isArray(snapshot.lines) || snapshot.lines.join("\n") !== expected.lines.join("\n")) {
    throw new Error("agentProtocol notice lines do not match the current unverified ledger.");
  }
  return expected;
}

export function logAgentProtocolReleaseNotice(snapshot, write = console.log) {
  write(`${snapshot.heading} (${snapshot.revision}; ${snapshot.unverifiedCount} unverified)`);
  for (const line of snapshot.lines) write(`- ${line}`);
}
