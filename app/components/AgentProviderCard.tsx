"use client";

import { useState, type Ref } from "react";
import { CodeIcon } from "@phosphor-icons/react/dist/csr/Code";
import { OpenAiLogoIcon } from "@phosphor-icons/react/dist/csr/OpenAiLogo";

import type {
  AgentProviderAvailabilitySnapshot,
  AgentProviderGuidanceKind,
} from "../domain/agent-provider-state.js";

type AgentActionOutcome = Readonly<{ status: string; reason?: string }> | null | undefined;
type CardActionKind = AgentProviderGuidanceKind | "recheck" | "cancel-install" | "api-key" | "model" | "reasoning";
type ApiKeyExtras = Readonly<{ vendorId?: string; baseUrl?: string; modelId?: string }>;
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
  onInstall?: () => Promise<AgentActionOutcome>;
  onCancelInstall?: () => Promise<AgentActionOutcome>;
  onRecheck?: () => Promise<AgentActionOutcome>;
  onConnectApiKey?: (apiKey: string, extras?: ApiKeyExtras) => Promise<AgentActionOutcome>;
  onDisconnectApiKey?: () => Promise<AgentActionOutcome>;
  onSelectModel?: (modelId: string) => Promise<AgentActionOutcome>;
  onSelectReasoning?: (reasoning: string) => Promise<AgentActionOutcome>;
};

type CardAction = Readonly<{
  kind: CardActionKind;
  label: string;
  copiedLabel: string;
}>;

