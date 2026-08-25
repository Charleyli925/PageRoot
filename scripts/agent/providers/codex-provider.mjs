import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { sha256 } from "../../lifecycle-core.mjs";
import {
  agentProviderError,
  defineAgentProvider,
} from "./agent-provider-contract.mjs";

export const CODEX_PROVIDER_ID = "codex";
export const CODEX_RUNTIME_ID = "acp";

const modulePath = fileURLToPath(import.meta.url);
const productRoot = path.resolve(path.dirname(modulePath), "..", "..", "..");
const SAFE_MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/+-]{0,159}$/u;

function failure(code, message, status = 503) {
  throw agentProviderError(code, message, { status });
}

function clean(value, maximum = 200) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/gu, "")
    .trim()
    .slice(0, maximum);
}

async function runtimeLock() {
  for (const candidate of [
    path.join(productRoot, "scripts", "agent", "codex-runtime-lock.json"),
    path.join(productRoot, "bridge", "agent", "codex-runtime-lock.json"),
  ]) {
    try {
      return JSON.parse(await readFile(candidate, "utf8"));
    } catch (cause) {
      if (cause?.code !== "ENOENT") throw cause;
    }
  }
  failure("CODEX_INSTALLATION_CORRUPT", "The pinned Codex runtime lock is unavailable.");
}

async function packageManifest(packageRoot) {
  try {
    return JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
  } catch {
    failure("CODEX_INSTALLATION_CORRUPT", "A pinned Codex package manifest is unavailable.");
  }
}

