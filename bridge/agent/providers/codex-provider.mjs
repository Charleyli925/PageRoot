import { createHash } from "node:crypto";
import {
  access,
  constants as fsConstants,
  lstat,
  readFile,
  realpath,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  AgentProviderError,
  agentProviderError,
  defineAgentProvider,
} from "./agent-provider-contract.mjs";
import {
  CodexAppServerError,
  probeCodexAppServer,
} from "../runtimes/codex-app-server-client.mjs";
import { CodexExecutionError } from "../runtimes/codex-app-server-runtime.mjs";
import { loadExecutionPolicy } from "../policies/execution-policy.mjs";

export const CODEX_PROVIDER_ID = "codex";
export const CODEX_RUNTIME_ID = "app-server";
export const PINNED_CODEX_VERSION = "0.149.1";

const PACKAGE_NAME = "@openai/codex";
const SAFE_REASONING = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/u;
const TARGETS = Object.freeze({
  "darwin:arm64": Object.freeze({
    packageDirectory: "codex-darwin-arm64",
    target: "aarch64-apple-darwin",
  }),
  "darwin:x64": Object.freeze({
    packageDirectory: "codex-darwin-x64",
    target: "x86_64-apple-darwin",
  }),
  "linux:arm64": Object.freeze({
    packageDirectory: "codex-linux-arm64",
    target: "aarch64-unknown-linux-musl",
  }),
  "linux:x64": Object.freeze({
    packageDirectory: "codex-linux-x64",
    target: "x86_64-unknown-linux-musl",
  }),
  "win32:arm64": Object.freeze({
    packageDirectory: "codex-win32-arm64",
    target: "aarch64-pc-windows-msvc",
    executable: "codex.exe",
  }),
  "win32:x64": Object.freeze({
    packageDirectory: "codex-win32-x64",
    target: "x86_64-pc-windows-msvc",
    executable: "codex.exe",
  }),
});

function fail(code, message, options) {
  throw agentProviderError(code, message, options);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function defaultResourcesRoot() {
  return fileURLToPath(new URL("../../../", import.meta.url));
}

async function readJson(filePath, code) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    fail(code, "The bundled Codex package metadata is invalid.");
  }
}

async function protectedFileIdentity(filePath, { executable = false } = {}) {
  const resolved = await realpath(filePath).catch(() => {
    fail("CODEX_INSTALLATION_MISSING", "The bundled Codex runtime is unavailable.", { status: 404 });
  });
  const information = await lstat(resolved).catch(() => null);
  if (!information?.isFile() || information.isSymbolicLink() || information.nlink !== 1) {
    fail("CODEX_INSTALLATION_UNTRUSTED", "The bundled Codex runtime identity is invalid.");
  }
  if ((information.mode & 0o022) !== 0) {
    fail("CODEX_INSTALLATION_UNTRUSTED", "The bundled Codex runtime is writable by other users.");
  }
  if (executable) {
    await access(resolved, fsConstants.X_OK).catch(() => {
      fail("CODEX_INSTALLATION_UNTRUSTED", "The bundled Codex runtime is not executable.");
    });
  }
  const bytes = await readFile(resolved);
  return Object.freeze({
    path: resolved,
    dev: information.dev,
    ino: information.ino,
    size: information.size,
    mtimeMs: information.mtimeMs,
    sha256: sha256(bytes),
  });
}

function sameIdentity(left, right) {
  return left?.path === right?.path
    && left?.dev === right?.dev
    && left?.ino === right?.ino
    && left?.size === right?.size
    && left?.mtimeMs === right?.mtimeMs
    && left?.sha256 === right?.sha256;
}

export async function resolveBundledCodexInstallation({
  resourcesRoot = defaultResourcesRoot(),
  platform = process.platform,
  arch = process.arch,
} = {}) {
  const target = TARGETS[`${platform}:${arch}`];
  if (!target) {
    fail("CODEX_PLATFORM_UNSUPPORTED", "This build does not include Codex for the current platform.");
  }
  const nodeModulesRoot = path.join(resourcesRoot, "node_modules", "@openai");
  const packageRoot = path.join(nodeModulesRoot, "codex");
  const platformRoot = path.join(nodeModulesRoot, target.packageDirectory);
  const wrapperManifestPath = path.join(packageRoot, "package.json");
  const launcherPath = path.join(packageRoot, "bin", "codex.js");
  const platformManifestPath = path.join(platformRoot, "package.json");
  const vendorRoot = path.join(platformRoot, "vendor", target.target);
  const runtimeManifestPath = path.join(vendorRoot, "codex-package.json");
  const commandPath = path.join(vendorRoot, "bin", target.executable || "codex");
  const [wrapperManifest, platformManifest, runtimeManifest] = await Promise.all([
    readJson(wrapperManifestPath, "CODEX_PACKAGE_INVALID"),
    readJson(platformManifestPath, "CODEX_PLATFORM_PACKAGE_INVALID"),
    readJson(runtimeManifestPath, "CODEX_RUNTIME_MANIFEST_INVALID"),
  ]);
  if (
    wrapperManifest?.name !== PACKAGE_NAME
    || wrapperManifest?.version !== PINNED_CODEX_VERSION
    || wrapperManifest?.license !== "Apache-2.0"
    || platformManifest?.name !== PACKAGE_NAME
    || platformManifest?.version !== `${PINNED_CODEX_VERSION}-${platform}-${arch}`
    || platformManifest?.license !== "Apache-2.0"
    || runtimeManifest?.layoutVersion !== 1
    || runtimeManifest?.version !== PINNED_CODEX_VERSION
    || runtimeManifest?.target !== target.target
    || runtimeManifest?.variant !== "codex"
    || runtimeManifest?.entrypoint !== `bin/${target.executable || "codex"}`
  ) {
    fail("CODEX_VERSION_MISMATCH", "The bundled Codex package versions do not match.");
  }
  const [launcherIdentity, commandIdentity] = await Promise.all([
    protectedFileIdentity(launcherPath),
    protectedFileIdentity(commandPath, { executable: true }),
  ]);
  return Object.freeze({
    resourcesRoot: path.resolve(resourcesRoot),
    packageRoot,
    platformRoot,
    command: commandIdentity.path,
    version: PINNED_CODEX_VERSION,
    platform,
    arch,
    target: target.target,
    launcherIdentity,
    commandIdentity,
  });
}

