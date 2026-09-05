import {
  AgentRuntimeCoordinator,
  TRUSTED_LOCAL_AGENT_POLICY_VERSION,
} from "./agent/agent-runtime-coordinator.mjs";
import { AgentProviderError as AgentBridgeError } from "./agent/providers/agent-provider-contract.mjs";
import { defaultManagedAgentDelivery } from "../shared/agent-delivery.mjs";

export { parsePublicModels, resolveQoderAcpCommand } from "./agent/providers/qoder-provider.mjs";
export { AgentBridgeError, TRUSTED_LOCAL_AGENT_POLICY_VERSION };

function defaultSelectionInput(input = {}) {
  const { driver: _ignored, ...rest } = input;
  return rest.selection
    ? rest
    : { selection: defaultManagedAgentDelivery().selection };
}

// Compatibility façade for existing routes. It owns no runtime facts.
export class AgentBridgeService {
  #coordinator;

  constructor(options = {}) {
    if (typeof options.resolveTask !== "function") {
      throw new TypeError("AgentBridgeService requires a task authority resolver.");
    }
    this.#coordinator = options.coordinator || new AgentRuntimeCoordinator(options);
  }

  get runtimeCoordinator() { return this.#coordinator; }

  async providers() {
    const listed = typeof this.#coordinator.publicProviderCatalog === "function"
      ? await this.#coordinator.publicProviderCatalog({ environment: process.env })
      : this.#coordinator.providerCatalog();
    return Object.freeze({
      ok: true,
      providers: listed,
      trustPolicyVersion: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
    });
  }

  install(providerId) {
    const catalog = this.#coordinator.agentCatalog;
    if (!catalog || typeof catalog.install !== "function") {
      throw new AgentBridgeError(
        "AGENT_INSTALL_UNSUPPORTED",
        "This Agent cannot be installed from PageRoot.",
        { status: 409 },
      );
    }
    return catalog.install(providerId);
  }

  cancelInstall(providerId) {
    const catalog = this.#coordinator.agentCatalog;
    if (!catalog || typeof catalog.cancelInstall !== "function") {
      throw new AgentBridgeError(
        "AGENT_INSTALL_UNSUPPORTED",
        "This Agent cannot be installed from PageRoot.",
        { status: 409 },
      );
    }
    return catalog.cancelInstall(providerId);
  }

  assertSelection(selection, purpose) {
    return this.#coordinator.assertSelection(selection, purpose);
  }

  availability(input = {}) {
    return this.#coordinator.availability(defaultSelectionInput(input));
  }

  diagnose(input = {}) {
    return this.#coordinator.diagnose(defaultSelectionInput(input));
  }

  preflight(input) { return this.#coordinator.preflight(input); }

  redeemCommandTicket(preflightId, options) {
    return this.#coordinator.redeemCommandTicket(preflightId, options);
  }

  submit(input) { return this.#coordinator.submit(input); }

  status(input) { return this.#coordinator.executionStatus(input); }

  setSessionCredential(providerId, apiKey, extras) {
    return this.#coordinator.setSessionCredential(providerId, apiKey, extras);
  }

  updateAgentConfiguration(providerId, candidate) {
    return this.#coordinator.updateAgentConfiguration(providerId, candidate);
  }

  clearSessionCredential(providerId) {
    return this.#coordinator.clearSessionCredential(providerId);
  }

  interrupted(input, options = {}) {
    return this.#coordinator.interrupted(input, defaultSelectionInput(options));
  }

  cancel(input) { return this.#coordinator.cancelExecution(input); }

  cancelDurable(input) { return this.#coordinator.cancelDurableExecution(input); }

  dispose() { return this.#coordinator.shutdown(); }
}
