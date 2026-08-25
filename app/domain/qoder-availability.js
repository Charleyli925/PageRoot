import {
  AGENT_PROVIDER_AVAILABILITY_STATUSES,
  AGENT_PROVIDER_GUIDANCE_KINDS,
  INITIAL_AGENT_PROVIDER_AVAILABILITY,
  agentProviderAvailabilityFromFailureReason,
  agentProviderAvailabilityFromLocalResult,
  agentProviderAvailabilityWithCopiedGuidance,
  checkingAgentProviderAvailability,
  readyAgentProviderAvailability,
} from "./agent-provider-state.js";
const FAILURE_REASONS = Object.freeze({
  QODER_COMMAND_NOT_FOUND: "not-installed",
  QODER_AUTH_REQUIRED: "auth-required",
  QODER_ACCOUNT_CAPACITY_UNAVAILABLE: "account-capacity",
  QODER_CAPACITY_UNAVAILABLE: "account-capacity",
  QODER_PREFLIGHT_TIMEOUT: "timeout",
  QODER_COMMAND_CHANGED: "restart-required",
  QODER_VERSION_MISMATCH: "restart-required",
  QODER_COMMAND_UNTRUSTED: "invalid-installation",
  QODER_VERSION_INVALID: "invalid-installation",
  QODER_VERSION_UNSUPPORTED: "invalid-installation",
});

export const QODER_AVAILABILITY_STATUSES = AGENT_PROVIDER_AVAILABILITY_STATUSES;
export const QODER_GUIDANCE_KINDS = AGENT_PROVIDER_GUIDANCE_KINDS;
export const INITIAL_QODER_AVAILABILITY = INITIAL_AGENT_PROVIDER_AVAILABILITY;
export const checkingQoderAvailability = checkingAgentProviderAvailability;
export const qoderAvailabilityFromLocalResult = agentProviderAvailabilityFromLocalResult;
export const readyQoderAvailability = readyAgentProviderAvailability;
export const qoderAvailabilityWithCopiedGuidance = agentProviderAvailabilityWithCopiedGuidance;

export function qoderAvailabilityFromFailureCode(
  code,
  previous = INITIAL_QODER_AVAILABILITY,
  checkedAt = null,
) {
  return agentProviderAvailabilityFromFailureReason(
    FAILURE_REASONS[String(code || "")] || "service-unavailable",
    previous,
    checkedAt,
  );
}

export function qoderAvailabilityPresentation(availability) {
  const status = availability?.status || "checking";
  if (status === "ready") {
    return Object.freeze({ statusLabel: "已连接", detail: "真实预检已完成，可直接交给 Qoder CLI", tone: "ready" });
  }
  if (status === "not-installed") {
    return Object.freeze({ statusLabel: "未安装", detail: "如需从 PageRoot 直接发送，还需要 Qoder CLI。", tone: "attention" });
  }
  if (status === "auth-required") {
    const waitingForLogin = availability?.guidanceCopied === "login";
    return Object.freeze({
      statusLabel: waitingForLogin ? "等待登录" : "需要登录",
      detail: waitingForLogin
        ? "完成登录后返回源页，系统会自动复检。"
        : "完成 Qoder 登录后即可直接发送。",
      tone: "attention",
    });
  }
  if (availability?.reason === "invalid-installation") {
    return Object.freeze({
      statusLabel: "无法使用当前安装",
      detail: "当前安装不是 PageRoot 支持的独立 Qoder CLI。",
      tone: "attention",
    });
  }
  if (availability?.reason === "restart-required") {
    return Object.freeze({
      statusLabel: "请重新打开 PageRoot",
      detail: "Qoder CLI 已发生变化，重新打开 PageRoot 后即可继续。",
      tone: "attention",
    });
  }
  if (status === "checking") {
    return Object.freeze({ statusLabel: "检测中", detail: "正在自动检查 Qoder CLI…", tone: "checking" });
  }
  if (availability?.reason === "account-capacity") {
    return Object.freeze({
      statusLabel: "暂不可用 · Qoder 额度已用完",
      detail: "Qoder 账号当前没有可用模型容量。",
      tone: "attention",
    });
  }
  if (availability?.reason === "timeout") {
    return Object.freeze({
      statusLabel: "暂不可用 · 连接超时",
      detail: "Qoder CLI 预检没有在规定时间内完成。",
      tone: "attention",
    });
  }
  return Object.freeze({
    statusLabel: "暂不可用 · 连接没有完成",
    detail: "本轮任务尚未创建，当前页面不受影响。",
    tone: "attention",
  });
}

export function qoderGuidanceInstruction(kind) {
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
