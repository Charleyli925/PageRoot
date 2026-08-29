"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type Ref,
  type ReactNode,
} from "react";
import { ArrowClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowClockwise";
import { ArrowSquareOutIcon } from "@phosphor-icons/react/dist/csr/ArrowSquareOut";
import { CloudArrowUpIcon } from "@phosphor-icons/react/dist/csr/CloudArrowUp";
import { DesktopIcon } from "@phosphor-icons/react/dist/csr/Desktop";
import { FolderOpenIcon } from "@phosphor-icons/react/dist/csr/FolderOpen";
import { InfoIcon } from "@phosphor-icons/react/dist/csr/Info";
import { SparkleIcon } from "@phosphor-icons/react/dist/csr/Sparkle";
import { SidebarSimpleIcon } from "@phosphor-icons/react/dist/csr/SidebarSimple";
import { UserCircleIcon } from "@phosphor-icons/react/dist/csr/UserCircle";

import type {
  AgentProviderGuidanceKind,
  AgentSelection,
} from "../domain/agent-provider-state.js";
import AgentProviderCard from "./AgentProviderCard";
import type { AgentProviderCardData } from "./agent-provider-card-types";
import type { ApplicationUpdateResult } from "../workbench/types";
import type { WorkspacePreferences } from "./desktop-ui-preferences-api";
import type { SettingsCategory } from "../workbench/settings-types";
import { architectureLabel, updatePresentation } from "./update-presentation";

type AgentActionOutcome = Readonly<{ status: string; reason?: string }> | null | undefined;

const DEFAULT_PANEL_WIDTHS = Object.freeze({
  sidebarWidth: 264,
  inspectorWidth: 376,
});

export type SettingsAgentChoice = Readonly<{
  id: string;
  label: string;
  selection: AgentSelection;
}>;

export type SettingsPageProps = {
  activeTabId: string;
  category: SettingsCategory;
  initialFocus?: SettingsCategory;
  appVersion: string;
  currentAgentName: string;
  updateResult: ApplicationUpdateResult | null;
  updatesAvailable: boolean;
  manualCheckPending: boolean;
  manualCheckFailed: boolean;
  releaseNotesOpenFailed: boolean;
  workspacePreferences: WorkspacePreferences;
  workspacePreferencesSaving: boolean;
  workspacePreferencesError: string | null;
  agentChoices: readonly SettingsAgentChoice[];
  selectedAgentChoiceId: string | null;
  agentCards: readonly AgentProviderCardData[];
  onUpdateWorkspacePreference: (
    patch: Partial<WorkspacePreferences>,
  ) => Promise<boolean>;
  onRetryWorkspacePreferences: () => void;
  onSelectAgent: (selection: AgentSelection) => void;
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
  onClose: () => void;
};

function focusableElements(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(
    "button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])",
  )];
}

function SettingRow({
  icon,
  title,
  description,
  children,
  className = "",
}: {
  icon: ReactNode;
  title: string;
  description: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`settings-row ${className}`.trim()}>
      <span className="settings-row-icon" aria-hidden="true">{icon}</span>
      <span className="settings-row-copy">
        <strong>{title}</strong>
        <span>{description}</span>
      </span>
      <span className="settings-row-control">{children}</span>
    </div>
  );
}

function SettingsToggle({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange(checked: boolean): void;
}) {
  return (
    <label className="settings-switch">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-label={label}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span aria-hidden="true" />
    </label>
  );
}

function SettingsSelect({
  value,
  label,
  disabled,
  options,
  onChange,
}: {
  value: string;
  label: string;
  disabled?: boolean;
  options: readonly Readonly<{ value: string; label: string }>[];
  onChange(value: string): void;
}) {
  return (
    <select
      className="settings-select"
      value={value}
      disabled={disabled}
      aria-label={label}
      onChange={(event) => onChange(event.target.value)}
    >
      {options.map((option) => (
        <option value={option.value} key={option.value}>{option.label}</option>
      ))}
    </select>
  );
}

function SettingsSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="settings-section" aria-labelledby={`settings-section-${title}`}>
      <h2 id={`settings-section-${title}`}>{title}</h2>
      <div className="settings-section-rows">{children}</div>
    </section>
  );
}

