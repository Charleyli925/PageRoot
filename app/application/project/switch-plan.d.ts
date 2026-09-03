export type ProjectSwitchPlan =
  | Readonly<{ kind: "ready"; action?: "reset-failed" | "drain-run-lock" | "continue" }>
  | Readonly<{ kind: "wait"; reason?: string }>
  | Readonly<{ kind: "reject"; code: string; reason: string }>;

export function planProjectSwitchEntry(input?: {
  disposed?: boolean;
  drainBlockedReason?: string | null;
  projectLoadError?: boolean;
  runLocked?: boolean;
  hasHistoryAction?: boolean;
}): ProjectSwitchPlan;

export function planProjectSwitchFence(input?: {
  needsCanvasCommit?: boolean;
  fenceOk?: boolean;
  fenceReason?: string;
}): ProjectSwitchPlan;

export function planProjectSwitchValidationLease(input?: {
  obligationsResolved?: boolean;
  hasPendingNativeEdit?: boolean;
  hasHistoryAction?: boolean;
  persistState?: string;
  pendingWrite?: boolean;
  flushInFlight?: boolean;
  editRevision?: number;
  lastPersistedRevision?: number;
  sourcePath?: string;
  sourceSha256?: string;
  persistedSourceSha256?: string;
  workingHtmlSha256?: string;
  canvasStatus?: string;
  renderedSha256?: string;
  canvasRenderedSha256?: string;
}): Readonly<{ kind: "ready"; action: "reuse-verified" | "full-check" }>;

export function planProjectSwitchAfterDrain(input?: {
  editRevision?: number;
  cutoffRevision?: number;
  pendingWrite?: boolean;
  flushInFlight?: boolean;
  hasHistoryAction?: boolean;
  recoveryProtected?: boolean;
}): ProjectSwitchPlan;

export function planProjectSwitchAfterSourceProtection(input?: {
  needsSourceProtection?: boolean;
  sourcePath?: string;
  lastPersistedRevision?: number;
  cutoffRevision?: number;
  committedSourceSha256?: string;
  documentSourceSha256?: string;
  persistedSourceSha256?: string;
  workingHtmlSha256?: string;
  protectionHtmlSha256?: string;
  recoveryProtected?: boolean;
}): ProjectSwitchPlan;
