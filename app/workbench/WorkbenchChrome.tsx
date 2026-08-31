"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  CaretDownIcon,
  CaretRightIcon,
  FileHtmlIcon,
  FolderOpenIcon,
  FolderSimpleIcon,
  GearSixIcon,
  PlusIcon,
  SidebarSimpleIcon,
  XIcon,
} from "@phosphor-icons/react";
import type { WorkbenchTab, WorkbenchTabsSnapshot } from "../application/workbench-tabs-session.js";
import type {
  ApplicationUpdateResult,
  ProjectVersionSummary,
  RecentProject,
  RegisteredProject,
} from "./types";
import {
  ProjectVersionTree,
  ProjectVersionTreeSkeleton,
  type ProjectVersionLoadResult,
} from "./project-version-tree";
import { WorkbenchResizer } from "./workbench-resizer";
import {
  createProjectExpansionState,
  reconcileProjectExpansionState,
  toggleProjectExpansion,
  type ProjectExpansionState,
} from "./project-sidebar-state";

type ProjectVersionLoadState = ProjectVersionLoadResult & Readonly<{
  status: "loading" | "ready" | "error";
}>;

export type { ProjectVersionLoadResult };

export function nextWorkbenchTabIndex(
  key: string,
  currentIndex: number,
  tabCount: number,
): number | null {
  if (tabCount <= 0 || currentIndex < 0 || currentIndex >= tabCount) return null;
  if (key === "ArrowLeft") return (currentIndex - 1 + tabCount) % tabCount;
  if (key === "ArrowRight") return (currentIndex + 1) % tabCount;
  if (key === "Home") return 0;
  if (key === "End") return tabCount - 1;
  return null;
}

export function SidebarToggle({
  expanded,
  onClick,
}: {
  expanded: boolean;
  onClick: () => void;
}) {
  const label = expanded ? "收起左侧边栏" : "展开左侧边栏";
  return (
    <button
      className="workbench-sidebar-toggle"
      type="button"
      aria-expanded={expanded}
      aria-label={label}
      data-sidebar-toggle={expanded ? "expanded" : "collapsed"}
      data-tooltip={label}
      onClick={onClick}
    >
      <SidebarSimpleIcon aria-hidden="true" size={16} weight="duotone" />
    </button>
  );
}

export function WorkbenchTabBar({
  snapshot,
  onSelect,
  onClose,
  onNew,
  sidebarOpen,
  onToggleSidebar,
}: {
  snapshot: WorkbenchTabsSnapshot;
  onSelect: (tab: WorkbenchTab) => void;
  onClose: (tab: WorkbenchTab) => void;
  onNew: () => void;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}) {
  const tabButtonsRef = useRef(new Map<string, HTMLButtonElement>());
  const pendingKeyboardFocusRef = useRef<string | null>(null);
  useEffect(() => {
    const pending = pendingKeyboardFocusRef.current;
    if (!pending || pending !== snapshot.activeTabId) return;
    pendingKeyboardFocusRef.current = null;
    tabButtonsRef.current.get(pending)?.focus();
  }, [snapshot.activeTabId]);

  return (
    <nav className="workbench-tabbar" aria-label="已打开的页面">
      {!sidebarOpen ? (
        <SidebarToggle expanded={false} onClick={onToggleSidebar} />
      ) : null}
      <div
        className="workbench-tablist"
        role="tablist"
        aria-label="已打开的页面"
        aria-orientation="horizontal"
      >
        {snapshot.tabs.map((tab) => {
          const selected = snapshot.activeTabId === tab.tabId;
          const pending = snapshot.pendingTabId === tab.tabId;
          return (
            <div
              className="workbench-tab"
              data-status={tab.status}
              data-selected={selected ? "true" : undefined}
              data-pending={pending ? "true" : undefined}
              key={tab.tabId}
            >
              <button
                id={`workbench-tab-${tab.tabId}`}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls="workbench-content-outlet"
                tabIndex={selected ? 0 : -1}
                ref={(element) => {
                  if (element) tabButtonsRef.current.set(tab.tabId, element);
                  else tabButtonsRef.current.delete(tab.tabId);
                }}
                onClick={() => onSelect(tab)}
                onKeyDown={(event) => {
                  if (event.altKey || event.ctrlKey || event.metaKey) return;
                  const currentIndex = snapshot.tabs.findIndex(
                    (candidate) => candidate.tabId === tab.tabId,
                  );
                  const targetIndex = nextWorkbenchTabIndex(
                    event.key,
                    currentIndex,
                    snapshot.tabs.length,
                  );
                  if (targetIndex === null) return;
                  event.preventDefault();
                  const target = snapshot.tabs[targetIndex];
                  pendingKeyboardFocusRef.current = target.tabId;
                  onSelect(target);
                }}
              >
                <span className="workbench-tab-status" aria-hidden="true" />
                <span>{tab.title}</span>
              </button>
              <button
                className="workbench-tab-close"
                type="button"
                aria-label={`关闭 ${tab.title}`}
                onClick={() => onClose(tab)}
              >
                <XIcon aria-hidden="true" size={11} weight="bold" />
              </button>
            </div>
          );
        })}
        <button
          className="workbench-new-tab"
          type="button"
          aria-label="新标签页"
          title="新标签页"
          onClick={onNew}
        >
          <PlusIcon aria-hidden="true" size={14} weight="bold" />
        </button>
      </div>
    </nav>
  );
}

