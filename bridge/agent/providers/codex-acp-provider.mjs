import { execFile, spawn } from "node:child_process";
import {
  access,
  constants as fsConstants,
  lstat,
  readFile,
  readdir,
  realpath,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import * as acp from "@agentclientprotocol/sdk";
import semver from "semver";

import { sha256 } from "../../lifecycle-core.mjs";
import { loadExecutionPolicy } from "../policies/execution-policy.mjs";
import { terminateManagedProcess } from "../hosts/execution-host.mjs";
import { acpProcessEnvironment } from "../runtimes/acp-protocol.mjs";
import { openVerifiedAgentExecutable } from "../runtimes/acp-verified-javascript.mjs";
import {
  AgentProviderError,
  agentProviderError,
  defineAgentProvider,
} from "./agent-provider-contract.mjs";
import { cleanProviderText } from "./qoder-provider.mjs";

export const CODEX_ACP_PROVIDER_ID = "codex";
export const CODEX_ACP_RUNTIME_ID = "acp";
export const MIN_CODEX_ACP_VERSION = "1.7.0";
export const CODEX_ACP_PACKAGE_NAME = "@agentclientprotocol/codex-acp";

const MAX_PUBLIC_MODELS = 40;
const SAFE_MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._/:+-]{0,79}$/u;
const SAFE_REASONING = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/u;
const AUTH_FAILURE_PATTERN = /not logged in|not authenticated|sign in|login required|unauthenticated|auth required|chatgpt login/iu;
const AUTH_SUCCESS_PATTERN = /logged in(?:\s+using|\s+as|\s*$)|authenticated(?:\s+using|\s+as|\s*$)/iu;
const ACP_AUTH_REQUIRED_CODE = -32000;
const execFileAsync = promisify(execFile);

function fail(code, message, options) {
  throw agentProviderError(code, message, options);
}

function nativePackageName(platform = process.platform, arch = process.arch) {
  return `codex-${platform}-${arch}`;
}

