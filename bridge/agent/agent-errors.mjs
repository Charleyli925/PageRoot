import { AgentProviderError } from "./providers/agent-provider-contract.mjs";

export { AgentProviderError as AgentRuntimeError };

export function agentRuntimeError(code, message, options) {
  return new AgentProviderError(code, message, options);
}

export function cleanAgentText(value, maxLength = 160) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/gu, "")
    .trim()
    .slice(0, maxLength);
}

export function failAgentRuntime(code, message, options) {
  throw agentRuntimeError(code, message, options);
}

export const AGENT_CAPACITY_FAILURE_PATTERN =
  /capacity|quota|no available model|model unavailable|credit usage limit|upgrade your subscription plan/iu;

export function isAgentCapacityFailureText(value) {
  return AGENT_CAPACITY_FAILURE_PATTERN.test(String(value || ""));
}

const MAX_SESSION_API_KEY_CHARS = 512;

export function cleanSessionApiKey(value) {
  const key = String(value || "")
    .replace(/[\u0000-\u001f\u007f]/gu, "")
    .trim();
  if (!key || key.length > MAX_SESSION_API_KEY_CHARS) return "";
  return key;
}

export function sessionCredentialEnvironment(credential) {
  if (!credential || typeof credential !== "object") return Object.freeze({});
  const key = cleanSessionApiKey(credential.apiKey);
  const vendorId = cleanAgentText(credential.vendorId, 32);
  const baseUrl = String(credential.baseUrl || "").trim();
  if (!key || !vendorId || !baseUrl) return Object.freeze({});
  return Object.freeze({
    PAGEROOT_API_KEY: key,
    PAGEROOT_API_VENDOR: vendorId,
    PAGEROOT_API_BASE_URL: baseUrl,
  });
}
