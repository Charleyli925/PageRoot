export type NativeEditHostMode = "plaintext-only" | "true";
export type NativeEditEventDeliveryMode =
  | "native"
  | "observer-guarded"
  | "unsafe";

export type NativeEditAttributeSnapshot = Record<
  string,
  { present: boolean; value: string | null }
>;

export declare const NATIVE_EDIT_HOST_MODE: Readonly<{
  PLAINTEXT_ONLY: "plaintext-only";
  CONTROLLED: "true";
}>;

export declare const NATIVE_EDIT_CHECKPOINT_DELAY_MS: 700;
export declare const NATIVE_EDIT_COMPOSITION_TERMINAL_GRACE_MS: 80;
export declare const NATIVE_EDIT_PENDING_COMPOSITION_COMMAND_GRACE_MS: 1200;
export declare const NATIVE_EDIT_SESSION_CONTROLLED_ATTRIBUTES: readonly string[];
export declare const NATIVE_EDIT_MANAGED_ATTRIBUTES: readonly string[];
export declare const NATIVE_EDIT_FORMAT_SKELETON_ROOT_ATTRIBUTES: readonly string[];
export declare const NATIVE_EDIT_DISPOSABLE_INLINE_WRAPPER_TAGS: readonly string[];

export declare function isNativeEditHostMode(
  value: unknown,
): value is NativeEditHostMode;
export declare function isDisposableNativeInlineWrapperTag(
  tagName: unknown,
): boolean;
export declare function captureNativeEditSessionAttributes(
  element: Element,
): NativeEditAttributeSnapshot;
export declare function restoreNativeEditSessionAttributes(
  element: Element,
  snapshot: NativeEditAttributeSnapshot,
): void;
export declare function applyNativeEditSessionAttributes(
  element: HTMLElement,
  options: {
    hostMode: NativeEditHostMode;
    ariaLabel?: string;
  },
): void;
export declare function chooseNativeEditHostMode(options: {
  plaintextOnly?: { layoutStable?: boolean; styleStable?: boolean } | null;
  controlled?: { layoutStable?: boolean; styleStable?: boolean } | null;
}): NativeEditHostMode | null;
export declare function classifyNativeEventDelivery(options: {
  hasDisplayContents: boolean;
  observerReady: boolean;
}): NativeEditEventDeliveryMode;
