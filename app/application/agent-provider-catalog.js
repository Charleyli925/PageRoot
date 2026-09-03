import {
  INITIAL_AGENT_PROVIDER_AVAILABILITY,
  agentPreflightKey,
  agentProviderAvailabilityFromFailureReason,
  agentProviderAvailabilityFromLocalResult,
  agentProviderAvailabilityFromDiagnostic,
  agentDiagnosticSnapshot,
  agentProviderAvailabilityWithCopiedGuidance,
  checkingAgentProviderAvailability,
  freezeAgentSelection,
  readyAgentProviderAvailability,
} from "../domain/agent-provider-state.js";
import {
  defaultManagedAgentDelivery,
  TRUSTED_LOCAL_AGENT_POLICY_VERSION,
} from "../../shared/agent-delivery.mjs";
import {
  PAGEROOT_PROVIDER_ID,
  PAGEROOT_RUNTIME_ID,
  DEFAULT_OPENAI_COMPATIBLE_REASONING,
  normalizeOpenAiCompatibleReasoning,
  publicOpenAiCompatibleVendors,
} from "../../shared/openai-compatible-vendors.mjs";

const QODER_FAILURE_REASONS = Object.freeze({
  QODER_COMMAND_NOT_FOUND: "not-installed",
  AGENT_COMMAND_NOT_FOUND: "not-installed",
  QODER_AUTH_REQUIRED: "auth-required",
  AGENT_AUTH_REQUIRED: "auth-required",
  QODER_ACCOUNT_CAPACITY_UNAVAILABLE: "account-capacity",
  QODER_CAPACITY_UNAVAILABLE: "account-capacity",
  QODER_MODEL_CATALOG_EMPTY: "service-unavailable",
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
  readyDetail: "已接通，可直接交给 Qoder 修改",
  notInstalledDetail: "安装后即可从侧栏直接发送。",
  authRequiredDetail: "登录后即可从侧栏直接发送。",
  loginLabel: "复制登录指令",
  invalidInstallationDetail: "当前安装不是 PageRoot 支持的独立 Qoder CLI。",
  restartRequiredDetail: "Qoder CLI 已发生变化，重新打开 PageRoot 后即可继续。",
  checkingDetail: "正在自动检查 Qoder CLI…",
  capacityStatusLabel: "额度已用完",
  capacityDetail: "换源页 Agent 或 Codex，或复制任务给别的 AI。",
  timeoutDetail: "Qoder CLI 预检没有在规定时间内完成。",
  startUnavailable: "当前 Request 还不能启动 Qoder CLI。",
  startBusy: "Qoder CLI 正在启动，请等待当前操作完成。",
  startFailure: "Qoder CLI 没有启动。本轮 Request 已保留，可重试或复制任务。",
  restartLabel: "重新启动 Qoder",
  restartSupported: true,
  settingsSupported: true,
  stopLabel: "停止 Qoder 并继续编辑",
  frozenPreviewDetail: "这是本轮冻结并交给 Qoder CLI 的只读内容",
  installLabel: "安装 Qoder CLI",
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
  installable: true,
  selection: freezeAgentSelection(defaultManagedAgentDelivery().selection),
  presentation: QODER_PRESENTATION,
  failureReason(code) {
    return QODER_FAILURE_REASONS[String(code || "")] || "service-unavailable";
  },
  guidanceInstruction: qoderGuidanceInstruction,
});

const CODEX_FAILURE_REASONS = Object.freeze({
  CODEX_INSTALLATION_MISSING: "not-installed",
  CODEX_COMMAND_NOT_FOUND: "not-installed",
  AGENT_COMMAND_NOT_FOUND: "not-installed",
  CODEX_AUTH_REQUIRED: "auth-required",
  CODEX_ACCOUNT_CAPACITY_UNAVAILABLE: "account-capacity",
  AGENT_ACCOUNT_CAPACITY_UNAVAILABLE: "account-capacity",
  CODEX_APP_SERVER_TIMEOUT: "timeout",
  CODEX_TURN_TIMEOUT: "timeout",
  CODEX_PREFLIGHT_TIMEOUT: "timeout",
  AGENT_PREFLIGHT_TIMEOUT: "timeout",
  CODEX_INSTALLATION_CHANGED: "restart-required",
  CODEX_COMMAND_CHANGED: "restart-required",
  AGENT_INSTALLATION_CHANGED: "restart-required",
  CODEX_VERSION_MISMATCH: "invalid-installation",
  CODEX_INSTALLATION_UNTRUSTED: "invalid-installation",
  CODEX_COMMAND_UNTRUSTED: "invalid-installation",
  CODEX_VERSION_UNSUPPORTED: "invalid-installation",
  AGENT_INSTALLATION_UNTRUSTED: "invalid-installation",
});

