"use client";

import { useState, type Ref } from "react";
import { CodeIcon } from "@phosphor-icons/react/dist/csr/Code";
import { OpenAiLogoIcon } from "@phosphor-icons/react/dist/csr/OpenAiLogo";

import type {
  AgentProviderAvailabilitySnapshot,
  AgentProviderGuidanceKind,
} from "../domain/agent-provider-state.js";

type AgentActionOutcome = Readonly<{ status: string; reason?: string }> | null | undefined;
type CardActionKind = AgentProviderGuidanceKind | "recheck" | "api-key";
type ApiKeyExtras = Readonly<{ vendorId?: string; baseUrl?: string }>;
type VendorOption = Readonly<{ id: string; label: string; needsBaseUrl?: boolean }>;

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
  presentation: AgentProviderCardPresentation;
  surface: "delivery" | "about" | "settings";
  disabled?: boolean;
  actionButtonRef?: Ref<HTMLButtonElement>;
  onCopyGuidance: (kind: AgentProviderGuidanceKind) => Promise<AgentActionOutcome>;
  onInstall?: () => Promise<AgentActionOutcome>;
  onRecheck?: () => Promise<AgentActionOutcome>;
  onConnectApiKey?: (apiKey: string, extras?: ApiKeyExtras) => Promise<AgentActionOutcome>;
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
  presentation: provider,
  surface,
  disabled = false,
  actionButtonRef,
  onCopyGuidance,
  onInstall,
  onRecheck,
  onConnectApiKey,
}: AgentProviderCardProps) {
  const [pendingAction, setPendingAction] = useState<CardActionKind | null>(null);
  const [actionError, setActionError] = useState("");
  const [apiKeyOpen, setApiKeyOpen] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [vendorId, setVendorId] = useState(provider.vendors?.[0]?.id || "deepseek");
  const [baseUrl, setBaseUrl] = useState("");
  const presentation = provider.availability(availability);
  const actions = actionsForAvailability(availability, provider);
  const checking = availability.status === "checking";
  const installing = pendingAction === "install";
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
      const outcome = kind === "install" && typeof onInstall === "function"
        ? await onInstall()
        : kind === "recheck" && typeof onRecheck === "function"
          ? await onRecheck()
          : kind === "login" || kind === "install"
            ? await onCopyGuidance(kind)
            : null;
      const succeeded = Boolean(outcome && ["succeeded", "stale"].includes(outcome.status));
      if (!succeeded) {
        setActionError(
          kind === "install"
            ? "安装没有完成，请重试。"
            : kind === "recheck"
              ? "检查没有完成，请重试。"
              : "指令暂时无法复制，请重试。",
        );
      }
    } catch {
      setActionError(
        kind === "install"
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
    setPendingAction("api-key");
    setActionError("");
    try {
      const outcome = await onConnectApiKey(apiKey, {
        vendorId: selectedVendor?.id || vendorId,
        baseUrl: selectedVendor?.needsBaseUrl ? baseUrl : undefined,
      });
      const succeeded = Boolean(outcome && ["succeeded", "stale"].includes(outcome.status));
      if (!succeeded) {
        setActionError("Token 没有接通。");
        return;
      }
      setApiKey("");
      setApiKeyOpen(false);
    } catch {
      setActionError("Token 没有接通。");
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <section
      className={provider.cardClassName}
      data-status={availability.status}
      data-surface={surface}
      data-tone={presentation.tone}
      aria-busy={checking || installing}
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
            data-tone={presentation.tone}
            aria-live="polite"
            aria-atomic="true"
          >
            <i aria-hidden="true" />
            {presentation.statusLabel}
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
                aria-label={installing && action.kind === "install" ? "正在安装…" : label}
                onClick={() => void runAction(action.kind)}
              >
                {busy
                  ? (action.kind === "install"
                    ? "正在安装…"
                    : action.kind === "recheck"
                      ? "正在检查…"
                      : "正在复制…")
                  : label}
              </button>
            );
          })}
          {actionError && !tokenFormOpen ? (
            <span className="qoder-card-error" role="alert">{actionError}</span>
          ) : null}
        </span>
      </div>
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
              aria-label="接口地址"
              value={baseUrl}
              disabled={Boolean(pendingAction) || disabled}
              onChange={(event) => setBaseUrl(event.target.value)}
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
        </form>
      ) : null}
    </section>
  );
}
