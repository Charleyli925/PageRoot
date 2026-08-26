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
export class WorkbenchTabsSession {
  readonly snapshot: WorkbenchTabsSnapshot;
  subscribe(listener: (snapshot: WorkbenchTabsSnapshot) => void): () => void;
  hydrate(value: unknown): WorkbenchTabsSnapshot;
  createStart(input?: { focus?: boolean }): WorkbenchTabsSnapshot | null;
  bindDocument(input: {
    projectId: string;
    documentId: string;
    title: string;
    status?: WorkbenchTabStatus;
    focus?: boolean;
  }): WorkbenchTabsSnapshot;
  stageDocument(input: {
    projectId: string;
    documentId: string;
    title: string;
    status?: WorkbenchTabStatus;
  }): WorkbenchTab | null;
  beginSwitch(tabId: string): WorkbenchTabsSnapshot | null;
  commitStart(tabId: string): WorkbenchTabsSnapshot | null;
  commitDocument(input: { tabId: string; projectId: string; documentId: string; title: string }): WorkbenchTabsSnapshot | null;
  cancelSwitch(tabId: string): WorkbenchTabsSnapshot;
  updateStatus(projectId: string, documentId: string, status: WorkbenchTabStatus): WorkbenchTabsSnapshot;
  close(tabId: string): Readonly<{ snapshot: WorkbenchTabsSnapshot; nextTabId: string | null }>;
  serialize(): Readonly<Record<string, unknown>>;
}
export function createWorkbenchTabsSession(): WorkbenchTabsSession;
