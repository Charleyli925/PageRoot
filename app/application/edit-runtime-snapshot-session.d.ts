import type {
  RuntimeSnapshotInputCandidate,
  RuntimeVisualProjection,
} from "../domain/runtime-snapshot-hosts.js";

export type { RuntimeVisualProjection } from "../domain/runtime-snapshot-hosts.js";

export type EditRuntimeSnapshot = Readonly<{
  status: "idle" | "scheduled" | "capturing" | "ready" | "unavailable";
  documentKey: string | null;
  sourceSha256: string | null;
  requestKey: string | null;
  projection: RuntimeVisualProjection | null;
}>;

export class EditRuntimeSnapshotSession {
  constructor(options?: {
    capture?: (payload: Readonly<{
      contractVersion: 1;
      captureSessionId: string;
      sourceSha256: string;
      side: "edit";
      html: string;
      candidates: readonly RuntimeSnapshotInputCandidate["captureCandidate"][];
      viewport: Readonly<{ width: number; height: number }>;
    }>) => Promise<unknown>;
    captureDebounceMs?: number;
  });
  setObserver(observer: ((snapshot: EditRuntimeSnapshot) => void) | null): void;
  request(options?: {
    html?: string;
    documentKey?: string;
    viewportWidth?: number;
    sourceIndex?: unknown;
  }): boolean;
  suspend(): void;
  reset(): void;
  dispose(): void;
  readonly snapshot: EditRuntimeSnapshot;
}
