import type { WorkbenchTabsSession } from "./workbench-tabs-session.js";
import type { WorkspaceController } from "./workspace-controller.js";
export type WorkbenchTabsOutcome = Readonly<{
  status: "succeeded";
  value: Readonly<Record<string, unknown>>;
}> | Readonly<{
  status: "rejected";
  code: string;
  reason: string;
}>;
export class WorkbenchTabsWorkflow {
  constructor(input: { session: WorkbenchTabsSession; controller: WorkspaceController });
  activate(tabId: string, input?: { deadlineMs?: number }): Promise<WorkbenchTabsOutcome>;
  createStart(): Promise<WorkbenchTabsOutcome>;
  close(tabId: string): Promise<WorkbenchTabsOutcome>;
  restorePending(): Promise<WorkbenchTabsOutcome>;
}
