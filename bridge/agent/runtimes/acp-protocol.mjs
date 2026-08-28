import { Transform } from "node:stream";

import * as acp from "@agentclientprotocol/sdk";

import {
  AGENT_POLICY_BRAND,
  MAX_HTML_BYTES,
  MAX_PROMPT_BYTES,
  assertObject,
} from "../policies/execution-policy.mjs";
import { createExecutionHost } from "../hosts/execution-host.mjs";

const SAFE_ACP_ENVIRONMENT_NAMES = Object.freeze(new Set([
  "HOME",
  "LANG",
  "LC_ALL",
  "LOGNAME",
  "NO_COLOR",
  "NODE_PATH",
  "PATH",
  "SHELL",
  "TERM",
  "TMPDIR",
  "USER",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
]));

export function acpProcessEnvironment(overrides = {}, baseEnvironment = process.env) {
  assertObject(overrides, "ACP environment");
  assertObject(baseEnvironment, "ACP base environment");
  const result = {};
  for (const name of SAFE_ACP_ENVIRONMENT_NAMES) {
    if (typeof baseEnvironment[name] === "string") result[name] = baseEnvironment[name];
  }
  for (const [name, value] of Object.entries(overrides)) {
    if (!SAFE_ACP_ENVIRONMENT_NAMES.has(name) || typeof value !== "string") {
      throw new TypeError(`ACP environment override ${JSON.stringify(name)} is not allowed.`);
    }
    result[name] = value;
  }
  return result;
}

export const DEFAULT_ACP_STARTUP_TIMEOUT_MS = 15_000;
export const DEFAULT_ACP_TURN_TIMEOUT_MS = 10 * 60_000;
const MAX_SESSION_UPDATES = 512;
const MAX_ACP_FRAME_BYTES = MAX_HTML_BYTES + (2 * 1024 * 1024);

export function acpPolicyError(code, message, details = {}) {
  const error = new Error(message);
  error.name = "AcpPolicyError";
  error.code = code;
  error.details = details;
  return error;
}

export function truncateUtf8Tail(value, byteLimit) {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.byteLength <= byteLimit) return { value, truncated: false };
  let start = bytes.byteLength - byteLimit;
  while (start < bytes.byteLength && (bytes[start] & 0b1100_0000) === 0b1000_0000) {
    start += 1;
  }
  return {
    value: bytes.subarray(start).toString("utf8"),
    truncated: true,
  };
}

export class AcpFrameGuard extends Transform {
  #decoder = new TextDecoder("utf-8", { fatal: true });

  #frameBytes = 0;

  _transform(chunk, _encoding, callback) {
    try {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      this.#decoder.decode(bytes, { stream: true });
      let offset = 0;
      for (;;) {
        const newline = bytes.indexOf(0x0a, offset);
        if (newline === -1) {
          this.#frameBytes += bytes.byteLength - offset;
          break;
        }
        this.#frameBytes += newline - offset;
        if (this.#frameBytes > MAX_ACP_FRAME_BYTES) {
          throw acpPolicyError("ACP_FRAME_TOO_LARGE", "The ACP Agent emitted an oversized ACP frame.");
        }
        this.#frameBytes = 0;
        offset = newline + 1;
      }
      if (this.#frameBytes > MAX_ACP_FRAME_BYTES) {
        throw acpPolicyError("ACP_FRAME_TOO_LARGE", "The ACP Agent emitted an oversized ACP frame.");
      }
      callback(null, bytes);
    } catch (error) {
      callback(String(error?.code || "").startsWith("ACP_")
        ? error
        : acpPolicyError("ACP_UTF8_INVALID", "The ACP Agent emitted invalid UTF-8 over ACP."));
    }
  }

  _flush(callback) {
    try {
      this.#decoder.decode();
      callback();
    } catch {
      callback(acpPolicyError("ACP_UTF8_INVALID", "The ACP Agent emitted invalid UTF-8 over ACP."));
    }
  }
}

function timeoutController(timeoutMs) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError("ACP timeouts must be positive integers.");
  }
  const controller = new AbortController();
  let rejectExpired;
  const expired = new Promise((_resolve, reject) => {
    rejectExpired = reject;
  });
  const timer = setTimeout(() => {
    const error = acpPolicyError("ACP_TIMEOUT", "The ACP operation timed out.");
    rejectExpired(error);
    controller.abort(error);
  }, timeoutMs);
  return {
    controller,
    expired,
    clear() {
      clearTimeout(timer);
    },
  };
}