function expandedHomePath(value, homeDirectory) {
  const text = String(value || "").trim().replace(/^['"]|['"]$/gu, "");
  if (!text) return null;
  const expanded = text
    .replace(/^~(?=\/|$)/u, homeDirectory)
    .replaceAll("${HOME}", homeDirectory)
    .replaceAll("$HOME", homeDirectory);
  return path.isAbsolute(expanded) ? path.normalize(expanded) : null;
}

async function configuredNpmPrefixes(environment, homeDirectory) {
  const prefixes = [];
  const configured = expandedHomePath(environment.NPM_CONFIG_PREFIX, homeDirectory);
  if (configured) prefixes.push(configured);
  const npmrc = await readFile(path.join(homeDirectory, ".npmrc"), "utf8").catch(() => "");
  for (const line of npmrc.split(/\r?\n/u)) {
    const match = line.match(/^\s*prefix\s*=\s*(.+?)\s*$/u);
    if (!match || match[1].trim().startsWith("#")) continue;
    const prefix = expandedHomePath(match[1], homeDirectory);
    if (prefix) prefixes.push(prefix);
  }
  return prefixes;
}

function versionDirectoryOrder(left, right) {
  const leftVersion = semver.coerce(left);
  const rightVersion = semver.coerce(right);
  if (leftVersion && rightVersion) return semver.rcompare(leftVersion, rightVersion);
  if (leftVersion) return -1;
  if (rightVersion) return 1;
  return right.localeCompare(left, "en");
}

async function versionedBinCandidates(root, suffix = ["bin", "codex-acp"]) {
  if (!root || !path.isAbsolute(root)) return [];
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .map((entry) => entry.name)
    .sort(versionDirectoryOrder)
    .map((name) => path.join(root, name, ...suffix));
}

async function commandCandidates(environment, homeDirectory) {
  const xdgDataHome = expandedHomePath(environment.XDG_DATA_HOME, homeDirectory)
    || path.join(homeDirectory, ".local", "share");
  const voltaHome = expandedHomePath(environment.VOLTA_HOME, homeDirectory)
    || path.join(homeDirectory, ".volta");
  const fnmRoots = [
    expandedHomePath(environment.FNM_DIR, homeDirectory),
    path.join(xdgDataHome, "fnm"),
    path.join(homeDirectory, ".fnm"),
  ].filter(Boolean);
  const miseDataHome = expandedHomePath(environment.MISE_DATA_DIR, homeDirectory)
    || path.join(xdgDataHome, "mise");
  const asdfDataHome = expandedHomePath(environment.ASDF_DATA_DIR, homeDirectory)
    || path.join(homeDirectory, ".asdf");
  const values = [];
  for (const directory of String(environment.PATH || "").split(path.delimiter)) {
    if (!directory || !path.isAbsolute(directory)) continue;
    values.push(path.join(directory, "codex-acp"));
  }
  for (const prefix of await configuredNpmPrefixes(environment, homeDirectory)) {
    values.push(path.join(prefix, "bin", "codex-acp"));
  }
  values.push(
    path.join(homeDirectory, ".npm-global", "bin", "codex-acp"),
    path.join(homeDirectory, ".local", "bin", "codex-acp"),
    path.join(voltaHome, "bin", "codex-acp"),
    "/opt/homebrew/bin/codex-acp",
    "/usr/local/bin/codex-acp",
  );
  values.push(...await versionedBinCandidates(path.join(homeDirectory, ".nvm", "versions", "node")));
  for (const root of fnmRoots) {
    values.push(...await versionedBinCandidates(
      path.join(root, "node-versions"),
      ["installation", "bin", "codex-acp"],
    ));
  }
  values.push(...await versionedBinCandidates(path.join(miseDataHome, "installs", "node")));
  values.push(...await versionedBinCandidates(path.join(homeDirectory, ".mise", "installs", "node")));
  values.push(...await versionedBinCandidates(path.join(asdfDataHome, "installs", "nodejs")));
  return [...new Set(values)];
}

async function fileIdentity(filePath) {
  try {
    const information = await lstat(filePath);
    if (
      !information.isFile()
      || information.isSymbolicLink()
      || information.nlink !== 1
      || (information.mode & 0o022) !== 0
    ) {
      fail("CODEX_COMMAND_UNTRUSTED", "Codex ACP executable is not a protected regular file.");
    }
    await access(filePath, fsConstants.X_OK).catch(() => {
      fail("CODEX_COMMAND_UNTRUSTED", "Codex ACP executable is not executable.");
    });
    const bytes = await readFile(filePath);
    return Object.freeze({
      dev: information.dev,
      ino: information.ino,
      nlink: information.nlink,
      size: information.size,
      mtimeMs: information.mtimeMs,
      sha256: sha256(bytes),
    });
  } catch (cause) {
    if (cause instanceof AgentProviderError) throw cause;
    fail("CODEX_COMMAND_UNTRUSTED", "Codex ACP executable identity could not be verified.");
  }
}

async function collectFiles(root) {
  const files = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    const information = await lstat(current).catch(() => null);
    if (!information) continue;
    if (information.isDirectory() && !information.isSymbolicLink()) {
      const children = await readdir(current).catch(() => []);
      for (const child of children) stack.push(path.join(current, child));
    } else if (information.isFile() && !information.isSymbolicLink()) {
      files.push(current);
    }
  }
  return files;
}

function looksLikeBundledPageRootCodex(filePath) {
  const normalized = path.normalize(filePath);
  return /[/\\]PageRoot\.app[/\\]Contents[/\\]Resources[/\\]/u.test(normalized)
    || /[/\\]extraResources[/\\]node_modules[/\\]@openai[/\\]codex/u.test(normalized);
}

async function assertProtectedNativeBinary(nativeRoot) {
  const information = await lstat(nativeRoot).catch(() => null);
  if (!information?.isDirectory() || information.isSymbolicLink() || (information.mode & 0o022) !== 0) {
    fail("CODEX_COMMAND_UNTRUSTED", "Codex native package directory is not a protected directory.");
  }
  const files = await collectFiles(nativeRoot);
  const executableName = process.platform === "win32" ? "codex.exe" : "codex";
  const binary = files.find((filePath) => path.basename(filePath) === executableName)
    || files.find((filePath) => path.basename(filePath).startsWith("codex"));
  if (!binary) fail("CODEX_COMMAND_UNTRUSTED", "Codex native executable was not found.");
  if (looksLikeBundledPageRootCodex(binary)) {
    fail("CODEX_COMMAND_UNTRUSTED", "PageRoot will not use an executable bundled inside the application for ACP.");
  }
  return Object.freeze({
    command: binary,
    identity: await fileIdentity(binary),
  });
}

async function findNativeRoot(packageRoot) {
  const nativeName = nativePackageName();
  const searchRoots = [
    path.join(packageRoot, "node_modules", "@openai", nativeName),
    path.join(path.dirname(packageRoot), "node_modules", "@openai", nativeName),
    path.join(path.dirname(path.dirname(packageRoot)), "@openai", nativeName),
    path.join(path.dirname(path.dirname(path.dirname(packageRoot))), "@openai", nativeName),
  ];
  for (const candidate of searchRoots) {
    const information = await lstat(candidate).catch(() => null);
    if (information?.isDirectory()) return candidate;
  }
  return null;
}

export async function validateNpmCodexAcpCommand(candidate, {
  expectedVersion = null,
} = {}) {
  let executable;
  try {
    executable = await realpath(candidate);
  } catch {
    return null;
  }
  if (path.basename(executable) !== "index.js" || path.basename(path.dirname(executable)) !== "dist") {
    fail("CODEX_COMMAND_UNTRUSTED", "Codex ACP executable does not match the supported package layout.");
  }
  const packageRoot = path.dirname(path.dirname(executable));
  let manifest;
  try {
    manifest = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
  } catch {
    fail("CODEX_COMMAND_UNTRUSTED", "Codex ACP package manifest could not be verified.");
  }
  if (
    manifest?.name !== CODEX_ACP_PACKAGE_NAME
    || manifest?.bin?.["codex-acp"] !== "dist/index.js"
    || !semver.valid(manifest?.version)
  ) {
    fail("CODEX_COMMAND_UNTRUSTED", "Codex ACP package identity could not be verified.");
  }
  if (semver.lt(manifest.version, MIN_CODEX_ACP_VERSION)) {
    fail(
      "CODEX_VERSION_UNSUPPORTED",
      `独立 Codex ACP 必须是 ${CODEX_ACP_PACKAGE_NAME} ${MIN_CODEX_ACP_VERSION} 或更高版本。`,
    );
  }
  if (expectedVersion && manifest.version !== expectedVersion) {
    fail("CODEX_VERSION_MISMATCH", "Codex ACP package version does not match the catalog pin.");
  }
  const [identity, packageInformation] = await Promise.all([
    fileIdentity(executable),
    lstat(packageRoot).catch(() => {
      fail("CODEX_COMMAND_UNTRUSTED", "Codex ACP package directory could not be verified.");
    }),
  ]);
  if (!packageInformation.isDirectory() || (packageInformation.mode & 0o022) !== 0) {
    fail("CODEX_COMMAND_UNTRUSTED", "Codex ACP package directory is writable by other users.");
  }
  const nativeRoot = await findNativeRoot(packageRoot);
  if (!nativeRoot) {
    fail("CODEX_COMMAND_UNTRUSTED", "Codex ACP native package was not found beside the adapter.");
  }
  const native = await assertProtectedNativeBinary(nativeRoot);
  const nodeModulesRoot = path.join(path.dirname(packageRoot), "node_modules");
  const nodeModulesInformation = await lstat(nodeModulesRoot).catch(() => null);
  return Object.freeze({
    command: executable,
    version: manifest.version,
    identity,
    nativeIdentity: native.identity,
    nativeCommand: native.command,
    nodeModulesRoot: nodeModulesInformation?.isDirectory() ? nodeModulesRoot : null,
    source: "verified-npm-package",
    installSource: "user",
  });
}

export async function resolveCodexAcpCommand({
  environment = process.env,
  homeDirectory = os.homedir(),
  managedCandidates = async () => [],
} = {}) {
  const configured = cleanProviderText(environment.PAGEROOT_CODEX_ACP_COMMAND, 4_096);
  const testOverride = configured
    && environment.PAGEROOT_E2E === "1"
    && environment.PAGEROOT_CODEX_ACP_ALLOW_TEST_COMMAND === "1";
  if (configured && !testOverride) {
    fail("CODEX_COMMAND_UNTRUSTED", "PAGEROOT_CODEX_ACP_COMMAND 只允许用于显式 E2E 测试。");
  }

  // Collect every source before validating/selecting one. This keeps a stale
  // global shim from masking a healthy PageRoot-managed installation and
  // makes the source priority explicit: configured test path, managed, user.
  const [managedResult, userResult] = await Promise.all([
    typeof managedCandidates === "function"
      ? Promise.resolve().then(() => managedCandidates()).then(
        (value) => Array.isArray(value) ? value : [],
        () => [],
      )
      : Promise.resolve([]),
    commandCandidates(environment, homeDirectory),
  ]);
  const diagnostics = [];
  const candidatesFor = async (candidates, source, expectedVersion = null) => {
    for (const candidate of candidates) {
      try {
        const resolved = await validateNpmCodexAcpCommand(candidate, {
          ...(expectedVersion ? { expectedVersion } : {}),
        });
        if (resolved) return Object.freeze({ ...resolved, installSource: source });
      } catch (cause) {
        if (cause instanceof AgentProviderError) {
          diagnostics.push({ source, cause });
          continue;
        }
        throw cause;
      }
    }
    return null;
  };

  if (testOverride) {
    if (!path.isAbsolute(configured)) {
      diagnostics.push({
        source: "explicit",
        cause: agentProviderError(
          "CODEX_COMMAND_UNTRUSTED",
          "测试 Codex ACP 命令必须是绝对路径。",
        ),
      });
    } else {
      const executable = await realpath(configured).catch(() => null);
      if (executable) {
        try {
          const identity = await fileIdentity(executable);
          return Object.freeze({
            command: executable,
            version: null,
            identity,
            // The explicit command is an E2E-only synthetic executable. It
            // implements both the ACP adapter and `login status`, so diagnosis
            // can prove the same ready/auth states as a real native closure.
            nativeCommand: executable,
            nativeIdentity: identity,
            nodeModulesRoot: null,
            source: "e2e-override",
            installSource: "explicit",
          });
        } catch (cause) {
          if (cause instanceof AgentProviderError) diagnostics.push({ source: "explicit", cause });
          else throw cause;
        }
      } else {
        diagnostics.push({
          source: "explicit",
          cause: agentProviderError("CODEX_COMMAND_NOT_FOUND", "测试 Codex ACP 命令不存在.", { status: 404 }),
        });
      }
    }
  }

  const managed = await candidatesFor(managedResult, "managed", MIN_CODEX_ACP_VERSION);
  if (managed) return managed;
  const user = await candidatesFor(userResult, "user");
  if (user) return user;
  const discoveredError = diagnostics[0]?.cause;
  if (discoveredError) throw discoveredError;
  fail("CODEX_COMMAND_NOT_FOUND", "没有找到独立安装的 Codex ACP。", { status: 404 });
}

export async function assertCodexAcpInstallationUnchanged(command) {
  const identityChanged = (current, expected) => (
    current.dev !== expected.dev
    || current.ino !== expected.ino
    || current.nlink !== expected.nlink
    || current.size !== expected.size
    || current.mtimeMs !== expected.mtimeMs
    || current.sha256 !== expected.sha256
  );
  const current = await fileIdentity(command.command);
  const nativeClosureIncomplete = Boolean(command.nativeCommand) !== Boolean(command.nativeIdentity);
  const nativeCurrent = command.nativeCommand && command.nativeIdentity
    ? await fileIdentity(command.nativeCommand)
    : null;
  if (
    identityChanged(current, command.identity)
    || nativeClosureIncomplete
    || (nativeCurrent && identityChanged(nativeCurrent, command.nativeIdentity))
  ) {
    fail("CODEX_COMMAND_CHANGED", "Codex ACP 在预检后发生变化，PageRoot 没有启动它。", {
      status: 409,
    });
  }
}

function installationDigest(command) {
  return sha256(Buffer.from(JSON.stringify({
    source: command.source,
    version: command.version,
    identity: command.identity,
    nativeIdentity: command.nativeIdentity,
  }), "utf8"));
}

function sessionModelCatalog(initializeResult, sessionResult) {
  const candidates = [
    sessionResult?.models,
    sessionResult?.availableModels,
    initializeResult?.agentCapabilities?.promptCapabilities?.models,
    initializeResult?.models,
  ];
  for (const candidate of candidates) {
    if (candidate == null) continue;
    if (Array.isArray(candidate)) {
      return Object.freeze({ ok: true, list: candidate, currentModelId: null });
    }
    if (typeof candidate === "object") {
      const list = candidate.availableModels ?? candidate.models;
      if (!Array.isArray(list)) {
        return Object.freeze({ ok: false, code: "CODEX_PROTOCOL_UNSUPPORTED" });
      }
      return Object.freeze({
        ok: true,
        list,
        currentModelId: cleanProviderText(candidate.currentModelId || candidate.modelId || "", 80) || null,
      });
    }
    return Object.freeze({ ok: false, code: "CODEX_PROTOCOL_UNSUPPORTED" });
  }
  return Object.freeze({ ok: true, list: [], currentModelId: null });
}

function namespacedModels(rawModels, currentModelId = null) {
  const seen = new Set();
  const models = [];
  const current = cleanProviderText(currentModelId, 80);
  for (const raw of rawModels) {
    const providerModelId = cleanProviderText(
      typeof raw === "string" ? raw : raw?.id || raw?.name || "",
      80,
    );
    if (!providerModelId || !SAFE_MODEL_ID.test(providerModelId) || seen.has(providerModelId)) continue;
    seen.add(providerModelId);
    const id = providerModelId.startsWith("codex:") ? providerModelId : `codex:${providerModelId}`;
    const matchesCurrent = Boolean(
      current
      && (providerModelId === current || id === current || id === `codex:${current}`),
    );
    models.push(Object.freeze({
      id,
      providerModelId: id.slice("codex:".length),
      displayName: cleanProviderText(raw?.displayName || providerModelId, 80) || id,
      reasoningEfforts: Object.freeze(
        Array.isArray(raw?.reasoningEfforts)
          ? raw.reasoningEfforts.filter((value) => SAFE_REASONING.test(String(value || "")))
          : [],
      ),
      defaultReasoningEffort: SAFE_REASONING.test(String(raw?.defaultReasoningEffort || ""))
        ? String(raw.defaultReasoningEffort)
        : null,
      isDefault: current ? matchesCurrent : raw?.isDefault === true,
    }));
    if (models.length >= MAX_PUBLIC_MODELS) break;
  }
  return Object.freeze(models);
}

function isCodexAcpAuthFailure(cause) {
  const jsonrpcCode = Number(cause?.jsonrpcCode ?? cause?.error?.code);
  if (jsonrpcCode === ACP_AUTH_REQUIRED_CODE) return true;
  const combined = `${cause?.stdout || ""}\n${cause?.stderr || ""}\n${cause?.message || ""}`;
  return AUTH_FAILURE_PATTERN.test(combined);
}

function classifyCodexAcpFailure(cause) {
  const mapped = cleanProviderText(cause?.code, 120);
  if (
    mapped === "AGENT_ACCOUNT_CAPACITY_UNAVAILABLE"
    || mapped === "CODEX_ACCOUNT_CAPACITY_UNAVAILABLE"
  ) {
    return "CODEX_ACCOUNT_CAPACITY_UNAVAILABLE";
  }
  if (isCodexAcpAuthFailure(cause)) return "CODEX_AUTH_REQUIRED";
  if (cause?.killed || cause?.code === "ETIMEDOUT" || cause?.signal === "SIGTERM") {
    return "CODEX_PREFLIGHT_TIMEOUT";
  }
  return mapped || "CODEX_PREFLIGHT_FAILED";
}

export function codexAcpFailure(code) {
  switch (code) {
    case "CODEX_AUTH_REQUIRED":
      return "Codex 尚未登录。请先在 Codex CLI 完成登录，再重试本轮。";
    case "CODEX_ACCOUNT_CAPACITY_UNAVAILABLE":
      return "Codex 账号当前没有可用额度。本轮 Request 已保留，可稍后重试或复制给其他 Agent。";
    case "CODEX_COMMAND_NOT_FOUND":
      return "没有找到独立安装的 Codex ACP。请先安装 Codex，或改用复制任务。";
    case "CODEX_COMMAND_UNTRUSTED":
      return "找到的 Codex ACP 不符合独立安装校验，PageRoot 没有启动它。";
    case "CODEX_VERSION_UNSUPPORTED":
      return "当前 Codex ACP 版本不受支持。请更新后再试。";
    case "AGENT_CANCELLED":
      return "Codex 已停止。";
    case "AGENT_TURN_TIMEOUT":
      return "Codex 本轮连续等待过久，已停止；Request 与当前 HTML 均已保留。";
    case "AGENT_NETWORK_INTERRUPTED":
      return "Codex 连接中断，Request 与当前 HTML 均已保留。";
    case "ACP_AGENT_IDENTITY_MISMATCH":
      return "ACP 进程没有证明自己是 Codex，PageRoot 已停止它。";
    default:
      return "Codex 没有完成本轮任务。Request 与当前 HTML 均已保留。";
  }
}

export function codexAcpPreflightFailure(code) {
  switch (code) {
    case "AGENT_PREFLIGHT_CLEANUP_UNCONFIRMED":
      return "Codex 预检进程未确认停止。PageRoot 尚未创建本轮 Request；为避免失去控制，本次不能继续，应用也不会退出。";
    case "CODEX_AUTH_REQUIRED":
      return "Codex 尚未登录。PageRoot 尚未创建本轮 Request；请先完成登录，再重试或改用复制任务。";
    case "CODEX_ACCOUNT_CAPACITY_UNAVAILABLE":
      return "Codex 账号当前没有可用额度。PageRoot 尚未创建本轮 Request；当前 HTML 和评论保持不变，可稍后重试或改用复制任务。";
    case "CODEX_COMMAND_NOT_FOUND":
      return "没有找到独立安装的 Codex ACP。PageRoot 尚未创建本轮 Request；请先安装，或改用复制任务。";
    case "CODEX_COMMAND_UNTRUSTED":
      return "找到的 Codex ACP 不符合独立安装校验。PageRoot 尚未创建本轮 Request，也没有启动该命令。";
    case "CODEX_COMMAND_CHANGED":
      return "Codex ACP 在预检期间发生变化。PageRoot 尚未创建本轮 Request，也没有启动变化后的命令。";
    case "CODEX_PREFLIGHT_TIMEOUT":
      return "Codex ACP 预检超时。PageRoot 尚未创建本轮 Request；当前 HTML 和评论保持不变，可重试或改用复制任务。";
    case "CODEX_PROTOCOL_UNSUPPORTED":
      return "当前 Codex 组件的模型目录无法识别。PageRoot 尚未创建本轮 Request；请更新受验证组件或改用其他服务。";
    default:
      return "Codex ACP 预检没有完成。PageRoot 尚未创建本轮 Request；当前 HTML 和评论保持不变，可重试或改用复制任务。";
  }
}

function normalizedPreflightError(cause) {
  const code = cause instanceof AgentProviderError
    ? cleanProviderText(cause.code, 120) || "CODEX_PREFLIGHT_FAILED"
    : "CODEX_COMMAND_UNTRUSTED";
  const status = code === "CODEX_AUTH_REQUIRED"
    ? 401
    : code === "CODEX_COMMAND_NOT_FOUND"
      ? 404
      : Number.isSafeInteger(cause?.status)
        ? cause.status
        : 503;
  return agentProviderError(code, codexAcpPreflightFailure(code), { status });
}

const RUNTIME_CODE_MAP = Object.freeze({
  ACP_CANCELLED: "AGENT_CANCELLED",
  ACP_TIMEOUT: "AGENT_TURN_TIMEOUT",
  ACP_TURN_TIMEOUT: "AGENT_TURN_TIMEOUT",
  CODEX_TURN_TIMEOUT: "AGENT_TURN_TIMEOUT",
  AGENT_TURN_TIMEOUT: "AGENT_TURN_TIMEOUT",
  ACP_AGENT_PROCESS_ERROR: "AGENT_NETWORK_INTERRUPTED",
  ACP_AGENT_EXITED_EARLY: "AGENT_NETWORK_INTERRUPTED",
  ACP_CONNECTION_CLOSED: "AGENT_NETWORK_INTERRUPTED",
  ACP_PROTOCOL_INVALID: "AGENT_NETWORK_INTERRUPTED",
  AGENT_ACCOUNT_CAPACITY_UNAVAILABLE: "CODEX_ACCOUNT_CAPACITY_UNAVAILABLE",
  ACP_OUTPUT_PREEXISTS: "AGENT_OUTPUT_PREEXISTS",
  ACP_COMPLETION_PREEXISTS: "AGENT_COMPLETION_PREEXISTS",
  ACP_PROCESS_CLEANUP_UNCONFIRMED: "AGENT_PROCESS_CLEANUP_UNCONFIRMED",
});

export function normalizeCodexAcpRuntimeError(cause) {
  const code = RUNTIME_CODE_MAP[cleanProviderText(cause?.code, 120)]
    || cleanProviderText(cause?.code, 120)
    || "CODEX_ACP_RUN_FAILED";
  if (cause instanceof Error) {
    cause.code = code;
    return cause;
  }
  return Object.assign(new Error("Agent runtime failed."), { code });
}

function launchEnvironment(installation) {
  if (typeof installation?.nodeModulesRoot === "string" && installation.nodeModulesRoot) {
    return Object.freeze({ NODE_PATH: installation.nodeModulesRoot });
  }
  return Object.freeze({});
}

async function readNdjsonResponse(child, requestId, timeoutMs) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => {
      cleanup();
      reject(Object.assign(new Error("Codex ACP probe timed out."), {
        code: "CODEX_PREFLIGHT_TIMEOUT",
      }));
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      child.stdout?.off("data", onData);
      child.off("error", onError);
      child.off("close", onClose);
    };
    const onData = (chunk) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/u);
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let parsed;
        try {
          parsed = JSON.parse(line);
        } catch {
          continue;
        }
        if (parsed?.id === requestId) {
          cleanup();
          resolve(parsed);
          return;
        }
      }
    };
    const onError = (cause) => {
      cleanup();
      reject(cause);
    };
    const onClose = () => {
      cleanup();
      reject(Object.assign(new Error("Codex ACP probe exited before the response completed."), {
        code: "CODEX_PREFLIGHT_FAILED",
      }));
    };
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", onData);
    child.once("error", onError);
    child.once("close", onClose);
  });
}

