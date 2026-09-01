import type { ActiveRun } from "../domain/run-lifecycle.js";

export type RunWorkflowCodecs = Readonly<{
  isRecord(value: unknown): value is Record<string, unknown>;
  sameSourcePath(left: string | null | undefined, right: string | null | undefined): boolean;
  activeRunFromRecord(value: unknown): ActiveRun | null;
  canonicalLifecycleState(
    value: unknown,
    options?: Readonly<{ readyVersion?: boolean }>,
  ): ActiveRun["status"];
  commentHasContent(value: unknown): boolean;
  commentEditSessionHasChanges(value: unknown): boolean;
  canLocateTarget(value: unknown): boolean;
  persistedComment(value: unknown): Record<string, unknown>;
  persistedChangeEvent(value: unknown): Record<string, unknown>;
  persistedTargetRef(value: unknown): Record<string, unknown>;
  uniqueTargets(value: unknown[]): unknown[];
  fileStem(value: string): string;
  operationKey(run: Pick<ActiveRun, "sourcePath" | "requestId" | "attemptId">): string;
  errorMessage(cause: unknown, fallback: string): string;
}>;

export function createRunWorkflowCodecs(
  overrides?: Partial<RunWorkflowCodecs>,
): RunWorkflowCodecs;