const CODEX_PRESENTATION = Object.freeze({
  displayName: "Codex",
  agentName: "Codex",
  logoSrc: null,
  brandIcon: "openai",
  cardClassName: "codex-availability-card",
  primaryActionDataAttribute: "data-codex-primary",
  guidancePurposePrefix: "codex",
  installLabel: "安装 Codex",
  readyDetail: "已接通，可直接交给 Codex 修改",
  notInstalledDetail: "安装后即可从侧栏直接发送。",
  authRequiredDetail: "登录 ChatGPT 后即可从侧栏直接发送。",
  capacityStatusLabel: "额度已用完",
  capacityDetail: "换源页 Agent 或 Qoder，或复制任务给别的 AI。",
  loginLabel: "复制登录指令",
  invalidInstallationDetail: "当前安装不是 PageRoot 支持的独立 Codex ACP。",
  restartRequiredDetail: "Codex ACP 已发生变化，重新打开 PageRoot 后即可继续。",
  checkingDetail: "正在检查 Codex…",
  timeoutDetail: "Codex 预检没有在规定时间内完成。",
  startUnavailable: "当前 Request 还不能启动 Codex。",
  startBusy: "Codex 正在启动，请等待当前操作完成。",
  startFailure: "Codex 没有启动。本轮 Request 已保留，可安全结束后重试。",
  restartLabel: "重新启动 Codex",
  restartSupported: true,
  settingsSupported: true,
  stopLabel: "停止 Codex 并继续编辑",
  frozenPreviewDetail: "这是本轮冻结并交给 Codex 的只读任务资料",
  localReadDisclosure: "Codex 修改时可能读取这台 Mac 上的本机文件。",
});

function codexGuidanceInstruction(kind) {
  if (kind === "login") {
    return [
      "请帮我完成这台 Mac 上独立 Codex CLI 的官方登录流程。",
      "使用 Codex 官方支持的登录入口 `codex login`；登录 ChatGPT 账号后再回到 PageRoot。",
      "完成浏览器登录后，验证 `codex-acp` 能正常启动。",
      "不要修改 PageRoot，也不要修改当前项目。完成后只告诉我登录和可用性验证结果。",
    ].join("\n");
  }
  return [
    "请帮我在这台 Mac 上准备 PageRoot 支持的独立 Codex ACP。",
    "使用官方 npm 包 `@agentclientprotocol/codex-acp`，不要改用 PageRoot 安装包内的 bundled Codex。",
    "安装后使用 `codex login` 完成登录。",
    "不要修改 PageRoot，也不要修改当前项目。完成后只告诉我安装、版本、登录和可用性验证结果。",
  ].join("\n");
}

export const CODEX_AGENT_PROVIDER = Object.freeze({
  providerId: "codex",
  runtimeId: "acp",
  securityProfile: "client-mediated",
  trustPolicyVersion: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
  installable: true,
  selection: freezeAgentSelection(Object.freeze({
    providerId: "codex",
    runtimeId: "acp",
    requestedModelId: null,
    resolvedModelId: null,
    reasoning: Object.freeze({
      requested: null,
      applied: null,
      resolution: "provider-default",
    }),
  })),
  presentation: CODEX_PRESENTATION,
  failureReason(code) {
    return CODEX_FAILURE_REASONS[String(code || "")] || "service-unavailable";
  },
  guidanceInstruction: codexGuidanceInstruction,
});