function actionsForAvailability(
  availability: AgentProviderAvailabilitySnapshot,
  presentation: AgentProviderCardPresentation,
): CardAction[] {
  if (availability.status === "not-installed") {
    return [{ kind: "install", ...presentation.actions.install }];
  }
  if (availability.status === "auth-required") {
    if (presentation.credentialKind === "api-token") return [];
    return [{ kind: "login", ...presentation.actions.login }];
  }
  if (
    availability.status === "ready"
    && presentation.supportsApiKey
    && presentation.credentialKind === "api-token"
  ) {
    return [{
      kind: "api-key",
      ...(presentation.actions.apiKey || { label: "更换 Token", copiedLabel: "更换 Token" }),
    }];
  }
  if (
    availability.status === "unavailable"
    && presentation.credentialKind === "api-token"
    && availability.reason === "account-capacity"
  ) {
    return [{
      kind: "api-key",
      label: "更换厂商",
      copiedLabel: "更换厂商",
    }];
  }
  if (
    availability.status === "unavailable"
    && presentation.credentialKind === "api-token"
    && availability.reason === "model-unavailable"
  ) {
    return [{
      kind: "api-key",
      label: "选择其他模型",
      copiedLabel: "选择其他模型",
    }];
  }
  if (
    availability.status === "unavailable"
    && presentation.credentialKind === "api-token"
    && availability.reason === "endpoint-region-mismatch"
  ) {
    return [{
      kind: "api-key",
      label: "修改接口",
      copiedLabel: "修改接口",
    }];
  }
  if (
    availability.status === "unavailable"
    && ["timeout", "service-unavailable"].includes(String(availability.reason || ""))
  ) {
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
  connection = null,
  models = [],
  selectedModelId = null,
  selectedReasoningId = null,
  presentation: provider,
  surface,
  disabled = false,
  actionButtonRef,
  onCopyGuidance,
  onInstall,
  onCancelInstall,
  onRecheck,
  onConnectApiKey,
  onDisconnectApiKey,
  onSelectModel,
  onSelectReasoning,
}: AgentProviderCardProps) {
  const [pendingAction, setPendingAction] = useState<CardActionKind | null>(null);
  const [actionError, setActionError] = useState("");
  const [apiKeyOpen, setApiKeyOpen] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [vendorId, setVendorId] = useState(connection?.vendorId || provider.vendors?.[0]?.id || "deepseek");
  const [baseUrl, setBaseUrl] = useState(connection?.vendorId === "custom" ? connection.baseUrl : "");
  const [modelId, setModelId] = useState(
    connection?.vendorId === "custom"
      ? String(selectedModelId || models[0]?.id || "").replace(/^pageroot:/u, "")
      : "",
  );
  const presentation = provider.availability(availability);
  const statusPresentation = installState === "installing"
    ? { ...presentation, statusLabel: "正在安装…", detail: "正在安装，请稍候。", tone: "checking" as const }
    : installState === "cancelling"
      ? { ...presentation, statusLabel: "正在取消…", detail: "正在取消安装，请稍候。", tone: "checking" as const }
      : presentation;
  const currentModel = models.find((model) => model.id === selectedModelId) || models[0] || null;
  const actions = installState === "installing" || installState === "cancelling"
    ? [{ kind: "cancel-install" as const, label: "取消", copiedLabel: "取消" }]
    : actionsForAvailability(availability, provider).filter((action) => !(
    availability.reason === "model-unavailable"
    && connection
    && models.length > 1
    && action.kind === "api-key"
    ));
  const checking = availability.status === "checking";
  const installing = installState === "installing" || pendingAction === "install";
  const tokenFormOpen = provider.credentialKind === "api-token"
    && (availability.status === "auth-required" || apiKeyOpen);
  const selectedVendor = provider.vendors?.find((vendor) => vendor.id === vendorId)
    || provider.vendors?.[0]
    || null;
  const primaryActionData = provider.primaryActionDataAttribute
    ? { [provider.primaryActionDataAttribute]: "true" }
    : {};

  const runAction = async (kind: CardActionKind) => {
    if (pendingAction || disabled) return;
    if (kind === "api-key") {
      setApiKeyOpen((open) => !open);
      setActionError("");
      return;
    }
    setPendingAction(kind);
    setActionError("");
    try {
      const outcome = kind === "cancel-install" && typeof onCancelInstall === "function"
        ? await onCancelInstall()
        : kind === "install" && typeof onInstall === "function"
        ? await onInstall()
        : kind === "recheck" && typeof onRecheck === "function"
          ? await onRecheck()
          : kind === "login" || kind === "install"
            ? await onCopyGuidance(kind)
            : null;
      const succeeded = Boolean(outcome && ["succeeded", "stale"].includes(outcome.status));
      if (!succeeded) {
        setActionError(
          kind === "install" || kind === "cancel-install"
            ? "安装没有完成，请重试。"
            : kind === "recheck"
              ? "检查没有完成，请重试。"
              : "指令暂时无法复制，请重试。",
        );
      }
    } catch {
      setActionError(
        kind === "install" || kind === "cancel-install"
          ? "安装没有完成，请重试。"
          : kind === "recheck"
            ? "检查没有完成，请重试。"
            : "指令暂时无法复制，请重试。",
      );
    } finally {
      setPendingAction(null);
    }
  };

  const connectApiKey = async () => {
    if (pendingAction || disabled || !apiKey.trim() || typeof onConnectApiKey !== "function") return;
    if (selectedVendor?.needsBaseUrl && !baseUrl.trim()) {
      setActionError("请填写接口地址。");
      return;
    }
    if (selectedVendor?.needsBaseUrl && !modelId.trim()) {
      setActionError("请填写 Model ID。");
      return;
    }
    setPendingAction("api-key");
    setActionError("");
    try {
      const outcome = await onConnectApiKey(apiKey, {
        vendorId: selectedVendor?.id || vendorId,
        baseUrl: selectedVendor?.needsBaseUrl ? baseUrl : undefined,
        modelId: modelId.trim() || undefined,
      });
      const succeeded = Boolean(outcome && ["succeeded", "stale"].includes(outcome.status));
      if (!succeeded) {
        setActionError(outcome?.reason || "Token 没有接通。");
        return;
      }
      setApiKey("");
      setModelId("");
      setApiKeyOpen(false);
    } catch {
      setActionError("Token 没有接通。");
    } finally {
      setPendingAction(null);
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
      aria-busy={checking || installing || installState === "cancelling" || Boolean(pendingAction)}
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
          <small>{presentation.detail}</small>
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
            const busy = pendingAction === action.kind;
            return (
              <button
                key={action.kind}
                ref={index === 0 ? actionButtonRef : undefined}
                type="button"
                data-kind={action.kind}
                {...(index === 0 ? primaryActionData : {})}
                disabled={Boolean(pendingAction) || disabled}
                aria-label={installState === "cancelling" && action.kind === "cancel-install"
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
      {connection && models.length > 1 && onSelectModel ? (
        <label className="qoder-card-model-choice">
          <span>{availability.reason === "model-unavailable" ? "选择其他模型" : "当前模型"}</span>
          <select
            aria-label="选择其他模型"
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
          {provider.vendors && provider.vendors.length > 0 ? (
            <select
              className="qoder-card-apikey-vendor"
              aria-label="厂商"
              data-testid="settings-agent-vendor"
              value={selectedVendor?.id || vendorId}
              disabled={Boolean(pendingAction) || disabled}
              onChange={(event) => {
                setVendorId(event.target.value);
                setBaseUrl("");
                setModelId("");
                setActionError("");
              }}
            >
              {provider.vendors.map((vendor) => (
                <option key={vendor.id} value={vendor.id}>{vendor.label}</option>
              ))}
            </select>
          ) : null}
          {selectedVendor?.needsBaseUrl ? (
            <input
              className="qoder-card-apikey-base"
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              placeholder="https://api.example.com/v1"
              aria-label="Base URL"
              value={baseUrl}
              disabled={Boolean(pendingAction) || disabled}
              onChange={(event) => setBaseUrl(event.target.value)}
            />
          ) : null}
          {selectedVendor?.needsBaseUrl ? (
            <input
              className="qoder-card-apikey-model"
              type="text"
              autoComplete="off"
              spellCheck={false}
              placeholder="Model ID"
              aria-label="Model ID"
              value={modelId}
              disabled={Boolean(pendingAction) || disabled}
              onChange={(event) => setModelId(event.target.value)}
            />
          ) : null}
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="API Token"
            aria-label="API Token"
            value={apiKey}
            disabled={Boolean(pendingAction) || disabled}
            onChange={(event) => setApiKey(event.target.value)}
          />
          <button
            type="submit"
            disabled={Boolean(pendingAction) || disabled || !apiKey.trim()}
          >
            {pendingAction === "api-key" ? "正在连接…" : "连接"}
          </button>
          {actionError ? (
            <span className="qoder-card-error" role="alert">{actionError}</span>
          ) : null}
          {connection ? (
            <span className="qoder-card-apikey-note">新配置验证成功后才会替换当前连接。</span>
          ) : null}
        </form>
      ) : null}
      {provider.credentialKind === "api-token" ? (
        <p className="qoder-card-token-note">
          Token 仅在本次打开期间保留。数据将发送给所选厂商，API 费用由厂商收取。
        </p>
      ) : null}
    </section>
  );
}