export function codexInstallationDigest(installation) {
  return `sha256:${sha256(JSON.stringify({
    version: installation.version,
    platform: installation.platform,
    arch: installation.arch,
    target: installation.target,
    launcher: installation.launcherIdentity.sha256,
    command: installation.commandIdentity.sha256,
  }))}`;
}

export async function assertCodexInstallationUnchanged(installation) {
  const current = await resolveBundledCodexInstallation({
    resourcesRoot: installation.resourcesRoot,
    platform: installation.platform,
    arch: installation.arch,
  });
  if (
    !sameIdentity(current.launcherIdentity, installation.launcherIdentity)
    || !sameIdentity(current.commandIdentity, installation.commandIdentity)
    || codexInstallationDigest(current) !== codexInstallationDigest(installation)
  ) {
    fail("CODEX_INSTALLATION_CHANGED", "The bundled Codex runtime changed after preflight.");
  }
  return installation;
}

function normalizeCodexError(cause) {
  if (cause instanceof AgentProviderError) return cause;
  const code = cause instanceof CodexAppServerError || cause instanceof CodexExecutionError
    ? cause.code
    : "CODEX_PREFLIGHT_FAILED";
  const status = Number.isSafeInteger(cause?.status) ? cause.status : 503;
  return agentProviderError(code, codexPreflightFailure(code), { status });
}

export function codexPreflightFailure(code) {
  switch (code) {
    case "CODEX_AUTH_REQUIRED":
      return "Codex 尚未登录。Stemmio 尚未创建本轮 Request；请先完成 Codex 登录。";
    case "CODEX_INSTALLATION_MISSING":
      return "当前 Stemmio 安装不包含受支持的 Codex runtime。尚未创建本轮 Request。";
    case "CODEX_VERSION_MISMATCH":
    case "CODEX_INSTALLATION_UNTRUSTED":
    case "CODEX_INSTALLATION_CHANGED":
      return "Codex runtime 未通过固定版本与完整性校验。尚未创建本轮 Request。";
    case "CODEX_MODEL_CATALOG_EMPTY":
      return "Codex 当前没有返回可用模型。尚未创建本轮 Request。";
    case "CODEX_APP_SERVER_CLEANUP_UNCONFIRMED":
      return "Codex 预检进程未确认停止。尚未创建本轮 Request，本次不能继续。";
    case "CODEX_APP_SERVER_TIMEOUT":
      return "Codex 预检超时。尚未创建本轮 Request，可稍后重试。";
    default:
      return "Codex 预检没有完成。尚未创建本轮 Request，当前 HTML 和评论保持不变。";
  }
}

function codexFailure(code) {
  if (code === "CODEX_EXECUTION_DISABLED") {
    return "当前构建尚未开放 Codex 修改能力。";
  }
  return "Codex 没有完成本轮任务。Request 与当前 HTML 均已保留。";
}

function codexExecutionPrompt(policy) {
  return [
    "Complete this single frozen Stemmio page-modification task.",
    `Read ${policy.manifestPath} and then every file in its exact readOrder.`,
    `Follow ${policy.promptPath}.`,
    `Write one complete HTML document only to ${policy.outputPath}.`,
    "Do not run a finalizer, do not create any other file, and do not modify any other path.",
    "After the Candidate file is complete, stop. Stemmio alone runs and verifies the fixed finalizer.",
    "The result remains a Candidate pending review and cannot replace the Working Copy without explicit adoption.",
  ].join("\n");
}

function selectionForCodex() {
  return Object.freeze({
    providerId: CODEX_PROVIDER_ID,
    runtimeId: CODEX_RUNTIME_ID,
    requestedModelId: null,
    resolvedModelId: null,
    reasoning: Object.freeze({
      requested: null,
      applied: null,
      resolution: "provider-default",
    }),
  });
}