export async function probeCodexAcp(command, environment = process.env) {
  const processGroup = process.platform !== "win32";
  const envOverrides = launchEnvironment(command);
  const childEnvironment = {
    ...acpProcessEnvironment(envOverrides, environment),
  };
  const executableHandle = command.identity
    ? await openVerifiedAgentExecutable(command.command, {
      path: command.command,
      identity: command.identity,
    })
    : null;
  let child;
  try {
    child = spawn(command.command, [], {
      cwd: os.tmpdir(),
      env: childEnvironment,
      detached: processGroup,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } finally {
    await executableHandle?.close().catch(() => {});
  }
  let stderr = "";
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-16 * 1024);
  });
  try {
    const initializeId = 1;
    child.stdin.write(`${JSON.stringify({
      jsonrpc: "2.0",
      id: initializeId,
      method: acp.methods.agent.initialize,
      params: {
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
        clientInfo: {
          name: "pageroot-agent-bridge",
          title: "PageRoot Agent Bridge",
          version: "1.0.0",
        },
      },
    })}\n`);
    const initialized = await readNdjsonResponse(child, initializeId, 15_000);
    if (initialized.error) {
      const error = new Error(initialized.error.message || "Codex ACP initialize failed.");
      error.stderr = stderr;
      fail(classifyCodexAcpFailure(error), initialized.error.message || "Codex ACP initialize failed.");
    }
    const agentInfo = initialized.result?.agentInfo || {};
    const agentName = cleanProviderText(agentInfo.name, 80);
    if (!/codex/iu.test(agentName)) {
      fail("ACP_AGENT_IDENTITY_MISMATCH", "The selected ACP executable did not identify itself as Codex.");
    }
    const sessionId = 2;
    child.stdin.write(`${JSON.stringify({
      jsonrpc: "2.0",
      id: sessionId,
      method: acp.methods.agent.session.new,
      params: { cwd: os.tmpdir(), mcpServers: [] },
    })}\n`);
    const session = await readNdjsonResponse(child, sessionId, 15_000).catch((cause) => {
      cause.stderr = `${stderr}\n${cause.stderr || ""}`;
      throw cause;
    });
    if (session.error) {
      const error = new Error(session.error.message || "Codex ACP session failed.");
      error.stderr = `${stderr}\n${session.error.message || ""}`;
      error.jsonrpcCode = session.error.code;
      const code = classifyCodexAcpFailure(error);
      fail(code, session.error.message || "Codex ACP session failed.", {
        status: code === "CODEX_AUTH_REQUIRED" ? 401 : 503,
      });
    }
    const catalog = sessionModelCatalog(initialized.result, session.result);
    if (!catalog.ok) {
      fail(catalog.code, codexAcpPreflightFailure(catalog.code), { status: 503 });
    }
    const models = namespacedModels(catalog.list, catalog.currentModelId);
    const publicModels = models.length > 0 ? models : Object.freeze([Object.freeze({
      id: "codex:default",
      providerModelId: "default",
      displayName: "Codex",
      reasoningEfforts: Object.freeze([]),
      defaultReasoningEffort: null,
      isDefault: true,
    })]);
    return Object.freeze({
      version: command.version || cleanProviderText(agentInfo.version, 80) || null,
      protocol: "acp",
      authMode: "ready",
      modelCount: publicModels.length,
      models: publicModels,
    });
  } catch (cause) {
    const code = cause?.code === "ACP_PROCESS_CLEANUP_UNCONFIRMED"
      || cause?.code === "ACP_PREFLIGHT_CLEANUP_UNCONFIRMED"
      ? "AGENT_PREFLIGHT_CLEANUP_UNCONFIRMED"
      : cause instanceof AgentProviderError
        ? cause.code
        : classifyCodexAcpFailure({ ...cause, stderr });
    fail(code, codexAcpPreflightFailure(code), {
      status: code === "CODEX_AUTH_REQUIRED" ? 401 : 503,
      cause,
    });
  } finally {
    child.stdin?.end();
    if (!(await terminateManagedProcess(child, { processGroup }))) {
      fail(
        "AGENT_PREFLIGHT_CLEANUP_UNCONFIRMED",
        "Codex 预检进程未确认停止。PageRoot 尚未创建本轮 Request；为避免失去控制，本次不能继续，应用也不会退出。",
        { status: 503 },
      );
    }
  }
}

