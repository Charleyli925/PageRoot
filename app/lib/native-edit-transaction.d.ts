export type NativeInputClassification = {
  category: "text" | "structure" | "unsupported";
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
