"use client";

import { useState, type Ref } from "react";
import { CodeIcon } from "@phosphor-icons/react/dist/csr/Code";
import { OpenAiLogoIcon } from "@phosphor-icons/react/dist/csr/OpenAiLogo";

import type {
  AgentProviderAvailabilitySnapshot,
  AgentProviderGuidanceKind,
} from "../domain/agent-provider-state.js";

type AgentActionOutcome = Readonly<{ status: string; reason?: string; code?: string }> | null | undefined;
type CardActionKind = AgentProviderGuidanceKind | "recheck" | "cancel-install" | "api-key" | "model" | "reasoning";
type ApiKeyExtras = Readonly<{ vendorId?: string; baseUrl?: string; modelId?: string; remember?: boolean }>;
type ApiKeyField = "apiKey" | "baseUrl" | "modelId" | "form";
type VendorOption = Readonly<{
  id: string;
  label: string;
  needsBaseUrl?: boolean;
  compatibilityMode?: boolean;
}>;

export type AgentProviderCardPresentation = Readonly<{
  displayName: string;
  logoSrc: string | null;
  brandIcon?: "openai" | null;
  cardClassName: string;
  primaryActionDataAttribute: string | null;
  availability: (value: AgentProviderAvailabilitySnapshot) => Readonly<{
    statusLabel: string;
    detail: string;
    tone: "ready" | "checking" | "attention";
  }>;
  actions: Readonly<{
    install: Readonly<{ label: string; copiedLabel: string }>;
    login: Readonly<{ label: string; copiedLabel: string }>;
    recheck?: Readonly<{ label: string; copiedLabel: string }>;
    apiKey?: Readonly<{ label: string; copiedLabel: string }>;
  }>;
  supportsApiKey?: boolean;
  credentialKind?: "api-token" | null;
  vendors?: readonly VendorOption[];
}>;

export type AgentProviderCardProps = {
  availability: AgentProviderAvailabilitySnapshot;
  installState?: "idle" | "installing" | "failed" | "cancelling";
  activeOperation?: Readonly<{
    kind: string;
    state: string;
  }> | null;
  connection?: Readonly<{
    vendorId: string;
    vendorDisplayName: string;
    baseUrl: string;
  }> | null;
  models?: readonly Readonly<{
    id: string;
    displayName: string;
    reasoningChoices?: readonly Readonly<{ id: string; label: string }>[];
  }>[];
  selectedModelId?: string | null;
  selectedReasoningId?: string | null;
  presentation: AgentProviderCardPresentation;
  surface: "delivery" | "about" | "settings";
  disabled?: boolean;
  actionButtonRef?: Ref<HTMLButtonElement>;
  onCopyGuidance: (kind: AgentProviderGuidanceKind) => Promise<AgentActionOutcome>;
  onStartLogin?: () => Promise<AgentActionOutcome>;
  onInstall?: () => Promise<AgentActionOutcome>;
  onCancelInstall?: () => Promise<AgentActionOutcome>;
  onRecheck?: () => Promise<AgentActionOutcome>;
  onConnectApiKey?: (apiKey: string, extras?: ApiKeyExtras) => Promise<AgentActionOutcome>;
  onDisconnectApiKey?: () => Promise<AgentActionOutcome>;
  onOpenVendorApiKeyPage?: (vendorId: string) => Promise<AgentActionOutcome>;
  onSelectModel?: (modelId: string) => Promise<AgentActionOutcome>;
  onSelectReasoning?: (reasoning: string) => Promise<AgentActionOutcome>;
};

type CardAction = Readonly<{
  kind: CardActionKind;
  label: string;
  copiedLabel: string;
}>;

function fieldForConnectError(code: string | undefined): ApiKeyField {
  switch (String(code || "")) {
    case "AGENT_AUTH_REQUIRED":
    case "AGENT_SESSION_CREDENTIAL_INVALID":
      return "apiKey";
    case "AGENT_SELECTION_UNSUPPORTED":
    case "AGENT_MODEL_ACCESS_DENIED":
      return "modelId";
    case "AGENT_ENDPOINT_REGION_MISMATCH":
      return "baseUrl";
    default:
      return "form";
  }
}

