export type SourceLocatorPlan =
  | Readonly<{ kind: "ready" }>
  | Readonly<{ kind: "reject"; code: string; reason: string }>;

export function planSourceLocatorRegister(input?: {
  epoch?: number;
  liveEpoch?: number;
  sourcePath?: string | null;
  liveSourcePath?: string | null;
  projectId?: string;
  documentId?: string;
  samePath?: (left: unknown, right: unknown) => boolean;
}): SourceLocatorPlan;

export function planSourceLocatorTransition(input?: {
  nextSourcePath?: string;
  previousSourcePath?: string | null;
  liveSourcePath?: string | null;
  samePath?: (left: unknown, right: unknown) => boolean;
}): SourceLocatorPlan;
