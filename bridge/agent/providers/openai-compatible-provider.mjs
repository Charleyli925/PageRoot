import { sha256 } from "../../lifecycle-core.mjs";
import { isAgentCapacityFailureText } from "../agent-errors.mjs";
import {
  AgentProviderError,
  agentProviderError,
  defineAgentProvider,
} from "./agent-provider-contract.mjs";
import { loadExecutionPolicy } from "../policies/execution-policy.mjs";
import {
  PAGEROOT_PROVIDER_ID,
  PAGEROOT_RUNTIME_ID,
  DEFAULT_OPENAI_COMPATIBLE_REASONING,
  httpAgentTestOverrideEnabled,
  normalizeOpenAiCompatibleReasoning,
  openaiCompatibleVendor,
  resolveOpenAiCompatibleVendor,
  testOpenAiCompatibleBaseUrl,
} from "../../../shared/openai-compatible-vendors.mjs";

const MAX_PUBLIC_MODELS = 40;
const SAFE_MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._/:+-]{0,79}$/u;

function fail(code, message, options) {
  throw agentProviderError(code, message, options);
}

function cleanText(value, maxLength = 160) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/gu, "")
    .trim()
    .slice(0, maxLength);
}

function credentialFromEnvironment(environment = {}) {
  const apiKey = cleanText(environment.PAGEROOT_API_KEY, 512);
  const resolved = resolveOpenAiCompatibleVendor(
    environment.PAGEROOT_API_VENDOR,
    environment.PAGEROOT_API_BASE_URL,
  );
  if (!apiKey || !resolved) return null;
  const fenced = httpAgentTestOverrideEnabled(environment);
  const testUrl = testOpenAiCompatibleBaseUrl(environment);
  if (fenced && !testUrl) return null;
  return Object.freeze({
    apiKey,
    vendorId: resolved.id,
    baseUrl: testUrl || resolved.baseUrl,
  });
}

function localModelId(modelId) {
  const value = String(modelId || "");
  return value.startsWith(`${PAGEROOT_PROVIDER_ID}:`)
    ? value.slice(`${PAGEROOT_PROVIDER_ID}:`.length)
    : value;
}

const VISION_MODEL = /vision/iu;

export function namespacePagerootModels(models, { fallback = [], names = new Map() } = {}) {
  const seen = new Set();
  const namespaced = [];
  for (const model of [...(Array.isArray(models) ? models : []), ...fallback]) {
    const localId = localModelId(model?.id || model);
    if (!SAFE_MODEL_ID.test(localId) || seen.has(localId) || VISION_MODEL.test(localId)) continue;
    seen.add(localId);
    namespaced.push(Object.freeze({
      id: `${PAGEROOT_PROVIDER_ID}:${localId}`,
      providerModelId: localId,
      displayName: cleanText(names.get(localId) || model?.displayName || localId, 80) || localId,
      isDefault: namespaced.length === 0,
    }));
    if (namespaced.length >= MAX_PUBLIC_MODELS) break;
  }
  return Object.freeze(namespaced);
}

export function parseOpenAiCompatibleModels(payload) {
  const rows = Array.isArray(payload?.data)
    ? payload.data
    : Array.isArray(payload)
      ? payload
      : [];
  return rows.map((item) => Object.freeze({
    id: String(item?.id || "").trim(),
    displayName: String(item?.id || "").trim(),
  }));
}

function classifyHttpFailure(cause) {
  const status = Number(cause?.status || cause?.details?.status || 0);
  const text = String(cause?.message || "");
  if (cause?.name === "AbortError" || cause?.code === "ABORT_ERR") {
    return "AGENT_PREFLIGHT_TIMEOUT";
  }
  if (status === 401 || status === 403 || cause?.code === "AGENT_AUTH_REQUIRED") {
    return "AGENT_AUTH_REQUIRED";
  }
  if (status === 429 || isAgentCapacityFailureText(text) || cause?.code === "AGENT_ACCOUNT_CAPACITY_UNAVAILABLE") {
    return "AGENT_ACCOUNT_CAPACITY_UNAVAILABLE";
  }
  if (status === 408 || status >= 500 || cause?.code === "AGENT_PREFLIGHT_TIMEOUT") {
    return "AGENT_PREFLIGHT_TIMEOUT";
  }
  return cause?.code || "AGENT_PROVIDER_UNAVAILABLE";
}

