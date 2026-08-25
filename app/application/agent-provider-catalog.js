import {
  INITIAL_AGENT_PROVIDER_AVAILABILITY,
  agentPreflightKey,
  agentProviderAvailabilityFromFailureReason,
  agentProviderAvailabilityFromLocalResult,
  agentProviderAvailabilityWithCopiedGuidance,
  checkingAgentProviderAvailability,
  freezeAgentSelection,
  readyAgentProviderAvailability,
} from "../domain/agent-provider-state.js";
import {
  defaultManagedAgentDelivery,
  TRUSTED_LOCAL_AGENT_POLICY_VERSION,
} from "../../shared/agent-delivery.mjs";

const QODER_FAILURE_REASONS = Object.freeze({
  QODER_COMMAND_NOT_FOUND: "not-installed",
  AGENT_COMMAND_NOT_FOUND: "not-installed",
  QODER_AUTH_REQUIRED: "auth-required",
  AGENT_AUTH_REQUIRED: "auth-required",
  QODER_ACCOUNT_CAPACITY_UNAVAILABLE: "account-capacity",
  QODER_CAPACITY_UNAVAILABLE: "account-capacity",
  AGENT_ACCOUNT_CAPACITY_UNAVAILABLE: "account-capacity",
  QODER_PREFLIGHT_TIMEOUT: "timeout",
  AGENT_PREFLIGHT_TIMEOUT: "timeout",
  QODER_COMMAND_CHANGED: "restart-required",
  QODER_VERSION_MISMATCH: "restart-required",
  AGENT_INSTALLATION_CHANGED: "restart-required",
  QODER_COMMAND_UNTRUSTED: "invalid-installation",
  QODER_VERSION_INVALID: "invalid-installation",
  QODER_VERSION_UNSUPPORTED: "invalid-installation",
  AGENT_INSTALLATION_UNTRUSTED: "invalid-installation",
});

const QODER_PRESENTATION = Object.freeze({
  displayName: "Qoder CLI",
  agentName: "Qoder",
  logoSrc: "./qoder-logo.png",
  cardClassName: "qoder-availability-card",
  primaryActionDataAttribute: "data-qoder-primary",
  guidancePurposePrefix: "qoder",
  readyDetail: "真实预检已完成，可直接交给 Qoder CLI",
  notInstalledDetail: "如需从 PageRoot 直接发送，还需要 Qoder CLI。",
  authRequiredDetail: "完成 Qoder 登录后即可直接发送。",
  invalidInstallationDetail: "当前安装不是 PageRoot 支持的独立 Qoder CLI。",
  restartRequiredDetail: "Qoder CLI 已发生变化，重新打开 PageRoot 后即可继续。",
  checkingDetail: "正在自动检查 Qoder CLI…",
  capacityStatusLabel: "暂不可用 · Qoder 额度已用完",
  capacityDetail: "Qoder 账号当前没有可用模型容量。",
  timeoutDetail: "Qoder CLI 预检没有在规定时间内完成。",
  startUnavailable: "当前 Request 还不能启动 Qoder CLI。",
  startBusy: "Qoder CLI 正在启动，请等待当前操作完成。",
  startFailure: "Qoder CLI 没有启动。本轮 Request 已保留，可重试或复制任务。",
  restartLabel: "重新启动 Qoder",
  restartSupported: true,
  stopLabel: "停止 Qoder 并继续编辑",
  frozenPreviewDetail: "这是本轮冻结并交给 Qoder CLI 的只读内容",
});

const AGENT_SECURITY_PROFILES = new Set(["client-mediated", "agent-native"]);

