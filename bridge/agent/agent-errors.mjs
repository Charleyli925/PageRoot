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