function GeneralSettings({
  workspace,
  saving,
  onUpdate,
}: {
  workspace: WorkspacePreferences;
  saving: boolean;
  onUpdate: (patch: Partial<WorkspacePreferences>) => void;
}) {
  return (
    <div className="settings-page-sections">
      <SettingsSection title="界面与布局">
        <SettingRow
          icon={<SidebarSimpleIcon size={20} weight="regular" />}
          title="记住面板宽度"
          description="记住侧边栏与右侧面板的宽度设置"
        >
          <SettingsToggle
            checked={workspace.rememberPanelWidths}
            disabled={saving}
            label="记住面板宽度"
            onChange={(checked) => onUpdate({ rememberPanelWidths: checked })}
          />
        </SettingRow>
        <SettingRow
          icon={<ArrowClockwiseIcon size={20} weight="regular" />}
          title="恢复默认布局"
          description="将所有面板恢复为响应式默认布局"
        >
          <button
            className="settings-secondary-action"
            type="button"
            disabled={saving}
            onClick={() => onUpdate({
              sidebarWidth: DEFAULT_PANEL_WIDTHS.sidebarWidth,
              inspectorWidth: DEFAULT_PANEL_WIDTHS.inspectorWidth,
            })}
          >
            恢复默认
          </button>
        </SettingRow>
        <SettingRow
          icon={<SparkleIcon size={20} weight="regular" />}
          title="动态效果"
          description="控制界面动画与过渡效果的显示方式"
        >
          <SettingsSelect
            value={workspace.motion}
            disabled={saving}
            label="动态效果"
            options={[
              { value: "system", label: "跟随系统" },
              { value: "reduced", label: "减少动画" },
            ]}
            onChange={(motion) => onUpdate({ motion: motion as WorkspacePreferences["motion"] })}
          />
        </SettingRow>
      </SettingsSection>

      <SettingsSection title="使用习惯">
        <SettingRow
          icon={<FolderOpenIcon size={20} weight="regular" />}
          title="启动时恢复上次标签页"
          description="应用启动时，自动恢复关闭前打开的标签页"
        >
          <SettingsToggle
            checked={workspace.restoreTabsOnLaunch}
            disabled={saving}
            label="启动时恢复上次标签页"
            onChange={(checked) => onUpdate({ restoreTabsOnLaunch: checked })}
          />
        </SettingRow>
      </SettingsSection>
    </div>
  );
}

function AgentSettings({
  currentAgentName,
  choices,
  selectedChoiceId,
  cards,
  checking,
  actionButtonRef,
  onSelect,
  onCheck,
  onCopyGuidance,
  onInstall,
}: {
  currentAgentName: string;
  choices: readonly SettingsAgentChoice[];
  selectedChoiceId: string | null;
  cards: readonly AgentProviderCardData[];
  checking: boolean;
  actionButtonRef: Ref<HTMLButtonElement>;
  onSelect(selection: AgentSelection): void;
  onCheck(): void;
  onCopyGuidance(kind: AgentProviderGuidanceKind, selection: AgentSelection): Promise<AgentActionOutcome>;
  onInstall(selection: AgentSelection): Promise<AgentActionOutcome>;
}) {
  return (
    <div className="settings-page-sections">
      <SettingsSection title="默认 Agent">
        <SettingRow
          icon={<UserCircleIcon size={20} weight="regular" />}
          title="默认 Agent"
          description={`下一轮任务将使用 ${currentAgentName || "尚未选择"}`}
        >
          <SettingsSelect
            value={selectedChoiceId || choices[0]?.id || ""}
            disabled={!choices.length}
            label="默认 Agent"
            options={choices.map((choice) => ({ value: choice.id, label: choice.label }))}
            onChange={(id) => {
              const choice = choices.find((item) => item.id === id);
              if (choice) onSelect(choice.selection);
            }}
          />
        </SettingRow>
      </SettingsSection>

      <SettingsSection title="连接状态">
        <div className="settings-agent-toolbar">
          <span>安装、登录和连接状态会在这里显示。</span>
          <button
            className="settings-secondary-action"
            type="button"
            disabled={checking}
            onClick={onCheck}
          >
            <ArrowClockwiseIcon aria-hidden="true" size={14} weight="bold" />
            {checking ? "正在检查…" : "重新检查"}
          </button>
        </div>
        <div className="settings-agent-rows">
          {cards.length ? cards.map((card, index) => (
            <AgentProviderCard
              key={`${card.selection.providerId}:${card.selection.runtimeId}`}
              availability={card.availability}
              presentation={card.presentation}
              surface="settings"
              actionButtonRef={index === 0 ? actionButtonRef : undefined}
              onCopyGuidance={(kind) => onCopyGuidance(kind, card.selection)}
              onInstall={() => onInstall(card.selection)}
            />
          )) : (
            <p className="settings-empty-state">当前没有可配置的 Agent。</p>
          )}
        </div>
      </SettingsSection>
    </div>
  );
}

