"use client";

import { useEffect, useRef } from "react";
import {
  CaretRightIcon,
  FileHtmlIcon,
  FolderOpenIcon,
  PlusIcon,
  SidebarSimpleIcon,
  XIcon,
} from "@phosphor-icons/react";
import type { WorkbenchTab, WorkbenchTabsSnapshot } from "../application/workbench-tabs-session.js";
import type { ApplicationUpdateResult, RecentProject, RegisteredProject } from "./types";
import { WorkbenchResizer } from "./workbench-resizer";

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
    <nav className="workbench-tabbar" aria-label="已打开的 HTML">
      {!sidebarOpen ? (
        <SidebarToggle expanded={false} onClick={onToggleSidebar} />
      ) : null}
      <div
        className="workbench-tablist"
        role="tablist"
        aria-label="已打开的 HTML"
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
  recentProjects,
  registeredProjects,
  projectsError,
  onToggle,
  onOpenLocal,
  onOpenRecent,
  onOpenRegistered,
  onOpenCurrentProject,
  updateActionVisible,
  updateDownloaded,
  updateDownloading,
  updateResult,
  updateBadgeLabel,
  onOpenAbout,
  onDownloadOrRestartUpdate,
}: {
  open: boolean;
  recentProjects: RecentProject[];
  registeredProjects: RegisteredProject[];
  projectsError?: string;
  onToggle: () => void;
  onOpenLocal: () => void;
  onOpenRecent: (sourcePath: string) => void;
  onOpenRegistered: (project: RegisteredProject) => void;
  onOpenCurrentProject: () => void;
  updateActionVisible: boolean;
  updateDownloaded: boolean;
  updateDownloading: boolean;
  updateResult: ApplicationUpdateResult | null | undefined;
  updateBadgeLabel: string;
  onOpenAbout: () => void;
  onDownloadOrRestartUpdate: () => void;
}) {
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
          <button type="button" onClick={onOpenCurrentProject}><FolderOpenIcon aria-hidden="true" size={15} weight="duotone" />当前项目</button>
          <strong>已登记项目</strong>
          {projectsError ? <span className="workbench-sidebar-error" role="status">{projectsError}</span> : null}
          {registeredProjects.slice(0, 12).map((project) => (
            <button type="button" key={project.projectId} disabled={project.availability !== "ready" || !project.documentId} onClick={() => onOpenRegistered(project)}>
              <FileHtmlIcon aria-hidden="true" size={14} weight="duotone" />
              <span>{project.projectName}</span>
            </button>
          ))}
          <strong>最近打开</strong>
          {recentProjects.slice(0, 8).map((project) => (
            <button type="button" key={project.sourcePath} onClick={() => onOpenRecent(project.sourcePath)}>
              <FileHtmlIcon aria-hidden="true" size={14} weight="duotone" />
              <span>{project.name}</span>
            </button>
          ))}
          </div>
          <WorkbenchResizer kind="sidebar" />
        </>
      ) : null}
    </aside>
  );
}