function cancellationGate(signal) {
  if (signal !== undefined && signal !== null && !(signal instanceof AbortSignal)) {
    throw new TypeError("ACP cancellationSignal must be an AbortSignal.");
  }
  if (!signal) {
    return {
      promise: new Promise(() => {}),
      dispose() {},
    };
  }
  let rejectCancelled;
  const promise = new Promise((_resolve, reject) => {
    rejectCancelled = reject;
  });
  const cancel = () => {
    const reason = acpPolicyError("ACP_CANCELLED", "The PageRoot ACP task was cancelled.");
    if (signal.reason instanceof Error) reason.cause = signal.reason;
    rejectCancelled(reason);
  };
  if (signal.aborted) cancel();
  else signal.addEventListener("abort", cancel, { once: true });
  return {
    promise,
    dispose() {
      signal.removeEventListener("abort", cancel);
    },
  };
}

function combinedSignal(...signals) {
  const active = signals.filter(Boolean);
  if (active.length === 0) return undefined;
  if (active.length === 1) return active[0];
  return AbortSignal.any(active);
}

function normalizedAgentInfo(value) {
  const agentInfo = value && typeof value === "object" ? value : {};
  const clean = (input, fallback) => {
    const normalized = String(input || fallback)
      .replace(/[\u0000-\u001f\u007f]/gu, "")
      .trim()
      .slice(0, 160);
    return normalized || fallback;
  };
  return Object.freeze({
    name: clean(agentInfo.name, "unknown"),
    version: clean(agentInfo.version, "unknown"),
  });
}

function summarizeUpdate(update) {
  const type = String(update?.sessionUpdate || "unknown");
  if (type === "tool_call" || type === "tool_call_update") {
    return {
      type,
      toolKind: String(update.kind || "unknown"),
      status: String(update.status || "unknown"),
    };
  }
  return { type };
}

