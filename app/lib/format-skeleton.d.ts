import type {
  SourceAffinity,
  SourceAnchor,
  SourceTextMap,
  SourceTextSegment,
} from "./source-text-map";
import type { RuntimeDomSourceMap } from "./runtime-dom-source-map";

export declare const FORMAT_SKELETON_VERSION: 1;
export declare const FORMAT_SKELETON_CRITICAL_STYLES: readonly string[];

export type FormatSkeletonAttribute = {
  name: string;
  value: string | null;
  rawValue: string | null;
  raw: string;
  range: { startOffset: number; endOffset: number };
  nameRange: { startOffset: number; endOffset: number };
  valueRange: { startOffset: number; endOffset: number } | null;
};

export type FormatSkeletonCriticalStyle = Record<string, string> | null;

export type FormatSkeletonProtectedRange = {
  nodeId: string;
  kind: "start-tag" | "end-tag";
  startOffset: number;
  endOffset: number;
  raw: string;
};

export type FormatSkeletonWrapper = {
  nodeId: string;
  parentNodeId: string;
  parentWrapperNodeId: string | null;
  ancestorWrapperNodeIds: string[];
  descendantTextNodeIds: string[];
  tagName: string;
  depth: number;
  textStart: number;
  textEnd: number;
  sourceStart: number;
  sourceEnd: number;
  sourceAttributes: FormatSkeletonAttribute[];
  domAttributes: Array<{ name: string; value: string }>;
  criticalStyle: FormatSkeletonCriticalStyle;
  disposable: boolean;
  link: boolean;
  href: string | null;
  protectedSourceRanges: FormatSkeletonProtectedRange[];
};

export type FormatSkeletonHardBreak = {
  kind: "hard-break";
  nodeId: string;
  parentNodeId: string;
  tagName: "br";
  textStart: number;
  textEnd: number;
  sourceStart: number;
  sourceEnd: number;
  sourceAttributes: FormatSkeletonAttribute[];
  domAttributes: Array<{ name: string; value: string }>;
  protectedSourceRanges: FormatSkeletonProtectedRange[];
};

export type FormatSkeleton = {
  version: 1;
  sourceSha256: string;
  rootNodeId: string;
  rootTagName: string;
  text: string;
  textLength: number;
  sourceMap: SourceTextMap;
  sourceSegments: Array<{
    kind: "text" | "hard-break" | "structure";
    nodeId: string;
    textStart: number;
    textEnd: number;
    sourceStart: number;
    sourceEnd: number;
    decodedText: string;
    raw: string;
  }>;
  root: {
    nodeId: string;
    tagName: string;
    sourceStart: number;
    sourceEnd: number;
    sourceAttributes: FormatSkeletonAttribute[];
    domAttributes: Array<{ name: string; value: string }>;
    criticalStyle: FormatSkeletonCriticalStyle;
    protectedSourceRanges: FormatSkeletonProtectedRange[];
  };
  wrappers: FormatSkeletonWrapper[];
  hardBreaks: FormatSkeletonHardBreak[];
  linkBoundaries: Array<{
    nodeId: string;
    textStart: number;
    textEnd: number;
    href: string | null;
  }>;
  protectedSourceRanges: FormatSkeletonProtectedRange[];
  criticalStylesCaptured: boolean;
};

export type FormatSkeletonPatchDescription = {
  version: 1;
  kind: "source-text-replacement";
  expectedSourceSha256: string;
  rootNodeId: string;
  editRange: {
    startOffset: number;
    endOffset: number;
    affinity: SourceAffinity;
  };
  beforeText: string;
  replacementText: string;
  deleteSegments: SourceTextSegment[];
  insertAt: SourceAnchor;
  inheritFormatFrom: {
    textOffset: number;
    affinity: SourceAffinity;
    wrapperNodeIds: string[];
    linkNodeId: string | null;
  };
  preserveWrapperNodeIds: string[];
  removalEligibleWrapperNodeIds: string[];
  domMissingDisposableWrapperNodeIds: string[];
  temporaryWrappers: Array<{
    path: string;
    tagName: string;
    textStart: number;
    textEnd: number;
  }>;
  protectedSourceRanges: FormatSkeletonProtectedRange[];
  canonicalizeDom: boolean;
};