const PAGEROOT_FAILURE_REASONS = Object.freeze({
  AGENT_AUTH_REQUIRED: "auth-required",
  AGENT_ACCOUNT_CAPACITY_UNAVAILABLE: "account-capacity",
  AGENT_BALANCE_INSUFFICIENT: "account-capacity",
  AGENT_PLAN_LIMIT: "account-capacity",
  AGENT_PREFLIGHT_TIMEOUT: "timeout",
  AGENT_TURN_TIMEOUT: "timeout",
  AGENT_MODEL_ID_REQUIRED: "model-unavailable",
  AGENT_MODEL_CATALOG_EMPTY: "model-unavailable",
  AGENT_MODEL_NOT_RELEASED: "model-unavailable",
  AGENT_MODEL_ACCESS_DENIED: "model-unavailable",
  AGENT_SELECTION_UNSUPPORTED: "model-unavailable",
  AGENT_ENDPOINT_REGION_MISMATCH: "endpoint-region-mismatch",
});

const PAGEROOT_PRESENTATION = Object.freeze({
  displayName: "源页 Agent",
  agentName: "源页",
  logoSrc: "./brand-logo.png",
  cardClassName: "pageroot-availability-card",
  primaryActionDataAttribute: "data-pageroot-primary",
  readyDetail: "可从侧栏发送",
  authRequiredDetail: "填入 Token 后发送",
  capacityStatusLabel: "额度已用完",
  capacityDetail: "换厂商，或复制任务给别的 AI。",
  checkingDetail: "正在连接…",
  timeoutDetail: "连接超时，请重试。",
  startUnavailable: "当前还不能发送。",
  startBusy: "正在处理，请稍候。",
  startFailure: "没有完成。本轮已保留。",
  restartLabel: "重新发送",
  restartSupported: true,
  settingsSupported: true,
  supportsApiKey: true,
  credentialKind: "api-token",
  supportsReasoning: true,
  vendors: publicOpenAiCompatibleVendors(),
  apiKeyLabel: "连接",
  replaceTokenLabel: "更换 Token",
  stopLabel: "停止源页 Agent 并继续编辑",
  frozenPreviewDetail: "这是本轮冻结并交给源页 Agent 的只读任务资料",
});

export const PAGEROOT_AGENT_PROVIDER = Object.freeze({
  providerId: PAGEROOT_PROVIDER_ID,
  runtimeId: PAGEROOT_RUNTIME_ID,
  securityProfile: "client-mediated",
  trustPolicyVersion: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
  installable: false,
  selection: freezeAgentSelection(Object.freeze({
    providerId: PAGEROOT_PROVIDER_ID,
    runtimeId: PAGEROOT_RUNTIME_ID,
    requestedModelId: null,
    resolvedModelId: null,
    reasoning: Object.freeze({
      requested: null,
      applied: null,
      resolution: "provider-default",
    }),
  })),
  presentation: PAGEROOT_PRESENTATION,
  failureReason(code) {
    return PAGEROOT_FAILURE_REASONS[String(code || "")] || "service-unavailable";
  },
  guidanceInstruction() {
    return "";
  },
});

export function defaultAgentProviders() {
  return Object.freeze([PAGEROOT_AGENT_PROVIDER, QODER_AGENT_PROVIDER, CODEX_AGENT_PROVIDER]);
}

