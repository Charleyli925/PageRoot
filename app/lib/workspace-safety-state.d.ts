export function workspaceUnavailableFromCode(code: string): {
  title: string;
  message: string;
  source: "locator";
} | null;

export type WorkspaceSafetyState =
  | { kind: "save-blocked"; reason: string }
  | { kind: "source-conflict"; reason: string }
  | { kind: "workspace-unavailable"; reason: string }
  | { kind: "closing-after-save" }
  | null;

export function deriveWorkspaceSafetyState(input?: {
  pendingExit?: boolean;
  persistState?: string;
  persistError?: string;
  workspaceIssue?: { title?: string; message?: string } | null;
}): WorkspaceSafetyState;
