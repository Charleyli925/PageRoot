"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { ArrowSquareOutIcon } from "@phosphor-icons/react/dist/csr/ArrowSquareOut";
import { CheckCircleIcon } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { CloudArrowDownIcon } from "@phosphor-icons/react/dist/csr/CloudArrowDown";
import { ArrowClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowClockwise";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";

import type {
  AgentProviderGuidanceKind,
  AgentSelection,
} from "../domain/agent-provider-state.js";
import AgentProviderCard from "./AgentProviderCard";
import type { AgentProviderCardData } from "./agent-provider-card-types";
import type { ApplicationUpdateResult } from "../workbench/types";
import { architectureLabel, updatePresentation } from "./update-presentation";

type AgentActionOutcome = Readonly<{ status: string; reason?: string }> | null | undefined;

export type SettingsPageProps = {
  activeTabId: string;
  initialFocus?: "close" | "agent";
  appVersion: string;
  currentAgentName: string;
  updateResult: ApplicationUpdateResult | null;
  updatesAvailable: boolean;
  manualCheckPending: boolean;
  manualCheckFailed: boolean;
  releaseNotesOpenFailed: boolean;
  agentCards: readonly AgentProviderCardData[];
  onClose: () => void;
  onCheckForUpdates: () => void;
  onDownloadUpdate: () => void;
  onRequestRestart: () => void;
  onOpenReleaseNotes: () => void;
  onCheckUsability: (selection: AgentSelection) => Promise<AgentActionOutcome>;
  onCopyGuidance: (
    kind: AgentProviderGuidanceKind,
    selection: AgentSelection,
  ) => Promise<AgentActionOutcome>;
  onInstall: (selection: AgentSelection) => Promise<AgentActionOutcome>;
};

function focusableElements(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(
    "button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])",
  )];
}

