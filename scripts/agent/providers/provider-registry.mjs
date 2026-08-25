import {
  agentProviderError,
  assertAgentSecurityProfile,
  assertProviderCapability,
  assertProviderTicket,
} from "./agent-provider-contract.mjs";
import { createQoderProvider } from "./qoder-provider.mjs";
import { createCodexProvider } from "./codex-provider.mjs";
import { resolveCodexFeatureFlags } from "../codex-feature-flags.mjs";
import { createAcpRuntime } from "../runtimes/acp-runtime.mjs";
import { createRuntimeRegistry } from "../runtimes/runtime-registry.mjs";

function unsupportedDriver() {
  throw agentProviderError(
    "AGENT_DRIVER_UNSUPPORTED",
    "当前只支持 Qoder CLI 的 ACP 驱动。",
    { status: 400 },
  );
}

function selectionForProvider(provider) {
  return Object.freeze({
    providerId: provider.providerId,
    runtimeId: provider.runtimeId,
    requestedModelId: null,
    resolvedModelId: null,
    reasoning: Object.freeze({
      requested: null,
      applied: null,
      resolution: "provider-default",
    }),
  });
}

function assertResolvedSelection(selection, provider) {
  if (!selection || typeof selection !== "object" || Array.isArray(selection)
    || selection.providerId !== provider.providerId
    || selection.runtimeId !== provider.runtimeId) {
    throw agentProviderError(
      "AGENT_SELECTION_UNSUPPORTED",
      "The requested Agent provider selection is unsupported.",
      { status: 409 },
    );
  }
  return selection;
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

  const resolveSelection = (selection) => {
    if (!selection || typeof selection !== "object" || Array.isArray(selection)) {
      throw agentProviderError(
        "AGENT_SELECTION_UNSUPPORTED",
        "The requested Agent provider selection is unsupported.",
        { status: 400 },
      );
    }
    const provider = resolveProvider(selection.providerId);
    assertResolvedSelection(selection, provider);
    return bindingForProvider(provider);
  };

  const resolveDriver = (driver) => {
    const providerId = byLegacyDriver.get(String(driver || ""));
    if (!providerId) unsupportedDriver();
    return bindingForProvider(resolveProvider(providerId));
  };

  const selectionFromDriver = (driver) => selectionForProvider(resolveDriver(driver).provider);

  const resolveTicket = (ticketInput, purpose = ticketInput?.purpose) => {
    const ticket = assertProviderTicket(ticketInput);
    const binding = bindingForProvider(resolveProvider(ticket.providerId));
    const legacyDriverMatches = ticket.driver === undefined
      || ticket.driver === null
      || binding.provider.legacyDrivers.includes(ticket.driver);
    if (
      binding.provider.runtimeId !== ticket.runtimeId
      || binding.provider.securityProfile !== ticket.securityProfile
      || !legacyDriverMatches
    ) {
      throw agentProviderError(
        "AGENT_PROVIDER_TICKET_INVALID",
        "Agent provider ticket binding is invalid.",
        { status: 409 },
      );
    }
    if (purpose) assertProviderCapability(binding.provider, purpose);
    return binding;
  };

  const prepareForSelection = async (selection, purpose, environment, legacyDriver = null) => {
    const { provider, runtime } = resolveSelection(selection);
    if (provider.capabilities.preflight !== true) {
      throw agentProviderError(
        "AGENT_CAPABILITY_UNSUPPORTED",
        "The selected Agent provider does not support preflight.",
        { status: 409 },
      );
    }
    assertProviderCapability(provider, purpose);
    try {
      const installation = await provider.resolveInstallation({ environment });
      let probe = null;
      if (typeof provider.createProbeLaunch === "function") {
        if (typeof runtime.probe !== "function") {
          throw agentProviderError(
            "AGENT_RUNTIME_PROBE_UNSUPPORTED",
            "The selected Agent runtime cannot perform a safe preflight probe.",
            { status: 409 },
          );
        }
        const probeLaunch = provider.createProbeLaunch({
          installation,
          selection,
          purpose,
          baseEnvironment: environment,
        });
        if (!probeLaunch || typeof probeLaunch !== "object" || Array.isArray(probeLaunch)
          || assertAgentSecurityProfile(probeLaunch.securityProfile, "probe securityProfile")
            !== provider.securityProfile) {
          throw agentProviderError(
            "AGENT_SECURITY_PROFILE_MISMATCH",
            "Agent probe security profile does not match its provider.",
            { status: 409 },
          );
        }
        probe = await runtime.probe(Object.freeze({ ...probeLaunch }));
      }
      const evidence = await provider.preflight(installation, {
        environment,
        purpose,
        selection,
        probe,
      });
      await provider.assertInstallationUnchanged(installation);
      const resolvedSelection = assertResolvedSelection(
        typeof provider.resolveSelection === "function"
          ? await provider.resolveSelection(selection, { evidence, purpose })
          : selection,
        provider,
      );
      return Object.freeze({
        ...(legacyDriver ? { driver: legacyDriver } : {}),
        providerId: provider.providerId,
        runtimeId: provider.runtimeId,
        securityProfile: provider.securityProfile,
        installation,
        installationDigest: provider.installationDigest(installation),
        capabilities: provider.capabilities,
        evidence,
        selection: resolvedSelection,
      });
    } catch (cause) {
      if (cause?.code === "AGENT_CAPABILITY_UNSUPPORTED") throw cause;
      throw provider.normalizePreflightError(cause);
    }
  };

  const runTicket = async (ticket, input) => {
    const { provider, runtime } = resolveTicket(ticket, ticket.purpose);
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
  };

  return Object.freeze({
    catalog() {
      return Object.freeze([...byProviderId.values()].map((provider) => Object.freeze({
        providerId: provider.providerId,
        displayName: provider.displayName,
        runtimeId: provider.runtimeId,
        capabilities: provider.capabilities,
        securityProfile: provider.securityProfile,
        presentation: provider.presentation,
      })));
    },
    resolveDriver,
    selectionFromDriver,
    resolveSelection,
    assertCapabilityForSelection(selection, purpose) {
      const { provider } = resolveSelection(selection);
      return assertProviderCapability(provider, purpose);
    },
    resolveTicket,
    async availabilityForSelection(selection, { environment } = {}) {
      const { provider } = resolveSelection(selection);
      if (provider.capabilities.availability !== true) {
        throw agentProviderError(
          "AGENT_CAPABILITY_UNSUPPORTED",
          "The selected Agent provider does not support availability checks.",
          { status: 409 },
        );
      }
      try {
        await provider.resolveInstallation({ environment });
        return Object.freeze({ status: "ready" });
      } catch (cause) {
        return provider.availabilityFailure(cause);
      }
    },
    preflightForSelection(selection, purpose, { environment } = {}) {
      return prepareForSelection(selection, purpose, environment);
    },
    async authenticateForSelection(selection, { environment, cancellationSignal } = {}) {
      const { provider, runtime } = resolveSelection(selection);
      if (typeof provider.createAuthLaunch !== "function" || typeof runtime.authenticate !== "function") {
        throw agentProviderError(
          "AGENT_AUTHENTICATION_UNSUPPORTED",
          "The selected Agent provider does not support managed authentication.",
          { status: 409 },
        );
      }
      const installation = await provider.resolveInstallation({ environment });
      const launch = provider.createAuthLaunch({
        installation,
        baseEnvironment: environment,
        cancellationSignal,
      });
      if (assertAgentSecurityProfile(launch?.securityProfile, "authentication securityProfile")
        !== provider.securityProfile) {
        throw agentProviderError(
          "AGENT_SECURITY_PROFILE_MISMATCH",
          "Agent authentication security profile does not match its provider.",
          { status: 409 },
        );
      }
      try {
        const result = await runtime.authenticate(Object.freeze({ ...launch }));
        await provider.assertInstallationUnchanged(installation);
        return result;
      } catch (cause) {
        throw provider.normalizePreflightError(cause);
      }
    },
    async availability({ driver, environment }) {
      return this.availabilityForSelection(selectionFromDriver(driver), { environment });
    },
    preflight({ driver, environment, purpose = "execution" }) {
      return prepareForSelection(selectionFromDriver(driver), purpose, environment, driver);
    },
    async verifyTicket(ticket, { purpose = ticket?.purpose } = {}) {
      const { provider } = resolveTicket(ticket, purpose);
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
      const { provider } = resolveTicket(ticket, "execution");
      try {
        return await provider.loadExecutionPolicy(input);
      } catch (cause) {
        throw provider.normalizeRuntimeError(cause);
      }
    },
    run: runTicket,
    async finalizeExecution(ticket, input) {
      const { provider } = resolveTicket(ticket, "execution");
      if (provider.finalizationOwner === "agent-host") {
        const completion = input?.runtimeResult?.completion;
        if (!completion || !["completed", "no-change"].includes(completion.status)) {
          throw agentProviderError(
            "AGENT_FINALIZER_NOT_COMPLETED",
            "The Agent turn stopped without verified completion evidence.",
            { status: 409 },
          );
        }
        return completion;
      }
      if (typeof provider.finalizeExecution !== "function") {
        throw agentProviderError(
          "AGENT_FINALIZER_UNSUPPORTED",
          "The selected Agent provider has no Bridge finalizer.",
          { status: 409 },
        );
      }
      try {
        return await provider.finalizeExecution(input);
      } catch (cause) {
        throw provider.normalizeRuntimeError(cause);
      }
    },
    createTurnRunner(ticket, { environment }) {
      resolveTicket(ticket, "discussion");
      return ({ policy, prompt, turnTimeoutMs, cancellationSignal, onEvent }) => runTicket(ticket, {
        policy,
        prompt,
        turnTimeoutMs,
        cancellationSignal,
        onEvent,
        baseEnvironment: environment,
      });
    },
    classifyRunFailure(ticket, cause) {
      const { provider } = resolveTicket(ticket, ticket.purpose);
      return provider.classifyRunFailure(provider.normalizeRuntimeError(cause));
    },
    failureMessage(ticket, code) {
      const { provider } = resolveTicket(ticket, ticket.purpose);
      return provider.failureMessage(code);
    },
    failureMessageForSelection(selection, code) {
      const { provider } = resolveSelection(selection);
      return provider.failureMessage(code);
    },
    preflightFailureMessageForSelection(selection, code) {
      const { provider } = resolveSelection(selection);
      return provider.preflightFailureMessage(code);
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
  environment = process.env,
  codexProvider,
} = {}) {
  const codexFlags = resolveCodexFeatureFlags({ environment });
  const runtimeRegistry = createRuntimeRegistry([
    createAcpRuntime({ ...(runTask ? { runTask } : {}) }),
  ]);
  const providers = [createQoderProvider({
    ...(commandResolver ? { commandResolver } : {}),
    ...(preflightRunner ? { preflightRunner } : {}),
    ...(policyLoader ? { policyLoader } : {}),
  })];
  if (codexProvider) providers.push(codexProvider);
  else if (codexFlags.codexDiscussion || codexFlags.codexExecution) {
    providers.push(createCodexProvider({
      capabilities: {
        discussion: codexFlags.codexDiscussion,
        execution: codexFlags.codexExecution,
      },
    }));
  }
  return createProviderRegistry({
    providers,
    runtimeRegistry,
  });
}

export const providerRegistry = createDefaultProviderRegistry();
