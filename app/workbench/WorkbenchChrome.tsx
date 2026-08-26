"use client";

import {
  CaretRightIcon,
  FileHtmlIcon,
  FolderOpenIcon,
  PlusIcon,
  SidebarSimpleIcon,
  XIcon,
} from "@phosphor-icons/react";
import type { WorkbenchTab, WorkbenchTabsSnapshot } from "../application/workbench-tabs-session.js";
import type { RecentProject, RegisteredProject } from "./types";

export function WorkbenchTabBar({
  snapshot,
  onSelect,
  onClose,
  onNew,
}: {
  snapshot: WorkbenchTabsSnapshot;
  onSelect: (tab: WorkbenchTab) => void;
  onClose: (tab: WorkbenchTab) => void;
  onNew: () => void;
}) {
  return (
    <nav className="workbench-tabbar" aria-label="已打开的 HTML">
      <div className="workbench-tablist" role="tablist" aria-orientation="horizontal">
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
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls="workbench-content-outlet"
                tabIndex={selected ? 0 : -1}
                onClick={() => onSelect(tab)}
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

export function WorkbenchStartToolbar({ onOpenSidebar }: { onOpenSidebar: () => void }) {
  return (
    <header className="workbench-start-toolbar">
      <button type="button" onClick={onOpenSidebar}>
        <SidebarSimpleIcon aria-hidden="true" size={16} weight="duotone" />
        项目
      </button>
      <strong>开始</strong>
    </header>
  );
}

export function WorkbenchStartPage({
  recentProjects,
  onOpenLocal,
  onOpenRecent,
  onOpenSidebar,
}: {
  recentProjects: RecentProject[];
  onOpenLocal: () => void;
  onOpenRecent: (sourcePath: string) => void;
  onOpenSidebar: () => void;
}) {
  return (
    <section id="workbench-content-outlet" className="workbench-start-page" aria-labelledby="workbench-start-title">
      <div className="workbench-start-card">
        <span className="workbench-start-icon"><FileHtmlIcon aria-hidden="true" size={28} weight="duotone" /></span>
        <h1 id="workbench-start-title">打开 HTML</h1>
        <p>从 Finder 选择一个 HTML，或从已登记的项目继续。</p>
        <button className="workbench-start-primary" type="button" onClick={onOpenLocal}>
          <FolderOpenIcon aria-hidden="true" size={17} weight="duotone" />
          从 Finder 打开 HTML
        </button>
        <button className="workbench-start-secondary" type="button" onClick={onOpenSidebar}>
          查看现有项目
          <CaretRightIcon aria-hidden="true" size={13} weight="bold" />
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
  onToggle,
  onOpenLocal,
  onOpenRecent,
  onOpenRegistered,
  onOpenCurrentProject,
}: {
  open: boolean;
  recentProjects: RecentProject[];
  registeredProjects: RegisteredProject[];
  onToggle: () => void;
  onOpenLocal: () => void;
  onOpenRecent: (sourcePath: string) => void;
  onOpenRegistered: (project: RegisteredProject) => void;
  onOpenCurrentProject: () => void;
}) {
  return (
    <aside className="workbench-global-sidebar" data-open={open ? "true" : undefined} aria-label="全局项目">
      <button className="workbench-sidebar-toggle" type="button" aria-expanded={open} aria-label={open ? "收起项目侧栏" : "展开项目侧栏"} onClick={onToggle}>
        <SidebarSimpleIcon aria-hidden="true" size={17} weight="duotone" />
        {open ? <span>项目</span> : null}
      </button>
      {open ? (
        <div className="workbench-sidebar-body">
          <button type="button" onClick={onOpenLocal}><PlusIcon aria-hidden="true" size={14} weight="bold" />打开 HTML</button>
          <button type="button" onClick={onOpenCurrentProject}><FolderOpenIcon aria-hidden="true" size={15} weight="duotone" />当前项目</button>
          <strong>已登记项目</strong>
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
      ) : null}
    </aside>
  );
}