export type FormatSkeletonTransactionReplacement = {
  replacementIndex: number;
  inputIndex: number;
  editRange: {
    startOffset: number;
    endOffset: number;
    affinity: SourceAffinity;
  };
  finalRange: {
    startOffset: number;
    endOffset: number;
  };
  beforeText: string;
  nextText: string;
  deleteSegments: SourceTextSegment[];
  insertAt: SourceAnchor;
  inheritFormatFrom: {
    textOffset: number;
    affinity: SourceAffinity;
    wrapperNodeIds: string[];
    linkNodeId: string | null;
  };
};

export type FormatSkeletonTransactionPatchDescription = {
  version: 1;
  kind: "source-text-transaction";
  expectedSourceSha256: string;
  rootNodeId: string;
  replacements: FormatSkeletonTransactionReplacement[];
  preserveWrapperNodeIds: string[];
  removalEligibleWrapperNodeIds: string[];
  domMissingDisposableWrapperNodeIds: string[];
  temporaryWrappers: Array<{
    path: string;
    tagName: string;
    textStart: number;
    textEnd: number;
    replacementIndex: number;
  }>;
  protectedSourceRanges: FormatSkeletonProtectedRange[];
  canonicalizeDom: boolean;
};

export type FormatSkeletonValidation =
  | {
      ok: true;
      code: "FORMAT_SKELETON_VALID";
      reason: null;
      details: {
        finalTextLength: number;
        finalSelection: { anchor: number; focus: number } | null;
        canonicalizeDom: boolean;
      };
      patch: FormatSkeletonPatchDescription;
    }
  | {
      ok: false;
      code: string;
      reason: string;
      details: Record<string, unknown>;
      patch: null;
    };

export type FormatSkeletonTransactionValidation =
  | {
      ok: true;
      code: "FORMAT_SKELETON_TRANSACTION_VALID";
      reason: null;
      details: {
        finalTextLength: number;
        finalSelection: { anchor: number; focus: number } | null;
        replacementCount: number;
        canonicalizeDom: boolean;
      };
      patch: FormatSkeletonTransactionPatchDescription;
    }
  | {
      ok: false;
      code: string;
      reason: string;
      details: Record<string, unknown>;
      patch: null;
    };

export declare class FormatSkeletonError extends Error {
  code: string;
  details: Record<string, unknown>;
}

export declare function captureFormatSkeleton(
  index: {
    source: string;
    sourceSha256: string;
    byNodeId: Map<string, Record<string, unknown>>;
  },
  sourceMap: SourceTextMap,
  options: {
    root: Element;
    runtimeMap: RuntimeDomSourceMap;
    getComputedStyle?: (element: Element) => CSSStyleDeclaration | Record<string, string>;
  },
): FormatSkeleton;

export declare function validateFormatSkeletonEdit(
  skeleton: FormatSkeleton,
  options: {
    root: Element;
    runtimeMap?: RuntimeDomSourceMap;
    getComputedStyle?: (element: Element) => CSSStyleDeclaration | Record<string, string>;
    expectedSourceSha256?: string;
    editRange?: {
      startOffset: number;
      endOffset: number;
      affinity?: SourceAffinity;
    };
    finalSelection?: {
      anchor?: number;
      focus?: number;
      anchorOffset?: number;
      focusOffset?: number;
    };
    allowPlaceholderBreak?: boolean;
  },
): FormatSkeletonValidation;

export declare function validateFormatSkeletonTransaction(
  skeleton: FormatSkeleton,
  options: {
    root: Element;
    runtimeMap?: RuntimeDomSourceMap;
    getComputedStyle?: (element: Element) => CSSStyleDeclaration | Record<string, string>;
    expectedSourceSha256?: string;
    replacements: Array<{
      startOffset: number;
      endOffset: number;
      nextText: string;
      affinity?: SourceAffinity;
    }>;
    finalSelection?: {
      anchor?: number;
      focus?: number;
      anchorOffset?: number;
      focusOffset?: number;
    };
    allowPlaceholderBreak?: boolean;
  },
): FormatSkeletonTransactionValidation;

export declare function isDisposableFormatSkeletonWrapper(
  value: string | Record<string, unknown>,
): boolean;
