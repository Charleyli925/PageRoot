import type {
  EditRuntimeGrant,
  EditRuntimePort,
} from "../domain/edit-runtime-contract.js";

export type EditAuthorRuntimePhase =
  | "static"
  | "preparing"
  | "recovering"
  | "ready"
  | "running"
  | "settled"
  | "static-fallback";

export type EditAuthorRuntimeSnapshot = Readonly<{
  phase: EditAuthorRuntimePhase;
  sourceSha256: string | null;
  sourcePath: string | null;
  canvasGeneration: number | null;
  grant: EditRuntimeGrant | null;
  lastOutcome: string | null;
}>;

export type EditAuthorRuntimePort = EditRuntimePort;

export class EditAuthorRuntimeSession {
  constructor(options?: { port?: EditAuthorRuntimePort | null });
  readonly snapshot: EditAuthorRuntimeSnapshot;
  subscribe(listener: (snapshot: EditAuthorRuntimeSnapshot) => void): () => void;
  refresh(input?: {
    html?: string;
    sourceSha256?: string | null;
    canvasGeneration?: number;
    sourcePath?: string | null;
    sourceIsAuthoritative?: boolean;
  }): EditAuthorRuntimeSnapshot;
  startPreparation(input?: {
    sourceSha256?: string;
    canvasGeneration?: number;
  }): boolean;
  beginRuntime(input?: {
    sessionId?: string;
    sourceSha256?: string;
    canvasGeneration?: number;
  }): boolean;
  settleRuntime(input?: {
    sessionId?: string;
    sourceSha256?: string;
    canvasGeneration?: number;
    outcome?: "ready" | "rejected" | "failed" | "superseded";
  }): boolean;
  dispose(): void;
}