export function agentAvailabilityCardPresentation(presentation, availability) {
  const status = availability?.status || "checking";
  if (status === "ready") {
    return Object.freeze({
      statusLabel: "已连接",
      detail: presentation.readyDetail,
      tone: "ready",
    });
  }
  if (status === "not-installed") {
    return Object.freeze({
      statusLabel: "未安装",
      detail: presentation.notInstalledDetail,
      tone: "attention",
    });
  }
  if (status === "auth-required") {
    if (presentation.credentialKind === "api-token") {
      return Object.freeze({
        statusLabel: "需要 Token",
        detail: presentation.authRequiredDetail,
        tone: "attention",
      });
    }
    const waitingForLogin = availability?.guidanceCopied === "login";
    return Object.freeze({
      statusLabel: waitingForLogin ? "等待登录" : "需要登录",
      detail: waitingForLogin
        ? "完成登录后返回源页，系统会自动复检。"
        : presentation.authRequiredDetail,
      tone: "attention",
    });
  }
  if (availability?.reason === "invalid-installation") {
    return Object.freeze({
      statusLabel: "无法使用当前安装",
      detail: presentation.invalidInstallationDetail,
      tone: "attention",
    });
  }
  if (availability?.reason === "restart-required") {
    return Object.freeze({
      statusLabel: "请重新打开 PageRoot",
      detail: presentation.restartRequiredDetail,
      tone: "attention",
    });
  }
  if (status === "checking") {
    return Object.freeze({
      statusLabel: "检测中",
      detail: presentation.checkingDetail,
      tone: "checking",
    });
  }
  if (availability?.reason === "account-capacity") {
    return Object.freeze({
      statusLabel: presentation.capacityStatusLabel || "暂不可用 · 额度已用完",
      detail: presentation.capacityDetail || "当前账号没有可用模型容量。",
      tone: "attention",
    });
  }
  if (availability?.reason === "timeout") {
    return Object.freeze({
      statusLabel: "暂不可用 · 连接超时",
      detail: presentation.timeoutDetail,
      tone: "attention",
    });
  }
  if (availability?.reason === "model-unavailable") {
    return Object.freeze({
      statusLabel: "暂不可用 · 模型不可用",
      detail: "请选择其他模型，或重新读取模型列表。",
      tone: "attention",
    });
  }
  if (availability?.reason === "endpoint-region-mismatch") {
    return Object.freeze({
      statusLabel: "暂不可用 · 接口地区不匹配",
      detail: "请修改兼容接口，或更换厂商。",
      tone: "attention",
    });
  }
  return Object.freeze({
    statusLabel: "暂不可用 · 连接没有完成",
    detail: "本轮任务尚未创建，当前页面不受影响。",
    tone: "attention",
  });
}

export function agentProviderCardPresentation(provider) {
  const presentation = provider?.presentation || {};
  return Object.freeze({
    displayName: presentation.displayName,
    logoSrc: presentation.logoSrc || null,
    brandIcon: presentation.brandIcon || null,
    cardClassName: presentation.cardClassName,
    primaryActionDataAttribute: presentation.primaryActionDataAttribute || null,
    availability: (availability) => agentAvailabilityCardPresentation(presentation, availability),
    actions: Object.freeze({
      install: Object.freeze({
        label: presentation.installLabel || `安装 ${presentation.agentName || presentation.displayName}`,
        copiedLabel: "重新安装",
      }),
      login: Object.freeze({
        label: presentation.loginLabel || "复制登录指令",
        copiedLabel: "重新复制",
      }),
      recheck: Object.freeze({
        label: "重试",
        copiedLabel: "重试",
      }),
      apiKey: Object.freeze({
        label: presentation.replaceTokenLabel || "更换 Token",
        copiedLabel: presentation.apiKeyLabel || "连接",
      }),
    }),
    supportsApiKey: presentation.supportsApiKey === true,
    credentialKind: presentation.credentialKind || null,
    vendors: Array.isArray(presentation.vendors) ? presentation.vendors : Object.freeze([]),
  });
}

export function agentProviderCardsFromCatalog(snapshot) {
  const selected = snapshot?.selected || null;
  return Object.freeze(Object.values(snapshot?.providers ?? {})
    .filter((provider) => (
      provider.providerId === selected?.providerId
      || provider.installable === true
      || provider.presentation?.supportsApiKey === true
      || provider.availability?.status === "auth-required"
      || provider.availability?.status === "not-installed"
    ))
    .map((provider) => Object.freeze({
      // Preflight may resolve a provider default model. Keep that resolved
      // selection for the selected card; other cards remain descriptor-backed
      // until the user selects them.
      selection: selected
        && selected.providerId === provider.providerId
        && selected.runtimeId === provider.runtimeId
        ? selected
        : provider.selection,
      presentation: agentProviderCardPresentation(provider),
      availability: provider.availability,
      models: Array.isArray(provider.models) ? provider.models : Object.freeze([]),
      credentialConfigured: provider.credentialConfigured === true,
      connection: provider.connection || null,
      diagnostic: provider.diagnostic || null,
    })));
}

