import type { WorkbenchTabsSession } from "./workbench-tabs-session.js";
import type { WorkspaceController } from "./workspace-controller.js";
export class WorkbenchTabsWorkflow {
  constructor(input: { session: WorkbenchTabsSession; controller: WorkspaceController });
  activate(tabId: string, input?: { deadlineMs?: number }): Promise<Readonly<Record<string, unknown>>>;
  createStart(): Promise<Readonly<Record<string, unknown>>>;
  close(tabId: string): Promise<Readonly<Record<string, unknown>>>;
  restorePending(): Promise<Readonly<Record<string, unknown>>>;
}