async function initializeCodexAcpForDiagnosis(command, environment, {
  authenticationVerified = false,
} = {}) {
  const processGroup = process.platform !== "win32";
  const envOverrides = launchEnvironment(command);
  const childEnvironment = {
    ...acpProcessEnvironment(envOverrides, environment),
  };
  const executableHandle = command.identity
    ? await openVerifiedAgentExecutable(command.command, {
      path: command.command,
      identity: command.identity,
    })
    : null;
  let child;
  try {
    child = spawn(command.command, [], {
      cwd: os.tmpdir(),
      env: childEnvironment,
      detached: processGroup,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } finally {
    await executableHandle?.close().catch(() => {});
  }
  let stderr = "";
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-16 * 1024);
  });
  try {
    child.stdin.write(`${JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: acp.methods.agent.initialize,
      params: {
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
        clientInfo: {
          name: "pageroot-agent-bridge",
          title: "PageRoot Agent Bridge",
          version: "1.0.0",
        },
      },
    })}\n`);
    const initialized = await readNdjsonResponse(child, 1, 15_000);
    if (initialized.error) {
      const error = new Error(initialized.error.message || "Codex ACP initialize failed.");
      error.stderr = stderr;
      error.jsonrpcCode = initialized.error.code;
      fail(classifyCodexAcpFailure(error), initialized.error.message || "Codex ACP initialize failed.");
    }
    const agentName = cleanProviderText(initialized.result?.agentInfo?.name, 80);
    if (!/codex/iu.test(agentName)) {
      fail("ACP_AGENT_IDENTITY_MISMATCH", "The selected ACP executable did not identify itself as Codex.");
    }
    return Object.freeze({
      readiness: authenticationVerified ? "ready" : "connection-failed",
      cause: authenticationVerified ? null : "CODEX_AUTH_UNVERIFIED",
      activeInstallation: null,
      facts: Object.freeze({
        installation: "ready",
        authentication: authenticationVerified ? "ready" : "unknown",
        protocol: "ready",
        service: "unknown",
      }),
    });
  } catch (cause) {
    if (cause instanceof AgentProviderError) throw cause;
    fail(classifyCodexAcpFailure({ ...cause, stderr }), "Codex ACP diagnosis failed.", { status: 503 });
  } finally {
    child.stdin?.end();
    if (!(await terminateManagedProcess(child, { processGroup }))) {
      fail("AGENT_PREFLIGHT_CLEANUP_UNCONFIRMED", "Codex diagnosis process did not stop.", { status: 503 });
    }
  }
}

