export type ExternalFileOpenRequest = Readonly<{
  requestId: string;
  sourcePath: string;
}>;

export type ExternalFileOpenSnapshot = Readonly<{
  status: "idle" | "queued" | "opening" | "deferred";
  activeRequestId: string | null;
  queuedRequestId: string | null;
  deferredRequestId: string | null;
  deferredSequence: number;
}>;

export type ExternalFileOpenExecution = (
  request: ExternalFileOpenRequest,
  options: Readonly<{
    isSuperseded: () => boolean;
  }>,
) => Promise<"complete" | "deferred" | void> | "complete" | "deferred" | void;

export type DeferredSwitchRetry = "idle" | "blocked" | "action-required" | "resumed";

export class ExternalFileOpenSession {
  setObserver(
    observer: ((snapshot: ExternalFileOpenSnapshot) => void) | null,
  ): void;
  enqueue(request: ExternalFileOpenRequest, execute: ExternalFileOpenExecution): boolean;
  resume(execute: ExternalFileOpenExecution): boolean;
  reconcileDeferredSwitch(options: {
    switchBlocked: boolean;
    execute: ExternalFileOpenExecution;
  }): DeferredSwitchRetry;
  dispose(): void;
  readonly snapshot: ExternalFileOpenSnapshot;
}
