import type { WorkspaceControllerCodecs } from "./workspace-controller.js";

export function createWorkspaceControllerCodecs(
  codecs: WorkspaceControllerCodecs,
): WorkspaceControllerCodecs;

export function decodeWorkspaceResponse(payload: Record<string, unknown>, codecs: Pick<WorkspaceControllerCodecs,
  "versionsFromWorkspace" | "draftAuthorityFromWorkspace" | "commentsFromRecords" | "changesFromDraftRecords"
>): Readonly<{ versions: unknown[]; draft: Record<string, unknown>; comments: unknown[]; changeEvents: unknown[] }>;
