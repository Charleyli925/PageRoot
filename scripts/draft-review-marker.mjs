const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const RUN_ID_PATTERN = /^\d{1,64}$/u;
const MARKER_NAME = "pageroot-draft-review-request:v1";
const COMMAND_NAME = "pageroot-draft-review-command:v1";
const STATUS_NAME = "pageroot-draft-review-status:v1";
export const DEFAULT_TRUSTED_ACTOR = "github-actions[bot]";
export const CODEX_LOGIN = "chatgpt-codex-connector";
export const SETTLED_STATES = new Set(["clean", "action_required"]);
const MAX_STATUS_ENTRIES = 12;

export function assertDraftReviewSha(value, label) {
  const normalized = String(value || "").toLowerCase();
  if (!SHA_PATTERN.test(normalized)) {
    throw new Error(label + " must be a 40-character lowercase Git SHA.");
  }
  return normalized;
}

export function assertDraftReviewRunId(value, label) {
  const normalized = String(value || "");
  if (!RUN_ID_PATTERN.test(normalized)) {
    throw new Error(label + " must contain only digits.");
  }
  return normalized;
}

function markerBlock(name, lines) {
  return "<!-- " + name + "\n" + lines.join("\n") + "\n-->";
}

function parseMarkerBlock(body, name, allowedKeys) {
  const text = String(body ?? "");
  const pattern = new RegExp("<!--\\s*" + name + "\\s*([\\r\\n][\\s\\S]*?)-->", "iu");
  const match = text.match(pattern);
  if (!match) return null;
  const fields = new Map();
  for (const line of match[1].split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) return null;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (!allowedKeys.includes(key)) return null;
    if (fields.has(key)) return null;
    fields.set(key, value);
  }
  return fields;
}

export function buildDraftReviewRequestMarker({ headSha, baseSha, sourceRunId = null } = {}) {
  const head = assertDraftReviewSha(headSha, "headSha");
  const base = assertDraftReviewSha(baseSha, "baseSha");
  const lines = ["head=" + head, "base=" + base];
  if (sourceRunId !== null && sourceRunId !== undefined && sourceRunId !== "") {
    lines.push("source_run=" + assertDraftReviewRunId(sourceRunId, "sourceRunId"));
  }
  return markerBlock(MARKER_NAME, lines);
}

export function parseDraftReviewRequestMarker(body) {
  const fields = parseMarkerBlock(body, MARKER_NAME, ["head", "base", "source_run"]);
  if (!fields) return null;
  const headSha = String(fields.get("head") ?? "").toLowerCase();
  const baseSha = String(fields.get("base") ?? "").toLowerCase();
  if (!SHA_PATTERN.test(headSha) || !SHA_PATTERN.test(baseSha)) return null;
  const sourceRunId = fields.has("source_run") ? String(fields.get("source_run")) : null;
  if (sourceRunId !== null && !RUN_ID_PATTERN.test(sourceRunId)) return null;
  return Object.freeze({ headSha, baseSha, sourceRunId });
}

export function buildDraftReviewCommandMarker({ mode, headSha, baseSha } = {}) {
  const normalizedMode = String(mode || "");
  if (!["request", "close"].includes(normalizedMode)) {
    throw new Error("command mode must be request or close.");
  }
  const head = assertDraftReviewSha(headSha, "headSha");
  const base = assertDraftReviewSha(baseSha, "baseSha");
  return markerBlock(COMMAND_NAME, ["mode=" + normalizedMode, "head=" + head, "base=" + base]);
}

export function parseDraftReviewCommandMarker(body) {
  const fields = parseMarkerBlock(body, COMMAND_NAME, ["mode", "head", "base"]);
  if (!fields) return null;
  const mode = String(fields.get("mode") ?? "");
  const headSha = String(fields.get("head") ?? "").toLowerCase();
  const baseSha = String(fields.get("base") ?? "").toLowerCase();
  if (!["request", "close"].includes(mode)) return null;
  if (!SHA_PATTERN.test(headSha) || !SHA_PATTERN.test(baseSha)) return null;
  return Object.freeze({ mode, headSha, baseSha });
}

export function buildDraftReviewStatusMarker({ pullRequest, entries = [] } = {}) {
  if (!Number.isInteger(pullRequest) || pullRequest <= 0) {
    throw new Error("status marker pullRequest must be a positive integer.");
  }
  const lines = ["pr=" + pullRequest];
  for (const entry of entries.slice(-MAX_STATUS_ENTRIES)) {
    const head = assertDraftReviewSha(entry.headSha, "status entry headSha");
    const state = String(entry.state || "");
    if (!["clean", "action_required", "timed_out", "stale", "promotion_overlap"].includes(state)) {
      throw new Error("status entry state is invalid.");
    }
    lines.push("head=" + head + " state=" + state);
  }
  return markerBlock(STATUS_NAME, lines);
}

export function parseDraftReviewStatusMarker(body) {
  const text = String(body ?? "");
  const pattern = new RegExp("<!--\\s*" + STATUS_NAME + "\\s*([\\r\\n][\\s\\S]*?)-->", "iu");
  const match = text.match(pattern);
  if (!match) return null;
  let pullRequest = 0;
  const entries = [];
  for (const line of match[1].split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) return null;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (key === "pr") {
      if (pullRequest) return null;
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed <= 0) return null;
      pullRequest = parsed;
    } else if (key === "head") {
      const entry = value.match(/^([0-9a-f]{40})\s+state=(clean|action_required|timed_out|stale|promotion_overlap)$/iu);
      if (!entry) return null;
      entries.push({ headSha: entry[1].toLowerCase(), state: entry[2].toLowerCase() });
    } else {
      return null;
    }
  }
  if (!pullRequest) return null;
  return Object.freeze({ pullRequest, entries });
}

export function recordSettledHead(entries = [], { headSha, state } = {}) {
  const head = assertDraftReviewSha(headSha, "headSha");
  const normalizedState = String(state || "");
  if (!["clean", "action_required", "timed_out", "stale", "promotion_overlap"].includes(normalizedState)) {
    throw new Error("settled head state is invalid.");
  }
  const next = entries.filter((entry) => entry?.headSha !== head);
  return [...next, Object.freeze({ headSha: head, state: normalizedState })].slice(-MAX_STATUS_ENTRIES);
}

export function settledHeadState(entries = [], headSha) {
  const head = String(headSha || "").toLowerCase();
  if (!SHA_PATTERN.test(head)) return null;
  const entry = entries.find((candidate) => candidate?.headSha === head);
  return entry?.state || null;
}