function UpdatesSettings({
  appVersion,
  updateResult,
  updatesAvailable,
  manualCheckPending,
  manualCheckFailed,
  releaseNotesOpenFailed,
  onCheckForUpdates,
  onDownloadUpdate,
  onRequestRestart,
  onOpenReleaseNotes,
}: Omit<SettingsPageProps, "activeTabId" | "category" | "initialFocus" | "currentAgentName" | "workspacePreferences" | "workspacePreferencesSaving" | "workspacePreferencesError" | "agentChoices" | "selectedAgentChoiceId" | "agentCards" | "onUpdateWorkspacePreference" | "onRetryWorkspacePreferences" | "onSelectAgent" | "onClose" | "onCheckUsability" | "onCopyGuidance" | "onInstall">) {
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
    <div className="settings-page-sections">
      <SettingsSection title="版本信息">
        <SettingRow
          icon={<InfoIcon size={20} weight="regular" />}
          title="当前版本"
          description="当前运行的源页版本"
        >
          <strong className="settings-value">{appVersion || updateResult?.currentVersion || "—"}</strong>
        </SettingRow>
        <SettingRow
          icon={<CloudArrowUpIcon size={20} weight="regular" />}
          title="最新版本"
          description="已知的最新正式版本"
        >
          <strong className="settings-value">{updateResult?.latestVersion || "—"}</strong>
        </SettingRow>
        <SettingRow
          icon={<DesktopIcon size={20} weight="regular" />}
          title="架构信息"
          description="当前安装包的运行架构"
        >
          <strong className="settings-value">{architectureLabel(updateResult?.architecture)}</strong>
        </SettingRow>
      </SettingsSection>

      <SettingsSection title="更新状态">
        <SettingRow
          icon={<ArrowClockwiseIcon size={20} weight="regular" />}
          title={presentation.title}
          description={presentation.detail}
          className={`settings-update-row settings-update-row-${presentation.tone}`}
        >
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
        </SettingRow>
        <div className="settings-update-footer">
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
        </div>
      </SettingsSection>
    </div>
  );
}

export default function SettingsPage({
  activeTabId,
  category,
  initialFocus = "general",
  appVersion,
  currentAgentName,
  updateResult,
  updatesAvailable,
  manualCheckPending,
  manualCheckFailed,
  releaseNotesOpenFailed,
  workspacePreferences,
  workspacePreferencesSaving,
  workspacePreferencesError,
  agentChoices,
  selectedAgentChoiceId,
  agentCards,
  onUpdateWorkspacePreference,
  onRetryWorkspacePreferences,
  onSelectAgent,
  onCheckForUpdates,
  onDownloadUpdate,
  onRequestRestart,
  onOpenReleaseNotes,
  onCheckUsability,
  onCopyGuidance,
  onInstall,
  onClose,
}: SettingsPageProps) {
  const pageRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const agentActionRef = useRef<HTMLButtonElement>(null);
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
    if (category !== "agent") return undefined;
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
  }, [category, requestAgentCheck]);

  useEffect(() => {
    const focusFrame = requestAnimationFrame(() => {
      if (initialFocus === "agent" && category === "agent") {
        agentActionRef.current?.focus();
        if (!agentActionRef.current) headingRef.current?.focus();
      } else headingRef.current?.focus();
    });
    return () => cancelAnimationFrame(focusFrame);
  }, [category, initialFocus]);

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

  const pageTitle = category === "general"
    ? "常规"
    : category === "agent"
      ? "AI Agent"
      : "软件更新";
  const pageDescription = category === "general"
    ? "调整工作台布局与启动习惯。"
    : category === "agent"
      ? "管理默认 Agent 与本机连接状态。"
      : "检查、下载并安装源页的正式版本。";

  return (
    <section
      ref={pageRef}
      id="workbench-content-outlet"
      className="workbench-settings-page"
      role="tabpanel"
      aria-labelledby={`workbench-tab-${activeTabId}`}
      aria-label={pageTitle}
      onKeyDown={handleKeyDown}
    >
      <div className="settings-page-inner">
        <header className="settings-page-header">
          <h1 ref={headingRef} tabIndex={-1}>{pageTitle}</h1>
          <p>{pageDescription}</p>
        </header>
        {workspacePreferencesError ? (
          <div className="settings-preference-error" role="alert">
            <span>设置暂未保存：{workspacePreferencesError}</span>
            <button type="button" onClick={onRetryWorkspacePreferences}>重试保存</button>
          </div>
        ) : null}

        {category === "general" ? (
          <GeneralSettings
            workspace={workspacePreferences}
            saving={workspacePreferencesSaving}
            onUpdate={(patch) => { void onUpdateWorkspacePreference(patch); }}
          />
        ) : category === "agent" ? (
          <AgentSettings
            currentAgentName={currentAgentName}
            choices={agentChoices}
            selectedChoiceId={selectedAgentChoiceId}
            cards={agentCards}
            checking={agentCheckPending}
            actionButtonRef={agentActionRef}
            onSelect={onSelectAgent}
            onCheck={() => requestAgentCheck(true)}
            onCopyGuidance={onCopyGuidance}
            onInstall={onInstall}
          />
        ) : (
          <UpdatesSettings
            appVersion={appVersion}
            updateResult={updateResult}
            updatesAvailable={updatesAvailable}
            manualCheckPending={manualCheckPending}
            manualCheckFailed={manualCheckFailed}
            releaseNotesOpenFailed={releaseNotesOpenFailed}
            onCheckForUpdates={onCheckForUpdates}
            onDownloadUpdate={onDownloadUpdate}
            onRequestRestart={onRequestRestart}
            onOpenReleaseNotes={onOpenReleaseNotes}
          />
        )}
      </div>
    </section>
  );
}
