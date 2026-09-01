"use client";

import {
  memo,
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/csr/ArrowLeft";
import { CloudArrowUpIcon } from "@phosphor-icons/react/dist/csr/CloudArrowUp";
import { GearSixIcon } from "@phosphor-icons/react/dist/csr/GearSix";
import { UserCircleIcon } from "@phosphor-icons/react/dist/csr/UserCircle";
import type { ProjectCatalogControllerCapability } from "../application/workspace-controller-capabilities.js";
import type {
  ApplicationUpdateResult,
  DocumentRecoveryJournalSummary,
  ProjectVersionSummary,
  RecentProject,
  RegisteredProject,
} from "./types";
import {
  WorkbenchGlobalSidebar,
  WorkbenchStartPage,
  type ProjectVersionLoadResult,
} from "./WorkbenchChrome";
import type { SettingsCategory } from "./settings-types";
import { localFileNameFromSourcePath } from "./project-model";

export type { SettingsCategory } from "./settings-types";

export type ProjectCatalogCapability = ProjectCatalogControllerCapability<
  RecentProject,
  RegisteredProject
>;

const SETTINGS_NAV_ITEMS: ReadonlyArray<Readonly<{
  category: SettingsCategory;
  label: string;
  Icon: typeof GearSixIcon;
}>> = [
  { category: "general", label: "常规", Icon: GearSixIcon },
  { category: "agent", label: "AI Agent", Icon: UserCircleIcon },
  { category: "updates", label: "软件更新", Icon: CloudArrowUpIcon },
];

export const WorkbenchSettingsSidebar = memo(function WorkbenchSettingsSidebar({
  open,
  category,
  onSelectCategory,
  onReturnToWorkbench,
}: {
  open: boolean;
  category: SettingsCategory;
  onSelectCategory(category: SettingsCategory): void;
  onReturnToWorkbench(): void;
}) {
  return (
    <aside
      className="workbench-settings-sidebar"
      data-open={open ? "true" : undefined}
      aria-label="设置导航"
      inert={!open}
    >
      <div className="workbench-settings-sidebar-inner">
        <button
          className="workbench-settings-back"
          type="button"
          onClick={onReturnToWorkbench}
        >
          <span className="workbench-settings-back-icon" aria-hidden="true">
            <ArrowLeftIcon size={18} weight="regular" />
          </span>
          <span>返回工作台</span>
        </button>
        <nav aria-label="设置类别">
          {SETTINGS_NAV_ITEMS.map(({ category: itemCategory, label, Icon }) => (
            <button
              className="workbench-settings-nav-item"
              data-selected={category === itemCategory ? "true" : undefined}
              type="button"
              aria-current={category === itemCategory ? "page" : undefined}
              key={itemCategory}
              onClick={() => onSelectCategory(itemCategory)}
            >
              <Icon aria-hidden="true" size={19} weight="regular" />
              <span>{label}</span>
            </button>
          ))}
        </nav>
      </div>
    </aside>
  );
});

export const WorkbenchGlobalSidebarContainer = memo(function WorkbenchGlobalSidebarContainer({
  capability,
  ...props
}: {
  capability: ProjectCatalogCapability;
  open: boolean;
  currentProjectId: string | null;
  currentProjectName: string;
  currentProjectDocumentId: string | null;
  currentProjectSourcePath: string | null;
  currentProjectVersions: readonly ProjectVersionSummary[];
  activeVersionId: string | null;
  projectRulesActive: boolean;
  onToggle(): void;
  onOpenLocal(): void;
  onOpenCurrentVersion(version: ProjectVersionSummary): void;
  onOpenRegisteredVersion(
    project: RegisteredProject,
    version: ProjectVersionSummary,
  ): void;
  updateActionVisible: boolean;
  updateDownloaded: boolean;
  updateDownloading: boolean;
  updateResult: ApplicationUpdateResult | null | undefined;
  updateBadgeLabel: string;
  onOpenAbout(): void;
  onOpenSettings(): void;
  onOpenProjectRules(): void;
  onDownloadOrRestartUpdate(): void;
  onResizeCommit?(width: number): void;
  openHtmlError?: string | null;
}) {
  const catalog = useSyncExternalStore(
    capability.subscribe,
    capability.getSnapshot,
    capability.getSnapshot,
  );
  const loadProjectVersions = useCallback(async (
    projectId: string,
  ): Promise<ProjectVersionLoadResult> => {
    const outcome = await capability.commands.loadVersionSummaries(projectId);
    if (outcome.status === "succeeded") {
      const value = outcome.value as { versions?: unknown };
      return {
        versions: Array.isArray(value.versions)
          ? value.versions as ProjectVersionSummary[]
          : [],
      };
    }
    return {
      versions: [],
      reason: "reason" in outcome && typeof outcome.reason === "string"
        ? outcome.reason
        : "项目版本摘要暂时无法读取。",
    };
  }, [capability]);
  return (
    <WorkbenchGlobalSidebar
      {...props}
      registeredProjects={[...catalog.registered]}
      projectsError={catalog.error}
      loadProjectVersions={loadProjectVersions}
      onToggle={() => {
        props.onToggle();
        if (!props.open) {
          void capability.commands.refreshRecents();
          void capability.commands.refreshRegistered();
        }
      }}
      onResizeCommit={props.onResizeCommit}
    />
  );
});

export const WorkbenchStartPageContainer = memo(function WorkbenchStartPageContainer({
  capability,
  activeTabId,
  onOpenLocal,
  onOpenRegistered,
}: {
  capability: ProjectCatalogCapability;
  activeTabId: string;
  onOpenLocal(): void;
  onOpenRegistered(project: RegisteredProject): void;
}) {
  const catalog = useSyncExternalStore(
    capability.subscribe,
    capability.getSnapshot,
    capability.getSnapshot,
  );
  const [catalogReady, setCatalogReady] = useState(false);
  const [recoveryJournals, setRecoveryJournals] = useState<DocumentRecoveryJournalSummary[]>([]);
  const [recoveryNextCursor, setRecoveryNextCursor] = useState<string | null>(null);
  const [recoveryLoading, setRecoveryLoading] = useState(false);

  useEffect(() => {
    let active = true;
    void Promise.allSettled([
      capability.commands.refreshRecents(),
      capability.commands.refreshRegistered(),
      window.htmlAIProjects?.listRecoveryJournals?.().then((result) => {
        if (active) {
          setRecoveryJournals(result.entries);
          setRecoveryNextCursor(result.nextCursor || null);
        }
      }),
    ]).then(() => {
      if (active) setCatalogReady(true);
    });
    return () => {
      active = false;
    };
  }, [capability]);

  return (
    <WorkbenchStartPage
      activeTabId={activeTabId}
      registeredProjects={[...catalog.registered]}
      catalogReady={catalogReady}
      catalogError={catalog.error}
      recoveryJournals={recoveryJournals}
      hasMoreRecoveryJournals={Boolean(recoveryNextCursor)}
      recoveryJournalsLoading={recoveryLoading}
      onCreateProject={onOpenLocal}
      onOpenProject={onOpenRegistered}
      onOpenRecovery={(journal) => {
        const project = catalog.registered.find((candidate) => (
          candidate.projectId === journal.projectId
          && candidate.documentId === journal.documentId
          && candidate.availability === "ready"
          && Boolean(candidate.activeSourcePath)
        ));
        if (project) {
          onOpenRegistered(project);
          return;
        }
        void window.htmlAIProjects?.readRecoveryJournal?.({
          projectId: journal.projectId,
          documentId: journal.documentId,
          expectedJournalSha256: journal.journalSha256,
        }).then((recovered) => recovered && window.htmlAIProjects?.exportHtmlCopy?.({
          html: recovered.html,
          sourcePath: journal.sourcePath,
          suggestedName: localFileNameFromSourcePath(journal.sourcePath),
        }));
      }}
      onLoadMoreRecovery={() => {
        if (!recoveryNextCursor || recoveryLoading) return;
        setRecoveryLoading(true);
        void window.htmlAIProjects?.listRecoveryJournals?.({
          cursor: recoveryNextCursor,
        }).then((result) => {
          setRecoveryJournals((current) => {
            const merged = new Map(current.map((journal) => [
              `${journal.projectId}:${journal.documentId}`,
              journal,
            ]));
            for (const journal of result.entries) {
              merged.set(`${journal.projectId}:${journal.documentId}`, journal);
            }
            return [...merged.values()].sort((left, right) => (
              right.updatedAt.localeCompare(left.updatedAt)
            ));
          });
          setRecoveryNextCursor(result.nextCursor || null);
        }).catch(() => {}).finally(() => setRecoveryLoading(false));
      }}
    />
  );
});