export async function diagnoseCodexAcp(command, environment = process.env) {
  if (typeof command?.nativeCommand === "string" && command.nativeCommand) {
    const executableHandle = command.nativeIdentity
      ? await openVerifiedAgentExecutable(command.nativeCommand, {
        path: command.nativeCommand,
        identity: command.nativeIdentity,
      })
      : null;
    try {
      const result = await execFileAsync(command.nativeCommand, ["login", "status"], {
        cwd: os.tmpdir(),
        env: acpProcessEnvironment(launchEnvironment(command), environment),
        encoding: "utf8",
        timeout: 15_000,
        maxBuffer: 64 * 1024,
        windowsHide: true,
      });
      const output = `${result.stdout || ""}\n${result.stderr || ""}`;
      if (AUTH_FAILURE_PATTERN.test(output)) {
        fail("CODEX_AUTH_REQUIRED", "Codex 尚未登录。", { status: 401 });
      }
      if (!AUTH_SUCCESS_PATTERN.test(output)) {
        fail("CODEX_AUTH_UNVERIFIED", "Codex 登录状态无法确认。", { status: 503 });
      }
      if (typeof command?.command === "string" && command.command) {
        return initializeCodexAcpForDiagnosis(command, environment, {
          authenticationVerified: true,
        });
      }
      return Object.freeze({
        readiness: "ready",
        cause: null,
        activeInstallation: null,
        facts: Object.freeze({
          installation: "ready",
          authentication: "ready",
          protocol: "unknown",
          service: "unknown",
        }),
      });
    } catch (cause) {
      if (cause instanceof AgentProviderError) throw cause;
      const output = `${cause?.stdout || ""}\n${cause?.stderr || ""}\n${cause?.message || ""}`;
      if (AUTH_FAILURE_PATTERN.test(output)) {
        fail("CODEX_AUTH_REQUIRED", "Codex 尚未登录。", { status: 401 });
      }
      fail(
        cause?.code === "ETIMEDOUT" ? "CODEX_DIAGNOSE_TIMEOUT" : "CODEX_CONNECTION_FAILED",
        "Codex 登录状态无法确认。",
        { status: 503 },
      );
    } finally {
      await executableHandle?.close().catch(() => {});
    }
  }
  return initializeCodexAcpForDiagnosis(command, environment);
}

