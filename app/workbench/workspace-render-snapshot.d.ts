import type { WorkspaceControllerSnapshot } from "../application/workspace-controller.js";

export function sameWorkbenchRenderSnapshot(
  previous: WorkspaceControllerSnapshot | null,
  next: WorkspaceControllerSnapshot | null,
): boolean;
