import { assertAgentSecurityProfile } from "../providers/agent-provider-contract.mjs";
import { defineAgentRuntime } from "./agent-runtime-contract.mjs";
import { runAcpProcessTask } from "./acp-process.mjs";

export function thinAcpRuntimeEvent(event) {
  if (!event || typeof event !== "object" || Array.isArray(event)) return null;
  return Object.freeze({ ...event });
}

function acpCancellationSignal(signal) {
  if (!signal || typeof signal.addEventListener !== "function") return signal;
  const controller = new AbortController();
  const abort = () => {
    const reason = signal.reason;
    if (reason?.code === "AGENT_CANCELLED") {
      controller.abort(Object.assign(new Error("ACP runtime cancelled."), {
        code: "ACP_CANCELLED",
      }));
    } else {
      controller.abort(reason);
    }
  };
  if (signal.aborted) abort();
  else signal.addEventListener("abort", abort, { once: true });
  return controller.signal;
}

export function createAcpRuntime({ runTask = runAcpProcessTask } = {}) {
  if (typeof runTask !== "function") {
    throw new TypeError("ACP runtime requires a task runner.");
  }
  return defineAgentRuntime({
    runtimeId: "acp",
    run(launch) {
      if (!launch || typeof launch !== "object" || Array.isArray(launch)) {
        throw new TypeError("ACP runtime requires a launch descriptor.");
      }
      assertAgentSecurityProfile(launch.securityProfile, "ACP launch securityProfile");
      const onEvent = typeof launch.onEvent === "function" ? launch.onEvent : () => {};
      return runTask({
        ...launch,
        cancellationSignal: acpCancellationSignal(launch.cancellationSignal),
        onEvent(event) {
          const thinned = thinAcpRuntimeEvent(event);
          if (thinned) onEvent(thinned);
        },
      });
    },
  });
}

export const acpRuntime = createAcpRuntime();
