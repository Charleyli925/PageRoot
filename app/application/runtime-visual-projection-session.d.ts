import type {
  RawRuntimeVisualProjection,
  RuntimeVisualCapturePayload,
  RuntimeVisualProjection,
} from "../domain/runtime-visual-projection.js";
import type { PageViewContext } from "../lib/page-view-context.js";

export type RuntimeVisualProjectionSnapshot = Readonly<{
  status: "idle" | "scheduled" | "capturing" | "ready" | "unavailable";
  documentKey: string | null;
  sourceSha256: string | null;
  requestKey: string | null;
  projection: RuntimeVisualProjection | null;
}>;

export class RuntimeVisualProjectionSession {
  constructor(options?: {
    capture?: (
      payload: RuntimeVisualCapturePayload,
    ) => Promise<RawRuntimeVisualProjection>;
    captureDebounceMs?: number;
  });
  setObserver(
    observer: ((snapshot: RuntimeVisualProjectionSnapshot) => void) | null,
  ): void;
  request(options?: {
    html?: string;
    sourcePath?: string;
    documentKey?: string;
    viewportWidth?: number;
    pageViewContext?: PageViewContext | null;
    sourceIndex?: unknown;
  }): boolean;
  suspend(): void;
  reset(): void;
  dispose(): void;
  readonly snapshot: RuntimeVisualProjectionSnapshot;
}
