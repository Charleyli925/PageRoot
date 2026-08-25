import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import * as acp from "@agentclientprotocol/sdk";

import {
  macosAgentSandboxProfile,
  packagedRuntimeReadRoot,
} from "../sandbox/macos-agent-sandbox.mjs";
import { withAgentNativeAcpProcess } from "./agent-native-acp-runner.mjs";

const DEFAULT_PROBE_TIMEOUT_MS = 30_000;
const SAFE_VALUE = /^[^\u0000-\u001f\u007f]{1,200}$/u;

function probeError(code, message) {
  const error = new Error(message);
  error.name = "AgentNativeAcpProbeError";
  error.code = code;
  return error;
}

function bounded(value, fallback = "") {
  const text = String(value || fallback).trim().slice(0, 200);
  return SAFE_VALUE.test(text) ? text : fallback;
}

function denyPermission() {
  return { outcome: { outcome: "cancelled" } };
}

function unsupportedHostOperation() {
  throw probeError("CODEX_PROBE_HOST_OPERATION", "Codex requested a host operation during preflight.");
}

function probeClient() {
  return acp.client({ name: "stemmio-codex-probe" })
    .onRequest(acp.methods.client.session.requestPermission, denyPermission)
    .onRequest(acp.methods.client.fs.readTextFile, unsupportedHostOperation)
    .onRequest(acp.methods.client.fs.writeTextFile, unsupportedHostOperation)
    .onRequest(acp.methods.client.terminal.create, unsupportedHostOperation)
    .onRequest(acp.methods.client.terminal.output, unsupportedHostOperation)
    .onRequest(acp.methods.client.terminal.waitForExit, unsupportedHostOperation)
    .onRequest(acp.methods.client.terminal.kill, unsupportedHostOperation)
    .onRequest(acp.methods.client.terminal.release, unsupportedHostOperation)
    .onRequest(acp.methods.client.elicitation.create, () => ({ outcome: "cancel" }));
}

function withTimeout(operation, timeoutMs) {
  let handle;
  const expired = new Promise((_resolve, reject) => {
    handle = setTimeout(() => reject(
      probeError("CODEX_PREFLIGHT_TIMEOUT", "Codex preflight timed out."),
    ), timeoutMs);
    handle.unref?.();
  });
  return Promise.race([operation, expired]).finally(() => clearTimeout(handle));
}

async function existingAuthFile(baseEnvironment) {
  const codexHome = baseEnvironment?.CODEX_HOME
    || (baseEnvironment?.HOME ? path.join(baseEnvironment.HOME, ".codex") : null);
  if (!codexHome) return null;
  const candidate = path.join(codexHome, "auth.json");
  const information = await lstat(candidate).catch(() => null);
  return information?.isFile() && !information.isSymbolicLink()
    ? realpath(candidate)
    : null;
}

function selectOptions(configOptions, id) {
  const option = Array.isArray(configOptions)
    ? configOptions.find((entry) => entry?.id === id && entry?.type === "select")
    : null;
  return Object.freeze((option?.options || []).flatMap((entry) => {
    const value = bounded(entry?.value);
    if (!value) return [];
    return [Object.freeze({
      id: value,
      displayName: bounded(entry?.name, value),
      description: bounded(entry?.description),
    })];
  }));
}

function currentConfigValue(configOptions, id) {
  const option = Array.isArray(configOptions)
    ? configOptions.find((entry) => entry?.id === id)
    : null;
  return bounded(option?.currentValue) || null;
}

function splitCombinedModelId(value) {
  const text = bounded(value);
  const open = text.lastIndexOf("[");
  if (open <= 0 || !text.endsWith("]")) return { modelId: text, reasoning: null };
  return {
    modelId: text.slice(0, open),
    reasoning: text.slice(open + 1, -1) || null,
  };
}

function normalizeCatalog(session) {
  const configOptions = Array.isArray(session?.configOptions) ? session.configOptions : [];
  let models = selectOptions(configOptions, "model");
  let reasoningEfforts = selectOptions(configOptions, "reasoning_effort");
  if (models.length === 0) {
    const combined = session?.models?.availableModels || [];
    const seen = new Set();
    models = Object.freeze(combined.flatMap((entry) => {
      const combinedId = bounded(entry?.modelId);
      const { modelId } = splitCombinedModelId(combinedId);
      if (!modelId || seen.has(modelId)) return [];
      seen.add(modelId);
      return [Object.freeze({
        id: modelId,
        displayName: bounded(entry?.name, modelId).replace(/\s+\([^()]+\)$/u, ""),
        description: bounded(entry?.description),
      })];
    }));
    const efforts = new Set(combined.flatMap((entry) => {
      const { reasoning } = splitCombinedModelId(entry?.modelId);
      return reasoning ? [reasoning] : [];
    }));
    reasoningEfforts = Object.freeze([...efforts].map((id) => Object.freeze({
      id,
      displayName: id,
      description: "",
    })));
  }
  const combinedCurrent = bounded(session?.models?.currentModelId);
  return Object.freeze({
    models,
    reasoningEfforts,
    currentModelId: currentConfigValue(configOptions, "model")
      || splitCombinedModelId(combinedCurrent).modelId
      || null,
    currentReasoning: currentConfigValue(configOptions, "reasoning_effort")
      || splitCombinedModelId(combinedCurrent).reasoning
      || null,
    modes: Object.freeze((session?.modes?.availableModes || []).flatMap((entry) => {
      const id = bounded(entry?.id);
      return id ? [Object.freeze({ id, displayName: bounded(entry?.name, id) })] : [];
    })),
    currentMode: bounded(session?.modes?.currentModeId) || null,
  });
}

