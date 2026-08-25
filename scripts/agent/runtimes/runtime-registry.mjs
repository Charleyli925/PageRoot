import { agentProviderError } from "../providers/agent-provider-contract.mjs";

export function createRuntimeRegistry(runtimes = []) {
  const byId = new Map();
  for (const runtime of runtimes) {
    if (!runtime?.runtimeId || typeof runtime.run !== "function") {
      throw new TypeError("Runtime registry entries must satisfy the Agent runtime contract.");
    }
    if (byId.has(runtime.runtimeId)) {
      throw new TypeError(`Duplicate Agent runtime ${runtime.runtimeId}.`);
    }
    byId.set(runtime.runtimeId, runtime);
  }
  return Object.freeze({
    resolve(runtimeId) {
      const runtime = byId.get(String(runtimeId || ""));
      if (!runtime) {
        throw agentProviderError(
          "AGENT_RUNTIME_UNSUPPORTED",
          "The requested Agent runtime is unsupported.",
          { status: 400 },
        );
      }
      return runtime;
    },
  });
}
