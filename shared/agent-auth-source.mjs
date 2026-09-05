export const AGENT_AUTH_SOURCES = Object.freeze([
  "cli-login",
  "chatgpt",
  "environment-token",
]);

export const AGENT_AUTH_SCOPES = Object.freeze([
  "app-managed",
  "shared-machine",
  "environment",
]);

const QODER_ENV_KEYS = Object.freeze([
  "QODER_API_KEY",
  "QODER_ACCESS_TOKEN",
  "QODER_PAT",
  "QODERCLI_TOKEN",
]);

const CODEX_ENV_KEYS = Object.freeze([
  "OPENAI_API_KEY",
  "CODEX_API_KEY",
]);

function firstPresentKey(environment, keys) {
  for (const key of keys) {
    if (String(environment?.[key] || "").trim()) return key;
  }
  return null;
}

export function publicAgentAuthSource({
  authSource = null,
  authScope = null,
} = {}) {
  return Object.freeze({
    authSource: AGENT_AUTH_SOURCES.includes(authSource) ? authSource : null,
    authScope: AGENT_AUTH_SCOPES.includes(authScope) ? authScope : null,
  });
}

export function qoderEnvironmentCredentialKey(environment = {}) {
  return firstPresentKey(environment, QODER_ENV_KEYS);
}

export function codexEnvironmentCredentialKey(environment = {}) {
  return firstPresentKey(environment, CODEX_ENV_KEYS);
}

export function describeQoderAuthSource(installation, environment = {}) {
  if (qoderEnvironmentCredentialKey(environment)) {
    return publicAgentAuthSource({
      authSource: "environment-token",
      authScope: "environment",
    });
  }
  return publicAgentAuthSource({
    authSource: "cli-login",
    authScope: installation?.installSource === "managed" ? "app-managed" : "shared-machine",
  });
}

export function describeCodexAuthSource(installation, environment = {}) {
  if (codexEnvironmentCredentialKey(environment)) {
    return publicAgentAuthSource({
      authSource: "environment-token",
      authScope: "environment",
    });
  }
  return publicAgentAuthSource({
    authSource: "chatgpt",
    authScope: installation?.installSource === "managed" ? "app-managed" : "shared-machine",
  });
}
