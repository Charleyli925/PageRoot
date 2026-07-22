export type NativeInputClassification = {
  category: "text" | "history" | "structure" | "unsupported";
  action: string;
  supported: boolean;
  composition?: boolean;
};

export type NativeTextReplacement = {
  startOffset: number;
  endOffset: number;
  beforeText: string;
  nextText: string;
};

export type NativeTextChangeTrackerSnapshot = {
  baselineText: string;
  currentText: string;
  pieces: Array<
    | { kind: "original"; startOffset: number; endOffset: number }
    | { kind: "inserted"; text: string }
  >;
};

export declare function classifyNativeInput(inputType: unknown): NativeInputClassification;
export declare function diffNativeText(
  previousText: string,
  nextText: string,
): NativeTextReplacement | null;

export declare class NativeTextChangeTracker {
  constructor(baselineText: string);
  rebase(nextBaselineText: string): void;
  update(nextText: string): void;
  replaceCurrentRange(startOffset: number, endOffset: number, nextText: string): void;
  snapshot(): NativeTextChangeTrackerSnapshot;
  restore(snapshot: NativeTextChangeTrackerSnapshot): void;
  replacements(): NativeTextReplacement[];
  originalRangesForCurrentRange(
    startOffset: number,
    endOffset: number,
  ): Array<{ startOffset: number; endOffset: number }>;
  value(): string;
  dirty(): boolean;
}

export type NativeTransactionSelection = {
  anchor: number;
  focus: number;
  affinity: "left" | "right";
};

export declare class NativeTransactionSelectionTracker {
  freeze(selection: NativeTransactionSelection): NativeTransactionSelection;
  startSelection(): NativeTransactionSelection | null;
  rebase(): void;
}

export type SourceTransactionQueueOptions<TPayload, TResult> = {
  sessionId?: string;
  commit: (transaction: TPayload & {
    sessionId: string;
    sequence: number;
    status: string;
    enqueuedAt: number;
  }) => TResult | Promise<TResult>;
  onStateChange?: (state: SourceTransactionQueueState<TPayload>) => void;
};

export type SourceTransactionQueueState<TPayload> = {
  sessionId: string;
  lastSequence: number;
  pending: Array<TPayload & Record<string, unknown>>;
  failed: Array<TPayload & Record<string, unknown>>;
};

export declare class SourceTransactionQueue<TPayload = Record<string, unknown>, TResult = unknown> {
  constructor(options: SourceTransactionQueueOptions<TPayload, TResult>);
  enqueue(payload: TPayload): Promise<{
    ok: boolean;
    transaction: TPayload & Record<string, unknown>;
    result?: TResult;
    error?: unknown;
  }>;
  snapshot(): SourceTransactionQueueState<TPayload>;
  flush(): Promise<SourceTransactionQueueState<TPayload>>;
  clearFailed(): void;
}
