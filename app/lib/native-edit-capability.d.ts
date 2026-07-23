import type { SourceTextMap } from "./source-text-map";
import type {
  NativeEditEventDeliveryMode,
  NativeEditHostMode,
} from "./native-edit-policy";

export type NativeEditMode =
  | "native-editable"
  | "select-comment"
  | "comment-only";

export type NativeEditRuntimePreflight = {
  preflightComplete: boolean;
  sourceBacked?: boolean;
  isConnected?: boolean;
  crossOrigin?: boolean;
  insideShadowRoot?: boolean;
  generatedContent?: boolean;
  pseudoContent?: boolean;
  isSingleTextIsland?: boolean;
  mappingComplete?: boolean;
  contentEditableMode?: NativeEditHostMode | null;
  styleStable?: boolean;
  layoutStable?: boolean;
  selectionStable?: boolean;
  observerReady?: boolean;
  nativeEventDeliveryMode?: NativeEditEventDeliveryMode;
  nativeEventDeliveryStable?: boolean;
  nativeEventDeliveryGuarded?: boolean;
  authorMutationRisk?: boolean;
};

export type NativeEditCapability = {
  mode: NativeEditMode;
  directlyEditable: boolean;
  selectable: boolean;
  sourceBacked: boolean;
  code: string;
  reason: string | null;
  userMessage: string;
  rootNodeId: string | null;
  sourceMap: SourceTextMap | null;
  details: Record<string, unknown>;
};

export declare const NATIVE_EDIT_MODE: Readonly<{
  EDITABLE: "native-editable";
  SELECT_COMMENT: "select-comment";
  COMMENT_ONLY: "comment-only";
}>;

export declare function classifyNativeEditCapability(
  index: Record<string, unknown>,
  target: string | Record<string, unknown>,
  options?: {
    features?: {
      hardBreak?: boolean;
      structuralRange?: boolean;
      emptyHost?: boolean;
    };
    runtime?: NativeEditRuntimePreflight;
  },
): NativeEditCapability;

export declare function isNativeEditableCapability(value: unknown): boolean;
export declare function isNativeDirectEditRoot(tagName: unknown): boolean;
export declare function isEstablishedNativeEditRoot(tagName: unknown): boolean;
