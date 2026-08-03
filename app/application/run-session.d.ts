import type { ActiveRun } from "../domain/run-lifecycle.js";

export type RunOperationKind = "activate" | "cancel" | "resolve" | "poll";

export type RunHandoffState = {
  sourcePath: string;
  requestId: string;
  attemptId: string;
  status: "copying" | "copied" | "failed";
};

export type RunBackgroundResult = {
  state: "processing" | "ready" | "conflict" | "no-change" | "error";
  label: string;
  updatedAt: number;
};

export type RunSessionSnapshot = {
  activeSourcePath: string | null;
  activeRun: ActiveRun | null;
  activeHandoff: RunHandoffState | null;
  backgroundResults: ReadonlyArray<readonly [string, RunBackgroundResult]>;
};

export class RunSession {
  constructor(options?: { sourcePath?: string | null });
  setObserver(observer: ((snapshot: RunSessionSnapshot) => void) | null): void;
  activate(sourcePath: string | null): RunSessionSnapshot;
  setActiveRun(run: ActiveRun | null): ActiveRun | null;
  trackRun(
    run: ActiveRun,
    options?: { activate?: "if-current" | "never" | "always" },
  ): ActiveRun | null;
  runForSource(sourcePath: string | null | undefined): ActiveRun | null;
  hasRun(run: ActiveRun | null | undefined): boolean;
  removeRun(
    run: ActiveRun,
    options?: { clearActive?: boolean },
  ): boolean;
  clearActiveRun(): boolean;
  publishHandoff(state: RunHandoffState): boolean;
  handoffForSource(
    sourcePath: string | null | undefined,
  ): RunHandoffState | null;
  clearHandoff(sourcePath: string | null | undefined): boolean;
  clearActiveHandoff(): boolean;
  markResult(
    sourcePath: string,
    result: RunBackgroundResult,
  ): boolean;
  clearResult(sourcePath: string | null | undefined): boolean;
  resultForSource(
    sourcePath: string | null | undefined,
  ): RunBackgroundResult | null;
  rebaseSource(value: {
    previousSourcePath: string;
    sourcePath: string;
    projectId?: string;
  }): boolean;
  beginOperation(kind: RunOperationKind, key: string): boolean;
  endOperation(kind: RunOperationKind, key: string): boolean;
  isOperationBusy(kind: RunOperationKind, key: string): boolean;
  readonly activeRun: ActiveRun | null;
  readonly activeHandoff: RunHandoffState | null;
  readonly runs: ReadonlyArray<ActiveRun>;
  readonly snapshot: RunSessionSnapshot;
}