function qoderGuidanceInstruction(kind) {
  if (kind === "login") {
    return [
      "请帮我完成这台 Mac 上独立 Qoder CLI 的官方登录流程。",
      "使用 Qoder 官方支持的登录入口 `qodercli login`；如果需要交互式登录，请启动 `qodercli` 后使用 `/login`。",
      "完成浏览器或令牌登录后，验证 `qodercli --list-models` 能返回当前账号可用的模型。",
      "不要修改 PageRoot，也不要修改当前项目。完成后只告诉我登录和可用性验证结果。",
    ].join("\n");
  }
  return [
    "请帮我在这台 Mac 上准备 PageRoot 支持的独立 Qoder CLI。",
    "使用 Qoder 官方 npm 包 `@qoder-ai/qodercli@latest`，不要使用 Qoder 应用包内置的命令。",
    "将它安装到 Finder 或 Dock 启动的应用也能稳定发现的位置；优先使用用户可写的稳定全局目录，或保留当前 nvm、Volta、fnm、mise 配置并确保 qodercli 启动器真实存在。",
    "安装后使用 Qoder 官方登录流程完成登录，并验证 `qodercli --version` 与 `qodercli --list-models` 均可用。",
    "不要修改 PageRoot，也不要修改当前项目。完成后只告诉我安装、版本、登录和可用性验证结果。",
  ].join("\n");
}

export const QODER_AGENT_PROVIDER = Object.freeze({
  providerId: "qoder",
  runtimeId: "acp",
  securityProfile: "client-mediated",
  trustPolicyVersion: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
  selection: freezeAgentSelection(defaultManagedAgentDelivery().selection),
  presentation: QODER_PRESENTATION,
  failureReason(code) {
    return QODER_FAILURE_REASONS[String(code || "")] || "service-unavailable";
  },
  guidanceInstruction: qoderGuidanceInstruction,
});

function frozenProviderEntry(descriptor, previous = null) {
  return Object.freeze({
    ...descriptor,
    availability: previous?.availability || INITIAL_AGENT_PROVIDER_AVAILABILITY,
    installationDigest: previous?.installationDigest || null,
  });
}

function frozenRecord(entries) {
  return Object.freeze(Object.fromEntries(entries));
}

function validDate(clock) {
  return new Date(Math.max(0, Number(clock.now()) || 0)).toISOString();
}

function preflightExpired(preflight, clock) {
  const expiresAt = Date.parse(String(preflight?.expiresAt || ""));
  return !Number.isFinite(expiresAt) || expiresAt <= clock.now();
}

export class AgentCatalogState {
  #bridgeClient;
  #handoffPort;
  #clock;
  #providers = new Map();
  #selected = null;
  #preflightBySelection = new Map();
  #inflightBySelection = new Map();
  #spentPreflightIds = new Set();
  #generationByProvider = new Map();
  #listeners = new Set();
  #disposed = false;