function frozenProviderEntry(descriptor, previous = null) {
  return Object.freeze({
    ...descriptor,
    installable: descriptor.installable === true,
    installSource: previous?.installSource || descriptor.installSource || "none",
    installState: previous?.installState || descriptor.installState || "idle",
    availability: previous?.availability || INITIAL_AGENT_PROVIDER_AVAILABILITY,
    installationDigest: previous?.installationDigest || null,
    models: previous?.models || Object.freeze([]),
    credentialConfigured: previous?.credentialConfigured === true,
    connection: previous?.connection || null,
    diagnostic: previous?.diagnostic || descriptor.diagnostic || null,
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

function publicModels(value) {
  if (!Array.isArray(value)) return Object.freeze([]);
  const models = [];
  const seen = new Set();
  for (const item of value) {
    const id = String(item?.id || "").trim().slice(0, 80);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    models.push(Object.freeze({
      id,
      displayName: String(item?.displayName || id).trim().slice(0, 80) || id,
      isDefault: item?.isDefault === true,
      providerModelId: String(item?.providerModelId || "").trim().slice(0, 80) || null,
      releaseChannel: String(item?.releaseChannel || "").trim().slice(0, 40) || null,
      contextWindow: Number(item?.contextWindow || 0) || null,
      recommendedMaxInputTokens: Number(item?.recommendedMaxInputTokens || 0) || null,
      maxOutputTokens: Number(item?.maxOutputTokens || 0) || null,
      supportsCompleteHtml: item?.supportsCompleteHtml === true,
      reasoningChoices: Object.freeze((Array.isArray(item?.reasoningChoices)
        ? item.reasoningChoices
        : []).map((choice) => Object.freeze({
        id: String(choice?.id || "").trim().slice(0, 40),
        label: String(choice?.label || choice?.id || "").trim().slice(0, 40),
      })).filter((choice) => choice.id && choice.label)),
    }));
  }
  return Object.freeze(models);
}

function preflightResolvedRequestedSelection(requested, returned) {
  if (
    requested.resolvedModelId !== null
    || requested.providerId !== returned.providerId
    || requested.runtimeId !== returned.runtimeId
    || requested.requestedModelId !== returned.requestedModelId
    || requested.reasoning.requested !== returned.reasoning.requested
  ) return false;
  if (
    typeof returned.resolvedModelId !== "string"
    || !returned.resolvedModelId.startsWith(`${requested.providerId}:`)
  ) return false;
  if (requested.requestedModelId && returned.resolvedModelId !== requested.requestedModelId) {
    return false;
  }
  if (requested.reasoning.requested === null) {
    return returned.reasoning.applied === null
      && returned.reasoning.resolution === "provider-default";
  }
  return returned.reasoning.applied === requested.reasoning.requested
    && returned.reasoning.resolution === "exact";
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
    providers = defaultAgentProviders(),
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
    const defaultSelection = defaultManagedAgentDelivery().selection;
    const initial = selected
      || providers.find((provider) => provider.providerId === defaultSelection.providerId)?.selection
      || providers[0]?.selection
      || null;
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
    // A preflight started before this selection generation can no longer
    // publish availability. Do not let its promise suppress the fresh check
    // required when the user switches away and then back to this Provider.
    // The old process may still settle, but its generation fence and identity
    // check keep it from replacing the new authority or clearing its map entry.
    for (const [key, inflight] of this.#inflightBySelection) {
      if (inflight.providerId === frozen.providerId) {
        this.#inflightBySelection.delete(key);
      }
    }
    this.#publish();
    return frozen;
  }

  freezeSelected() {
    if (!this.#selected) return null;
    return freezeAgentSelection(this.#selected);
  }

  freezeProviderSelection(providerId) {
    const provider = this.#providers.get(String(providerId || ""));
    if (!provider) return null;
    return this.#selected?.providerId === provider.providerId
      ? freezeAgentSelection(this.#selected)
      : freezeAgentSelection(provider.selection);
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
      await this.#applyPublicCatalog();
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

  async diagnose(selection = this.freezeSelected()) {
    const frozen = freezeAgentSelection(selection);
    const provider = this.provider(frozen);
    if (!provider) throw this.#unsupportedProvider(frozen.providerId);
    const generation = (this.#generationByProvider.get(frozen.providerId) || 0) + 1;
    this.#generationByProvider.set(frozen.providerId, generation);
    const previous = provider.availability;
    this.#setAvailability(frozen.providerId, checkingAgentProviderAvailability(previous));
    try {
      const diagnoseMethod = typeof this.#bridgeClient.agentDiagnose === "function"
        ? (input) => this.#bridgeClient.agentDiagnose(input)
        : typeof this.#bridgeClient.agentAvailability === "function"
          ? (input) => this.#bridgeClient.agentAvailability(input)
          : typeof this.#bridgeClient.qoderAvailability === "function"
            ? (input) => this.#bridgeClient.qoderAvailability(input)
            : null;
      if (!diagnoseMethod) {
        throw Object.assign(new Error("Agent diagnosis is unavailable."), {
          code: "AGENT_DIAGNOSE_UNAVAILABLE",
        });
      }
      const result = await diagnoseMethod({ selection: frozen });
      if (
        this.#disposed
        || this.#generationByProvider.get(frozen.providerId) !== generation
      ) return null;
      const diagnostic = agentDiagnosticSnapshot(result?.diagnostic, validDate(this.#clock));
      const availability = result?.diagnostic
        ? agentProviderAvailabilityFromDiagnostic(diagnostic, previous, diagnostic.checkedAt)
        : agentProviderAvailabilityFromLocalResult(result, previous, validDate(this.#clock));
      const current = this.#providers.get(frozen.providerId);
      if (current) {
        this.#providers.set(frozen.providerId, Object.freeze({ ...current, diagnostic }));
      }
      this.#setAvailability(frozen.providerId, availability);
      return Object.freeze({ result, diagnostic, availability });
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
    if (purpose !== "execution") {
      return Promise.reject(Object.assign(new Error("Agent preflight purpose is unsupported."), {
        code: "AGENT_CAPABILITY_UNSUPPORTED",
      }));
    }
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
    if (inflight) return inflight.promise;
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
        if (
          agentPreflightKey(returnedSelection) !== agentPreflightKey(frozen)
          && !preflightResolvedRequestedSelection(frozen, returnedSelection)
        ) {
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
        const generationIsCurrent = (
          !this.#disposed
          && this.#generationByProvider.get(frozen.providerId) === generation
        );
        if (!generationIsCurrent) return result;
        const wasSelected = this.#isSelected(frozen);
        if (wasSelected) this.#selected = returnedSelection;
        const finalKey = agentPreflightKey(result.selection, {
          installationDigest: result.installationDigest,
          trustPolicyVersion: trust,
          purpose,
        });
        this.#preflightBySelection.set(finalKey, result);
        if (finalKey !== key) this.#preflightBySelection.delete(key);
        if (wasSelected || this.#canProjectAvailability(frozen)) {
          this.#setProviderDigest(frozen.providerId, result.installationDigest);
          const current = this.#providers.get(frozen.providerId);
          if (current) {
            this.#providers.set(frozen.providerId, Object.freeze({
              ...current,
              models: publicModels(result.models),
            }));
          }
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
        if (this.#inflightBySelection.get(key)?.promise === checking) {
          this.#inflightBySelection.delete(key);
        }
      }
    })();
    this.#inflightBySelection.set(key, Object.freeze({
      providerId: frozen.providerId,
      promise: checking,
    }));
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

  async install(selection = this.freezeSelected()) {
    const frozen = freezeAgentSelection(selection);
    const provider = this.provider(frozen);
    if (!provider) throw this.#unsupportedProvider(frozen.providerId);
    if (provider.installable !== true) {
      throw Object.assign(new Error("This Agent cannot be installed from PageRoot."), {
        code: "AGENT_INSTALL_UNSUPPORTED",
      });
    }
    if (typeof this.#bridgeClient.installAgent !== "function") {
      throw Object.assign(new Error("Agent install is unavailable."), {
        code: "AGENT_INSTALL_UNSUPPORTED",
      });
    }
    this.#patchProvider(frozen.providerId, { installState: "installing" });
    this.#setAvailability(frozen.providerId, checkingAgentProviderAvailability(provider.availability));
    try {
      await this.#bridgeClient.installAgent({ providerId: frozen.providerId });
      this.#patchProvider(frozen.providerId, {
        installState: "idle",
        installSource: "managed",
      });
      return this.diagnose(
        this.freezeProviderSelection(frozen.providerId) || frozen,
      );
    } catch (cause) {
      this.#patchProvider(frozen.providerId, { installState: "failed" });
      await this.diagnose(
        this.freezeProviderSelection(frozen.providerId) || frozen,
      ).catch(() => null);
      throw cause;
    }
  }

  async cancelInstall(selection = this.freezeSelected()) {
    const frozen = freezeAgentSelection(selection);
    const provider = this.provider(frozen);
    if (!provider) throw this.#unsupportedProvider(frozen.providerId);
    if (provider.installable !== true) {
      throw Object.assign(new Error("This Agent cannot be installed from PageRoot."), {
        code: "AGENT_INSTALL_UNSUPPORTED",
      });
    }
    if (typeof this.#bridgeClient.cancelAgentInstall !== "function") {
      throw Object.assign(new Error("Agent install cancellation is unavailable."), {
        code: "AGENT_INSTALL_UNSUPPORTED",
      });
    }
    this.#patchProvider(frozen.providerId, { installState: "cancelling" });
    try {
      const result = await this.#bridgeClient.cancelAgentInstall({ providerId: frozen.providerId });
      this.#patchProvider(frozen.providerId, {
        installState: ["idle", "failed"].includes(result?.installState)
          ? result.installState
          : "idle",
      });
      await this.diagnose(this.freezeProviderSelection(frozen.providerId) || frozen).catch(() => null);
      return result;
    } catch (cause) {
      this.#patchProvider(frozen.providerId, { installState: "failed" });
      throw cause;
    }
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

  selectModel(modelId, expectedSelection = this.#selected) {
    if (!this.#selected || !expectedSelection) return null;
    const expected = freezeAgentSelection(expectedSelection);
    if (agentPreflightKey(this.#selected) !== agentPreflightKey(expected)) return null;
    const id = typeof modelId === "string" && modelId.trim()
      ? modelId.trim().slice(0, 80)
      : null;
    if (id && !id.startsWith(`${expected.providerId}:`)) return null;
    return this.select({
      ...expected,
      requestedModelId: id,
      resolvedModelId: id,
      reasoning: {
        requested: null,
        applied: null,
        resolution: "provider-default",
      },
    });
  }

  selectReasoning(reasoning, expectedSelection = this.#selected) {
    if (!this.#selected || !expectedSelection) return null;
    const expected = freezeAgentSelection(expectedSelection);
    if (agentPreflightKey(this.#selected) !== agentPreflightKey(expected)) return null;
    if (String(reasoning || "") === DEFAULT_OPENAI_COMPATIBLE_REASONING) {
      return this.select({
        ...expected,
        reasoning: {
          requested: null,
          applied: null,
          resolution: "provider-default",
        },
      });
    }
    const requested = normalizeOpenAiCompatibleReasoning(reasoning);
    if (!requested) return expected;
    return this.select({
      ...expected,
      reasoning: {
        requested,
        applied: requested,
        resolution: "exact",
      },
    });
  }

  noteRunFailure(selection, code) {
    if (!selection) return null;
    const frozen = freezeAgentSelection(selection);
    const provider = this.provider(frozen);
    if (!provider) return null;
    return this.#setFailure(frozen, { code }, provider.availability);
  }

  async connectWithApiKey(selection, apiKey, extras = {}) {
    const frozen = freezeAgentSelection(selection);
    const provider = this.provider(frozen);
    if (!provider) throw this.#unsupportedProvider(frozen.providerId);
    const updateConfiguration = typeof this.#bridgeClient.updateAgentConfiguration === "function"
      ? (body) => this.#bridgeClient.updateAgentConfiguration(body)
      : typeof this.#bridgeClient.setAgentSessionCredential === "function"
        ? (body) => this.#bridgeClient.setAgentSessionCredential(body)
        : null;
    if (!updateConfiguration) {
      throw Object.assign(new Error("API Token 无法保存。"), {
        code: "AGENT_SESSION_CREDENTIAL_UNSUPPORTED",
      });
    }
    // Candidate configuration edits invalidate every old renderer ticket at
    // the start of the transaction. Provider/model/readiness state is not
    // replaced unless the Bridge commits the candidate below.
    this.#invalidateProvider(frozen.providerId);
    const manualModelId = String(extras.modelId || "").trim().slice(0, 80);
    const requestedSelection = freezeAgentSelection({
      ...frozen,
      requestedModelId: manualModelId
        ? `${frozen.providerId}:${manualModelId.replace(/^pageroot:/u, "")}`
        : null,
      resolvedModelId: null,
      reasoning: { requested: null, applied: null, resolution: "provider-default" },
    });
    const result = await updateConfiguration({
      providerId: frozen.providerId,
      apiKey,
      vendorId: extras.vendorId || null,
      baseUrl: extras.baseUrl || null,
      selection: requestedSelection,
    });
    if (result?.status !== "ready" || !result?.selection) {
      throw Object.assign(new Error("API Token 没有返回可执行配置。"), {
        code: "AGENT_SESSION_CREDENTIAL_INVALID",
      });
    }
    const returnedSelection = freezeAgentSelection(result.selection);
    this.#invalidateProvider(frozen.providerId);
    if (this.#selected?.providerId === frozen.providerId) this.#selected = returnedSelection;
    const current = this.#providers.get(frozen.providerId);
    this.#providers.set(frozen.providerId, Object.freeze({
      ...current,
      models: publicModels(result.models),
      credentialConfigured: true,
      connection: Object.freeze({
        vendorId: String(result.vendorId || extras.vendorId || ""),
        vendorDisplayName: String(result.vendorDisplayName || extras.vendorId || ""),
        baseUrl: String(result.baseUrl || extras.baseUrl || ""),
      }),
      availability: readyAgentProviderAvailability(validDate(this.#clock)),
      installationDigest: String(result.installationDigest || "") || null,
    }));
    this.#publish();
    return result;
  }

  async disconnectApiKey(selection = this.freezeSelected()) {
    const frozen = freezeAgentSelection(selection);
    const provider = this.provider(frozen);
    const updateConfiguration = typeof this.#bridgeClient.updateAgentConfiguration === "function"
      ? (body) => this.#bridgeClient.updateAgentConfiguration(body)
      : typeof this.#bridgeClient.setAgentSessionCredential === "function"
        ? (body) => this.#bridgeClient.setAgentSessionCredential(body)
        : null;
    if (!provider || !updateConfiguration) {
      throw this.#unsupportedProvider(frozen.providerId);
    }
    await updateConfiguration({
      providerId: frozen.providerId,
      disconnect: true,
    });
    this.#invalidateProvider(frozen.providerId);
    const resetSelection = freezeAgentSelection(provider.selection);
    if (this.#selected?.providerId === frozen.providerId) this.#selected = resetSelection;
    this.#providers.set(frozen.providerId, Object.freeze({
      ...provider,
      models: Object.freeze([]),
      credentialConfigured: false,
      connection: null,
      installationDigest: null,
      availability: agentProviderAvailabilityFromFailureReason(
        "auth-required",
        provider.availability,
        validDate(this.#clock),
      ),
    }));
    this.#publish();
    return Object.freeze({ configured: false });
  }

  #invalidateProvider(providerId) {
    this.#generationByProvider.set(
      providerId,
      (this.#generationByProvider.get(providerId) || 0) + 1,
    );
    for (const [key, inflight] of this.#inflightBySelection) {
      if (inflight.providerId === providerId) this.#inflightBySelection.delete(key);
    }
    for (const [key, preflight] of this.#preflightBySelection) {
      if (preflight?.selection?.providerId === providerId) this.#preflightBySelection.delete(key);
    }
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
      installSource: provider.installSource,
      installState: provider.installState,
    }));
  }

  #patchProvider(providerId, patch) {
    const provider = this.#providers.get(providerId);
    if (!provider) return;
    this.#providers.set(providerId, Object.freeze({ ...provider, ...patch }));
    this.#publish();
  }

  async #applyPublicCatalog() {
    if (typeof this.#bridgeClient.agentProviders !== "function") return;
    const listed = await this.#bridgeClient.agentProviders().catch(() => null);
    const providers = Array.isArray(listed?.providers) ? listed.providers : [];
    for (const item of providers) {
      const providerId = String(item?.providerId || "");
      const current = this.#providers.get(providerId);
      if (!current) continue;
      this.#providers.set(providerId, Object.freeze({
        ...current,
        installable: item.installable === true,
        installSource: item.installSource === "user" || item.installSource === "managed"
          ? item.installSource
          : "none",
        installState: ["idle", "installing", "failed", "cancelling"].includes(item.installState)
          ? item.installState
          : current.installState || "idle",
      }));
    }
    this.#publish();
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
