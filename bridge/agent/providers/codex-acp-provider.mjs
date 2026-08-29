import { spawn } from "node:child_process";
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
const AUTH_FAILURE_PATTERN = /not logged in|sign in|login required|unauthenticated|auth required|chatgpt login/iu;
const ACP_AUTH_REQUIRED_CODE = -32000;

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
  return fileIdentity(binary);
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
  const nativeIdentity = await assertProtectedNativeBinary(nativeRoot);
  const nodeModulesRoot = path.join(path.dirname(packageRoot), "node_modules");
  const nodeModulesInformation = await lstat(nodeModulesRoot).catch(() => null);
  return Object.freeze({
    command: executable,
    version: manifest.version,
    identity,
    nativeIdentity,
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
  if (testOverride) {
    if (!path.isAbsolute(configured)) {
      fail("CODEX_COMMAND_UNTRUSTED", "测试 Codex ACP 命令必须是绝对路径。");
    }
    const executable = await realpath(configured).catch(() => null);
    if (!executable) fail("CODEX_COMMAND_NOT_FOUND", "测试 Codex ACP 命令不存在。");
    return Object.freeze({
      command: executable,
      version: null,
      identity: await fileIdentity(executable),
      nativeIdentity: null,
      nodeModulesRoot: null,
      source: "e2e-override",
      installSource: "none",
    });
  }

  let discoveredError = null;
  for (const candidate of await commandCandidates(environment, homeDirectory)) {
    try {
      const resolved = await validateNpmCodexAcpCommand(candidate);
      if (resolved) {
        return Object.freeze({
          ...resolved,
          installSource: "user",
        });
      }
    } catch (cause) {
      if (cause instanceof AgentProviderError) {
        discoveredError ||= cause;
        continue;
      }
      throw cause;
    }
  }
  if (discoveredError) throw discoveredError;

  if (typeof managedCandidates !== "function") {
    fail("CODEX_COMMAND_NOT_FOUND", "没有找到独立安装的 Codex ACP。", { status: 404 });
  }
  for (const candidate of await managedCandidates()) {
    try {
      const resolved = await validateNpmCodexAcpCommand(candidate, {
        expectedVersion: MIN_CODEX_ACP_VERSION,
      });
      if (resolved) {
        return Object.freeze({
          ...resolved,
          installSource: "managed",
        });
      }
    } catch (cause) {
      if (cause instanceof AgentProviderError) {
        discoveredError ||= cause;
        continue;
      }
      throw cause;
    }
  }
  if (discoveredError) throw discoveredError;
  fail("CODEX_COMMAND_NOT_FOUND", "没有找到独立安装的 Codex ACP。", { status: 404 });
}

export async function assertCodexAcpInstallationUnchanged(command) {
  const current = await fileIdentity(command.command);
  if (
    current.dev !== command.identity.dev
    || current.ino !== command.identity.ino
    || current.nlink !== command.identity.nlink
    || current.size !== command.identity.size
    || current.mtimeMs !== command.identity.mtimeMs
    || current.sha256 !== command.identity.sha256
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

function namespacedModels(rawModels) {
  const seen = new Set();
  const models = [];
  for (const raw of rawModels) {
    const providerModelId = cleanProviderText(
      typeof raw === "string" ? raw : raw?.id || raw?.name || "",
      80,
    );
    if (!providerModelId || !SAFE_MODEL_ID.test(providerModelId) || seen.has(providerModelId)) continue;
    seen.add(providerModelId);
    const id = providerModelId.startsWith("codex:") ? providerModelId : `codex:${providerModelId}`;
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
      isDefault: raw?.isDefault === true,
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
  if (isCodexAcpAuthFailure(cause)) return "CODEX_AUTH_REQUIRED";
  if (cause?.killed || cause?.code === "ETIMEDOUT" || cause?.signal === "SIGTERM") {
    return "CODEX_PREFLIGHT_TIMEOUT";
  }
  return cleanProviderText(cause?.code, 120) || "CODEX_PREFLIGHT_FAILED";
}

export function codexAcpFailure(code) {
  switch (code) {
    case "CODEX_AUTH_REQUIRED":
      return "Codex 尚未登录。请先在 Codex CLI 完成登录，再重试本轮。";
    case "CODEX_COMMAND_NOT_FOUND":
      return "没有找到独立安装的 Codex ACP。请先安装 Codex，或改用复制任务。";
    case "CODEX_COMMAND_UNTRUSTED":
      return "找到的 Codex ACP 不符合独立安装校验，PageRoot 没有启动它。";
    case "CODEX_VERSION_UNSUPPORTED":
      return "当前 Codex ACP 版本不受支持。请更新后再试。";
    case "AGENT_CANCELLED":
      return "Codex 已停止。";
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
    case "CODEX_COMMAND_NOT_FOUND":
      return "没有找到独立安装的 Codex ACP。PageRoot 尚未创建本轮 Request；请先安装，或改用复制任务。";
    case "CODEX_COMMAND_UNTRUSTED":
      return "找到的 Codex ACP 不符合独立安装校验。PageRoot 尚未创建本轮 Request，也没有启动该命令。";
    case "CODEX_COMMAND_CHANGED":
      return "Codex ACP 在预检期间发生变化。PageRoot 尚未创建本轮 Request，也没有启动变化后的命令。";
    case "CODEX_PREFLIGHT_TIMEOUT":
      return "Codex ACP 预检超时。PageRoot 尚未创建本轮 Request；当前 HTML 和评论保持不变，可重试或改用复制任务。";
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
    const models = namespacedModels(
      initialized.result?.agentCapabilities?.promptCapabilities?.models
      || initialized.result?.models
      || session.result?.models
      || session.result?.availableModels
      || [],
    );
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
  preflightRunner = probeCodexAcp,
  policyLoader = loadExecutionPolicy,
  managedCandidates,
} = {}) {
  if (
    typeof commandResolver !== "function"
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
    legacyDrivers: [],
    capabilities: {
      availability: true,
      preflight: true,
      execution: true,
      modelCatalog: true,
    },
    resolveInstallation: ({ environment }) => resolveInstallation({ environment }),
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
        onEvent,
      });
    },
    classifyRunFailure(cause) {
      if (isCodexAcpAuthFailure({
        ...cause,
        stderr: `${cause?.stderr || ""}\n${cause?.agentStderr || ""}`,
      })) {
        return "CODEX_AUTH_REQUIRED";
      }
      return cleanProviderText(cause?.code, 120) || "CODEX_ACP_RUN_FAILED";
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