export default function SettingsPage({
  activeTabId,
  initialFocus = "close",
  appVersion,
  currentAgentName,
  updateResult,
  updatesAvailable,
  manualCheckPending,
  manualCheckFailed,
  releaseNotesOpenFailed,
  agentCards,
  onClose,
  onCheckForUpdates,
  onDownloadUpdate,
  onRequestRestart,
  onOpenReleaseNotes,
  onCheckUsability,
  onCopyGuidance,
  onInstall,
}: SettingsPageProps) {
  const pageRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const agentActionRef = useRef<HTMLButtonElement>(null);
  const agentHeadingRef = useRef<HTMLHeadingElement>(null);
  const agentCardsRef = useRef(agentCards);
  const checkInFlightRef = useRef(false);
  const lastCheckStartedAtRef = useRef(0);
  const lastCheckGuidanceRef = useRef("");
  const [agentCheckPending, setAgentCheckPending] = useState(false);

  useEffect(() => {
    agentCardsRef.current = agentCards;
  }, [agentCards]);

  const requestAgentCheck = useCallback((force = false) => {
    const cards = agentCardsRef.current;
    if (!force && cards.every((card) => (
      card.availability.status === "ready" || card.availability.status === "checking"
    ))) return;
    const now = Date.now();
    const guidanceKey = cards.map((card) => card.availability.guidanceCopied).join("|");
    const guidanceChanged = guidanceKey !== lastCheckGuidanceRef.current;
    if (
      checkInFlightRef.current
      || (!force && !guidanceChanged && now - lastCheckStartedAtRef.current < 1_500)
    ) return;
    lastCheckStartedAtRef.current = now;
    lastCheckGuidanceRef.current = guidanceKey;
    checkInFlightRef.current = true;
    setAgentCheckPending(true);
    Promise.all(cards.map((card) => Promise.resolve(onCheckUsability(card.selection))))
      .catch(() => undefined)
      .finally(() => {
        checkInFlightRef.current = false;
        setAgentCheckPending(false);
      });
  }, [onCheckUsability]);

  useEffect(() => {
    requestAgentCheck(true);
    const handleReturnToApp = () => {
      if (document.visibilityState === "visible") {
        const unresolved = agentCardsRef.current.some((card) => (
          !["ready", "checking"].includes(card.availability.status)
        ));
        if (unresolved) requestAgentCheck(true);
      }
    };
    window.addEventListener("focus", handleReturnToApp);
    document.addEventListener("visibilitychange", handleReturnToApp);
    return () => {
      window.removeEventListener("focus", handleReturnToApp);
      document.removeEventListener("visibilitychange", handleReturnToApp);
    };
  }, [requestAgentCheck]);

  useEffect(() => {
    const focusFrame = requestAnimationFrame(() => {
      if (initialFocus === "agent") {
        agentActionRef.current?.focus();
        if (!agentActionRef.current) agentHeadingRef.current?.focus();
      } else closeButtonRef.current?.focus();
    });
    return () => cancelAnimationFrame(focusFrame);
  }, [initialFocus]);

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab" || !pageRef.current) return;
    const elements = focusableElements(pageRef.current);
    if (!elements.length) {
      event.preventDefault();
      return;
    }
    const current = document.activeElement;
    const currentIndex = elements.indexOf(current as HTMLElement);
    if (currentIndex < 0) return;
    const nextIndex = event.shiftKey
      ? (currentIndex - 1 + elements.length) % elements.length
      : (currentIndex + 1) % elements.length;
    if (
      (!event.shiftKey && currentIndex === elements.length - 1)
      || (event.shiftKey && currentIndex === 0)
    ) {
      event.preventDefault();
      elements[nextIndex]?.focus();
    }
  };

  const presentation = updatePresentation({
    result: updateResult,
    updatesAvailable,
    manualCheckPending,
    manualCheckFailed,
  });
  const checking = manualCheckPending || updateResult?.status === "checking";
  const downloaded = updateResult?.status === "downloaded";
  const available = updateResult?.status === "available";
  const installing = updateResult?.status === "installing";
  const downloading = updateResult?.status === "downloading";
  const canCheck = (
    updatesAvailable
    && !checking
    && !available
    && !downloaded
    && !installing
    && !downloading
    && updateResult?.status !== "unsupported"
  );
  const updateActionLabel = downloaded
    ? "重启更新"
    : available
      ? "下载更新"
      : installing
        ? "正在重启…"
        : downloading
          ? "正在下载…"
          : checking
            ? "正在检查…"
            : canCheck
              ? "立即检查"
              : "仅正式版可用";

  return (
    <section
      ref={pageRef}
      id="workbench-content-outlet"
      className="workbench-settings-page"
      role="tabpanel"
      aria-labelledby={`workbench-tab-${activeTabId}`}
      aria-label="设置"
      onKeyDown={handleKeyDown}
    >
      <div className="settings-page-inner">
        <header className="settings-page-header">
          <div>
            <p className="settings-page-eyebrow">工作台设置</p>
            <h1>设置</h1>
            <p>管理 AI Agent 连接和源页软件更新。</p>
          </div>
          <button
            ref={closeButtonRef}
            className="settings-close-button"
            type="button"
            aria-label="关闭设置"
            data-tooltip="关闭设置"
            onClick={onClose}
          >
            <XIcon aria-hidden="true" size={18} weight="bold" />
          </button>
        </header>

        <div className="settings-sections">
          <section className="settings-section settings-agent-section" aria-labelledby="settings-agent-title">
            <div className="settings-section-heading">
              <div>
                <p className="settings-section-eyebrow">连接</p>
                <h2 ref={agentHeadingRef} id="settings-agent-title" tabIndex={-1}>AI Agent</h2>
                <p>当前 Agent：{currentAgentName || "尚未选择"}</p>
              </div>
              <button
                className="settings-secondary-action"
                type="button"
                disabled={agentCheckPending}
                onClick={() => requestAgentCheck(true)}
              >
                <ArrowClockwiseIcon aria-hidden="true" size={14} weight="bold" />
                {agentCheckPending ? "正在检查…" : "重新检查"}
              </button>
            </div>
            <p className="settings-agent-guidance">
              安装、登录或连接状态会在这里显示；需要登录时，复制命令并粘贴到对应 Agent 中完成授权。
            </p>
            <div className="settings-agent-cards">
              {agentCards.length ? agentCards.map((card, index) => (
                <AgentProviderCard
                  key={`${card.selection.providerId}:${card.selection.runtimeId}`}
                  availability={card.availability}
                  presentation={card.presentation}
                  surface="settings"
                  actionButtonRef={index === 0 ? agentActionRef : undefined}
                  onCopyGuidance={(kind) => onCopyGuidance(kind, card.selection)}
                  onInstall={() => onInstall(card.selection)}
                />
              )) : (
                <p className="settings-empty-state">当前没有可配置的 Agent。</p>
              )}
            </div>
          </section>

          <section className="settings-section settings-update-section" aria-labelledby="settings-update-title">
            <div className="settings-section-heading">
              <div>
                <p className="settings-section-eyebrow">源页</p>
                <h2 id="settings-update-title">软件更新</h2>
                <p>在不影响当前编辑的情况下检查和安装正式版本。</p>
              </div>
            </div>
            <div className="settings-update-meta" aria-label="版本信息">
              <span>当前版本 {appVersion || updateResult?.currentVersion || "—"}</span>
              <span>最新版本 {updateResult?.latestVersion || "—"}</span>
              <span>{architectureLabel(updateResult?.architecture)}</span>
            </div>
            <div className="settings-update-card" data-tone={presentation.tone}>
              <div className="settings-update-icon" aria-hidden="true">
                {presentation.tone === "ready" ? (
                  <CheckCircleIcon size={22} weight="fill" />
                ) : (
                  <CloudArrowDownIcon size={22} weight="duotone" />
                )}
              </div>
              <div className="settings-update-copy" aria-live="polite" aria-atomic="true">
                <strong>{presentation.title}</strong>
                <p>{presentation.detail}</p>
              </div>
              <button
                className="settings-update-action"
                type="button"
                disabled={!canCheck && !available && !downloaded}
                onClick={downloaded
                  ? onRequestRestart
                  : available
                    ? onDownloadUpdate
                    : onCheckForUpdates}
              >
                {updateActionLabel}
              </button>
            </div>
            <button
              className="settings-release-notes"
              type="button"
              onClick={onOpenReleaseNotes}
            >
              <span>查看更新内容</span>
              <ArrowSquareOutIcon aria-hidden="true" size={12} weight="bold" />
            </button>
            {releaseNotesOpenFailed ? (
              <p className="settings-error" role="alert">
                更新内容页面没有打开，请检查网络后重试。
              </p>
            ) : null}
          </section>
        </div>
      </div>
    </section>
  );
}