function wrapProviderError(cause, fallbackCode, fallbackMessage) {
  if (cause instanceof AgentProviderError) return cause;
  const code = classifyHttpFailure(cause);
  return agentProviderError(
    code || fallbackCode,
    cleanText(cause?.message, 160) || fallbackMessage,
    { status: code === "AGENT_AUTH_REQUIRED" ? 401 : 502 },
  );
}

async function listModels(fetchImpl, { baseUrl, apiKey, vendorId, signal }) {
  const vendor = openaiCompatibleVendor(vendorId);
  const fallback = vendor?.defaultModels || [];
  const names = new Map((fallback || []).map((model) => [model.id, model.displayName]));
  try {
    const response = await fetchImpl(`${baseUrl.replace(/\/+$/u, "")}/models`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      signal,
    });
    const text = await response.text();
    if (response.status === 401 || response.status === 403) {
      fail("AGENT_AUTH_REQUIRED", "API Token 无效或已过期。", { status: 401 });
    }
    if (response.status === 404) {
      return namespacePagerootModels(fallback, { names });
    }
    if (!response.ok) {
      const code = classifyHttpFailure({ status: response.status, message: text });
      fail(code, "模型列表没有接通。", { status: 502 });
    }
    let payload = {};
    try {
      payload = JSON.parse(text);
    } catch {
      payload = {};
    }
    const listed = namespacePagerootModels(parseOpenAiCompatibleModels(payload), {
      fallback,
      names,
    });
    if (!listed.length) fail("AGENT_AUTH_REQUIRED", "当前 Token 没有可用模型。", { status: 401 });
    return listed;
  } catch (cause) {
    if (cause instanceof AgentProviderError) throw cause;
    if (fallback.length && cause?.name !== "AbortError") {
      return namespacePagerootModels(fallback, { names });
    }
    throw wrapProviderError(cause, "AGENT_PROVIDER_UNAVAILABLE", "模型列表没有接通。");
  }
}

function resolvedPagerootReasoning(selection) {
  const requested = normalizeOpenAiCompatibleReasoning(selection?.reasoning?.requested);
  if (requested) {
    return Object.freeze({
      requested,
      applied: requested,
      resolution: "exact",
    });
  }
  return Object.freeze({
    requested: null,
    applied: null,
    resolution: "provider-default",
  });
}

function resolvedPagerootSelection(selection, { evidence } = {}) {
  const models = evidence?.models || [];
  const requestedId = selection?.requestedModelId || null;
  const selected = requestedId
    ? models.find((model) => model.id === requestedId)
    : models.find((model) => model.isDefault) || models[0];
  if (requestedId && !selected) {
    fail("AGENT_SELECTION_UNSUPPORTED", "当前 Token 没有这个模型。", { status: 409 });
  }
  return Object.freeze({
    providerId: PAGEROOT_PROVIDER_ID,
    runtimeId: PAGEROOT_RUNTIME_ID,
    requestedModelId: requestedId,
    resolvedModelId: selected?.id || null,
    reasoning: resolvedPagerootReasoning(selection),
  });
}

