export type NativeInputIntentKind =
  | "text"
  | "history"
  | "insert-hard-break"
  | "split-block"
  | "format"
  | "structure"
  | "unsupported";

export type NativeInputIntent = {
  kind: NativeInputIntentKind;
  action: string;
  supported: boolean;
  composition?: boolean;
};

export declare const NATIVE_INPUT_INTENT_KIND: Readonly<{
  TEXT: "text";
  HISTORY: "history";
  INSERT_HARD_BREAK: "insert-hard-break";
  SPLIT_BLOCK: "split-block";
  FORMAT: "format";
  STRUCTURE: "structure";
  UNSUPPORTED: "unsupported";
}>;

export declare function classifyNativeInputIntent(
  inputType: unknown,
): NativeInputIntent;

export declare function normalizePlainTextLineEndings(value: unknown): string;

export declare function hasMultilinePlainText(value: unknown): boolean;
