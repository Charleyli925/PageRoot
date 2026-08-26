import { sha256 } from "../../../scripts/lifecycle-core.mjs";
import { defineAgentProvider } from "../../../scripts/agent/providers/agent-provider-contract.mjs";
import { defineAgentRuntime } from "../../../scripts/agent/runtimes/agent-runtime-contract.mjs";

export function createSyntheticQoderProviderFixture({
  calls = [],
  runOutcome = Object.freeze({ stopReason: "end_turn" }),
  securityProfile = "client-mediated",
  launchSecurityProfile = securityProfile,
  legacyDrivers = ["qoder-acp"],
  capabilities: capabilityOverrides = {},
} = {}) {
  const installation = Object.freeze({
    fixtureId: "synthetic-qoder-installation",
    version: "1.1.27",
  });
  const capabilities = Object.freeze({
    availability: true,
    preflight: true,
    execution: true,
    discussion: true,
    modelCatalog: true,
    ...capabilityOverrides,
  });
  const provider = defineAgentProvider({
    providerId: "qoder",
    runtimeId: "acp",
    securityProfile,
    legacyDrivers,
    capabilities,
    async resolveInstallation() {
      calls.push("provider:resolve-installation");
      return installation;
    },
    async preflight(received) {
      calls.push("provider:preflight");
      if (received !== installation) throw new Error("fixture installation mismatch");
      return Object.freeze({
        version: "1.1.27",
        modelCount: 1,
        models: Object.freeze([
          Object.freeze({ id: "Synthetic-Model", displayName: "Synthetic-Model" }),
        ]),
      });
    },
    async assertInstallationUnchanged(received) {
      calls.push("provider:verify-installation");
      if (received !== installation) throw new Error("fixture installation changed");
    },
    installationDigest(received) {
      if (received !== installation) throw new Error("fixture installation changed");
      return sha256(Buffer.from("synthetic-qoder-installation@1.1.27", "utf8"));
    },
    availabilityFailure() {
      return Object.freeze({ status: "unavailable", reason: "check-failed" });
    },
    normalizePreflightError(cause) {
      return cause;
    },
    normalizeRuntimeError(cause) {
      return cause;
    },
    preflightFailureMessage() {
      return "Synthetic preflight failure.";
    },
    async loadExecutionPolicy(input) {
      calls.push("provider:load-policy");
      return Object.freeze({
        ...input,
        manifestPath: "/synthetic/request/input-manifest.json",
        finalizer: Object.freeze({
          command: "/synthetic/runtime/node",
          args: Object.freeze(["/synthetic/finalize-attempt.mjs"]),
          cwd: "/synthetic/request",
          env: Object.freeze({}),
        }),
      });
    },
    createRuntimeLaunch(input) {
      calls.push("provider:create-launch");
      return Object.freeze({
        ...input,
        securityProfile: launchSecurityProfile,
        fixtureLaunch: true,
      });
    },
    classifyRunFailure(cause) {
      return cause?.code || "SYNTHETIC_RUN_FAILED";
    },
    failureMessage(code) {
      return `Synthetic provider failure: ${code}`;
    },
  });
  const runtime = defineAgentRuntime({
    runtimeId: "acp",
    async run(launch) {
      calls.push("runtime:run");
      if (launch.fixtureLaunch !== true) throw new Error("fixture launch was not provider-built");
      launch.onEvent?.({
        kind: "initialized",
        agentName: "Synthetic Qoder",
        agentVersion: "1.1.27",
      });
      return runOutcome;
    },
  });
  return Object.freeze({ calls, provider, runtime, installation, capabilities });
}
