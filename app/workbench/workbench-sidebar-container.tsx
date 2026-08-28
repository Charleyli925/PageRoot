"use client";

import {
  memo,
  useCallback,
  useSyncExternalStore,
} from "react";
import type { ProjectCatalogControllerCapability } from "../application/workspace-controller-capabilities.js";
import type {
  ApplicationUpdateResult,
  ProjectVersionSummary,
  RecentProject,
  RegisteredProject,
} from "./types";
import {
  WorkbenchGlobalSidebar,
  WorkbenchStartPage,
  type ProjectVersionLoadResult,
} from "./WorkbenchChrome";

export type ProjectCatalogCapability = ProjectCatalogControllerCapability<
  RecentProject,
  RegisteredProject
>;

export const WorkbenchGlobalSidebarContainer = memo(function WorkbenchGlobalSidebarContainer({
  capability,
  ...props
}: {
  capability: ProjectCatalogCapability;
  open: boolean;
  currentProjectId: string | null;
  currentProjectName: string;
  currentProjectVersions: readonly ProjectVersionSummary[];
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
  onDownloadOrRestartUpdate(): void;
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
    />
  );
});

export const WorkbenchStartPageContainer = memo(function WorkbenchStartPageContainer({
  capability,
  activeTabId,
  onOpenLocal,
  onOpenRecent,
  onOpenSidebar,
}: {
  capability: ProjectCatalogCapability;
  activeTabId: string;
  onOpenLocal(): void;
  onOpenRecent(sourcePath: string): void;
  onOpenSidebar(): void;
}) {
  const catalog = useSyncExternalStore(
    capability.subscribe,
    capability.getSnapshot,
    capability.getSnapshot,
  );
  return (
    <WorkbenchStartPage
      activeTabId={activeTabId}
      recentProjects={[...catalog.recent]}
      onOpenLocal={onOpenLocal}
      onOpenRecent={onOpenRecent}
      onOpenSidebar={() => {
        onOpenSidebar();
        void capability.commands.refreshRegistered();
      }}
    />
  );
});