  constructor({
    bridgeClient,
    handoffPort = null,
    clock = Date,
    providers = [QODER_AGENT_PROVIDER],
    selected = null,
  } = {}) {
    if (!bridgeClient || typeof bridgeClient.preflightAgent !== "function") {
      throw new TypeError("AgentCatalogState requires an Agent bridge client.");
    }
    if (!clock || typeof clock.now !== "function") {
      throw new TypeError("AgentCatalogState requires a ClockPort.");
    }
    this.#bridgeClient = bridgeClient;
    this.#handoffPort = handoffPort;
    this.#clock = clock;
    for (const descriptor of providers) {
      if (!descriptor?.providerId || !descriptor?.runtimeId || !descriptor?.selection) {
        throw new TypeError("Agent provider descriptor is invalid.");
      }
      if (!AGENT_SECURITY_PROFILES.has(descriptor.securityProfile)) {
        throw new TypeError("Agent provider security profile is invalid.");
      }
      const descriptorSelection = freezeAgentSelection(descriptor.selection);
      if (
        descriptorSelection.providerId !== descriptor.providerId
        || descriptorSelection.runtimeId !== descriptor.runtimeId
      ) {
        throw new TypeError("Agent provider descriptor selection is mismatched.");
      }
      this.#providers.set(descriptor.providerId, frozenProviderEntry(Object.freeze({
        ...descriptor,
        selection: descriptorSelection,
      })));
      this.#generationByProvider.set(descriptor.providerId, 0);
    }
    const initial = selected || providers[0]?.selection || null;
    this.#selected = initial ? freezeAgentSelection(initial) : null;
  }

  getSnapshot() {
    return Object.freeze({
      providers: frozenRecord(this.#providers.entries()),
      selected: this.#selected,
      preflightBySelection: frozenRecord(this.#preflightBySelection.entries()),
    });
  }

  subscribe(listener) {
    if (typeof listener !== "function") throw new TypeError("Agent catalog listener is invalid.");
    this.#listeners.add(listener);
    listener(this.getSnapshot());
    return () => this.#listeners.delete(listener);
  }

  dispose() {
    this.#disposed = true;
    this.#listeners.clear();
    this.#preflightBySelection.clear();
    this.#inflightBySelection.clear();
    this.#spentPreflightIds.clear();
  }

  select(selection) {
    const frozen = freezeAgentSelection(selection);
    const provider = this.#providers.get(frozen.providerId);
    if (!provider) {
      throw Object.assign(new Error("The selected Agent provider is not installed in this build."), {
        code: "AGENT_PROVIDER_UNSUPPORTED",
      });
    }
    if (provider.runtimeId !== frozen.runtimeId) {
      throw Object.assign(new Error("The selected Agent runtime is not installed in this build."), {
        code: "AGENT_RUNTIME_UNSUPPORTED",
      });
    }
    this.#selected = frozen;
    this.#generationByProvider.set(
      frozen.providerId,
      (this.#generationByProvider.get(frozen.providerId) || 0) + 1,
    );
    this.#publish();
    return frozen;
  }

  freezeSelected() {
    if (!this.#selected) return null;
    return freezeAgentSelection(this.#selected);
  }

  provider(selection = this.#selected) {
    if (!selection) return null;
    const provider = this.#providers.get(selection.providerId) || null;
    return provider?.runtimeId === selection.runtimeId ? provider : null;
  }

  availability(selection = this.#selected) {
    return this.provider(selection)?.availability || INITIAL_AGENT_PROVIDER_AVAILABILITY;
  }

  presentation(selection = this.#selected) {
    const provider = this.provider(selection);
    if (provider) return provider.presentation;
    const providerId = String(selection?.providerId || "Agent");
    return Object.freeze({
      displayName: providerId,
      agentName: providerId,
      logoSrc: null,
      cardClassName: "agent-provider-card",
      primaryActionDataAttribute: null,
      stopLabel: "停止 Agent 并继续编辑",
      restartLabel: "重新启动 Agent",
      restartSupported: false,
      frozenPreviewDetail: `这是本轮冻结并交给 ${providerId} 的只读内容`,
    });
  }

  async refreshAvailability(selection = this.freezeSelected()) {
    const frozen = freezeAgentSelection(selection);
    const provider = this.provider(frozen);
    if (!provider) throw this.#unsupportedProvider(frozen.providerId);
    const previous = provider.availability;
    const generation = (this.#generationByProvider.get(frozen.providerId) || 0) + 1;
    this.#generationByProvider.set(frozen.providerId, generation);
    this.#setAvailability(frozen.providerId, checkingAgentProviderAvailability(previous));
    try {
      const availabilityMethod = typeof this.#bridgeClient.agentAvailability === "function"
        ? (input) => this.#bridgeClient.agentAvailability(input)
        : typeof this.#bridgeClient.qoderAvailability === "function"
          ? (input) => this.#bridgeClient.qoderAvailability(input)
          : null;
      if (!availabilityMethod) {
        throw Object.assign(new Error("Agent availability is unavailable."), {
          code: "AGENT_AVAILABILITY_UNAVAILABLE",
        });
      }
      const result = await availabilityMethod({ selection: frozen });
      if (
        this.#disposed
        || this.#generationByProvider.get(frozen.providerId) !== generation
      ) return null;
      const availability = agentProviderAvailabilityFromLocalResult(
        result,
        previous,
        validDate(this.#clock),
      );
      this.#setAvailability(frozen.providerId, availability);
      return Object.freeze({ result, availability });
    } catch (cause) {
      if (
        !this.#disposed
        && this.#generationByProvider.get(frozen.providerId) === generation
      ) {
        this.#setFailure(frozen, cause, previous);
      }
      throw cause;
    }
  }

  preflight(selection = this.freezeSelected(), {
    force = false,
    purpose = "execution",
    trustPolicyVersion = null,
    installationDigest = null,
  } = {}) {
    const frozen = freezeAgentSelection(selection);
    const provider = this.provider(frozen);
    if (!provider) return Promise.reject(this.#unsupportedProvider(frozen.providerId));
    const trust = String(trustPolicyVersion || provider.trustPolicyVersion || "");
    const digest = String(
      installationDigest || frozen.installationDigest || provider.installationDigest || "",
    );
    const key = agentPreflightKey(frozen, {
      installationDigest: digest,
      trustPolicyVersion: trust,
      purpose,
    });
    if (!force) {
      const reusable = this.#preflightBySelection.get(key);
      if (reusable && !preflightExpired(reusable, this.#clock)) {
        return Promise.resolve(reusable);
      }
      if (reusable) this.#preflightBySelection.delete(key);
    }
    const inflight = this.#inflightBySelection.get(key);
    if (inflight) return inflight;
    const generation = (this.#generationByProvider.get(frozen.providerId) || 0) + 1;
    this.#generationByProvider.set(frozen.providerId, generation);
    const previous = provider.availability;
    if (this.#isSelected(frozen)) {
      this.#setAvailability(frozen.providerId, checkingAgentProviderAvailability(previous));
    }
    const checking = (async () => {
      try {
        const preflight = await this.#bridgeClient.preflightAgent({
          selection: frozen,
          purpose,
          trustPolicyAccepted: trust,
        });
        if (preflight?.status !== "ready" || !preflight.preflightId) {
          throw Object.assign(new Error("Agent preflight did not return a usable ticket."), {
            code: "RUN_AGENT_PREFLIGHT_INVALID",
          });
        }
        if (preflight.purpose && preflight.purpose !== purpose) {
          throw Object.assign(new Error("Agent preflight purpose changed."), {
            code: "AGENT_PREFLIGHT_PURPOSE_MISMATCH",
          });
        }
        if (
          preflight.trustPolicyVersion
          && preflight.trustPolicyVersion !== trust
        ) {
          throw Object.assign(new Error("Agent preflight trust policy changed."), {
            code: "AGENT_PREFLIGHT_TRUST_MISMATCH",
          });
        }
        const returnedSelection = freezeAgentSelection(preflight.selection || frozen);
        if (agentPreflightKey(returnedSelection) !== agentPreflightKey(frozen)) {
          throw Object.assign(new Error("Agent preflight returned a different selection."), {
            code: "AGENT_PREFLIGHT_SELECTION_MISMATCH",
          });
        }
        if (
          preflight.securityProfile
          && preflight.securityProfile !== provider.securityProfile
        ) {
          throw Object.assign(new Error("Agent preflight security profile changed."), {
            code: "AGENT_SECURITY_PROFILE_MISMATCH",
          });
        }
        const result = Object.freeze({
          ...preflight,
          selection: returnedSelection,
          securityProfile: provider.securityProfile,
          purpose,
          trustPolicyVersion: trust,
          installationDigest: String(preflight.installationDigest || digest || ""),
        });
        const finalKey = agentPreflightKey(result.selection, {
          installationDigest: result.installationDigest,
          trustPolicyVersion: trust,
          purpose,
        });
        this.#preflightBySelection.set(finalKey, result);
        if (finalKey !== key) this.#preflightBySelection.delete(key);
        if (
          !this.#disposed
          && this.#generationByProvider.get(frozen.providerId) === generation
          && this.#canProjectAvailability(frozen)
        ) {
          this.#setProviderDigest(frozen.providerId, result.installationDigest);
          this.#setAvailability(
            frozen.providerId,
            readyAgentProviderAvailability(validDate(this.#clock)),
          );
        } else {
          this.#publish();
        }
        return result;
      } catch (cause) {
        if (
          !this.#disposed
          && this.#generationByProvider.get(frozen.providerId) === generation
          && this.#canProjectAvailability(frozen)
        ) {
          this.#setFailure(frozen, cause, previous);
        }
        throw cause;
      } finally {
        if (this.#inflightBySelection.get(key) === checking) {
          this.#inflightBySelection.delete(key);
        }
      }
    })();
    this.#inflightBySelection.set(key, checking);
    return checking;
  }

  async spendTicket(selection = this.freezeSelected(), options = {}) {
    const frozen = freezeAgentSelection(selection);
    const preflight = await this.preflight(frozen, options);
    const preflightId = String(preflight?.preflightId || "");
    if (!preflightId || this.#spentPreflightIds.has(preflightId)) {
      throw Object.assign(new Error("Agent preflight ticket was already spent."), {
        code: "AGENT_PREFLIGHT_TICKET_SPENT",
      });
    }
    this.#spentPreflightIds.add(preflightId);
    const provider = this.provider(frozen);
    const key = agentPreflightKey(preflight.selection || frozen, {
      installationDigest: preflight.installationDigest,
      trustPolicyVersion: preflight.trustPolicyVersion || provider?.trustPolicyVersion,
      purpose: preflight.purpose || options.purpose || "execution",
    });
    this.#preflightBySelection.delete(key);
    this.#publish();
    return preflight;
  }

  discardTicket(preflight) {
    if (!preflight?.selection) return false;
    const key = agentPreflightKey(preflight.selection, {
      installationDigest: preflight.installationDigest,
      trustPolicyVersion: preflight.trustPolicyVersion,
      purpose: preflight.purpose,
    });
    const deleted = this.#preflightBySelection.delete(key);
    if (deleted) this.#publish();
    return deleted;
  }

  async copyGuidance(kind, selection = this.freezeSelected()) {
    const frozen = freezeAgentSelection(selection);
    const provider = this.provider(frozen);
    if (!provider || typeof provider.guidanceInstruction !== "function") {
      throw this.#unsupportedProvider(frozen.providerId);
    }
    if (!this.#handoffPort || typeof this.#handoffPort.copy !== "function") {
      throw new TypeError("Agent guidance requires a Handoff copy port.");
    }
    const result = await this.#handoffPort.copy({
      message: provider.guidanceInstruction(kind),
      run: null,
      purpose: `${provider.presentation.guidancePurposePrefix || "agent"}-${kind}-guidance`,
    });
    if (result?.status !== "copied" || result?.copied !== true) {
      throw Object.assign(new Error("Clipboard write was not confirmed."), {
        code: "AGENT_GUIDANCE_COPY_UNCONFIRMED",
      });
    }
    this.#setAvailability(frozen.providerId, agentProviderAvailabilityWithCopiedGuidance(
      provider.availability,
      kind,
      validDate(this.#clock),
    ));
    return Object.freeze({ kind, copied: true });
  }

  #isSelected(selection) {
    return Boolean(
      this.#selected
      && agentPreflightKey(this.#selected) === agentPreflightKey(selection),
    );
  }

  #canProjectAvailability(selection) {
    return Boolean(
      !this.#selected
      || this.#selected.providerId !== selection.providerId
      || this.#isSelected(selection),
    );
  }

  #setProviderDigest(providerId, installationDigest) {
    const provider = this.#providers.get(providerId);
    if (!provider) return;
    this.#providers.set(providerId, frozenProviderEntry({
      ...provider,
      installationDigest: installationDigest || null,
    }, {
      availability: provider.availability,
      installationDigest: installationDigest || null,
    }));
  }

  #setAvailability(providerId, availability) {
    const provider = this.#providers.get(providerId);
    if (!provider) return availability;
    this.#providers.set(providerId, Object.freeze({ ...provider, availability }));
    this.#publish();
    return availability;
  }

  #setFailure(selection, cause, previous) {
    const provider = this.provider(selection);
    const reason = provider?.failureReason?.(cause?.code) || "service-unavailable";
    return this.#setAvailability(selection.providerId, agentProviderAvailabilityFromFailureReason(
      reason,
      previous,
      validDate(this.#clock),
    ));
  }

  #unsupportedProvider(providerId) {
    return Object.assign(new Error(`Agent provider ${String(providerId || "unknown")} is unavailable.`), {
      code: "AGENT_PROVIDER_UNSUPPORTED",
    });
  }

  #publish() {
    if (this.#disposed) return;
    const state = this.getSnapshot();
    for (const listener of this.#listeners) {
      try {
        listener(state);
      } catch {
        // Observation cannot change catalog authority.
      }
    }
  }
}

export const AgentProviderCatalog = AgentCatalogState;