export function createOpenAiCompatibleProvider({
  fetchImpl = fetch,
  policyLoader = loadExecutionPolicy,
} = {}) {
  return defineAgentProvider({
    providerId: PAGEROOT_PROVIDER_ID,
    runtimeId: PAGEROOT_RUNTIME_ID,
    displayName: "源页 Agent",
    securityProfile: "client-mediated",
    legacyDrivers: [],
    capabilities: {
      availability: true,
      preflight: true,
      execution: true,
      modelCatalog: true,
    },
    resolveInstallation({ environment } = {}) {
      const credential = credentialFromEnvironment(environment);
      if (!credential) {
        fail("AGENT_AUTH_REQUIRED", "还没有接通 API Token。", { status: 401 });
      }
      return Object.freeze({
        source: "session-credential",
        vendorId: credential.vendorId,
        baseUrl: credential.baseUrl,
        version: "1.0.0",
        credentialDigest: sha256(Buffer.from(credential.apiKey, "utf8")),
      });
    },
    async preflight(installation, { environment, selection } = {}) {
      const credential = credentialFromEnvironment(environment);
      if (!credential || credential.vendorId !== installation.vendorId
        || credential.baseUrl !== installation.baseUrl
        || sha256(Buffer.from(credential.apiKey, "utf8")) !== installation.credentialDigest) {
        fail("AGENT_AUTH_REQUIRED", "API Token 已变化，请重新连接。", { status: 401 });
      }
      const models = await listModels(fetchImpl, {
        baseUrl: credential.baseUrl,
        apiKey: credential.apiKey,
        vendorId: credential.vendorId,
        signal: AbortSignal.timeout(15_000),
      });
      const evidence = Object.freeze({
        version: "1.0.0",
        modelCount: models.length,
        models,
        vendorId: credential.vendorId,
      });
      if (selection) resolvedPagerootSelection(selection, { evidence });
      return evidence;
    },
    assertInstallationUnchanged(installation) {
      if (installation?.source !== "session-credential" || !installation.credentialDigest) {
        fail("AGENT_INSTALLATION_CHANGED", "API Token 已变化，请重新连接。", { status: 409 });
      }
    },
    installationDigest(installation) {
      return sha256(Buffer.from(
        `${installation.vendorId}\0${installation.baseUrl}\0${installation.credentialDigest}`,
        "utf8",
      ));
    },
    availabilityFailure(cause) {
      const code = classifyHttpFailure(cause);
      if (code === "AGENT_AUTH_REQUIRED") return Object.freeze({ status: "auth-required" });
      if (code === "AGENT_ACCOUNT_CAPACITY_UNAVAILABLE") {
        return Object.freeze({ status: "unavailable", reason: "account-capacity" });
      }
      if (code === "AGENT_PREFLIGHT_TIMEOUT") {
        return Object.freeze({ status: "unavailable", reason: "timeout" });
      }
      return Object.freeze({ status: "unavailable", reason: "check-failed" });
    },
    normalizePreflightError(cause) {
      return wrapProviderError(cause, "AGENT_PROVIDER_UNAVAILABLE", "源页 Agent 预检没有完成。");
    },
    normalizeRuntimeError(cause) {
      return wrapProviderError(cause, "AGENT_PROVIDER_UNAVAILABLE", "源页 Agent 没有完成这一轮。");
    },
    preflightFailureMessage(code) {
      switch (code) {
        case "AGENT_AUTH_REQUIRED":
          return "还没有接通 Token。";
        case "AGENT_ACCOUNT_CAPACITY_UNAVAILABLE":
          return "额度已用完。";
        case "AGENT_PREFLIGHT_TIMEOUT":
          return "连接超时，请重试。";
        default:
          return "暂时无法接通。";
      }
    },
    loadExecutionPolicy: policyLoader,
    createRuntimeLaunch({
      ticket,
      policy,
      baseEnvironment,
      cancellationSignal,
      onEvent,
      turnTimeoutMs,
    }) {
      const credential = credentialFromEnvironment(baseEnvironment);
      return Object.freeze({
        securityProfile: "client-mediated",
        modelId: localModelId(ticket.selection?.resolvedModelId),
        reasoning: normalizeOpenAiCompatibleReasoning(ticket.selection?.reasoning?.applied)
          || normalizeOpenAiCompatibleReasoning(ticket.selection?.reasoning?.requested)
          || DEFAULT_OPENAI_COMPATIBLE_REASONING,
        policy,
        environment: Object.freeze({
          PAGEROOT_API_KEY: String(credential?.apiKey || baseEnvironment?.PAGEROOT_API_KEY || ""),
          PAGEROOT_API_BASE_URL: String(credential?.baseUrl || baseEnvironment?.PAGEROOT_API_BASE_URL || ""),
          PAGEROOT_API_VENDOR: String(credential?.vendorId || baseEnvironment?.PAGEROOT_API_VENDOR || ""),
        }),
        cancellationSignal,
        onEvent,
        ...(turnTimeoutMs ? { turnTimeoutMs } : {}),
      });
    },
    classifyRunFailure(cause) {
      return classifyHttpFailure(cause);
    },
    failureMessage(code) {
      switch (code) {
        case "AGENT_AUTH_REQUIRED":
          return "Token 无效或已过期。本轮已保留。";
        case "AGENT_ACCOUNT_CAPACITY_UNAVAILABLE":
          return "额度已用完。本轮已保留。";
        case "AGENT_OUTPUT_INVALID":
          return "没有返回完整 HTML。本轮已保留。";
        case "AGENT_PROMPT_TOO_LARGE":
          return "页面太大，可复制给别的 AI。";
        case "AGENT_CANCELLED":
          return "已停止。";
        default:
          return "没有完成这一轮。本轮已保留。";
      }
    },
    resolveSelection: resolvedPagerootSelection,
  });
}

export const openAiCompatibleProvider = createOpenAiCompatibleProvider();
