import { runQoderAcpTask } from "../../qoder-acp-client.mjs";
import { defineAgentRuntime } from "./agent-runtime-contract.mjs";

export function thinAcpRuntimeEvent(event) {
  if (!event || typeof event !== "object" || Array.isArray(event)) return null;
  // The hardened ACP client already bounds and sanitizes event fields. The
  // runtime boundary makes the envelope immutable and drops non-events without
  // assigning provider meaning to the standard ACP progress vocabulary.
  return Object.freeze({ ...event });
}

// PR1 keeps the already-hardened process and host implementation in its
// existing module. This adapter is the provider-neutral runtime boundary: it
// accepts one verified launch descriptor and owns no provider discovery,
// version, login, model or error-classification rule.
export function createAcpRuntime({ runTask = runQoderAcpTask } = {}) {
  if (typeof runTask !== "function") {
    throw new TypeError("ACP runtime requires a task runner.");
  }
  return defineAgentRuntime({
    runtimeId: "acp",
    run(launch) {
      if (!launch || typeof launch !== "object" || Array.isArray(launch)) {
        throw new TypeError("ACP runtime requires a launch descriptor.");
      }
      const onEvent = typeof launch.onEvent === "function" ? launch.onEvent : () => {};
      return runTask({
        ...launch,
        onEvent(event) {
          const thinned = thinAcpRuntimeEvent(event);
          if (thinned) onEvent(thinned);
        },
      });
    },
  });
}

export const acpRuntime = createAcpRuntime();
