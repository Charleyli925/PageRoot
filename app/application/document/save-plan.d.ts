export type DocumentPlan =
  | Readonly<{ kind: "ready"; action?: "idle" | "write"; revision?: number }>
  | Readonly<{ kind: "wait" }>
  | Readonly<{ kind: "reject"; code: string; reason: string }>;

export function planDocumentEnqueue(input?: {
  disposed?: boolean;
  persistState?: string;
}): DocumentPlan;

export function planDocumentSave(input?: {
  disposed?: boolean;
  flushInFlight?: boolean;
  pendingWrite?: { sourcePath?: string } | null;
  editRevision?: number;
  lastPersistedRevision?: number;
}): DocumentPlan;
