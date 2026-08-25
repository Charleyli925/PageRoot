import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import * as acp from "@agentclientprotocol/sdk";

import { withAgentNativeAcpProcess } from "./agent-native-acp-runner.mjs";

const AUTH_TIMEOUT_MS = 10 * 60_000;

function authError(code, message) {
  const error = new Error(message);
  error.name = "AgentNativeAcpAuthError";
  error.code = code;
  return error;
}

function unsupportedHostOperation() {
  throw authError("CODEX_AUTH_HOST_OPERATION", "Codex requested a host operation during authentication.");
}

function authenticationClient() {
  return acp.client({ name: "stemmio-codex-authentication" })
    .onRequest(acp.methods.client.session.requestPermission, () => ({
      outcome: { outcome: "cancelled" },
    }))
    .onRequest(acp.methods.client.fs.readTextFile, unsupportedHostOperation)
    .onRequest(acp.methods.client.fs.writeTextFile, unsupportedHostOperation)
    .onRequest(acp.methods.client.terminal.create, unsupportedHostOperation)
    .onRequest(acp.methods.client.terminal.output, unsupportedHostOperation)
    .onRequest(acp.methods.client.terminal.waitForExit, unsupportedHostOperation)
    .onRequest(acp.methods.client.terminal.kill, unsupportedHostOperation)
    .onRequest(acp.methods.client.terminal.release, unsupportedHostOperation)
    .onRequest(acp.methods.client.elicitation.create, () => ({ action: "cancel" }));
}

function withAuthTimeout(operation, signal) {
  let handle;
  let rejectCancelled;
  const cancelled = new Promise((_resolve, reject) => {
    rejectCancelled = reject;
  });
  const abort = () => rejectCancelled(authError("CODEX_AUTH_CANCELLED", "Codex authentication was cancelled."));
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });
  const expired = new Promise((_resolve, reject) => {
    handle = setTimeout(() => reject(
      authError("CODEX_AUTH_TIMEOUT", "Codex authentication timed out."),
    ), AUTH_TIMEOUT_MS);
    handle.unref?.();
  });
  return Promise.race([operation, expired, cancelled]).finally(() => {
    clearTimeout(handle);
    signal?.removeEventListener("abort", abort);
  });
}

export async function authenticateAgentNativeAcp(launch) {
  const authRoot = await mkdtemp(path.join(os.tmpdir(), "stemmio-codex-auth-"));
  try {
    return await withAgentNativeAcpProcess({
      ...launch,
      cwd: authRoot,
      mode: "read-only",
    }, ({ stream }) => withAuthTimeout(
      authenticationClient().connectWith(stream, async (context) => {
        const initialized = await context.request(acp.methods.agent.initialize, {
          protocolVersion: acp.PROTOCOL_VERSION,
          clientCapabilities: {
            fs: { readTextFile: false, writeTextFile: false },
            terminal: false,
          },
          clientInfo: {
            name: "stemmio-codex-authentication",
            title: "Stemmio Codex Authentication",
            version: "1.0.0",
          },
        });
        if (initialized?.protocolVersion !== acp.PROTOCOL_VERSION) {
          throw authError("CODEX_ACP_PROTOCOL_MISMATCH", "Codex ACP protocol is incompatible.");
        }
        const methods = Array.isArray(initialized?.authMethods)
          ? initialized.authMethods.map((method) => method?.id)
          : [];
        if (!methods.includes("chat-gpt")) {
          throw authError("CODEX_AUTH_METHOD_UNAVAILABLE", "Codex did not offer ChatGPT authentication.");
        }
        const before = await context.request("authentication/status", {});
        if (before?.type !== "unauthenticated") return Object.freeze({ status: "ready" });
        await context.request(acp.methods.agent.authenticate, { methodId: "chat-gpt" });
        const after = await context.request("authentication/status", {});
        if (after?.type === "unauthenticated") {
          throw authError("CODEX_AUTH_REQUIRED", "Codex authentication did not complete.");
        }
        return Object.freeze({ status: "ready" });
      }),
      launch.cancellationSignal,
    ));
  } finally {
    await rm(authRoot, { recursive: true, force: true });
  }
}
