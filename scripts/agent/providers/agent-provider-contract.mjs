import { LifecycleError } from "../../lifecycle-core.mjs";

const SAFE_COMPONENT_ID = /^[a-z][a-z0-9-]{0,63}$/u;
const CAPABILITY_NAMES = Object.freeze([
  "availability",
  "preflight",
  "execution",
  "discussion",
  "modelCatalog",
]);

export class AgentProviderError extends LifecycleError {
  constructor(code, message, { status = 422, details } = {}) {
    super(code, message, details, status);
    this.name = "AgentBridgeError";
  }
}

export function agentProviderError(code, message, options) {
  return new AgentProviderError(code, message, options);
}

function assertComponentId(value, label) {
  if (typeof value !== "string" || !SAFE_COMPONENT_ID.test(value)) {
    throw new TypeError(`${label} must be a lower-case component identifier.`);
  }
  return value;
}

function normalizedCapabilities(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Agent provider capabilities must be an object.");
  }
  const unexpected = Object.keys(value).find((name) => !CAPABILITY_NAMES.includes(name));
  if (unexpected) {
    throw new TypeError(`Agent provider capability ${JSON.stringify(unexpected)} is unsupported.`);
  }
  return Object.freeze(Object.fromEntries(
    CAPABILITY_NAMES.map((name) => [name, value[name] === true]),
  ));
}

export function defineAgentProvider(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Agent provider must be an object.");
  }
  const providerId = assertComponentId(value.providerId, "providerId");
  const runtimeId = assertComponentId(value.runtimeId, "runtimeId");
  const legacyDrivers = Array.isArray(value.legacyDrivers)
    ? [...new Set(value.legacyDrivers.map((driver) => assertComponentId(driver, "legacy driver")))]
    : [];
  if (legacyDrivers.length === 0) {
    throw new TypeError("Agent provider must declare at least one legacy driver mapping.");
  }
  const requiredMethods = [
    "resolveInstallation",
    "preflight",
    "assertInstallationUnchanged",
    "installationDigest",
    "availabilityFailure",
    "normalizePreflightError",
    "preflightFailureMessage",
    "loadExecutionPolicy",
    "createRuntimeLaunch",
    "classifyRunFailure",
    "failureMessage",
  ];
  for (const method of requiredMethods) {
    if (typeof value[method] !== "function") {
      throw new TypeError(`Agent provider ${providerId} requires ${method}().`);
    }
  }
  return Object.freeze({
    ...value,
    providerId,
    runtimeId,
    legacyDrivers: Object.freeze(legacyDrivers),
    capabilities: normalizedCapabilities(value.capabilities),
  });
}

export function assertProviderTicket(ticket) {
  if (!ticket || typeof ticket !== "object" || Array.isArray(ticket)) {
    throw agentProviderError(
      "AGENT_PROVIDER_TICKET_INVALID",
      "Agent provider ticket is invalid.",
      { status: 409 },
    );
  }
  assertComponentId(ticket.providerId, "ticket providerId");
  assertComponentId(ticket.runtimeId, "ticket runtimeId");
  if (typeof ticket.installationDigest !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(ticket.installationDigest)) {
    throw agentProviderError(
      "AGENT_PROVIDER_TICKET_INVALID",
      "Agent provider ticket installation identity is invalid.",
      { status: 409 },
    );
  }
  normalizedCapabilities(ticket.capabilities);
  return ticket;
}
