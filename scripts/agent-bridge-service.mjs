import {
  AgentRuntimeCoordinator,
  TRUSTED_LOCAL_AGENT_POLICY_VERSION,
} from "./agent/agent-runtime-coordinator.mjs";
import { AgentProviderError as AgentBridgeError } from "./agent/providers/agent-provider-contract.mjs";

export { parsePublicModels, resolveQoderAcpCommand } from "./agent/providers/qoder-provider.mjs";
export { AgentBridgeError, TRUSTED_LOCAL_AGENT_POLICY_VERSION };

const LEGACY_DRIVER = "qoder-acp";

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

  availability() { return this.#coordinator.availability({ driver: LEGACY_DRIVER }); }

  preflight(input) { return this.#coordinator.preflight(input); }

  redeemCommandTicket(preflightId, options) {
    return this.#coordinator.redeemCommandTicket(preflightId, options);
  }

  submit(input) { return this.#coordinator.submit(input); }

  status(input) { return this.#coordinator.executionStatus(input); }

  interrupted(input) { return this.#coordinator.interrupted(input, { driver: LEGACY_DRIVER }); }

  cancel(input) { return this.#coordinator.cancelExecution(input); }

  cancelDurable(input) { return this.#coordinator.cancelDurableExecution(input); }

  dispose() { return this.#coordinator.shutdown(); }
}
