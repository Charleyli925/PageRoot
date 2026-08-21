export const QODER_AVAILABILITY_STATUSES = Object.freeze([
  "checking",
  "ready",
  "not-installed",
  "auth-required",
  "unavailable",
]);

export const QODER_GUIDANCE_KINDS = Object.freeze(["install", "login"]);

export const INITIAL_QODER_AVAILABILITY = Object.freeze({
  status: "checking",
  reason: "initial",
  lastCheck: null,
  checkedAt: null,
  guidanceCopied: null,
  guidanceCopiedAt: null,
});

function cleanDate(value) {
  return typeof value === "string" && value ? value : null;
}

function cleanGuidanceKind(value) {
  return QODER_GUIDANCE_KINDS.includes(value) ? value : null;
}

function availabilitySnapshot({
  status,
  reason = null,
  lastCheck = null,
  checkedAt = null,
  guidanceCopied = null,
  guidanceCopiedAt = null,
}) {
  return Object.freeze({
    status: QODER_AVAILABILITY_STATUSES.includes(status) ? status : "unavailable",
    reason: reason ? String(reason) : null,
    lastCheck: lastCheck === "local" || lastCheck === "use" ? lastCheck : null,
    checkedAt: cleanDate(checkedAt),
    guidanceCopied: cleanGuidanceKind(guidanceCopied),
    guidanceCopiedAt: cleanDate(guidanceCopiedAt),
  });
}

export function checkingQoderAvailability(previous = INITIAL_QODER_AVAILABILITY) {
  return availabilitySnapshot({
    status: "checking",
    reason: "checking",
    lastCheck: previous.lastCheck,
    checkedAt: previous.checkedAt,
    guidanceCopied: previous.guidanceCopied,
    guidanceCopiedAt: previous.guidanceCopiedAt,
  });
}

function preserveUseFailureAfterLocalReady(previous) {
  return Boolean(
    previous?.lastCheck === "use"
    && (
      previous.status === "auth-required"
      || (
        previous.status === "unavailable"
        && ["restart-required", "service-unavailable"].includes(previous.reason)
      )
    ),
  );
}

export function qoderAvailabilityFromLocalResult(
  result,
  previous = INITIAL_QODER_AVAILABILITY,
  checkedAt = null,
) {
  const status = String(result?.status || "unavailable");
  if (status === "ready") {
    if (preserveUseFailureAfterLocalReady(previous)) {
      return availabilitySnapshot({
        ...previous,
        checkedAt,
      });
    }
    return availabilitySnapshot({
      status: "ready",
      reason: null,
      lastCheck: "local",
      checkedAt,
      guidanceCopied: previous.guidanceCopied,
      guidanceCopiedAt: previous.guidanceCopiedAt,
    });
  }
  if (status === "not-installed") {
    return availabilitySnapshot({
      status: "not-installed",
      reason: "not-installed",
      lastCheck: "local",
      checkedAt,
      guidanceCopied: previous.guidanceCopied,
      guidanceCopiedAt: previous.guidanceCopiedAt,
    });
  }
  return availabilitySnapshot({
    status: "unavailable",
    reason: result?.reason === "invalid-installation"
      ? "invalid-installation"
      : "service-unavailable",
    lastCheck: "local",
    checkedAt,
    guidanceCopied: previous.guidanceCopied,
    guidanceCopiedAt: previous.guidanceCopiedAt,
  });
}

export function readyQoderAvailability(checkedAt = null) {
  return availabilitySnapshot({
    status: "ready",
    reason: null,
    lastCheck: "use",
    checkedAt,
    guidanceCopied: null,
    guidanceCopiedAt: null,
  });
}

export function qoderAvailabilityFromFailureCode(
  code,
  previous = INITIAL_QODER_AVAILABILITY,
  checkedAt = null,
) {
  const normalized = String(code || "QODER_PREFLIGHT_FAILED");
  if (normalized === "QODER_COMMAND_NOT_FOUND") {
    return availabilitySnapshot({
      status: "not-installed",
      reason: "not-installed",
      lastCheck: "use",
      checkedAt,
      guidanceCopied: previous.guidanceCopied,
      guidanceCopiedAt: previous.guidanceCopiedAt,
    });
  }
  if (normalized === "QODER_AUTH_REQUIRED") {
    return availabilitySnapshot({
      status: "auth-required",
      reason: "auth-required",
      lastCheck: "use",
      checkedAt,
      guidanceCopied: previous.guidanceCopied,
      guidanceCopiedAt: previous.guidanceCopiedAt,
    });
  }
  if (["QODER_COMMAND_CHANGED", "QODER_VERSION_MISMATCH"].includes(normalized)) {
    return availabilitySnapshot({
      status: "unavailable",
      reason: "restart-required",
      lastCheck: "use",
      checkedAt,
      guidanceCopied: previous.guidanceCopied,
      guidanceCopiedAt: previous.guidanceCopiedAt,
    });
  }
  if ([
    "QODER_COMMAND_UNTRUSTED",
    "QODER_VERSION_INVALID",
    "QODER_VERSION_UNSUPPORTED",
  ].includes(normalized)) {
    return availabilitySnapshot({
      status: "unavailable",
      reason: "invalid-installation",
      lastCheck: "use",
      checkedAt,
      guidanceCopied: previous.guidanceCopied,
      guidanceCopiedAt: previous.guidanceCopiedAt,
    });
  }
  return availabilitySnapshot({
    status: "unavailable",
    reason: "service-unavailable",
    lastCheck: "use",
    checkedAt,
    guidanceCopied: previous.guidanceCopied,
    guidanceCopiedAt: previous.guidanceCopiedAt,
  });
}

export function qoderAvailabilityWithCopiedGuidance(previous, kind, copiedAt = null) {
  if (!QODER_GUIDANCE_KINDS.includes(kind)) return previous;
  return availabilitySnapshot({
    ...previous,
    guidanceCopied: kind,
    guidanceCopiedAt: copiedAt,
  });
}

export function qoderAvailabilityPresentation(availability) {
  const status = availability?.status || "checking";
  if (status === "ready") {
    return Object.freeze({
      statusLabel: "可使用",
      detail: "自动执行，并在 PageRoot 中显示进度",
      tone: "ready",
    });
  }
  if (status === "not-installed") {
    return Object.freeze({
      statusLabel: "未安装",
      detail: "如需从 PageRoot 直接发送，还需要 Qoder CLI。",
      tone: "attention",
    });
  }
  if (status === "auth-required") {
    return Object.freeze({
      statusLabel: "需要登录",
      detail: "完成 Qoder 登录后即可直接发送。",
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
    return Object.freeze({
      statusLabel: "正在检查",
      detail: "正在检查 Qoder CLI…",
      tone: "checking",
    });
  }
  return Object.freeze({
    statusLabel: "暂时无法检查",
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