function visibleTextChunk(update) {
  if (update?.sessionUpdate !== "agent_message_chunk") return "";
  if (update.content?.type !== "text") return "";
  return String(update.content.text || "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "");
}

function visibleTextBuffer(byteLimit) {
  let text = "";
  let bytes = 0;
  let truncated = false;
  return {
    append(chunk) {
      if (!chunk || truncated) return "";
      const remaining = byteLimit - bytes;
      if (remaining <= 0) {
        truncated = true;
        return "";
      }
      const size = Buffer.byteLength(chunk, "utf8");
      if (size <= remaining) {
        text += chunk;
        bytes += size;
        return chunk;
      }
      const kept = truncateUtf8Tail(chunk, remaining);
      text += kept.value;
      bytes += Buffer.byteLength(kept.value, "utf8");
      truncated = true;
      return kept.value;
    },
    get value() {
      return text;
    },
    get truncated() {
      return truncated;
    },
  };
}

export const ACP_HOST_METHODS = Object.freeze([
  "bindSessionId",
  "requestPermission",
  "readTextFile",
  "writeTextFile",
  "createTerminal",
  "terminalOutput",
  "waitForTerminalExit",
  "killTerminal",
  "releaseTerminal",
  "cancel",
  "dispose",
]);

function buildClient(host) {
  return acp
    .client({ name: "pageroot-agent-bridge" })
    .onRequest(acp.methods.client.session.requestPermission, ({ params, signal }) => (
      host.requestPermission(params, signal)
    ))
    .onRequest(acp.methods.client.fs.readTextFile, ({ params, signal }) => (
      host.readTextFile(params, signal)
    ))
    .onRequest(acp.methods.client.fs.writeTextFile, ({ params, signal }) => (
      host.writeTextFile(params, signal)
    ))
    .onRequest(acp.methods.client.terminal.create, ({ params, signal }) => (
      host.createTerminal(params, signal)
    ))
    .onRequest(acp.methods.client.terminal.output, ({ params, signal }) => (
      host.terminalOutput(params, signal)
    ))
    .onRequest(acp.methods.client.terminal.waitForExit, ({ params, signal }) => (
      host.waitForTerminalExit(params, signal)
    ))
    .onRequest(acp.methods.client.terminal.kill, ({ params, signal }) => (
      host.killTerminal(params, signal)
    ))
    .onRequest(acp.methods.client.terminal.release, ({ params, signal }) => (
      host.releaseTerminal(params, signal)
    ));
}

function driverProfile({
  mode,
  createHost,
  clientCapabilities,
  requiresTurnCompletion,
  visibleTextByteLimit,
  requiredHostMethods,
}) {
  return Object.freeze({
    mode,
    createHost,
    clientCapabilities,
    requiresTurnCompletion,
    visibleTextByteLimit,
    requiredHostMethods,
    assertHost(host) {
      const missing = requiredHostMethods.filter(
        (name) => typeof host?.[name] !== "function",
      );
      if (missing.length > 0) {
        throw acpPolicyError(
          "ACP_HOST_CONTRACT_INCOMPLETE",
          `The ${mode} ACP host does not implement ${missing.join(", ")}.`,
          { mode, missing },
        );
      }
      return host;
    },
  });
}

function defaultCreateHost(policy, onEvent) {
  return createExecutionHost(policy, { onEvent });
}

export function acpDriverProfile(policy, { createHost = defaultCreateHost } = {}) {
  assertObject(policy, "policy");
  if (policy[AGENT_POLICY_BRAND] !== true) {
    throw new TypeError("The ACP driver requires a verified PageRoot policy.");
  }
  if (policy.mode !== "execution") {
    throw acpPolicyError(
      "ACP_POLICY_MODE_UNSUPPORTED",
      "The ACP driver does not support this policy mode.",
    );
  }
  return driverProfile({
    mode: "execution",
    createHost,
    clientCapabilities: Object.freeze({
      fs: Object.freeze({ readTextFile: true, writeTextFile: true }),
      terminal: true,
    }),
    requiresTurnCompletion: true,
    visibleTextByteLimit: 64 * 1024,
    requiredHostMethods: Object.freeze([...ACP_HOST_METHODS, "assertTurnCompleted"]),
  });
}

export async function runAcpTask({
  connection,
  policy,
  prompt,
  onEvent = () => {},
  startupTimeoutMs = DEFAULT_ACP_STARTUP_TIMEOUT_MS,
  turnTimeoutMs = DEFAULT_ACP_TURN_TIMEOUT_MS,
  cancellationSignal,
  expectedAgentName,
  createHost,
} = {}) {
  const isStream = Boolean(connection?.readable && connection?.writable);
  const isAgentApp = typeof connection?.connect === "function"
    && typeof connection?.connectWith === "function";
  if (!isStream && !isAgentApp) {
    throw new TypeError("An ACP Stream or AgentApp connection is required.");
  }
  if (typeof prompt !== "string" || !prompt.trim()) {
    throw new TypeError("ACP prompt must be a non-empty string.");
  }
  if (Buffer.byteLength(prompt, "utf8") > MAX_PROMPT_BYTES) {
    throw acpPolicyError("ACP_PROMPT_TOO_LARGE", "The ACP prompt exceeds 256 KiB.");
  }
  if (
    expectedAgentName !== undefined
    && !(expectedAgentName instanceof RegExp)
  ) {
    throw new TypeError("expectedAgentName must be a RegExp.");
  }
  const profile = acpDriverProfile(policy, createHost ? { createHost } : {});
  const host = profile.assertHost(profile.createHost(policy, onEvent));
  const client = buildClient(host);
  const startupTimeout = timeoutController(startupTimeoutMs);
  const cancellation = cancellationGate(cancellationSignal);
  const updates = [];
  let droppedUpdateCount = 0;
  let visibleTextTruncationReported = false;
  const visibleText = visibleTextBuffer(profile.visibleTextByteLimit);
  const cancelStartup = () => {
    void host.cancel().catch(() => {});
  };
  startupTimeout.controller.signal.addEventListener("abort", cancelStartup, { once: true });
  cancellationSignal?.addEventListener("abort", cancelStartup, { once: true });
  try {
    const connected = client.connectWith(connection, async (context) => {
      const startupSignal = combinedSignal(
        startupTimeout.controller.signal,
        cancellationSignal,
      );
      const initialized = await Promise.race([
        context.request(
          acp.methods.agent.initialize,
          {
            protocolVersion: acp.PROTOCOL_VERSION,
            clientCapabilities: profile.clientCapabilities,
            clientInfo: {
              name: "pageroot-agent-bridge",
              title: "PageRoot Agent Bridge",
              version: "1.0.0",
            },
          },
          { cancellationSignal: startupSignal },
        ),
        startupTimeout.expired,
        cancellation.promise,
      ]);
      if (initialized.protocolVersion !== acp.PROTOCOL_VERSION) {
        throw acpPolicyError(
          "ACP_PROTOCOL_UNSUPPORTED",
          `The ACP Agent selected unsupported ACP protocol ${initialized.protocolVersion}.`,
        );
      }
      const agentInfo = normalizedAgentInfo(initialized.agentInfo);
      if (expectedAgentName) expectedAgentName.lastIndex = 0;
      if (expectedAgentName && !expectedAgentName.test(agentInfo.name)) {
        throw acpPolicyError(
          "ACP_AGENT_IDENTITY_MISMATCH",
          "The selected ACP executable did not identify itself as the expected Agent.",
        );
      }
      onEvent(Object.freeze({
        kind: "initialized",
        protocolVersion: initialized.protocolVersion,
        agentName: agentInfo.name,
        agentVersion: agentInfo.version,
      }));

      const session = await Promise.race([
        context.buildSession({
          cwd: policy.requestRoot,
          mcpServers: [],
        }).start({ cancellationSignal: startupSignal }),
        startupTimeout.expired,
        cancellation.promise,
      ]);
      startupTimeout.clear();
      host.bindSessionId(session.sessionId);
      const turnTimeout = timeoutController(turnTimeoutMs);
      const turnSignal = combinedSignal(
        turnTimeout.controller.signal,
        cancellationSignal,
      );
      const cancelTurn = () => {
        void host.cancel().catch(() => {});
        void context.notify(acp.methods.agent.session.cancel, {
          sessionId: session.sessionId,
        }).catch(() => {});
      };
      turnTimeout.controller.signal.addEventListener("abort", cancelTurn, { once: true });
      cancellationSignal?.addEventListener("abort", cancelTurn, { once: true });
      try {
        const promptPromise = session.prompt(prompt, {
          cancellationSignal: turnSignal,
        });
        void promptPromise.catch(() => {});
        for (;;) {
          const message = await Promise.race([
            session.nextUpdate(),
            turnTimeout.expired,
            cancellation.promise,
          ]);
          if (message.kind === "stop") {
            onEvent(Object.freeze({ kind: "turn-stopping", stopReason: message.stopReason }));
            const completion = profile.requiresTurnCompletion
              ? await host.assertTurnCompleted()
              : null;
            onEvent(Object.freeze({ kind: "turn-stopped", stopReason: message.stopReason }));
            return {
              initialized,
              sessionId: session.sessionId,
              stopReason: message.stopReason,
              completion,
              updates,
              droppedUpdateCount,
              visibleText: visibleText.value,
              visibleTextTruncated: visibleText.truncated,
            };
          }
          const chunk = visibleText.append(visibleTextChunk(message.update));
          if (chunk) {
            const messageId = String(
              message.update?.messageId
              || message.update?.message_id
              || "",
            ).trim();
            onEvent(Object.freeze({
              kind: "visible-text",
              text: chunk,
              ...(messageId ? { messageId } : {}),
            }));
          }
          if (visibleText.truncated && !visibleTextTruncationReported) {
            visibleTextTruncationReported = true;
            onEvent(Object.freeze({ kind: "visible-text-truncated" }));
          }
          const summary = summarizeUpdate(message.update);
          if (updates.length < MAX_SESSION_UPDATES) {
            updates.push(summary);
            onEvent(Object.freeze({ kind: "session-update", ...summary }));
          } else {
            droppedUpdateCount += 1;
            if (droppedUpdateCount === 1) {
              onEvent(Object.freeze({ kind: "session-updates-truncated" }));
            }
          }
        }
      } finally {
        turnTimeout.controller.signal.removeEventListener("abort", cancelTurn);
        cancellationSignal?.removeEventListener("abort", cancelTurn);
        turnTimeout.clear();
        session.dispose();
      }
    });
    void connected.catch(() => {});
    return await Promise.race([connected, cancellation.promise]);
  } finally {
    startupTimeout.controller.signal.removeEventListener("abort", cancelStartup);
    cancellationSignal?.removeEventListener("abort", cancelStartup);
    startupTimeout.clear();
    cancellation.dispose();
    await host.dispose();
  }
}