export function WorkbenchStartPage({
  activeTabId,
  recentProjects,
  onOpenLocal,
  onOpenRecent,
  onOpenSidebar,
}: {
  activeTabId: string;
  recentProjects: RecentProject[];
  onOpenLocal: () => void;
  onOpenRecent: (sourcePath: string) => void;
  onOpenSidebar: () => void;
}) {
  return (
    <section
      id="workbench-content-outlet"
      className="workbench-start-page"
      role="tabpanel"
      aria-labelledby={`workbench-tab-${activeTabId}`}
    >
      <div className="workbench-start-content">
        <span className="workbench-start-icon"><FileHtmlIcon aria-hidden="true" size={28} weight="duotone" /></span>
        <h1 id="workbench-start-title">继续编辑 HTML</h1>
        <p>从已有项目继续，或打开一份新的本地 HTML。</p>
        <button className="workbench-start-primary" type="button" onClick={onOpenSidebar}>
          查看现有项目
          <CaretRightIcon aria-hidden="true" size={13} weight="bold" />
        </button>
        <button className="workbench-start-secondary" type="button" onClick={onOpenLocal}>
          <FolderOpenIcon aria-hidden="true" size={16} weight="duotone" />
          从 Finder 打开 HTML
        </button>
        {recentProjects.length ? (
          <div className="workbench-start-recents">
            <strong>最近打开</strong>
            {recentProjects.slice(0, 4).map((project) => (
              <button type="button" key={project.sourcePath} onClick={() => onOpenRecent(project.sourcePath)}>
                <FileHtmlIcon aria-hidden="true" size={15} weight="duotone" />
                <span>{project.name}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

export function WorkbenchGlobalSidebar({
  open,
  registeredProjects,
  projectsError,
  currentProjectId,
  currentProjectName,
  currentProjectVersions,
  onToggle,
  onOpenLocal,
  onOpenCurrentVersion,
  onOpenRegisteredVersion,
  loadProjectVersions,
  updateActionVisible,
  updateDownloaded,
  updateDownloading,
  updateResult,
  updateBadgeLabel,
  onOpenAbout,
  onOpenSettings,
  onDownloadOrRestartUpdate,
  onResizeCommit,
}: {
  open: boolean;
  registeredProjects: RegisteredProject[];
  projectsError?: string;
  currentProjectId: string | null;
  currentProjectName: string;
  currentProjectVersions: readonly ProjectVersionSummary[];
  onToggle: () => void;
  onOpenLocal: () => void;
  onOpenCurrentVersion: (version: ProjectVersionSummary) => void;
  onOpenRegisteredVersion: (
    project: RegisteredProject,
    version: ProjectVersionSummary,
  ) => void;
  loadProjectVersions: (projectId: string) => Promise<ProjectVersionLoadResult>;
  updateActionVisible: boolean;
  updateDownloaded: boolean;
  updateDownloading: boolean;
  updateResult: ApplicationUpdateResult | null | undefined;
  updateBadgeLabel: string;
  onOpenAbout: () => void;
  onOpenSettings: () => void;
  onDownloadOrRestartUpdate: () => void;
  onResizeCommit?: (width: number) => void;
}) {
  const [projectExpansionState, setProjectExpansionState] = useState<ProjectExpansionState>(
    () => createProjectExpansionState(currentProjectId),
  );
  const [versionStates, setVersionStates] = useState<Record<string, ProjectVersionLoadState>>({});
  const requestTokensRef = useRef(new Map<string, number>());
  const requestSequenceRef = useRef(0);

  const knownProjectIdsKey = useMemo(() => {
    const ids = new Set<string>();
    if (currentProjectId) ids.add(currentProjectId);
    for (const project of registeredProjects) {
      if (project.projectId) ids.add(project.projectId);
    }
    return [...ids].join("\u0000");
  }, [currentProjectId, registeredProjects]);

  useEffect(() => {
    const knownProjectIds = knownProjectIdsKey ? knownProjectIdsKey.split("\u0000") : [];
    setProjectExpansionState((state) => reconcileProjectExpansionState(
      state,
      knownProjectIds,
      currentProjectId,
    ));
    setVersionStates((states) => {
      const next = Object.fromEntries(
        Object.entries(states).filter(([projectId]) => knownProjectIds.includes(projectId)),
      ) as Record<string, ProjectVersionLoadState>;
      return Object.keys(next).length === Object.keys(states).length ? states : next;
    });
    for (const projectId of requestTokensRef.current.keys()) {
      if (!knownProjectIds.includes(projectId)) requestTokensRef.current.delete(projectId);
    }
  }, [currentProjectId, knownProjectIdsKey]);

  const importedProjects = useMemo(
    () => registeredProjects
      .filter((project) => project.projectId !== currentProjectId)
      .slice(0, 12),
    [currentProjectId, registeredProjects],
  );

  const loadImportedProject = useCallback(async (
    project: RegisteredProject,
    retry = false,
  ) => {
    const existing = versionStates[project.projectId];
    if (!retry && (existing?.status === "loading" || existing?.status === "ready")) return;
    const token = requestSequenceRef.current + 1;
    requestSequenceRef.current = token;
    requestTokensRef.current.set(project.projectId, token);
    if (project.availability !== "ready" || !project.documentId) {
      setVersionStates((current) => ({
        ...current,
        [project.projectId]: {
          status: "error",
          versions: [],
          reason: project.availabilityReason || "项目内容暂不可用。",
        },
      }));
      return;
    }
    setVersionStates((current) => ({
      ...current,
      [project.projectId]: { status: "loading", versions: [] },
    }));
    try {
      const result = await loadProjectVersions(project.projectId);
      if (requestTokensRef.current.get(project.projectId) !== token) return;
      setVersionStates((current) => ({
        ...current,
        [project.projectId]: result.reason && !result.versions.length
          ? { ...result, status: "error" }
          : { ...result, status: "ready" },
      }));
    } catch (cause) {
      if (requestTokensRef.current.get(project.projectId) !== token) return;
      setVersionStates((current) => ({
        ...current,
        [project.projectId]: {
          status: "error",
          versions: [],
          reason: cause instanceof Error ? cause.message : "项目版本摘要暂时无法读取。",
        },
      }));
    }
  }, [loadProjectVersions, versionStates]);

  const toggleImportedProject = useCallback((project: RegisteredProject) => {
    const expanded = projectExpansionState.expandedProjectIds[project.projectId] === true;
    setProjectExpansionState((state) => toggleProjectExpansion(state, project.projectId));
    if (!expanded) void loadImportedProject(project);
  }, [loadImportedProject, projectExpansionState]);

  const toggleProject = useCallback((projectId: string) => {
    setProjectExpansionState((state) => toggleProjectExpansion(state, projectId));
  }, []);
  const currentProjectUserDiffersFromBase = currentProjectVersions.find(
    (version) => version.isActiveWorkingCopy,
  )?.userDiffersFromBase;
  const currentProjectStatus = typeof currentProjectUserDiffersFromBase === "boolean"
    ? currentProjectUserDiffersFromBase ? "已修改" : "未修改"
    : null;

  return (
    <aside className="workbench-global-sidebar" data-open={open ? "true" : undefined} aria-label="全局项目" inert={!open}>
      {open ? (
        <>
          <div className="workbench-sidebar-titlebar">
            <SidebarToggle expanded onClick={onToggle} />
          </div>
          <div className="workbench-sidebar-product">
            <button type="button" onClick={onOpenAbout}>
              <span><FileHtmlIcon aria-hidden="true" size={18} weight="duotone" /></span>
              <strong>源页</strong>
            </button>
            {updateActionVisible ? (
              <button
                className="workbench-sidebar-update"
                type="button"
                data-update-downloaded={updateDownloaded ? "true" : undefined}
                aria-label={updateDownloaded
                  ? `PageRoot ${updateResult?.latestVersion || "新版本"} 已下载，重启更新`
                  : updateDownloading
                    ? `正在下载 PageRoot ${updateResult?.latestVersion || "新版本"}`
                    : `发现 PageRoot ${updateResult?.latestVersion || "新版本"}，下载更新`}
                disabled={updateDownloading}
                onClick={onDownloadOrRestartUpdate}
              >
                {updateBadgeLabel}
              </button>
            ) : null}
          </div>
          <div className="workbench-sidebar-body">
            <button type="button" onClick={onOpenLocal}><PlusIcon aria-hidden="true" size={14} weight="bold" />打开 HTML</button>
            <section className="sidebar-project-section" aria-labelledby="sidebar-current-project-heading">
              <h2 id="sidebar-current-project-heading">当前项目</h2>
              <button
                className="sidebar-project-row sidebar-project-row-current"
                type="button"
                aria-current={currentProjectId ? "true" : undefined}
                aria-expanded={Boolean(currentProjectId && projectExpansionState.expandedProjectIds[currentProjectId])}
                disabled={!currentProjectId}
                onClick={() => currentProjectId && toggleProject(currentProjectId)}
              >
                {currentProjectId && projectExpansionState.expandedProjectIds[currentProjectId]
                  ? <CaretDownIcon aria-hidden="true" size={13} weight="bold" />
                  : <CaretRightIcon aria-hidden="true" size={13} weight="bold" />}
                <FolderSimpleIcon className="sidebar-project-icon" aria-hidden="true" size={14} weight="regular" />
                <span className="sidebar-project-name">{currentProjectName || "尚未打开项目"}</span>
                {currentProjectStatus ? (
                  <span
                    className="sidebar-project-change-status"
                    data-modified={currentProjectUserDiffersFromBase ? "true" : "false"}
                  >
                    {currentProjectStatus}
                  </span>
                ) : null}
              </button>
              {currentProjectId && projectExpansionState.expandedProjectIds[currentProjectId] ? (
                <ProjectVersionTree
                  key={currentProjectId}
                  versions={currentProjectVersions}
                  onOpenVersion={onOpenCurrentVersion}
                />
              ) : null}
            </section>
            <section className="sidebar-project-section" aria-labelledby="sidebar-imported-project-heading">
              <h2 id="sidebar-imported-project-heading">已导入项目</h2>
              {projectsError ? <span className="workbench-sidebar-error" role="status">{projectsError}</span> : null}
              {importedProjects.length ? importedProjects.map((project) => {
                const expanded = projectExpansionState.expandedProjectIds[project.projectId] === true;
                const state = versionStates[project.projectId];
                return (
                  <div className="sidebar-imported-project" key={project.projectId}>
                    <button
                      className="sidebar-project-row"
                      type="button"
                      aria-current={project.projectId === currentProjectId ? "true" : undefined}
                      aria-expanded={expanded}
                      data-availability={project.availability}
                      onClick={() => toggleImportedProject(project)}
                    >
                      {expanded
                        ? <CaretDownIcon aria-hidden="true" size={13} weight="bold" />
                        : <CaretRightIcon aria-hidden="true" size={13} weight="bold" />}
                      <FolderSimpleIcon className="sidebar-project-icon" aria-hidden="true" size={14} weight="regular" />
                      <span className="sidebar-project-name">{project.projectName}</span>
                      {typeof project.userDiffersFromBase === "boolean" ? (
                        <span
                          className="sidebar-project-change-status"
                          data-modified={project.userDiffersFromBase ? "true" : "false"}
                        >
                          {project.userDiffersFromBase ? "已修改" : "未修改"}
                        </span>
                      ) : null}
                      {project.hasPendingCandidate ? (
                        <span className="sidebar-project-pending" aria-label="有候选待审阅" title="有候选待审阅" />
                      ) : null}
                    </button>
                    {expanded ? (
                      !state || state.status === "loading" ? (
                        <ProjectVersionTreeSkeleton />
                      ) : state.status === "error" ? (
                        <div className="sidebar-project-load-error" role="status">
                          <span>{state.reason || "项目版本摘要暂时无法读取。"}</span>
                          <button type="button" onClick={() => void loadImportedProject(project, true)}>重试</button>
                        </div>
                      ) : (
                        <ProjectVersionTree
                          versions={state.versions}
                          onOpenVersion={(version) => onOpenRegisteredVersion(project, version)}
                        />
                      )
                    ) : null}
                  </div>
                );
              }) : (
                <span className="sidebar-project-empty">暂无其他已导入项目</span>
              )}
            </section>
          </div>
          <footer className="workbench-sidebar-footer">
            <button
              className="workbench-sidebar-settings"
              type="button"
              aria-label="设置"
              data-tooltip="设置"
              onClick={onOpenSettings}
            >
              <GearSixIcon aria-hidden="true" size={20} weight="bold" />
            </button>
          </footer>
          <WorkbenchResizer kind="sidebar" onCommit={onResizeCommit} />
        </>
      ) : null}
    </aside>
  );
}
