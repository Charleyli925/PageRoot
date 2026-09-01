"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  CaretRightIcon,
  FileHtmlIcon,
  FolderSimpleIcon,
  GearSixIcon,
  PlusIcon,
  SidebarSimpleIcon,
  XIcon,
} from "@phosphor-icons/react";
import { PencilSimpleIcon } from "@phosphor-icons/react/dist/csr/PencilSimple";
import type { WorkbenchTab, WorkbenchTabsSnapshot } from "../application/workbench-tabs-session.js";
import type {
  DocumentRecoveryJournalSummary,
  ApplicationUpdateResult,
  ProjectVersionSummary,
  RegisteredProject,
} from "./types";
import {
  formatProjectTimestamp,
  localFileNameFromSourcePath,
} from "./project-model";
import {
  ProjectVersionTree,
  ProjectVersionTreeSkeleton,
  type ProjectVersionLoadResult,
} from "./project-version-tree";
import { WorkbenchResizer } from "./workbench-resizer";
import {
  createProjectExpansionState,
  sortSidebarProjects,
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
                aria-controls={tab.kind === "project-rules"
                  ? "workbench-project-rules-outlet"
                  : "workbench-content-outlet"}
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
  registeredProjects,
  catalogReady,
  catalogError,
  recoveryJournals,
  onCreateProject,
  onOpenProject,
  onOpenRecovery,
}: {
  activeTabId: string;
  registeredProjects: RegisteredProject[];
  catalogReady: boolean;
  catalogError: string;
  recoveryJournals: DocumentRecoveryJournalSummary[];
  onCreateProject: () => void;
  onOpenProject: (project: RegisteredProject) => void;
  onOpenRecovery: (journal: DocumentRecoveryJournalSummary) => void;
}) {
  const [showAllTasks, setShowAllTasks] = useState(false);
  const [renderedAt] = useState(Date.now);
  const readyProjects = useMemo(() => (
    registeredProjects
      .filter((project) => (
        project.availability === "ready"
        && Boolean(project.documentId)
        && Boolean(project.activeSourcePath)
      ))
      .sort((left, right) => (
        Number(right.lastOpenedAt || 0) - Number(left.lastOpenedAt || 0)
        || left.projectName.localeCompare(right.projectName, "zh-CN")
      ))
  ), [registeredProjects]);
  const continuingProject = readyProjects[0] || null;
  const pendingProjects = readyProjects.filter((project) => project.hasPendingCandidate);
  const visiblePendingProjects = showAllTasks
    ? pendingProjects
    : pendingProjects.slice(0, 3);
  const firstProject = catalogReady
    && !catalogError
    && registeredProjects.length === 0
    && recoveryJournals.length === 0;
  const recoveryCanOpen = (journal: DocumentRecoveryJournalSummary) => (
    readyProjects.some((project) => (
      project.projectId === journal.projectId
      && project.documentId === journal.documentId
    ))
  );

  const formatRecency = (lastOpenedAt: number | null): string => {
    if (!lastOpenedAt) return "";
    const elapsed = renderedAt - lastOpenedAt;
    if (elapsed < 0) return formatProjectTimestamp(lastOpenedAt);
    if (elapsed < 60_000) return "刚刚";
    if (elapsed < 60 * 60_000) return `${Math.floor(elapsed / 60_000)} 分钟前`;
    if (elapsed < 24 * 60 * 60_000) return `${Math.floor(elapsed / (60 * 60_000))} 小时前`;
    return formatProjectTimestamp(lastOpenedAt);
  };

  return (
    <section
      id="workbench-content-outlet"
      className="workbench-start-page"
      role="tabpanel"
      aria-labelledby={`workbench-tab-${activeTabId}`}
    >
      <div className="workbench-start-content">
        <header className="workbench-start-header">
          <h1 id="workbench-start-title">开始</h1>
          {!firstProject ? (
            <button className="workbench-start-primary" type="button" onClick={onCreateProject}>
              <PlusIcon aria-hidden="true" size={14} weight="bold" />
              新建项目
            </button>
          ) : null}
        </header>

        {firstProject ? (
          <section className="workbench-start-empty" aria-labelledby="workbench-start-empty-title">
            <h2 id="workbench-start-empty-title">开始你的第一个项目</h2>
            <p>选择一份 HTML，在 PageRoot 中编辑、评论和交给 AI 修改。</p>
            <button className="workbench-start-primary" type="button" onClick={onCreateProject}>
              <PlusIcon aria-hidden="true" size={14} weight="bold" />
              新建项目
            </button>
          </section>
        ) : (
          <>
            {recoveryJournals.length ? (
              <section className="workbench-start-section workbench-start-recovery" aria-labelledby="workbench-start-recovery-title">
                <h2 id="workbench-start-recovery-title">可恢复修改</h2>
                <div className="workbench-start-recovery-list">
                  {recoveryJournals.map((journal) => (
                    <button
                      type="button"
                      key={`${journal.projectId}:${journal.documentId}`}
                      onClick={() => onOpenRecovery(journal)}
                    >
                      <span className="workbench-start-file-icon">
                        <FileHtmlIcon aria-hidden="true" size={18} weight="duotone" />
                      </span>
                      <span>
                        <strong>{localFileNameFromSourcePath(journal.sourcePath)}</strong>
                        <small>原文件未更新 · 已校验恢复副本</small>
                      </span>
                      <span className="workbench-start-resume-action">
                        {recoveryCanOpen(journal) ? "恢复编辑" : "导出恢复副本"}
                      </span>
                      <CaretRightIcon aria-hidden="true" size={15} weight="bold" />
                    </button>
                  ))}
                </div>
              </section>
            ) : null}
            {continuingProject ? (
              <section className="workbench-start-section" aria-labelledby="workbench-start-continue-title">
                <h2 id="workbench-start-continue-title">继续编辑</h2>
                <button
                  className="workbench-start-resume"
                  type="button"
                  onClick={() => onOpenProject(continuingProject)}
                >
                  <span className="workbench-start-file-icon">
                    <FileHtmlIcon aria-hidden="true" size={18} weight="duotone" />
                  </span>
                  <span className="workbench-start-resume-copy">
                    <strong>{continuingProject.projectName}</strong>
                    <span>
                      {localFileNameFromSourcePath(continuingProject.activeSourcePath)}
                      {continuingProject.lastOpenedAt ? (
                        <>
                          <span aria-hidden="true"> · </span>
                          <time dateTime={new Date(continuingProject.lastOpenedAt).toISOString()}>
                            {formatRecency(continuingProject.lastOpenedAt)}
                          </time>
                        </>
                      ) : null}
                    </span>
                  </span>
                  <span className="workbench-start-resume-action">继续编辑</span>
                  <CaretRightIcon aria-hidden="true" size={15} weight="bold" />
                </button>
              </section>
            ) : null}

            {pendingProjects.length ? (
              <section className="workbench-start-section workbench-start-tasks" aria-labelledby="workbench-start-tasks-title">
                <h2 id="workbench-start-tasks-title">需要处理</h2>
                <div className="workbench-start-task-list">
                  {visiblePendingProjects.map((project) => (
                    <button
                      type="button"
                      key={project.projectId}
                      onClick={() => onOpenProject(project)}
                    >
                      <span className="workbench-start-task-dot" aria-hidden="true" />
                      <strong>{project.projectName}</strong>
                      <span>1 个版本待审阅</span>
                      <CaretRightIcon aria-hidden="true" size={14} weight="bold" />
                    </button>
                  ))}
                  {!showAllTasks && pendingProjects.length > 3 ? (
                    <button
                      className="workbench-start-task-more"
                      type="button"
                      onClick={() => setShowAllTasks(true)}
                    >
                      查看全部 {pendingProjects.length} 项
                    </button>
                  ) : null}
                </div>
              </section>
            ) : null}
          </>
        )}
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
  currentProjectDocumentId,
  currentProjectSourcePath,
  currentProjectVersions,
  activeVersionId,
  projectRulesActive,
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
  onOpenProjectRules,
  onDownloadOrRestartUpdate,
  onResizeCommit,
  openHtmlError,
}: {
  open: boolean;
  registeredProjects: RegisteredProject[];
  projectsError?: string;
  currentProjectId: string | null;
  currentProjectName: string;
  currentProjectDocumentId: string | null;
  currentProjectSourcePath: string | null;
  currentProjectVersions: readonly ProjectVersionSummary[];
  activeVersionId: string | null;
  projectRulesActive: boolean;
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
  onOpenProjectRules: () => void;
  onDownloadOrRestartUpdate: () => void;
  onResizeCommit?: (width: number) => void;
  openHtmlError?: string | null;
}) {
  const [projectExpansionState, setProjectExpansionState] = useState<ProjectExpansionState>(
    () => createProjectExpansionState(currentProjectId),
  );
  const [versionStates, setVersionStates] = useState<Record<string, ProjectVersionLoadState>>({});
  const requestTokensRef = useRef(new Map<string, number>());
  const requestSequenceRef = useRef(0);

  const fallbackProjectLastUpdatedAt = useMemo(() => {
    const timestamps = currentProjectVersions
      .map((version) => Date.parse(String(version.modifiedAt || "")))
      .filter((timestamp) => Number.isFinite(timestamp));
    return timestamps.length > 0
      ? new Date(Math.max(...timestamps)).toISOString()
      : null;
  }, [currentProjectVersions]);

  const projects = useMemo(() => {
    const byId = new Map<string, RegisteredProject>();
    for (const project of registeredProjects) {
      if (project.projectId) byId.set(project.projectId, project);
    }
    if (currentProjectId && !byId.has(currentProjectId)) {
      byId.set(currentProjectId, {
        projectId: currentProjectId,
        documentId: currentProjectDocumentId,
        projectName: currentProjectName || "尚未打开项目",
        registeredProjectRootPath: "",
        activeWorkingCopyId: null,
        activeSourcePath: currentProjectSourcePath,
        currentBasedOnVersionId: activeVersionId,
        latestOfficialVersionId: null,
        hasPendingCandidate: false,
        availability: currentProjectDocumentId && currentProjectSourcePath
          ? "ready"
          : "unavailable",
        availabilityReason: null,
        lastUpdatedAt: fallbackProjectLastUpdatedAt,
        lastOpenedAt: null,
      });
    }
    return sortSidebarProjects([...byId.values()]);
  }, [
    activeVersionId,
    currentProjectDocumentId,
    currentProjectId,
    currentProjectName,
    currentProjectSourcePath,
    fallbackProjectLastUpdatedAt,
    registeredProjects,
  ]);

  const knownProjectIdsKey = useMemo(() => {
    return projects.map((project) => project.projectId).join("\u0000");
  }, [projects]);

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

  const otherProjects = useMemo(
    () => projects.filter((project) => project.projectId !== currentProjectId),
    [currentProjectId, projects],
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

  useEffect(() => {
    for (const project of otherProjects) {
      if (
        projectExpansionState.expandedProjectIds[project.projectId] === true
        && !versionStates[project.projectId]
      ) {
        void loadImportedProject(project);
      }
    }
  }, [
    otherProjects,
    loadImportedProject,
    projectExpansionState.expandedProjectIds,
    versionStates,
  ]);

  const toggleOtherProject = useCallback((project: RegisteredProject) => {
    const expanded = projectExpansionState.expandedProjectIds[project.projectId] === true;
    setProjectExpansionState((state) => toggleProjectExpansion(state, project.projectId));
    if (!expanded) void loadImportedProject(project);
  }, [loadImportedProject, projectExpansionState]);

  const toggleProject = useCallback((projectId: string) => {
    setProjectExpansionState((state) => toggleProjectExpansion(state, projectId));
  }, []);

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
            <button type="button" onClick={onOpenLocal}>
              <PlusIcon aria-hidden="true" size={16} weight="bold" />
              <span>新建项目</span>
            </button>
            {openHtmlError ? (
              <p className="workbench-sidebar-error" role="alert">{openHtmlError}</p>
            ) : null}
            <section className="sidebar-project-section" aria-labelledby="sidebar-project-heading">
              <h2 id="sidebar-project-heading">项目</h2>
              {projectsError ? <span className="workbench-sidebar-error" role="status">{projectsError}</span> : null}
              {projects.length ? projects.map((project) => {
                const isCurrentProject = project.projectId === currentProjectId;
                const expanded = projectExpansionState.expandedProjectIds[project.projectId] === true;
                const state = versionStates[project.projectId];
                return (
                  <div className="sidebar-project-item" key={project.projectId}>
                    <button
                      className="sidebar-project-row"
                      type="button"
                      aria-expanded={expanded}
                      data-availability={project.availability}
                      onClick={() => {
                        if (isCurrentProject) toggleProject(project.projectId);
                        else toggleOtherProject(project);
                      }}
                    >
                      <FolderSimpleIcon className="sidebar-project-icon" aria-hidden="true" size={16} weight="regular" />
                      <span className="sidebar-project-name">{project.projectName}</span>
                    </button>
                    {isCurrentProject ? (
                      <button
                        className="sidebar-project-rules-row"
                        type="button"
                        aria-current={projectRulesActive ? "page" : undefined}
                        data-selected={projectRulesActive ? "true" : undefined}
                        onClick={onOpenProjectRules}
                      >
                        <PencilSimpleIcon aria-hidden="true" size={16} weight="regular" />
                        <span className="sidebar-project-rules-name">长期规则</span>
                      </button>
                    ) : null}
                    {expanded ? (
                      isCurrentProject ? (
                        <ProjectVersionTree
                          key={currentProjectId}
                          versions={currentProjectVersions}
                          isCurrentProject
                          activeVersionId={activeVersionId}
                          onOpenVersion={onOpenCurrentVersion}
                        />
                      ) : !state || state.status === "loading" ? (
                        <ProjectVersionTreeSkeleton />
                      ) : state.status === "error" ? (
                        <div className="sidebar-project-load-error" role="status">
                          <span>{state.reason || "项目版本摘要暂时无法读取。"}</span>
                          <button type="button" onClick={() => void loadImportedProject(project, true)}>重试</button>
                        </div>
                      ) : (
                        <ProjectVersionTree
                          versions={state.versions}
                          isCurrentProject={false}
                          activeVersionId={null}
                          onOpenVersion={(version) => onOpenRegisteredVersion(project, version)}
                        />
                      )
                    ) : null}
                  </div>
                );
              }) : (
                <span className="sidebar-project-empty">暂无项目</span>
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
              <GearSixIcon aria-hidden="true" size={17} weight="bold" />
            </button>
          </footer>
          <WorkbenchResizer kind="sidebar" onCommit={onResizeCommit} />
        </>
      ) : null}
    </aside>
  );
}
