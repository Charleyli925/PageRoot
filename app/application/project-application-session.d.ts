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

export class ProjectApplicationSession<T> {
  setObserver(
    observer: ((snapshot: ProjectApplicationSnapshot) => void) | null,
  ): void;
  enqueue(application: ProjectApplication<T>, execute: ProjectApplicationExecution<T>): boolean;
  resume(execute: ProjectApplicationExecution<T>): boolean;
  dispose(): void;
  readonly snapshot: ProjectApplicationSnapshot;
}
