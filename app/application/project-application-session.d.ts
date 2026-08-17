export type ProjectApplicationSnapshot = Readonly<{
  status: "idle" | "queued" | "applying" | "deferred";
  activeApplicationId: string | null;
  queuedApplicationId: string | null;
  deferredApplicationId: string | null;
  deferredSequence: number;
}>;

export type ProjectApplication<T> = Readonly<{
  applicationId: string;
  value: T;
}>;

export type ProjectApplicationExecution<T> = (
  application: ProjectApplication<T>,
) => Promise<"complete" | "deferred" | void> | "complete" | "deferred" | void;

export type ProjectApplicationDeferredSwitchRetry = "idle" | "blocked" | "action-required" | "resumed";

export class ProjectApplicationSession<T> {
  setObserver(
    observer: ((snapshot: ProjectApplicationSnapshot) => void) | null,
  ): void;
  enqueue(application: ProjectApplication<T>, execute: ProjectApplicationExecution<T>): boolean;
  resume(execute: ProjectApplicationExecution<T>): boolean;
  reconcileDeferredSwitch(options: {
    switchBlocked: boolean;
    execute: ProjectApplicationExecution<T>;
  }): ProjectApplicationDeferredSwitchRetry;
  waitFor(applicationId: string): Promise<Readonly<{
    applicationId: string;
    result: string;
  }>>;
  dispose(): void;
  readonly snapshot: ProjectApplicationSnapshot;
}