function resolvedSelection(requested, { evidence } = {}) {
  const models = Array.isArray(evidence?.models) ? evidence.models : [];
  const requestedId = requested.requestedModelId;
  const selected = requestedId
    ? models.find((model) => model.id === requestedId)
    : models.find((model) => model.isDefault) || models[0];
  if (!selected) {
    fail("AGENT_SELECTION_UNSUPPORTED", "The selected Codex model is unavailable.", { status: 409 });
  }
  const requestedReasoning = requested.reasoning?.requested;
  if (requestedReasoning) {
    if (
      !SAFE_REASONING.test(requestedReasoning)
      || !selected.reasoningEfforts.includes(requestedReasoning)
    ) {
      fail("AGENT_SELECTION_UNSUPPORTED", "The selected Codex reasoning effort is unavailable.", {
        status: 409,
      });
    }
  }
  return Object.freeze({
    providerId: CODEX_PROVIDER_ID,
    runtimeId: CODEX_RUNTIME_ID,
    requestedModelId: requestedId,
    resolvedModelId: selected.id,
    reasoning: requestedReasoning
      ? Object.freeze({
        requested: requestedReasoning,
        applied: requestedReasoning,
        resolution: "exact",
      })
      : Object.freeze({
        requested: null,
        applied: null,
        resolution: "provider-default",
      }),
  });
}

export function createCodexProvider({
  installationResolver = resolveBundledCodexInstallation,
  probeRunner = probeCodexAppServer,
  executionEnabled = false,
  policyLoader = loadExecutionPolicy,
} = {}) {
  if (typeof installationResolver !== "function" || typeof probeRunner !== "function"
    || typeof policyLoader !== "function") {
    throw new TypeError("Codex provider dependencies are invalid.");
  }
  return defineAgentProvider({
    providerId: CODEX_PROVIDER_ID,
    displayName: "Codex",
    runtimeId: CODEX_RUNTIME_ID,
    securityProfile: "agent-native",
    legacyDrivers: [],
    capabilities: {
      availability: true,
      preflight: true,
      execution: executionEnabled === true,
      modelCatalog: true,
    },
    resolveInstallation: ({ environment }) => installationResolver({ environment }),
    async preflight(installation, { environment }) {
      const probe = await probeRunner({
        command: installation.command,
        cwd: installation.packageRoot,
        environment,
      });
      return Object.freeze({
        version: installation.version,
        protocol: probe.protocol,
        authMode: probe.authMode,
        modelCount: probe.models.length,
        models: probe.models,
      });
    },
    assertInstallationUnchanged: assertCodexInstallationUnchanged,
    installationDigest: codexInstallationDigest,
    availabilityFailure(cause) {
      const code = String(cause?.code || "");
      if (code === "CODEX_INSTALLATION_MISSING") return Object.freeze({ status: "not-installed" });
      return Object.freeze({
        status: "unavailable",
        reason: [
          "CODEX_VERSION_MISMATCH",
          "CODEX_INSTALLATION_UNTRUSTED",
          "CODEX_PLATFORM_UNSUPPORTED",
        ].includes(code) ? "invalid-installation" : "check-failed",
      });
    },
    normalizePreflightError: normalizeCodexError,
    normalizeRuntimeError: normalizeCodexError,
    preflightFailureMessage: codexPreflightFailure,
    loadExecutionPolicy(input) {
      if (executionEnabled !== true) {
        fail("CODEX_EXECUTION_DISABLED", "Codex execution is disabled in this build.", { status: 409 });
      }
      return policyLoader(input);
    },
    createRuntimeLaunch({
      ticket,
      policy,
      baseEnvironment,
      cancellationSignal,
      onEvent,
    } = {}) {
      if (executionEnabled !== true) {
        fail("CODEX_EXECUTION_DISABLED", "Codex execution is disabled in this build.", { status: 409 });
      }
      const namespacedModel = String(ticket?.selection?.resolvedModelId || "");
      if (!namespacedModel.startsWith("codex:") || namespacedModel.length <= "codex:".length) {
        fail("AGENT_SELECTION_UNSUPPORTED", "The resolved Codex model is unavailable.", { status: 409 });
      }
      return Object.freeze({
        securityProfile: "agent-native",
        command: ticket.installation.command,
        expectedCommandIdentity: ticket.installation.commandIdentity,
        cwd: path.dirname(policy.outputPath),
        environment: baseEnvironment,
        policy,
        prompt: codexExecutionPrompt(policy),
        model: namespacedModel.slice("codex:".length),
        effort: ticket.selection.reasoning.applied,
        cancellationSignal,
        onEvent,
      });
    },
    classifyRunFailure(cause) {
      return String(cause?.code || "CODEX_EXECUTION_FAILED");
    },
    failureMessage: codexFailure,
    resolveSelection: resolvedSelection,
    defaultSelection: selectionForCodex(),
  });
}

export const codexProvider = createCodexProvider();
