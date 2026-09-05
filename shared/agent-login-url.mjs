// Canonical login-host allowlist for Bridge. Main cannot import this file in
// the packaged app; `desktop/agent-login-url.mjs` restates the same rules.

const HTTPS_URL = /https:\/\/[^\s<>"'`]+/giu;

export const AGENT_LOGIN_HOST_SUFFIXES = Object.freeze({
  qoder: Object.freeze(["qoder.ai"]),
  codex: Object.freeze(["chatgpt.com", "openai.com"]),
});

function hostAllowed(hostname, suffixes) {
  const host = String(hostname || "").trim().toLowerCase().replace(/\.$/u, "");
  if (!host || host.includes(":") || /^\d{1,3}(?:\.\d{1,3}){3}$/u.test(host)) return false;
  return suffixes.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

export function allowedLoginHostsForProvider(providerId) {
  return AGENT_LOGIN_HOST_SUFFIXES[providerId] || Object.freeze([]);
}

export function publicAgentLoginUrl(value, { providerId } = {}) {
  let parsed;
  try {
    parsed = new URL(String(value || ""));
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  if (parsed.username || parsed.password) return null;
  if (parsed.port && parsed.port !== "443") return null;
  const suffixes = allowedLoginHostsForProvider(providerId);
  if (!suffixes.length || !hostAllowed(parsed.hostname, suffixes)) return null;
  parsed.hash = "";
  return parsed.toString();
}

export function extractAgentLoginUrl(text, { providerId } = {}) {
  const matches = String(text || "").match(HTTPS_URL) || [];
  for (const match of matches) {
    const cleaned = match.replace(/[),.;]+$/u, "");
    const allowed = publicAgentLoginUrl(cleaned, { providerId });
    if (allowed) return allowed;
  }
  return null;
}
