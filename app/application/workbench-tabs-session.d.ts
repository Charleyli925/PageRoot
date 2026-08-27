export type WorkbenchTabStatus = "normal" | "processing" | "review-ready" | "error" | "opening";
export type WorkbenchTab = Readonly<{
  tabId: string;
  kind: "start" | "document";
  title: string;
  status: WorkbenchTabStatus;
  projectId?: string;
  documentId?: string;
}>;
export type WorkbenchTabsSnapshot = Readonly<{
  revision: number;
  tabs: readonly WorkbenchTab[];
  activeTabId: string;
  pendingTabId: string | null;
  mountedDocumentTabId: string | null;
  runtimeOwnerTabId: string | null;
}>;
export const INITIAL_WORKBENCH_TABS_SNAPSHOT: WorkbenchTabsSnapshot;
export class WorkbenchTabsSession {
  readonly snapshot: WorkbenchTabsSnapshot;
  captureAuthority(): unknown;
  restoreAuthority(authority: unknown): WorkbenchTabsSnapshot | null;
  subscribe(listener: (snapshot: WorkbenchTabsSnapshot) => void): () => void;
  hydrate(value: unknown): WorkbenchTabsSnapshot;
  createStart(input?: { focus?: boolean }): WorkbenchTabsSnapshot | null;
  bindDocument(input: {
    projectId: string;
    documentId: string;
    title: string;
    status?: WorkbenchTabStatus;
    focus?: boolean;
  }): WorkbenchTabsSnapshot | null;
  stageDocument(input: {
    projectId: string;
    documentId: string;
    title: string;
    status?: WorkbenchTabStatus;
  }): WorkbenchTab | null;
  resolveTab(tabId: string): WorkbenchTab | null;
  discardUnstartedDocument(tabId: string): boolean;
  beginSwitch(tabId: string): WorkbenchTabsSnapshot | null;
  commitStart(tabId: string): WorkbenchTabsSnapshot | null;
  commitDocument(input: { tabId: string; projectId: string; documentId: string; title: string }): WorkbenchTabsSnapshot | null;
  cancelSwitch(tabId: string): WorkbenchTabsSnapshot;
  updateStatus(projectId: string, documentId: string, status: WorkbenchTabStatus): WorkbenchTabsSnapshot;
  updateTitle(projectId: string, documentId: string, title: string): WorkbenchTabsSnapshot;
  reconcileRegisteredProjects(projects: readonly unknown[]): Readonly<{
    snapshot: WorkbenchTabsSnapshot;
    missing: readonly WorkbenchTab[];
  }>;
  close(tabId: string): Readonly<{ snapshot: WorkbenchTabsSnapshot; nextTabId: string | null }>;
  serialize(): Readonly<Record<string, unknown>>;
}
export function projectAppliedEventToWorkbenchTabs(input: {
  session: WorkbenchTabsSession;
  event: Readonly<{
    type: "project-applied";
    project: Readonly<{
      projectId?: string;
      documentId?: string;
      name?: string;
    }>;
    activeLocked?: boolean;
  }>;
  title?: string;
}): WorkbenchTabsSnapshot | null;
export function reconcileWorkbenchTabsWhenReady(input: {
  session: WorkbenchTabsSession;
  tabsPersistenceReady: boolean;
  registeredProjectsReady: boolean;
  registeredProjects: readonly unknown[];
}): ReturnType<WorkbenchTabsSession["reconcileRegisteredProjects"]> | null;
