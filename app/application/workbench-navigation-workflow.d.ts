import type { WorkbenchNavigationSession, WorkbenchNavigationReceipt } from "./workbench-navigation-session.js";
import type { WorkbenchTabsSession, WorkbenchTabStatus } from "./workbench-tabs-session.js";
import type { ProjectWorkflow, ProjectWorkflowOutcome, ProjectWorkflowProject } from "./project-workflow.js";
import type { WorkspaceController } from "./workspace-controller.js";
import type { BrowserDocumentSession } from "./browser-document-session.js";
import type { WorkbenchTabsPersistenceCoordinator } from "./workbench-tabs-persistence-coordinator.js";
export type WorkbenchNavigationOutcome = ProjectWorkflowOutcome<Record<string, unknown>> & Readonly<{
  committed?: boolean;
  tabId?: string;
}>;
export function workbenchNavigationOutcomeHasCommittedDocument(outcome: unknown): boolean;
export function workbenchStartupPriority(input?: {
  externalRequestCount?: number;
  persistedStatePresent?: boolean;
  persistedActiveTabId?: string | null;
}): "external" | "persisted-active-tab" | "active-path-compatibility" | "start";
export class WorkbenchNavigationWorkflow {
  constructor(input: {
    session: WorkbenchNavigationSession;
    tabs: WorkbenchTabsSession;
    projectWorkflow: ProjectWorkflow;
    controller: WorkspaceController;
    browserDocuments?: BrowserDocumentSession | null;
    tabsPersistence?: WorkbenchTabsPersistenceCoordinator | null;
    clock?: Readonly<{ now(): number }>;
    setTimer?: (callback: () => void, delayMs: number) => unknown;
    clearTimer?: (handle: unknown) => void;
  });
  openProject(input?: Record<string, unknown>): Promise<WorkbenchNavigationOutcome>;
  activateTab(tabId: string, input?: { deadlineMs?: number; intentKind?: string }): Promise<WorkbenchNavigationOutcome>;
  openRegisteredProject(input: { projectId: string; documentId: string; title: string; status?: WorkbenchTabStatus }): Promise<WorkbenchNavigationOutcome>;
  createStart(): Promise<WorkbenchNavigationOutcome>;
  closeTab(tabId: string): Promise<WorkbenchNavigationOutcome>;
  acceptBrowserProject(input: { operationId?: string; project: ProjectWorkflowProject }): Promise<WorkbenchNavigationOutcome>;
  acceptExternalProject(input: { requestId: string; sourcePath?: string }): Promise<WorkbenchNavigationOutcome>;
  confirmOpen(input?: Record<string, unknown>): Promise<WorkbenchNavigationOutcome>;
  cancelOpen(input?: Record<string, unknown>): Promise<WorkbenchNavigationOutcome>;
  retryOpen(input?: Record<string, unknown>): Promise<WorkbenchNavigationOutcome>;
  resumeDeferredProjectApplication(): ProjectWorkflowOutcome;
  resumeDeferredExternalProject(): ProjectWorkflowOutcome;
  beginClose(input: { requestId: string }): boolean;
  commitClose(input: { requestId: string }): boolean;
  abortClose(input: { requestId: string }): boolean;
  authorizeProjectApplication(input: {
    transactionId?: string | null;
    applicationId?: string | null;
  }): Readonly<{ accepted: boolean; kind: "authority-refresh" | "transaction" | "stale" }>;
  applyProject(input: Readonly<Record<string, unknown>>): WorkbenchNavigationReceipt;
  onConfirmationPresented(input: { transactionId?: string; requestId?: string }): boolean;
  onTerminalFailure(input: { transactionId?: string; reason?: string }): boolean;
  prepareClose(input: { deadlineAt: number }): Promise<boolean>;
  waitForIdle(input: { deadlineAt: number }): Promise<boolean>;
  waitForTerminal(transactionId: string): Promise<Readonly<Record<string, unknown>> | null>;
  dispose(): void;
}