async function fileIdentity(filePath, { executable = false } = {}) {
  const resolved = await realpath(filePath).catch(() => {
    failure("CODEX_INSTALLATION_CORRUPT", "A pinned Codex runtime file is unavailable.");
  });
  if (resolved !== filePath) {
    failure("CODEX_INSTALLATION_CORRUPT", "A pinned Codex runtime path is not canonical.");
  }
  const information = await lstat(resolved);
  if (!information.isFile() || information.isSymbolicLink()
    || information.nlink !== 1 || (information.mode & 0o022) !== 0
    || (executable && (information.mode & 0o111) === 0)) {
    failure("CODEX_INSTALLATION_UNTRUSTED", "A pinned Codex runtime file is not protected.");
  }
  const bytes = await readFile(resolved);
  return Object.freeze({
    path: resolved,
    dev: information.dev,
    ino: information.ino,
    nlink: information.nlink,
    size: information.size,
    mtimeMs: information.mtimeMs,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}

function targetForPlatform() {
  const key = `${process.platform}-${process.arch}`;
  if (key !== "darwin-arm64") {
    failure(
      "CODEX_PLATFORM_UNSUPPORTED",
      "This Stemmio build does not include a supported Codex runtime for this platform.",
      409,
    );
  }
  return Object.freeze({
    key,
    packageName: "@openai/codex-darwin-arm64",
    triple: "aarch64-apple-darwin",
    executableName: "codex",
  });
}

export async function resolvePinnedCodexInstallation() {
  const lock = await runtimeLock();
  const target = targetForPlatform();
  const adapterRoot = path.join(productRoot, "node_modules", "@agentclientprotocol", "codex-acp");
  const codexRoot = path.join(productRoot, "node_modules", "@openai", "codex");
  const platformRoot = path.join(productRoot, "node_modules", "@openai", `codex-${target.key}`);
  const [adapterManifest, codexManifest, platformManifest] = await Promise.all([
    packageManifest(adapterRoot),
    packageManifest(codexRoot),
    packageManifest(platformRoot),
  ]);
  if (adapterManifest.name !== lock.adapter.name
    || adapterManifest.version !== lock.adapter.version
    || codexManifest.name !== lock.codex.name
    || codexManifest.version !== lock.codex.version
    || platformManifest.name !== lock.codex.name
    || platformManifest.version !== lock.codex.platformPackage.version) {
    failure("CODEX_INSTALLATION_INCOMPATIBLE", "The pinned Codex package versions are incompatible.");
  }
  const adapterEntry = path.join(adapterRoot, "dist", "index.js");
  const codexWrapper = path.join(codexRoot, "bin", "codex.js");
  const codexBinary = path.join(
    platformRoot,
    "vendor",
    target.triple,
    "bin",
    target.executableName,
  );
  const [adapterEntryIdentity, codexWrapperIdentity, codexBinaryIdentity] = await Promise.all([
    fileIdentity(adapterEntry, { executable: true }),
    fileIdentity(codexWrapper, { executable: true }),
    fileIdentity(codexBinary, { executable: true }),
  ]);
  if (adapterEntryIdentity.sha256 !== lock.adapter.entrySha256
    || codexWrapperIdentity.sha256 !== lock.codex.wrapperSha256
    || codexBinaryIdentity.sha256 !== lock.codex.platformPackage.binarySha256) {
    failure("CODEX_INSTALLATION_INCOMPATIBLE", "The pinned Codex runtime bytes are incompatible.");
  }
  return Object.freeze({
    adapterEntry,
    adapterEntryIdentity,
    adapterVersion: lock.adapter.version,
    adapterCommit: lock.adapter.upstreamCommit,
    codexWrapper,
    codexWrapperIdentity,
    codexBinary,
    codexBinaryIdentity,
    codexVersion: lock.codex.version,
    platform: target.key,
  });
}

function sameIdentity(left, right) {
  return left.path === right.path
    && left.dev === right.dev
    && left.ino === right.ino
    && left.nlink === right.nlink
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.sha256 === right.sha256;
}

export async function assertPinnedCodexInstallationUnchanged(installation) {
  const [adapterEntryIdentity, codexWrapperIdentity, codexBinaryIdentity] = await Promise.all([
    fileIdentity(installation.adapterEntry, { executable: true }),
    fileIdentity(installation.codexWrapper, { executable: true }),
    fileIdentity(installation.codexBinary, { executable: true }),
  ]);
  if (!sameIdentity(adapterEntryIdentity, installation.adapterEntryIdentity)
    || !sameIdentity(codexWrapperIdentity, installation.codexWrapperIdentity)
    || !sameIdentity(codexBinaryIdentity, installation.codexBinaryIdentity)) {
    failure("CODEX_INSTALLATION_CHANGED", "The pinned Codex runtime changed after preflight.", 409);
  }
}

function installationDigest(installation) {
  return sha256(Buffer.from(JSON.stringify({
    adapterVersion: installation.adapterVersion,
    adapterCommit: installation.adapterCommit,
    adapterEntryIdentity: installation.adapterEntryIdentity,
    codexVersion: installation.codexVersion,
    codexWrapperIdentity: installation.codexWrapperIdentity,
    codexBinaryIdentity: installation.codexBinaryIdentity,
    platform: installation.platform,
  }), "utf8"));
}

export const CODEX_LOCKED_CONFIG = Object.freeze({
  approval_policy: "never",
  sandbox_mode: "read-only",
  web_search: "disabled",
  mcp_servers: Object.freeze({}),
  analytics: Object.freeze({ enabled: false }),
  features: Object.freeze({
    apps: false,
    browser_use: false,
    computer_use: false,
    hooks: false,
    memories: false,
    multi_agent: false,
    multi_agent_v2: false,
    plugins: false,
    recommended_plugins: false,
    skill_search: false,
    standalone_web_search: false,
  }),
});

export function codexFailure(code) {
  switch (code) {
    case "CODEX_AUTH_REQUIRED":
      return "Codex 尚未登录。请先使用现有 Codex/ChatGPT 账号完成登录，再重试。";
    case "CODEX_MODEL_CATALOG_EMPTY":
      return "Codex 当前没有返回可用模型。请稍后重试。";
    case "CODEX_ACCOUNT_CAPACITY_UNAVAILABLE":
      return "Codex 账号当前没有可用容量。可稍后重试，或切换到其他 Agent。";
    case "CODEX_PLATFORM_UNSUPPORTED":
      return "当前 Stemmio 安装包不支持在此平台运行 Codex。";
    case "AGENT_PROCESS_CLEANUP_UNCONFIRMED":
      return "Codex 进程尚未确认完全停止。为避免失去控制，本轮不能继续。";
    case "AGENT_CANCELLED":
      return "Codex 已停止。";
    default:
      return "Codex 暂时无法完成本轮操作。当前页面和对话均已保留。";
  }
}

export function normalizeCodexError(cause) {
  const raw = clean(cause?.code, 120);
  const code = raw || "CODEX_RUNTIME_FAILED";
  if (cause instanceof Error) {
    cause.code = code;
    cause.message = codexFailure(code);
    return cause;
  }
  return agentProviderError(code, codexFailure(code), { status: 503 });
}

function classifyCodexRunFailure(cause) {
  const code = clean(cause?.code, 120);
  if (code) return code;
  return "CODEX_RUNTIME_FAILED";
}

function preflightEvidence(installation, probe) {
  if (!probe || typeof probe !== "object" || Array.isArray(probe)) {
    failure("CODEX_PREFLIGHT_INVALID", "Codex preflight returned no trusted evidence.");
  }
  if (probe.auth?.status === "required") {
    failure("CODEX_AUTH_REQUIRED", codexFailure("CODEX_AUTH_REQUIRED"), 401);
  }
  if (!Array.isArray(probe.models) || probe.models.length === 0) {
    failure("CODEX_MODEL_CATALOG_EMPTY", codexFailure("CODEX_MODEL_CATALOG_EMPTY"));
  }
  const models = Object.freeze(probe.models.flatMap((model) => {
    const id = clean(model?.id);
    if (!SAFE_MODEL_ID.test(id)) return [];
    return [Object.freeze({
      id: `${CODEX_PROVIDER_ID}:${id}`,
      displayName: clean(model?.displayName, 80) || id,
      description: clean(model?.description, 240),
    })];
  }));
  if (models.length === 0) {
    failure("CODEX_MODEL_CATALOG_EMPTY", codexFailure("CODEX_MODEL_CATALOG_EMPTY"));
  }
  return Object.freeze({
    version: installation.codexVersion,
    adapterVersion: installation.adapterVersion,
    protocolVersion: probe.protocolVersion,
    auth: probe.auth,
    modelCount: models.length,
    models,
    reasoningEfforts: probe.reasoningEfforts || Object.freeze([]),
    modes: probe.modes || Object.freeze([]),
    currentModelId: probe.currentModelId ? `${CODEX_PROVIDER_ID}:${probe.currentModelId}` : null,
    currentReasoning: probe.currentReasoning || null,
    currentMode: probe.currentMode || null,
  });
}

export function createCodexProvider({
  capabilities = {},
  installationResolver = resolvePinnedCodexInstallation,
  installationVerifier = assertPinnedCodexInstallationUnchanged,
  installationDigester = installationDigest,
} = {}) {
  return defineAgentProvider({
    providerId: CODEX_PROVIDER_ID,
    displayName: "Codex",
    runtimeId: CODEX_RUNTIME_ID,
    securityProfile: "agent-native",
    legacyDrivers: [],
    capabilities: {
      availability: true,
      preflight: true,
      modelCatalog: true,
      discussion: false,
      execution: false,
      ...capabilities,
    },
    resolveInstallation: () => installationResolver(),
    createProbeLaunch({ installation, purpose, baseEnvironment }) {
      return Object.freeze({
        securityProfile: "agent-native",
        purpose,
        adapterEntry: installation.adapterEntry,
        adapterEntryIdentity: installation.adapterEntryIdentity,
        adapterVersion: installation.adapterVersion,
        codexBinary: installation.codexBinary,
        codexBinaryIdentity: installation.codexBinaryIdentity,
        codexConfig: CODEX_LOCKED_CONFIG,
        baseEnvironment,
      });
    },
    preflight: (installation, { probe }) => preflightEvidence(installation, probe),
    resolveSelection(selection) {
      if (selection.requestedModelId !== null
        || selection.resolvedModelId !== null
        || selection.reasoning?.resolution !== "provider-default") {
        failure(
          "AGENT_SELECTION_UNSUPPORTED",
          "Codex model selection is not enabled until the live catalog contract is connected.",
          409,
        );
      }
      return selection;
    },
    assertInstallationUnchanged: installationVerifier,
    installationDigest: installationDigester,
    availabilityFailure(cause) {
      const code = clean(cause?.code, 120);
      if (code === "CODEX_PLATFORM_UNSUPPORTED") {
        return Object.freeze({ status: "unavailable", reason: "unsupported-platform" });
      }
      if (["CODEX_INSTALLATION_CORRUPT", "CODEX_INSTALLATION_UNTRUSTED"].includes(code)) {
        return Object.freeze({ status: "unavailable", reason: "invalid-installation" });
      }
      return Object.freeze({ status: "unavailable", reason: "check-failed" });
    },
    normalizePreflightError: normalizeCodexError,
    normalizeRuntimeError: normalizeCodexError,
    preflightFailureMessage: codexFailure,
    loadExecutionPolicy() {
      failure(
        "AGENT_CAPABILITY_UNSUPPORTED",
        "Codex execution is disabled until its sandbox authority gate passes.",
        409,
      );
    },
    createRuntimeLaunch({
      ticket,
      policy,
      prompt,
      baseEnvironment,
      cancellationSignal,
      onEvent,
      turnTimeoutMs,
    }) {
      return Object.freeze({
        securityProfile: "agent-native",
        purpose: ticket.purpose,
        adapterEntry: ticket.installation.adapterEntry,
        adapterEntryIdentity: ticket.installation.adapterEntryIdentity,
        adapterVersion: ticket.installation.adapterVersion,
        codexBinary: ticket.installation.codexBinary,
        codexBinaryIdentity: ticket.installation.codexBinaryIdentity,
        codexConfig: CODEX_LOCKED_CONFIG,
        cwd: policy.requestRoot,
        mode: ticket.purpose === "discussion" ? "read-only" : "agent",
        policy,
        prompt,
        baseEnvironment,
        cancellationSignal,
        onEvent,
        ...(turnTimeoutMs ? { turnTimeoutMs } : {}),
      });
    },
    classifyRunFailure: classifyCodexRunFailure,
    failureMessage: codexFailure,
  });
}

export const codexInstallationDigest = installationDigest;
