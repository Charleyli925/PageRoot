import {
  agentProviderError,
  assertAgentSecurityProfile,
  assertProviderTicket,
} from "./agent-provider-contract.mjs";
import { createQoderProvider } from "./qoder-provider.mjs";
import { createAcpRuntime } from "../runtimes/acp-runtime.mjs";
import { createRuntimeRegistry } from "../runtimes/runtime-registry.mjs";

function unsupportedDriver() {
  throw agentProviderError(
    "AGENT_DRIVER_UNSUPPORTED",
    "当前只支持 Qoder CLI 的 ACP 驱动。",
    { status: 400 },
  );
}

export function createProviderRegistry({ providers = [], runtimeRegistry } = {}) {
  if (!runtimeRegistry || typeof runtimeRegistry.resolve !== "function") {
    throw new TypeError("Provider registry requires a runtime registry.");
  }
  const byProviderId = new Map();
  const byLegacyDriver = new Map();
  for (const provider of providers) {
    if (!provider?.providerId || !provider?.runtimeId) {
      throw new TypeError("Provider registry entries must satisfy the Agent provider contract.");
    }
    if (byProviderId.has(provider.providerId)) {
      throw new TypeError(`Duplicate Agent provider ${provider.providerId}.`);
    }
    // Resolve at composition time so a provider cannot register a runtime that
    // will fail only after a one-use preflight ticket has been consumed.
    runtimeRegistry.resolve(provider.runtimeId);
    byProviderId.set(provider.providerId, provider);
    for (const driver of provider.legacyDrivers) {
      if (byLegacyDriver.has(driver)) {
        throw new TypeError(`Duplicate legacy Agent driver mapping ${driver}.`);
      }
      byLegacyDriver.set(driver, provider.providerId);
    }
  }

  const resolveProvider = (providerId) => {
    const provider = byProviderId.get(String(providerId || ""));
    if (!provider) {
      throw agentProviderError(
        "AGENT_PROVIDER_UNSUPPORTED",
        "The requested Agent provider is unsupported.",
        { status: 400 },
      );
    }
    return provider;
  };

  const bindingForProvider = (provider) => Object.freeze({
    provider,
    runtime: runtimeRegistry.resolve(provider.runtimeId),
  });

  const resolveDriver = (driver) => {
    const providerId = byLegacyDriver.get(String(driver || ""));
    if (!providerId) unsupportedDriver();
    return bindingForProvider(resolveProvider(providerId));
  };

  const resolveTicket = (ticketInput) => {
    const ticket = assertProviderTicket(ticketInput);
    const binding = bindingForProvider(resolveProvider(ticket.providerId));
    if (
      binding.provider.runtimeId !== ticket.runtimeId
      || binding.provider.securityProfile !== ticket.securityProfile
      || !binding.provider.legacyDrivers.includes(ticket.driver)
    ) {
      throw agentProviderError(
        "AGENT_PROVIDER_TICKET_INVALID",
        "Agent provider ticket binding is invalid.",
        { status: 409 },
      );
    }
    return binding;
  };

  return Object.freeze({
    resolveDriver,
    resolveTicket,
    async availability({ driver, environment }) {
      const { provider } = resolveDriver(driver);
      try {
        await provider.resolveInstallation({ environment });
        return Object.freeze({ status: "ready" });
      } catch (cause) {
        return provider.availabilityFailure(cause);
      }
    },
    async preflight({ driver, environment }) {
      const { provider } = resolveDriver(driver);
      try {
        const installation = await provider.resolveInstallation({ environment });
        const evidence = await provider.preflight(installation, { environment });
        await provider.assertInstallationUnchanged(installation);
        return Object.freeze({
          driver,
          providerId: provider.providerId,
          runtimeId: provider.runtimeId,
          securityProfile: provider.securityProfile,
          installation,
          installationDigest: provider.installationDigest(installation),
          capabilities: provider.capabilities,
          evidence,
        });
      } catch (cause) {
        throw provider.normalizePreflightError(cause);
      }
    },
    async verifyTicket(ticket) {
      const { provider } = resolveTicket(ticket);
      await provider.assertInstallationUnchanged(ticket.installation);
      if (provider.installationDigest(ticket.installation) !== ticket.installationDigest) {
        throw agentProviderError(
          "AGENT_PROVIDER_TICKET_INVALID",
          "Agent installation identity no longer matches its preflight ticket.",
          { status: 409 },
        );
      }
      return ticket;
    },
    async loadExecutionPolicy(ticket, input) {
      const { provider } = resolveTicket(ticket);
      try {
        return await provider.loadExecutionPolicy(input);
      } catch (cause) {
        throw provider.normalizeRuntimeError(cause);
      }
    },
    async run(ticket, input) {
      const { provider, runtime } = resolveTicket(ticket);
      const launch = provider.createRuntimeLaunch({ ticket, ...input });
      if (!launch || typeof launch !== "object" || Array.isArray(launch)
        || assertAgentSecurityProfile(launch.securityProfile, "launch securityProfile")
          !== ticket.securityProfile) {
        throw agentProviderError(
          "AGENT_SECURITY_PROFILE_MISMATCH",
          "Agent launch security profile does not match its ticket.",
          { status: 409 },
        );
      }
      try {
        return await runtime.run(Object.freeze({ ...launch }));
      } catch (cause) {
        throw provider.normalizeRuntimeError(cause);
      }
    },
    createTurnRunner(ticket, { environment }) {
      resolveTicket(ticket);
      return ({ policy, prompt, turnTimeoutMs, cancellationSignal, onEvent }) => this.run(ticket, {
        policy,
        prompt,
        turnTimeoutMs,
        cancellationSignal,
        onEvent,
        baseEnvironment: environment,
      });
    },
    classifyRunFailure(ticket, cause) {
      const { provider } = resolveTicket(ticket);
      return provider.classifyRunFailure(provider.normalizeRuntimeError(cause));
    },
    failureMessage(ticket, code) {
      const { provider } = resolveTicket(ticket);
      return provider.failureMessage(code);
    },
    failureMessageForDriver(driver, code) {
      const { provider } = resolveDriver(driver);
      return provider.failureMessage(code);
    },
    preflightFailureMessageForDriver(driver, code) {
      const { provider } = resolveDriver(driver);
      return provider.preflightFailureMessage(code);
    },
  });
}

export function createDefaultProviderRegistry({
  commandResolver,
  preflightRunner,
  policyLoader,
  runTask,
} = {}) {
  const runtimeRegistry = createRuntimeRegistry([
    createAcpRuntime({ ...(runTask ? { runTask } : {}) }),
  ]);
  return createProviderRegistry({
    providers: [createQoderProvider({
      ...(commandResolver ? { commandResolver } : {}),
      ...(preflightRunner ? { preflightRunner } : {}),
      ...(policyLoader ? { policyLoader } : {}),
    })],
    runtimeRegistry,
  });
}

export const providerRegistry = createDefaultProviderRegistry();
