export type ProjectClosePlan =
  | Readonly<{ kind: "ready"; action?: "allow-hydration" | "allow-load-error" | "continue" }>
  | Readonly<{ kind: "reject"; code: string; reason: string; presentation?: "native" | "in-app" }>;

export function planProjectCloseIdentity(input?: {
  requestId?: string;
  deadlineAt?: number;
}): ProjectClosePlan;

export function planProjectCloseHydration(input?: {
  projectOpenInFlight?: boolean;
  projectHydrating?: boolean;
  canCloseDuringHydration?: boolean;
  projectLoadError?: boolean;
  pendingDirty?: boolean;
}): ProjectClosePlan;

export function planProjectCloseAbort(input?: {
  aborted?: boolean;
  projectOpenInFlight?: boolean;
}): ProjectClosePlan;
