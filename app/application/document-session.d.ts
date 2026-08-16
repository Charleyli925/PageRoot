export type DocumentPersistState =
  | "idle"
  | "preview-dirty"
  | "queued"
  | "writing"
  | "failed"
  | "conflict";

export type DocumentCanvasAuthorityStatus =
  | "idle"
  | "pending"
  | "verified"
  | "failed";

export type DocumentCanvasAuthority = {
  status: DocumentCanvasAuthorityStatus;
  generation: number;
  renderedSha256: string | null;
  error: string | null;
};

export type DocumentSessionSnapshot = {
  html: string;
  sourceSha256: string | null;
  canvasGeneration: number;
  canvasAuthority: DocumentCanvasAuthority;
  editRevision: number;
  lastPersistedRevision: number;
  persistState: DocumentPersistState;
  persistError: string;
  hasPendingWrite: boolean;
  isFlushing: boolean;
};

export type PersistedBoundaryResult =
  | {
      ready: true;
      repaired: boolean;
      sourceSha256: string;
      lastModifiedAt: string;
    }
  | {
      ready: false;
      code:
        | "frozen-integrity-unavailable"
        | "session-changed"
        | "source-unavailable"
        | "source-identity-changed"
        | "source-integrity-failed"
        | "source-diverged";
      reason: string;
      confirmed: boolean;
    };

export class DocumentSession<TWrite = unknown> {
  constructor(options?: {
    html?: string;
    sourceSha256?: string | null;
  });
  setObserver(
    observer: ((snapshot: DocumentSessionSnapshot) => void) | null,
  ): void;
  update(value: {
    html?: string;
    sourceSha256?: string | null;
    editRevision?: number;
    lastPersistedRevision?: number;
    persistState?: DocumentPersistState;
    persistError?: string;
    pendingWrite?: TWrite | null;
  }): DocumentSessionSnapshot;
  reset(value: {
    html: string;
    sourceSha256?: string | null;
    editRevision?: number;
    lastPersistedRevision?: number;
  }): DocumentSessionSnapshot;
  publishAuthority(value: {
    html: string;
    sourceSha256: string | null;
    editRevision?: number;
    lastPersistedRevision?: number;
    persistState?: DocumentPersistState;
    persistError?: string;
    pendingWrite?: TWrite | null;
  }): DocumentSessionSnapshot;
  reloadCanvas(): DocumentSessionSnapshot;
  confirmCanvas(value: {
    generation: number;
    renderedSha256: string;
  }): boolean;
  failCanvas(value: {
    generation: number;
    error?: string;
  }): boolean;
  beginEdit(html: string): number;
  setHtml(html: string): void;
  setSourceSha256(sourceSha256: string | null): void;
  setEditRevision(value: number): void;
  setLastPersistedRevision(value: number): void;
  setPersistence(value?: {
    state?: DocumentPersistState;
    error?: string;
  }): void;
  setPersistState(state: DocumentPersistState): void;
  setPersistError(error: string): void;
  setPendingWrite(write: TWrite | null): TWrite | null;
  takePendingWrite(): TWrite | null;
  setFlushPromise(
    promise: Promise<boolean> | null,
  ): Promise<boolean> | null;
  clearFlushPromise(promise: Promise<boolean>): boolean;
  reconcilePersistedBoundary(value: {
    frozenHtml: string;
    reportedSourceSha256?: string | null;
    cutoffRevision: number;
    hashHtml: (html: string) => Promise<string>;
    readSource: () => Promise<Record<string, unknown>>;
    isCurrent: () => boolean;
    acceptsSource: (source: Record<string, unknown>) => boolean;
  }): Promise<PersistedBoundaryResult>;
  readonly html: string;
  readonly sourceSha256: string | null;
  readonly canvasGeneration: number;
  readonly canvasAuthority: DocumentCanvasAuthority;
  readonly editRevision: number;
  readonly lastPersistedRevision: number;
  readonly persistState: DocumentPersistState;
  readonly persistError: string;
  readonly pendingWrite: TWrite | null;
  readonly flushPromise: Promise<boolean> | null;
  readonly snapshot: DocumentSessionSnapshot;
}
