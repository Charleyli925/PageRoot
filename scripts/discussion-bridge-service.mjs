import { AgentRuntimeCoordinator } from "./agent/agent-runtime-coordinator.mjs";

// Compatibility façade for existing discussion routes. Production composition
// supplies the execution coordinator so both purposes share one runtime owner.
export class DiscussionBridgeService {
  #coordinator;
  #ownsCoordinator;

  constructor({ coordinator, providerRegistry, ...options } = {}) {
    this.#ownsCoordinator = !coordinator;
    this.#coordinator = coordinator || new AgentRuntimeCoordinator({
      ...(providerRegistry ? { providerRegistry } : {}),
      redeemCommandTicket: options.redeemCommandTicket,
      ...(options.environment ? { environment: options.environment } : {}),
      ...(options.clock ? { clock: options.clock } : {}),
      ...(options.leaseStore ? { leaseStore: options.leaseStore } : {}),
    });
    this.#coordinator.configureDiscussion({
      readWorkingCopy: options.readWorkingCopy,
      recordQuestion: options.recordQuestion,
      sealReply: options.sealReply,
      ...(options.runDiscussion ? { runDiscussion: options.runDiscussion } : {}),
      ...(options.createTurnRunner ? { createTurnRunner: options.createTurnRunner } : {}),
      ...(options.turnTimeoutMs ? { turnTimeoutMs: options.turnTimeoutMs } : {}),
    });
  }

  start(input) { return this.#coordinator.discussionStart(input); }

  status(input) { return this.#coordinator.discussionStatus(input); }

  cancel(input) { return this.#coordinator.cancelDiscussion(input); }

  dispose() {
    return this.#ownsCoordinator ? this.#coordinator.shutdown() : Promise.resolve();
  }
}
