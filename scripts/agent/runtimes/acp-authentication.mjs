import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  realpath,
  rm,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import * as acp from "@agentclientprotocol/sdk";

import {
  macosAgentSandboxProfile,
  packagedRuntimeReadRoot,
} from "../sandbox/macos-agent-sandbox.mjs";
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

async function verifiedAuthRoot(baseEnvironment) {
  const requested = baseEnvironment?.CODEX_HOME
    || (baseEnvironment?.HOME ? path.join(baseEnvironment.HOME, ".codex") : null);
  if (!requested || !path.isAbsolute(requested)) {
    throw authError("CODEX_AUTH_STATE_UNAVAILABLE", "Codex authentication state is unavailable.");
  }
  const parent = path.dirname(requested);
  const [parentPath, parentInformation] = await Promise.all([
    realpath(parent).catch(() => null),
    lstat(parent).catch(() => null),
  ]);
  if (parentPath !== parent || !parentInformation?.isDirectory()
    || parentInformation.isSymbolicLink()
    || (typeof process.getuid === "function" && parentInformation.uid !== process.getuid())
    || (parentInformation.mode & 0o022) !== 0) {
    throw authError("CODEX_AUTH_STATE_UNAVAILABLE", "Codex authentication state is unavailable.");
  }
  await mkdir(requested, { mode: 0o700 }).catch((cause) => {
    if (cause?.code !== "EEXIST") throw cause;
  });
  const information = await lstat(requested).catch(() => null);
  const privateOwner = typeof process.getuid !== "function"
    || information?.uid === process.getuid();
  const privateMode = information
    ? (information.mode & 0o700) === 0o700 && (information.mode & 0o022) === 0
    : false;
  if (!information?.isDirectory() || information.isSymbolicLink()
    || !privateOwner || !privateMode) {
    throw authError("CODEX_AUTH_STATE_UNAVAILABLE", "Codex authentication state is unavailable.");
  }
  const resolved = await realpath(requested);
  if (resolved !== requested) {
    throw authError("CODEX_AUTH_STATE_UNAVAILABLE", "Codex authentication state is unavailable.");
  }
  return resolved;
}

export async function authenticateAgentNativeAcp(launch) {
  if (process.platform !== "darwin") {
    throw authError(
      "CODEX_SANDBOX_PLATFORM_UNSUPPORTED",
      "Codex authentication requires the pinned macOS sandbox boundary.",
    );
  }
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "stemmio-codex-auth-")));
  const contextRoot = path.join(root, "context");
  const stateRoot = path.join(root, "state");
  const homeRoot = path.join(stateRoot, "home");
  const temporaryRoot = path.join(stateRoot, "tmp");
  try {
    await Promise.all([
      mkdir(contextRoot, { mode: 0o500 }),
      mkdir(homeRoot, { recursive: true, mode: 0o700 }),
      mkdir(temporaryRoot, { recursive: true, mode: 0o700 }),
    ]);
    const authRoot = await verifiedAuthRoot(launch.baseEnvironment);
    const runtime = await realpath(process.execPath);
    const packageRoot = path.resolve(path.dirname(launch.adapterEntry), "..", "..", "..");
    const sandboxProfileFactory = ({ codexBinary, codeModeHost }) => macosAgentSandboxProfile({
      runtime,
      runtimeReadRoot: packagedRuntimeReadRoot(runtime),
      codexBinary,
      codeModeHost,
      packageRoot,
      contextRoot,
      stateRoot,
      authRoot,
      allowAuthentication: true,
    });
    return await withAgentNativeAcpProcess({
      ...launch,
      cwd: contextRoot,
      mode: "read-only",
      sandboxProfileFactory,
      baseEnvironment: Object.freeze({
        ...(launch.baseEnvironment || {}),
        HOME: homeRoot,
        CODEX_HOME: authRoot,
        TMPDIR: temporaryRoot,
        XDG_CACHE_HOME: path.join(stateRoot, "cache"),
        XDG_CONFIG_HOME: path.join(stateRoot, "config"),
        XDG_DATA_HOME: path.join(stateRoot, "data"),
      }),
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
    await chmod(contextRoot, 0o700).catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
}
