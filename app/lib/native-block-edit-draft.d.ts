export type NativeBlockMutationState =
  | "clean"
  | "dirty-owned"
  | "dirty-unowned"
  | "poisoned";

export type NativeBlockEditLease = {
  readonly sessionId: string;
  readonly domGeneration: number;
  readonly sourceRevision: string;
  readonly hostId: string;
};

export type NativeBlockSelection = {
  readonly anchor: number;
  readonly focus: number;
  readonly affinity: "left" | "right";
};

export type NativeBlockCompositionGuard = {
  readonly compositionId: string;
  readonly phase: "composing" | "settling" | "stable" | "timed-out" | "cancelled";
  readonly startText: string;
  readonly startSelection: NativeBlockSelection;
  readonly candidateText: string | null;
  readonly candidateSelection: NativeBlockSelection | null;
  readonly stableObservationCount: number;
  readonly lastObservedTaskTurn: number | null;
  readonly fallbackAuthorized: boolean;
};

export type NativeBlockPendingCommand<TPayload = unknown> = {
  readonly sequence: number;
  readonly kind: string;
  readonly authority: "user-explicit" | "system";
  readonly payload?: TPayload;
  readonly compositionId: string | null;
};

export type NativeBlockEditDraftSnapshot<TFormatSkeleton = unknown> = {
  readonly lease: NativeBlockEditLease;
  readonly baselineText: string;
  readonly currentText: string;
  readonly baselineSelection: NativeBlockSelection;
  readonly currentSelection: NativeBlockSelection;
  readonly formatSkeleton: TFormatSkeleton;
  readonly mutationState: NativeBlockMutationState;
  readonly mutationReason: string | null;
  readonly compositionGuard: NativeBlockCompositionGuard | null;
  readonly pendingCommand: NativeBlockPendingCommand | null;
  readonly expired: boolean;
};

export type NativeBlockDraftAccepted<TDetails extends object = Record<string, never>> = {
  readonly accepted: true;
} & TDetails;

export type NativeBlockDraftRejected = {
  readonly accepted: false;
  readonly reason: string;
  readonly [key: string]: unknown;
};

export type NativeBlockDraftResult<TDetails extends object = Record<string, never>> =
  | NativeBlockDraftAccepted<TDetails>
  | NativeBlockDraftRejected;

export declare const NATIVE_BLOCK_MUTATION_STATES: Readonly<{
  CLEAN: "clean";
  DIRTY_OWNED: "dirty-owned";
  DIRTY_UNOWNED: "dirty-unowned";
  POISONED: "poisoned";
}>;

export declare const NATIVE_BLOCK_COMMAND_REPLACEMENT_POLICY: "latest-wins";

export declare class NativeBlockEditDraft<TFormatSkeleton = unknown> {
  constructor(options: {
    lease: NativeBlockEditLease;
    baselineText: string;
    baselineSelection: NativeBlockSelection;
    formatSkeleton?: TFormatSkeleton;
  });

  snapshot(): NativeBlockEditDraftSnapshot<TFormatSkeleton>;

  recordOwnedMutation(options: {
    lease: NativeBlockEditLease;
    compositionId?: string | null;
    reason?: string;
  }): NativeBlockDraftResult<{ mutationState: NativeBlockMutationState }>;

  recordOwnedText(options: {
    lease: NativeBlockEditLease;
    text: string;
    selection: NativeBlockSelection;
    evidence: "input" | "composition";
    compositionId?: string | null;
  }): NativeBlockDraftResult<{
    currentText: string;
    currentSelection: NativeBlockSelection;
    mutationState: NativeBlockMutationState;
  }>;

  recordUnownedMutation(options: {
    lease: NativeBlockEditLease;
    reason?: string;
  }): NativeBlockDraftResult<{ mutationState: NativeBlockMutationState }>;

  poison(options: {
    lease: NativeBlockEditLease;
    reason?: string;
  }): NativeBlockDraftResult<{ mutationState: NativeBlockMutationState }>;

  beginComposition(options: {
    lease: NativeBlockEditLease;
    compositionId: string;
    selection?: NativeBlockSelection;
  }): NativeBlockDraftResult<{ compositionId: string }>;

  endComposition(options: {
    lease: NativeBlockEditLease;
    compositionId: string;
  }): NativeBlockDraftResult<{ phase: "settling" }>;

  observeSettling(options: {
    lease: NativeBlockEditLease;
    compositionId: string;
    text: string;
    selection: NativeBlockSelection;
    taskTurn: number;
  }): NativeBlockDraftResult<{
    stable: boolean;
    stableObservationCount: number;
    advancedTaskTurn: boolean;
  }>;

  markCompositionTimeout(options: {
    lease: NativeBlockEditLease;
    compositionId: string;
  }): NativeBlockDraftResult<{
    phase: "timed-out";
    fallbackAuthorized: false;
  }>;

  cancelComposition(options: {
    lease: NativeBlockEditLease;
    compositionId: string;
  }): NativeBlockDraftResult<{
    phase: "cancelled";
    currentText: string;
    currentSelection: NativeBlockSelection;
  }>;

  discardProvisionalComposition(options: {
    lease: NativeBlockEditLease;
    compositionId: string;
  }): NativeBlockDraftResult<{
    phase: "cancelled";
    currentText: string;
    currentSelection: NativeBlockSelection;
  }>;

  compositionFallbackCandidate(options: {
    lease: NativeBlockEditLease;
    compositionId: string;
  }): NativeBlockDraftResult<{
    candidate: {
      compositionId: string;
      text: string;
      selection: NativeBlockSelection;
    };
  }>;

  acknowledgeComposition(options: {
    lease: NativeBlockEditLease;
    compositionId: string;
  }): NativeBlockDraftResult;

  queueCommand<TPayload = unknown>(options: {
    lease: NativeBlockEditLease;
    command: {
      kind: string;
      authority?: "user-explicit" | "system";
      payload?: TPayload;
    };
  }): NativeBlockDraftResult<{
    policy: "latest-wins";
    pendingCommand: NativeBlockPendingCommand<TPayload>;
    replacedCommand: NativeBlockPendingCommand | null;
  }>;

  takePendingCommand(options: {
    lease: NativeBlockEditLease;
  }): NativeBlockDraftResult<{
    command: NativeBlockPendingCommand | null;
  }>;

  rebaseFromSource(options: {
    lease: NativeBlockEditLease;
    nextLease: NativeBlockEditLease;
    baselineText: string;
    baselineSelection: NativeBlockSelection;
    formatSkeleton?: TFormatSkeleton;
    preservePendingCommand?: boolean;
    advanceLease?: ((
      expected: NativeBlockEditLease,
      next: NativeBlockEditLease,
    ) => boolean) | null;
  }): NativeBlockDraftResult<{ lease: NativeBlockEditLease }>;

  expire(options: {
    lease: NativeBlockEditLease;
    reason?: string;
  }): NativeBlockDraftResult<{ mutationState: "poisoned" }>;
}
