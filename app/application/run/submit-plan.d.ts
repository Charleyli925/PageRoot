export type RunSubmitPlan =
  | Readonly<{ kind: "ready" }>
  | Readonly<{ kind: "reject"; code: string; reason: string }>;

export function planRunSubmitEntry(input?: { disposed?: boolean }): RunSubmitPlan;

export function planRunSubmit(input?: {
  sourcePath?: string | null;
  context?: object | null;
  submissionPending?: boolean;
  activeLocked?: boolean;
  hasComposerDraft?: boolean;
  hasDirtyEdit?: boolean;
}): RunSubmitPlan;