function resolvedSelection(selection, { evidence } = {}) {
  const models = evidence?.models || [];
  const requestedId = selection?.requestedModelId || null;
  const selected = requestedId
    ? models.find((model) => model.id === requestedId)
    : models.find((model) => model.isDefault) || models[0];
  if (requestedId && !selected) {
    fail("AGENT_SELECTION_UNSUPPORTED", "The requested Codex model is unavailable.", { status: 409 });
  }
  const requestedReasoning = selection?.reasoning?.requested;
  if (requestedReasoning && !SAFE_REASONING.test(requestedReasoning)) {
    fail("AGENT_SELECTION_UNSUPPORTED", "The requested Codex reasoning value is unsupported.", { status: 409 });
  }
  if (
    requestedReasoning
    && selected?.reasoningEfforts?.length
    && !selected.reasoningEfforts.includes(requestedReasoning)
  ) {
    fail("AGENT_SELECTION_UNSUPPORTED", "The requested Codex reasoning value is unsupported.", { status: 409 });
  }
  return Object.freeze({
    providerId: CODEX_ACP_PROVIDER_ID,
    runtimeId: CODEX_ACP_RUNTIME_ID,
    requestedModelId: requestedId,
    resolvedModelId: selected?.id || null,
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

export function createCodexAcpProvider({
  commandResolver = resolveCodexAcpCommand,
  diagnoseRunner = diagnoseCodexAcp,
  preflightRunner = probeCodexAcp,
  policyLoader = loadExecutionPolicy,
  managedCandidates,
} = {}) {
  if (
    typeof commandResolver !== "function"
    || typeof diagnoseRunner !== "function"
    || typeof preflightRunner !== "function"
    || typeof policyLoader !== "function"
  ) {
    throw new TypeError("Codex ACP provider dependencies are invalid.");
  }
  const resolveInstallation = typeof managedCandidates === "function"
    ? (input) => commandResolver({ ...input, managedCandidates })
    : commandResolver;
  return defineAgentProvider({
    providerId: CODEX_ACP_PROVIDER_ID,
    displayName: "Codex",
    runtimeId: CODEX_ACP_RUNTIME_ID,
    securityProfile: "client-mediated",
    capabilities: {
      availability: true,
      preflight: true,
      execution: true,
      modelCatalog: true,
    },
    resolveInstallation: ({ environment }) => resolveInstallation({ environment }),
    diagnose: (installation, { environment }) => diagnoseRunner(installation, environment),
    preflight: (installation, { environment }) => preflightRunner(installation, environment),
    assertInstallationUnchanged: assertCodexAcpInstallationUnchanged,
    installationDigest,
    availabilityFailure(cause) {
      const code = cleanProviderText(cause?.code, 120) || "CODEX_AVAILABILITY_FAILED";
      if (code === "CODEX_COMMAND_NOT_FOUND") return Object.freeze({ status: "not-installed" });
      return Object.freeze({
        status: "unavailable",
        reason: [
          "CODEX_COMMAND_UNTRUSTED",
          "CODEX_VERSION_UNSUPPORTED",
          "CODEX_VERSION_MISMATCH",
        ].includes(code) ? "invalid-installation" : "check-failed",
      });
    },
    normalizePreflightError: normalizedPreflightError,
    normalizeRuntimeError: normalizeCodexAcpRuntimeError,
    preflightFailureMessage: codexAcpPreflightFailure,
    loadExecutionPolicy: policyLoader,
    createRuntimeLaunch({
      ticket,
      policy,
      prompt,
      baseEnvironment,
      cancellationSignal,
      onEvent,
      turnTimeoutMs,
      inactivityTimeoutMs,
    }) {
      const installation = ticket.installation;
      return Object.freeze({
        securityProfile: "client-mediated",
        command: installation.command,
        expectedExecutable: {
          path: installation.command,
          identity: installation.identity,
        },
        args: [],
        policy,
        prompt,
        environment: launchEnvironment(installation),
        baseEnvironment,
        useVerifiedJavaScriptRuntime: false,
        cancellationSignal,
        expectedAgentName: installation.source === "e2e-override"
          ? /codex|pageroot-e2e/iu
          : /codex/iu,
        ...(turnTimeoutMs ? { turnTimeoutMs } : {}),
        ...(inactivityTimeoutMs ? { inactivityTimeoutMs } : {}),
        onEvent,
      });
    },
    classifyRunFailure(cause) {
      const mapped = cleanProviderText(cause?.code, 120);
      if (
        mapped === "AGENT_ACCOUNT_CAPACITY_UNAVAILABLE"
        || mapped === "CODEX_ACCOUNT_CAPACITY_UNAVAILABLE"
      ) {
        return "CODEX_ACCOUNT_CAPACITY_UNAVAILABLE";
      }
      if (["AGENT_TURN_TIMEOUT", "ACP_TURN_TIMEOUT", "ACP_TIMEOUT"].includes(mapped)) {
        return "AGENT_TURN_TIMEOUT";
      }
      if (mapped === "AGENT_NETWORK_INTERRUPTED") {
        return mapped;
      }
      if (isCodexAcpAuthFailure({
        ...cause,
        stderr: `${cause?.stderr || ""}\n${cause?.agentStderr || ""}`,
      })) {
        return "CODEX_AUTH_REQUIRED";
      }
      return mapped || "CODEX_ACP_RUN_FAILED";
    },
    failureMessage: codexAcpFailure,
    resolveSelection: resolvedSelection,
    defaultSelection: Object.freeze({
      providerId: CODEX_ACP_PROVIDER_ID,
      runtimeId: CODEX_ACP_RUNTIME_ID,
      requestedModelId: null,
      resolvedModelId: null,
      reasoning: Object.freeze({
        requested: null,
        applied: null,
        resolution: "provider-default",
      }),
    }),
  });
}

export const codexAcpProvider = createCodexAcpProvider();
