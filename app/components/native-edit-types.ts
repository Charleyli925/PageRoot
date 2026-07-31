export type NativeEditSelection = {
  anchor: number;
  focus: number;
  affinity: "left" | "right";
};

export type NativeEditBaseline = {
  revision: string;
  text: string;
  selection?: NativeEditSelection;
};

export type NativeEditLeaseStamp = {
  readonly sessionId: string;
  readonly domGeneration: number;
  readonly sourceRevision: string;
  readonly hostId: string;
};

export type NativeEditLease = {
  stamp: NativeEditLeaseStamp;
  isCurrent: (stamp: NativeEditLeaseStamp) => boolean;
  advance: (
    expected: NativeEditLeaseStamp,
    next: NativeEditLeaseStamp,
  ) => boolean;
};

export type NativeEditCheckpointTrigger =
  | "automatic"
  | "blur"
  | "fence"
  | "style"
  | "save"
  | "export"
  | "project-switch"
  | "ai"
  | "manual";

export type NativeEditPendingCommandRequest = {
  kind: string;
  authority?: "user-explicit" | "system";
  payload?: unknown;
};

export type NativeEditQueuedCommand<TPayload = unknown> = {
  readonly sequence: number;
  readonly kind: string;
  readonly authority: "user-explicit" | "system";
  readonly payload?: TPayload;
  readonly compositionId: string | null;
};

export type NativeEditQueueCommandResult =
  | { queued: false }
  | {
      queued: true;
      sequence: number;
      replacedSequence: number | null;
    };

export type NativeEditSessionState = {
  dirty: boolean;
  draftPending: boolean;
  composing: boolean;
  requiresCanonicalReconcile: boolean;
  selection: NativeEditSelection;
  inputType: string | null;
};
