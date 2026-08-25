import { sha256 } from "../../lifecycle-core.mjs";
import {
  AGENT_POLICY_BRAND,
  assertAbsolutePath,
  assertObject,
  policyError,
  readVerifiedRegularFile,
} from "../policies/execution-policy.mjs";

function validateSession(boundSessionId, receivedSessionId) {
  if (!boundSessionId || receivedSessionId !== boundSessionId) {
    throw policyError(
      "SESSION_ID_MISMATCH",
      "The Agent operation does not belong to the active PageRoot task session.",
    );
  }
}

function slicedLines(content, line, limit) {
  if (line == null && limit == null) return content;
  const start = line == null ? 0 : line - 1;
  if (!Number.isSafeInteger(start) || start < 0 || start > 1_000_000) {
    throw policyError("READ_RANGE_INVALID", "Agent line must be a positive integer.");
  }
  if (
    limit != null
    && (!Number.isSafeInteger(limit) || limit <= 0 || limit > 100_000)
  ) {
    throw policyError("READ_RANGE_INVALID", "Agent limit must be a positive integer.");
  }
  const lines = content.match(/[^\n]*(?:\n|$)/gu) || [];
  if (lines.at(-1) === "") lines.pop();
  return lines.slice(start, limit == null ? undefined : start + limit).join("");
}

export function createDiscussionHost(policy, { onEvent = () => {} } = {}) {
  assertObject(policy, "policy");
  if (
    policy[AGENT_POLICY_BRAND] !== true
    || policy.mode !== "discussion"
    || !Array.isArray(policy.readableFiles)
  ) {
    throw new TypeError("Restricted discussion host requires a verified discussion policy.");
  }
  if (typeof onEvent !== "function") {
    throw new TypeError("Restricted discussion host dependencies are invalid.");
  }
  let sessionId = null;
  let phase = "active";
  let cancellationRequested = false;
  const readableFiles = new Map(
    policy.readableFiles.map((entry) => [entry.path, entry]),
  );
  const event = (kind, details = {}) => onEvent(Object.freeze({ kind, ...details }));
  const noTerminal = () => policyError(
    "DISCUSSION_NO_TERMINAL",
    "A discussion turn cannot use a terminal.",
  );
  const assertActive = (signal) => {
    if (signal?.aborted) {
      throw policyError("REQUEST_CANCELLED", "The Agent request was cancelled.");
    }
    if (cancellationRequested || phase === "cancelling") {
      throw policyError("HOST_CANCELLING", "The discussion host is cancelling.");
    }
    if (phase === "disposed") {
      throw policyError("HOST_DISPOSED", "The discussion host is already closed.");
    }
  };

  return {
    bindSessionId(nextSessionId) {
      assertActive();
      if (
        sessionId
        || typeof nextSessionId !== "string"
        || !/^[^\u0000-\u001f\u007f]{1,256}$/u.test(nextSessionId)
      ) {
        throw policyError("SESSION_BIND_INVALID", "The Agent session could not be bound.");
      }
      sessionId = nextSessionId;
      event("session-bound");
    },
    async requestPermission(params) {
      validateSession(sessionId, params.sessionId);
      event("permission-rejected", { toolKind: params.toolCall?.kind || "unknown" });
      return { outcome: { outcome: "cancelled" } };
    },
    async readTextFile(params, signal) {
      assertActive(signal);
      validateSession(sessionId, params.sessionId);
      const requestedPath = assertAbsolutePath(
        params.path,
        "agent/read_text_file path",
      );
      const authorized = readableFiles.get(requestedPath);
      if (!authorized) {
        throw policyError(
          "READ_NOT_AUTHORIZED",
          "The Agent requested a file outside the discussion snapshot.",
        );
      }
      const file = await readVerifiedRegularFile(
        requestedPath,
        policy.requestRoot,
        "Agent discussion read target",
      );
      assertActive(signal);
      const { bytes } = file;
      if (bytes.byteLength !== authorized.byteLength || sha256(bytes) !== authorized.sha256) {
        throw policyError(
          "FROZEN_INPUT_DRIFT",
          "The discussion snapshot changed after the session started.",
        );
      }
      event("file-read", { role: authorized.role });
      return { content: slicedLines(bytes.toString("utf8"), params.line, params.limit) };
    },
    async writeTextFile() {
      throw policyError(
        "DISCUSSION_READONLY",
        "A discussion turn cannot write any file.",
      );
    },
    async createTerminal() {
      throw noTerminal();
    },
    async terminalOutput() {
      throw noTerminal();
    },
    async waitForTerminalExit() {
      throw noTerminal();
    },
    async killTerminal() {
      throw noTerminal();
    },
    async releaseTerminal() {
      throw noTerminal();
    },
    cancel() {
      cancellationRequested = true;
      if (phase === "active") phase = "cancelling";
      return Promise.resolve();
    },
    dispose() {
      phase = "disposed";
    },
  };
}
