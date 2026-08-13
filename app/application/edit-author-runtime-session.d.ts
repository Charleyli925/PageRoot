import type {
  EditRuntimeGrant,
  EditRuntimePort,
} from "../domain/edit-runtime-contract.js";

export type EditAuthorRuntimePhase =
  | "static"
  | "probing"
  | "compatible"
  | "loading"
  | "ready";

export type EditAuthorRuntimeGrant = EditRuntimeGrant;

export type EditAuthorRuntimeSnapshot = Readonly<{
  phase: EditAuthorRuntimePhase;
  sourceSha256: string | null;
  canvasGeneration: number | null;
  grant: EditAuthorRuntimeGrant | null;
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
  beginDirectLoad(input?: {
    sessionId?: string;
    sourceSha256?: string;
    canvasGeneration?: number;
  }): boolean;
  settleDirectLoad(input?: {
    sessionId?: string;
    sourceSha256?: string;
    canvasGeneration?: number;
    outcome?: "ready" | "rejected" | "failed";
  }): boolean;
  dispose(): void;
}