function actionsForAvailability(
  availability: AgentProviderAvailabilitySnapshot,
  presentation: AgentProviderCardPresentation,
): CardAction[] {
  if (availability.status === "not-installed") {
    return [{ kind: "install", ...presentation.actions.install }];
  }
  if (availability.status === "auth-required") {
    if (presentation.credentialKind === "api-token") {
      return [{ kind: "api-key", label: "登录", copiedLabel: "登录" }];
    }
    return [{ kind: "login", ...presentation.actions.login }];
  }
  if (availability.status === "unavailable" && [
    "invalid-installation",
    "restart-required",
  ].includes(String(availability.reason || ""))) {
    return [{ kind: "install", label: "修复", copiedLabel: "修复" }];
  }
  if (availability.status === "unavailable") {
    return [{
      kind: "recheck" as const,
      ...(presentation.actions.recheck || { label: "重试", copiedLabel: "重试" }),
    }];
  }
  return [];
}

export default function AgentProviderCard({
  availability,
  installState = "idle",
  activeOperation = null,
  connection = null,
  models = [],
  selectedModelId = null,
  selectedReasoningId = null,
  presentation: provider,
  surface,
  disabled = false,
  actionButtonRef,
  onCopyGuidance,
  onStartLogin,
  onInstall,
  onCancelInstall,
  onRecheck,
  onConnectApiKey,
  onDisconnectApiKey,
  onOpenVendorApiKeyPage,
  onSelectModel,
  onSelectReasoning,
}: AgentProviderCardProps) {
  const [pendingAction, setPendingAction] = useState<CardActionKind | null>(null);
  const [installPending, setInstallPending] = useState(false);
  const [cancelPending, setCancelPending] = useState(false);
  const [cancelRequested, setCancelRequested] = useState(false);
  const [actionError, setActionError] = useState("");
  const [fieldError, setFieldError] = useState<ApiKeyField | "">("");
  const [apiKeyOpen, setApiKeyOpen] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [rememberKey, setRememberKey] = useState(false);
  const [vendorId, setVendorId] = useState(connection?.vendorId || provider.vendors?.[0]?.id || "deepseek");
  const [baseUrl, setBaseUrl] = useState(connection?.vendorId === "custom" ? connection.baseUrl : "");
  const [modelId, setModelId] = useState(
    connection?.vendorId === "custom"
      ? String(selectedModelId || models[0]?.id || "").replace(/^pageroot:/u, "")
      : "",
  );
  const presentation = provider.availability(availability);
  const installing = installState === "installing" || installPending;
  const loggingIn = activeOperation?.kind === "login"
    && (activeOperation.state === "waiting" || activeOperation.state === "cancelling" || pendingAction === "login");
  const cancelling = installState === "cancelling"
    || (activeOperation?.kind === "login" && activeOperation.state === "cancelling")
    || cancelPending;
  const statusPresentation = (installing || loggingIn) && !cancelling
    ? {
      ...presentation,
      statusLabel: loggingIn ? "请在浏览器完成登录" : "正在安装…",
      detail: "",
      tone: "checking" as const,
    }
    : cancelling
      ? { ...presentation, statusLabel: "正在取消…", detail: "", tone: "checking" as const }
      : presentation;
  const currentModel = models.find((model) => model.id === selectedModelId) || models[0] || null;
  const actions = installing || cancelling || loggingIn
    ? [{ kind: "cancel-install" as const, label: "取消", copiedLabel: "取消" }]
    : actionsForAvailability(availability, provider).filter((action) => !(
    availability.reason === "model-unavailable"
    && connection
    && models.length > 1
    && action.kind === "api-key"
    ));
  const checking = availability.status === "checking";
  const tokenFormOpen = provider.credentialKind === "api-token"
    && (availability.status === "auth-required" || apiKeyOpen);
  const selectedVendor = provider.vendors?.find((vendor) => vendor.id === vendorId)
    || provider.vendors?.[0]
    || null;
  const primaryActionData = provider.primaryActionDataAttribute
    ? { [provider.primaryActionDataAttribute]: "true" }
    : {};

  const runAction = async (kind: CardActionKind) => {
    if (disabled) return;
    if (kind === "cancel-install") {
      if (cancelPending || cancelRequested || typeof onCancelInstall !== "function") return;
      setCancelRequested(true);
      setCancelPending(true);
      setActionError("");
      let confirmed = false;
      try {
        const outcome = await onCancelInstall();
        confirmed = Boolean(outcome && ["succeeded", "stale"].includes(outcome.status));
        if (!confirmed) {
          setActionError(loggingIn ? "登录没有取消，请重试。" : "安装没有取消，请重试。");
        }
      } catch {
        setActionError(loggingIn ? "登录没有取消，请重试。" : "安装没有取消，请重试。");
      } finally {
        setCancelPending(false);
        setCancelRequested(false);
      }
      return;
    }
    if (kind === "install") {
      if (installPending || pendingAction || typeof onInstall !== "function") return;
      setCancelRequested(false);
      setInstallPending(true);
      setActionError("");
      try {
        const outcome = await onInstall();
        if (!outcome || !["succeeded", "stale"].includes(outcome.status)) {
          setActionError("安装没有完成，请重试。");
        }
      } catch {
        setActionError("安装没有完成，请重试。");
      } finally {
        setInstallPending(false);
        setCancelRequested(false);
      }
      return;
    }
    if (pendingAction || installPending || cancelPending) return;
    if (kind === "api-key") {
      setApiKeyOpen((open) => !open);
      setActionError("");
      return;
    }
    setPendingAction(kind);
    setActionError("");
    try {
      const outcome = kind === "recheck" && typeof onRecheck === "function"
          ? await onRecheck()
          : kind === "login"
            ? await (typeof onStartLogin === "function" ? onStartLogin() : onCopyGuidance(kind))
            : null;
      const succeeded = Boolean(outcome && ["succeeded", "stale"].includes(outcome.status));
      if (!succeeded) {
        setActionError(
          kind === "recheck"
              ? "检查没有完成，请重试。"
              : kind === "login"
                ? "登录没有完成，请重试。"
                : "指令暂时无法复制，请重试。",
        );
      }
    } catch {
      setActionError(
        kind === "recheck"
            ? "检查没有完成，请重试。"
            : kind === "login"
              ? "登录没有完成，请重试。"
              : "指令暂时无法复制，请重试。",
      );
    } finally {
      setPendingAction(null);
    }
  };

  const connectApiKey = async () => {
    if (pendingAction || disabled || !apiKey.trim() || typeof onConnectApiKey !== "function") return;
    if (selectedVendor?.needsBaseUrl && !baseUrl.trim()) {
      setFieldError("baseUrl");
      setActionError("请填写接口地址。");
      return;
    }
    if (selectedVendor?.needsBaseUrl && !modelId.trim()) {
      setFieldError("modelId");
      setActionError("请填写 Model ID。");
      return;
    }
    setPendingAction("api-key");
    setActionError("");
    setFieldError("");
    try {
      const outcome = await onConnectApiKey(apiKey, {
        vendorId: selectedVendor?.id || vendorId,
        baseUrl: selectedVendor?.needsBaseUrl ? baseUrl : undefined,
        modelId: modelId.trim() || undefined,
        remember: rememberKey,
      });
      const succeeded = Boolean(outcome && ["succeeded", "stale"].includes(outcome.status));
      if (!succeeded) {
        const message = outcome?.reason || "API Key 无效或已失效。";
        setFieldError(fieldForConnectError(outcome?.code));
        setActionError(message);
        return;
      }
      setApiKey("");
      setModelId("");
      setRememberKey(false);
      setApiKeyOpen(false);
    } catch {
      setFieldError("form");
      setActionError("连接中断，请重试。");
    } finally {
      setPendingAction(null);
    }
  };

  const cancelConnectApiKey = async () => {
    if (typeof onCancelInstall !== "function") return;
    setCancelPending(true);
    try {
      await onCancelInstall();
    } catch {
      setFieldError("form");
      setActionError("连接验证没有取消，请重试。");
    } finally {
      setCancelPending(false);
      setPendingAction(null);
    }
  };

  const openVendorKeyPage = async () => {
    const id = selectedVendor?.id || vendorId;
    if (!id || typeof onOpenVendorApiKeyPage !== "function") return;
    setActionError("");
    setFieldError("");
    try {
      const outcome = await onOpenVendorApiKeyPage(id);
      if (outcome && !["succeeded", "stale"].includes(outcome.status)) {
        setFieldError("form");
        setActionError(outcome.reason || "无法打开获取 API Key 页面。");
      }
    } catch {
      setFieldError("form");
      setActionError("无法打开获取 API Key 页面。");
    }
  };

  const disconnectApiKey = async () => {
    if (pendingAction || disabled || typeof onDisconnectApiKey !== "function") return;
    setPendingAction("api-key");
    setActionError("");
    try {
      const outcome = await onDisconnectApiKey();
      if (!outcome || !["succeeded", "stale"].includes(outcome.status)) {
        setActionError(outcome?.reason || "断开连接没有完成。");
      } else {
        setApiKeyOpen(false);
        setApiKey("");
        setModelId("");
      }
    } catch {
      setActionError("断开连接没有完成。");
    } finally {
      setPendingAction(null);
    }
  };

  const selectModel = async (nextModelId: string) => {
    if (pendingAction || disabled || !nextModelId || typeof onSelectModel !== "function") return;
    setPendingAction("model");
    setActionError("");
    try {
      const outcome = await onSelectModel(nextModelId);
      if (!outcome || !["succeeded", "stale"].includes(outcome.status)) {
        setActionError(outcome?.reason || "模型没有切换成功，请重试。");
      }
    } catch {
      setActionError("模型没有切换成功，请重试。");
    } finally {
      setPendingAction(null);
    }
  };

  const selectReasoning = async (nextReasoning: string) => {
    if (pendingAction || disabled || !nextReasoning || typeof onSelectReasoning !== "function") return;
    setPendingAction("reasoning");
    setActionError("");
    try {
      const outcome = await onSelectReasoning(nextReasoning);
      if (!outcome || outcome.status !== "succeeded") {
        setActionError(outcome?.reason || "思考深度没有切换成功，请重试。");
      }
    } catch {
      setActionError("思考深度没有切换成功，请重试。");
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <section
      className={provider.cardClassName}
      data-status={availability.status}
      data-surface={surface}
      data-tone={statusPresentation.tone}
      aria-busy={checking || installing || cancelling || Boolean(pendingAction)}
    >
      <div className="qoder-card-summary">
        <span
          className="qoder-card-brand"
          data-fallback={!provider.logoSrc && provider.brandIcon !== "openai" ? "true" : undefined}
          aria-hidden="true"
        >
          {provider.logoSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={provider.logoSrc} alt="" />
          ) : provider.brandIcon === "openai" ? (
            <OpenAiLogoIcon size={22} weight="regular" />
          ) : (
            <CodeIcon size={22} weight="bold" />
          )}
        </span>
        <span className="qoder-card-copy">
          <strong>{provider.displayName}</strong>
          {presentation.detail ? <small>{presentation.detail}</small> : null}
        </span>
        <span className="qoder-card-control">
          <span
            className="qoder-card-status"
            data-tone={statusPresentation.tone}
            aria-live="polite"
            aria-atomic="true"
          >
            <i aria-hidden="true" />
            {statusPresentation.statusLabel}
          </span>
          {actions.map((action, index) => {
            const copied = action.kind === "login" || action.kind === "install"
              ? availability.guidanceCopied === action.kind
              : false;
            const label = copied ? action.copiedLabel : action.label;
            const busy = action.kind === "cancel-install"
              ? cancelPending
              : action.kind === "install" ? installPending : pendingAction === action.kind;
            const actionDisabled = disabled
              || (action.kind === "cancel-install"
                ? cancelling
                : Boolean(pendingAction) || installPending || cancelPending);
            return (
              <button
                key={action.kind}
                ref={index === 0 ? actionButtonRef : undefined}
                type="button"
                data-kind={action.kind}
                {...(index === 0 ? primaryActionData : {})}
                disabled={actionDisabled}
                aria-label={cancelling && action.kind === "cancel-install"
                  ? "正在取消…"
                  : installing && action.kind === "cancel-install"
                    ? "取消"
                    : installing && action.kind === "install" ? "正在安装…" : label}
                onClick={() => void runAction(action.kind)}
              >
                {busy
                  ? (action.kind === "cancel-install"
                    ? "正在取消…"
                    : action.kind === "install"
                    ? "正在安装…"
                    : action.kind === "login"
                      ? "正在登录…"
                    : action.kind === "recheck"
                      ? "正在检查…"
                      : "正在复制…")
                  : label}
              </button>
            );
          })}
          {connection && onDisconnectApiKey ? (
            <button
              type="button"
              data-kind="disconnect"
              disabled={Boolean(pendingAction) || disabled}
              onClick={() => void disconnectApiKey()}
            >
              {pendingAction === "api-key" && !apiKeyOpen ? "正在断开…" : "断开连接"}
            </button>
          ) : null}
          {actionError && !tokenFormOpen ? (
            <span className="qoder-card-error" role="alert">{actionError}</span>
          ) : null}
        </span>
      </div>
      {connection ? (
        <p className="qoder-card-connection" data-testid="settings-agent-current-connection">
          当前连接：{connection.vendorDisplayName || connection.vendorId}
          {currentModel ? ` · ${currentModel.displayName}` : ""}
          {connection.vendorId === "custom" && connection.baseUrl ? ` · ${connection.baseUrl}` : ""}
        </p>
      ) : null}
          {availability.status === "ready"
        && provider.credentialKind === "api-token"
        && provider.supportsApiKey
        && onConnectApiKey ? (
        <button
          type="button"
          data-kind="api-key"
          disabled={Boolean(pendingAction) || disabled}
          onClick={() => {
            setApiKeyOpen((open) => !open);
            setActionError("");
          }}
        >
          {apiKeyOpen ? "收起配置" : (provider.actions.apiKey?.label || "更换 Token")}
        </button>
      ) : null}
          {connection && models.length > 1 && onSelectModel ? (
            <label className="qoder-card-model-choice">
              <span>当前模型</span>
          <select
            aria-label="当前模型"
            value={selectedModelId || models[0]?.id || ""}
                    disabled={Boolean(pendingAction) || disabled}
            onChange={(event) => void selectModel(event.target.value)}
          >
            {models.map((model) => (
              <option key={model.id} value={model.id}>{model.displayName || model.id}</option>
            ))}
          </select>
        </label>
      ) : null}
      {(currentModel?.reasoningChoices?.length || 0) > 1 && onSelectReasoning ? (
        <details className="qoder-card-advanced">
          <summary>高级设置</summary>
          <label className="qoder-card-model-choice">
            <span>思考深度</span>
            <select
              aria-label="思考深度"
              value={selectedReasoningId || "auto"}
              disabled={Boolean(pendingAction) || disabled}
              onChange={(event) => void selectReasoning(event.target.value)}
            >
              {currentModel?.reasoningChoices?.map((choice) => (
                <option key={choice.id} value={choice.id}>{choice.label}</option>
              ))}
            </select>
          </label>
        </details>
      ) : null}
      {tokenFormOpen ? (
        <form
          className="qoder-card-apikey"
          onSubmit={(event) => {
            event.preventDefault();
            void connectApiKey();
          }}
        >
          <p className="qoder-card-apikey-title">
            连接 {selectedVendor?.label || "DeepSeek"}
          </p>
          <div className="qoder-card-apikey-key-row">
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="API Key"
              aria-label="API Key"
              aria-invalid={fieldError === "apiKey" || undefined}
              value={apiKey}
              disabled={Boolean(pendingAction) || disabled}
              onChange={(event) => {
                setApiKey(event.target.value);
                if (fieldError === "apiKey") {
                  setFieldError("");
                  setActionError("");
                }
              }}
            />
            {onOpenVendorApiKeyPage && selectedVendor?.id && selectedVendor.id !== "custom" ? (
              <button
                type="button"
                className="qoder-card-apikey-get"
                disabled={Boolean(pendingAction) || disabled}
                onClick={() => void openVendorKeyPage()}
              >
                获取 API Key
              </button>
            ) : null}
          </div>
          {fieldError === "apiKey" && actionError ? (
            <span className="qoder-card-error" role="alert">{actionError}</span>
          ) : null}
          {provider.vendors && provider.vendors.length > 1 ? (
            <details className="qoder-card-apikey-vendors">
              <summary>其他服务商</summary>
              <select
                className="qoder-card-apikey-vendor"
                aria-label="服务商"
                data-testid="settings-agent-vendor"
                value={selectedVendor?.id || vendorId}
                disabled={Boolean(pendingAction) || disabled}
                onChange={(event) => {
                  setVendorId(event.target.value);
                  setBaseUrl("");
                  setModelId("");
                  setActionError("");
                  setFieldError("");
                }}
              >
                {provider.vendors.map((vendor) => (
                  <option key={vendor.id} value={vendor.id}>{vendor.label}</option>
                ))}
              </select>
            </details>
          ) : null}
          {selectedVendor?.needsBaseUrl ? (
            <input
              className="qoder-card-apikey-base"
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              placeholder="https://api.example.com/v1"
              aria-label="接口地址"
              aria-invalid={fieldError === "baseUrl" || undefined}
              value={baseUrl}
              disabled={Boolean(pendingAction) || disabled}
              onChange={(event) => {
                setBaseUrl(event.target.value);
                if (fieldError === "baseUrl") {
                  setFieldError("");
                  setActionError("");
                }
              }}
            />
          ) : null}
          {fieldError === "baseUrl" && actionError ? (
            <span className="qoder-card-error" role="alert">{actionError}</span>
          ) : null}
          {selectedVendor?.needsBaseUrl ? (
            <input
              className="qoder-card-apikey-model"
              type="text"
              autoComplete="off"
              spellCheck={false}
              placeholder="Model ID"
              aria-label="Model ID"
              aria-invalid={fieldError === "modelId" || undefined}
              value={modelId}
              disabled={Boolean(pendingAction) || disabled}
              onChange={(event) => {
                setModelId(event.target.value);
                if (fieldError === "modelId") {
                  setFieldError("");
                  setActionError("");
                }
              }}
            />
          ) : null}
          {fieldError === "modelId" && actionError ? (
            <span className="qoder-card-error" role="alert">{actionError}</span>
          ) : null}
          <label className="qoder-card-apikey-remember">
            <input
              type="checkbox"
              checked={rememberKey}
              disabled={Boolean(pendingAction) || disabled}
              onChange={(event) => setRememberKey(event.target.checked)}
            />
            在此 Mac 上记住 API Key
          </label>
          <p className="qoder-card-apikey-note">连接验证可能产生少量 API 费用。</p>
          <button
            type="submit"
            disabled={Boolean(pendingAction) || disabled || !apiKey.trim()}
          >
            {pendingAction === "api-key" ? "正在连接…" : "连接"}
          </button>
          {pendingAction === "api-key" && onCancelInstall ? (
            <button
              type="button"
              data-kind="cancel-validate"
              disabled={cancelPending || disabled}
              onClick={() => void cancelConnectApiKey()}
            >
              {cancelPending ? "正在取消…" : "取消"}
            </button>
          ) : null}
          {actionError && (fieldError === "form" || !fieldError) ? (
            <span className="qoder-card-error" role="alert">{actionError}</span>
          ) : null}
          {connection ? (
            <span className="qoder-card-apikey-note">新配置验证成功后才会替换当前连接。</span>
          ) : null}
        </form>
      ) : null}
      {provider.credentialKind === "api-token" ? (
        <p className="qoder-card-token-note">
          {`使用时会将任务内容发送给${selectedVendor?.label || "所选厂商"}，API 费用由${selectedVendor?.label || "厂商"}收取。${rememberKey ? "" : "未勾选记住时仅本次使用。"}`}
        </p>
      ) : null}
    </section>
  );
}
