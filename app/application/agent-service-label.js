// User-facing names for the three AI services. Internal providerId values stay
// pageroot / qoder / codex so persisted defaults and frozen Requests do not move.

export const AGENT_SERVICE_ORDER = Object.freeze(["pageroot", "qoder", "codex"]);

export const AGENT_SERVICE_LABELS = Object.freeze({
  pageroot: "内置 AI",
  qoder: "Qoder",
  codex: "Codex",
});

export function agentServiceLabel(providerId) {
  return AGENT_SERVICE_LABELS[providerId] || "AI 服务";
}

export function agentServiceStatusText({
  availability = null,
  installState = "idle",
  activeOperation = null,
  connection = null,
  isDefault = false,
  providerId = null,
  modelDisplayName = null,
} = {}) {
  if (availability?.reason === "disabled") return "已断开";
  if (installState === "installing") return "正在安装组件";
  if (installState === "cancelling") return "正在取消";
  if (
    activeOperation?.kind === "login"
    && ["waiting", "cancelling"].includes(String(activeOperation.state || ""))
  ) {
    return "请在浏览器完成登录";
  }
  if (availability?.status === "checking") return "正在检查";
  if (availability?.status === "ready") {
    if (providerId === "pageroot" && connection?.vendorDisplayName) {
      const model = String(modelDisplayName || "当前模型").trim() || "当前模型";
      return isDefault
        ? `${connection.vendorDisplayName} · ${model} · 默认`
        : `${connection.vendorDisplayName} · ${model}`;
    }
    return isDefault ? "已连接 · 默认" : "已连接";
  }
  if (availability?.reason === "account-capacity") return "额度已用完";
  if (
    availability?.status === "auth-required"
    || availability?.status === "not-installed"
  ) {
    return "尚未连接";
  }
  return "需要处理";
}

export function agentServicePrimaryAction({
  availability = null,
  isDefault = false,
} = {}) {
  if (availability?.reason === "disabled") {
    return Object.freeze({ kind: "connect", label: "重新连接" });
  }
  if (availability?.status === "ready") {
    return isDefault
      ? Object.freeze({ kind: "manage", label: "管理" })
      : Object.freeze({ kind: "default", label: "设为默认" });
  }
  return Object.freeze({ kind: "connect", label: "连接" });
}

export function sidebarServiceTriggerText({
  providerId = null,
  catalogStatus = "ready",
  connectionVendorName = null,
  modelDisplayName = null,
} = {}) {
  const service = agentServiceLabel(providerId);
  const model = String(modelDisplayName || "").trim();
  if (catalogStatus === "ready" && providerId === "pageroot" && connectionVendorName) {
    return `${connectionVendorName} · ${model || "当前模型"}`;
  }
  if (catalogStatus === "ready") {
    return `${service} · ${model || "默认模型"}`;
  }
  if (catalogStatus === "checking") return `${service} · 正在检查`;
  return `${service} · 尚未连接`;
}