export async function probeAgentNativeAcp(launch) {
  if (process.platform !== "darwin") {
    throw probeError(
      "CODEX_SANDBOX_PLATFORM_UNSUPPORTED",
      "Codex preflight requires the pinned macOS sandbox boundary.",
    );
  }
  const timeoutMs = Number.isSafeInteger(launch?.timeoutMs) && launch.timeoutMs > 0
    ? launch.timeoutMs
    : DEFAULT_PROBE_TIMEOUT_MS;
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "stemmio-codex-probe-")));
  const probeRoot = path.join(root, "context");
  const stateRoot = path.join(root, "state");
  const codexHome = path.join(stateRoot, "codex-home");
  const homeRoot = path.join(stateRoot, "home");
  const temporaryRoot = path.join(stateRoot, "tmp");
  try {
    await Promise.all([
      mkdir(probeRoot, { mode: 0o500 }),
      mkdir(codexHome, { recursive: true, mode: 0o700 }),
      mkdir(homeRoot, { recursive: true, mode: 0o700 }),
      mkdir(temporaryRoot, { recursive: true, mode: 0o700 }),
    ]);
    const authFile = await existingAuthFile(launch.baseEnvironment);
    if (authFile) await symlink(authFile, path.join(codexHome, "auth.json"));
    const runtime = await realpath(process.execPath);
    const packageRoot = path.resolve(path.dirname(launch.adapterEntry), "..", "..", "..");
    const sandboxProfileFactory = ({ codexBinary, codeModeHost }) => macosAgentSandboxProfile({
      runtime,
      runtimeReadRoot: packagedRuntimeReadRoot(runtime),
      codexBinary,
      codeModeHost,
      packageRoot,
      contextRoot: probeRoot,
      stateRoot,
      authFile,
    });
    return await withAgentNativeAcpProcess({
      ...launch,
      cwd: probeRoot,
      mode: "read-only",
      sandboxProfileFactory,
      baseEnvironment: Object.freeze({
        ...(launch.baseEnvironment || {}),
        HOME: homeRoot,
        CODEX_HOME: codexHome,
        TMPDIR: temporaryRoot,
        XDG_CACHE_HOME: path.join(stateRoot, "cache"),
        XDG_CONFIG_HOME: path.join(stateRoot, "config"),
        XDG_DATA_HOME: path.join(stateRoot, "data"),
      }),
    }, ({ stream }) => withTimeout(probeClient().connectWith(stream, async (context) => {
      const initialized = await context.request(acp.methods.agent.initialize, {
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: {
          fs: { readTextFile: false, writeTextFile: false },
          terminal: false,
          session: { configOptions: { boolean: true } },
        },
        clientInfo: {
          name: "stemmio-codex-provider",
          title: "Stemmio Codex Provider",
          version: "1.0.0",
        },
      });
      if (initialized?.protocolVersion !== acp.PROTOCOL_VERSION) {
        throw probeError("CODEX_ACP_PROTOCOL_MISMATCH", "Codex ACP protocol is incompatible.");
      }
      const agentName = bounded(initialized?.agentInfo?.name);
      const adapterVersion = bounded(initialized?.agentInfo?.version);
      if (!/codex-acp/iu.test(agentName) || adapterVersion !== launch.adapterVersion) {
        throw probeError("CODEX_ACP_IDENTITY_MISMATCH", "The ACP adapter identity is incompatible.");
      }
      const authentication = await context.request("authentication/status", {});
      const authType = bounded(authentication?.type, "unknown");
      if (authType === "unauthenticated") {
        return Object.freeze({
          protocolVersion: initialized.protocolVersion,
          agentName,
          adapterVersion,
          auth: Object.freeze({ status: "required", type: authType }),
          models: Object.freeze([]),
          reasoningEfforts: Object.freeze([]),
          modes: Object.freeze([]),
        });
      }
      const session = await context.request(acp.methods.agent.session.new, {
        cwd: probeRoot,
        mcpServers: [],
      });
      try {
        const catalog = normalizeCatalog(session);
        if (catalog.models.length === 0) {
          throw probeError("CODEX_MODEL_CATALOG_EMPTY", "Codex returned no available models.");
        }
        return Object.freeze({
          protocolVersion: initialized.protocolVersion,
          agentName,
          adapterVersion,
          auth: Object.freeze({ status: "ready", type: authType }),
          sessionId: bounded(session?.sessionId),
          ...catalog,
        });
      } finally {
        if (session?.sessionId) {
          await context.request(acp.methods.agent.session.close, {
            sessionId: session.sessionId,
          }).catch(() => {});
        }
      }
    }), timeoutMs));
  } finally {
    await chmod(probeRoot, 0o700).catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
}
