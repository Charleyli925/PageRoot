// OpenAI-compatible vendors for PageRoot's native HTTP Agent.
// Anthropic is intentionally absent.

const HTTPS_ORIGIN = /^https:\/\//u;

export const PAGEROOT_PROVIDER_ID = "pageroot";
export const PAGEROOT_RUNTIME_ID = "http";

export const OPENAI_COMPATIBLE_VENDORS = Object.freeze([
  Object.freeze({
    id: "deepseek",
    displayName: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    needsBaseUrl: false,
    defaultModels: Object.freeze([
      Object.freeze({ id: "deepseek-v4-flash", displayName: "V4 Flash" }),
      Object.freeze({ id: "deepseek-v4-pro", displayName: "V4 Pro" }),
    ]),
  }),
  Object.freeze({
    id: "zhipu",
    displayName: "智谱",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    needsBaseUrl: false,
    defaultModels: Object.freeze([
      Object.freeze({ id: "glm-4.5", displayName: "GLM-4.5" }),
      Object.freeze({ id: "glm-4.5-air", displayName: "GLM-4.5 Air" }),
      Object.freeze({ id: "glm-4-flash", displayName: "GLM-4 Flash" }),
      Object.freeze({ id: "glm-4-plus", displayName: "GLM-4 Plus" }),
    ]),
  }),
  Object.freeze({
    id: "dashscope",
    displayName: "阿里通义",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    needsBaseUrl: false,
    defaultModels: Object.freeze([
      Object.freeze({ id: "qwen-plus", displayName: "Qwen Plus" }),
      Object.freeze({ id: "qwen-turbo", displayName: "Qwen Turbo" }),
      Object.freeze({ id: "qwen-max", displayName: "Qwen Max" }),
    ]),
  }),
  Object.freeze({
    id: "openai",
    displayName: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    needsBaseUrl: false,
    defaultModels: Object.freeze([
      Object.freeze({ id: "gpt-4.1", displayName: "GPT-4.1" }),
      Object.freeze({ id: "gpt-4o", displayName: "GPT-4o" }),
      Object.freeze({ id: "gpt-4o-mini", displayName: "GPT-4o mini" }),
    ]),
  }),
  Object.freeze({
    id: "custom",
    displayName: "其他兼容接口",
    baseUrl: "",
    needsBaseUrl: true,
    defaultModels: Object.freeze([]),
  }),
]);

export function openaiCompatibleVendor(vendorId) {
  return OPENAI_COMPATIBLE_VENDORS.find((vendor) => vendor.id === vendorId) || null;
}

export function normalizeOpenAiCompatibleBaseUrl(value) {
  const text = String(value || "").trim();
  if (!text || !HTTPS_ORIGIN.test(text) || text.length > 200) return "";
  let url;
  try {
    url = new URL(text);
  } catch {
    return "";
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    return "";
  }
  if (!url.hostname || url.hostname === "localhost" || url.hostname.endsWith(".local")) {
    return "";
  }
  return `${url.origin}${url.pathname}`.replace(/\/+$/u, "");
}

export function resolveOpenAiCompatibleVendor(vendorId, baseUrl) {
  const vendor = openaiCompatibleVendor(String(vendorId || "").trim());
  if (!vendor) return null;
  if (vendor.needsBaseUrl) {
    const resolved = normalizeOpenAiCompatibleBaseUrl(baseUrl);
    if (!resolved) return null;
    return Object.freeze({
      ...vendor,
      baseUrl: resolved,
    });
  }
  return vendor;
}

const LOOPBACK_HTTP = /^https?:\/\/127\.0\.0\.1(?::\d+)?(?:\/[A-Za-z0-9._~!$&'()*+,;=:@%-]*)?$/u;

export function httpAgentTestOverrideEnabled(environment = {}) {
  return environment.PAGEROOT_E2E === "1"
    && environment.PAGEROOT_HTTP_AGENT_ALLOW_TEST_BASE_URL === "1";
}

export function testOpenAiCompatibleBaseUrl(environment = {}) {
  if (!httpAgentTestOverrideEnabled(environment)) return "";
  const text = String(environment.PAGEROOT_HTTP_AGENT_BASE_URL || "").trim();
  if (!text || text.length > 200 || !LOOPBACK_HTTP.test(text)) return "";
  let url;
  try {
    url = new URL(text);
  } catch {
    return "";
  }
  if (
    !["http:", "https:"].includes(url.protocol)
    || url.hostname !== "127.0.0.1"
    || url.username
    || url.password
    || url.search
    || url.hash
  ) {
    return "";
  }
  return `${url.origin}${url.pathname}`.replace(/\/+$/u, "");
}

export function httpAgentLaunchBaseUrl(environment, vendorBaseUrl) {
  if (httpAgentTestOverrideEnabled(environment)) {
    return testOpenAiCompatibleBaseUrl(environment);
  }
  return String(vendorBaseUrl || "");
}

export const OPENAI_COMPATIBLE_REASONING_CHOICES = Object.freeze([
  Object.freeze({ id: "none", label: "关闭" }),
  Object.freeze({ id: "low", label: "低" }),
  Object.freeze({ id: "high", label: "高" }),
  Object.freeze({ id: "max", label: "最深" }),
]);
export const DEFAULT_OPENAI_COMPATIBLE_REASONING = "high";

export function normalizeOpenAiCompatibleReasoning(value) {
  const id = String(value || "").trim();
  return OPENAI_COMPATIBLE_REASONING_CHOICES.some((choice) => choice.id === id) ? id : "";
}

export function openaiCompatibleChatThinkingFields(vendorId, reasoning) {
  const effort = normalizeOpenAiCompatibleReasoning(reasoning) || DEFAULT_OPENAI_COMPATIBLE_REASONING;
  if (String(vendorId || "") === "openai") {
    if (effort === "none") return Object.freeze({});
    return Object.freeze({
      reasoning_effort: effort === "max" ? "high" : effort,
    });
  }
  if (effort === "none") {
    return Object.freeze({ thinking: Object.freeze({ type: "disabled" }) });
  }
  return Object.freeze({
    thinking: Object.freeze({ type: "enabled" }),
    reasoning_effort: effort,
  });
}

export function publicOpenAiCompatibleReasoningChoices() {
  return OPENAI_COMPATIBLE_REASONING_CHOICES;
}

export function publicOpenAiCompatibleVendors() {
  return Object.freeze(OPENAI_COMPATIBLE_VENDORS.map((vendor) => Object.freeze({
    id: vendor.id,
    label: vendor.displayName,
    needsBaseUrl: vendor.needsBaseUrl === true,
  })));
}
