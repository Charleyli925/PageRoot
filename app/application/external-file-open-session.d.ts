export type ExternalFileOpenRequest = Readonly<{
  requestId: string;
  sourcePath: string;
}>;

export type ExternalFileOpenSnapshot = Readonly<{
  status: "idle" | "queued" | "opening" | "deferred";
  activeRequestId: string | null;
  queuedRequestId: string | null;
  deferredRequestId: string | null;
}>;

export type ExternalFileOpenExecution = (
  request: ExternalFileOpenRequest,
  options: Readonly<{
    isSuperseded: () => boolean;
  }>,
) => Promise<"complete" | "deferred" | void> | "complete" | "deferred" | void;

export class ExternalFileOpenSession {
  setObserver(
    observer: ((snapshot: ExternalFileOpenSnapshot) => void) | null,
  ): void;
  enqueue(request: ExternalFileOpenRequest, execute: ExternalFileOpenExecution): boolean;
  resume(execute: ExternalFileOpenExecution): boolean;
  dispose(): void;
  readonly snapshot: ExternalFileOpenSnapshot;
}
