export type WorkbenchTabsPersistenceSnapshot = Readonly<{
  revision: number;
  requestedRevision: number;
  acknowledgedRevision: number;
  phase: "idle" | "loading" | "queued" | "writing" | "failed";
  restartSafe: boolean;
  error: string | null;
}>;
export const INITIAL_WORKBENCH_TABS_PERSISTENCE_SNAPSHOT: WorkbenchTabsPersistenceSnapshot;
export class WorkbenchTabsPersistenceCoordinator {
  constructor(input?: {
    port?: Readonly<{ get(): Promise<unknown>; set(value: Readonly<Record<string, unknown>>): Promise<unknown> }> | null;
    clock?: Readonly<{ now(): number }>;
  });
  readonly snapshot: WorkbenchTabsPersistenceSnapshot;
  subscribe(listener: (snapshot: WorkbenchTabsPersistenceSnapshot) => void): () => void;
  load(): Promise<unknown>;
  commit(state: Readonly<Record<string, unknown>>): Readonly<{ requestedRevision: number; deferred?: boolean }> | null;
  pinCloseRevision(): number | null;
  releaseCloseRevision(): boolean;
  retry(): boolean;
  drain(input: { deadlineAt: number; throughRevision?: number }): Promise<Readonly<{ ok: boolean; revision?: number; reason?: string }>>;
  dispose(): void;
}
