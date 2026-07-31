export type SourceAffinity = "left" | "right";

export type SourceTextAnchor = {
  kind: "text";
  textNodeId: string;
  utf16Offset: number;
  affinity: SourceAffinity;
};

export type SourceChildBoundaryAnchor = {
  kind: "child-boundary";
  parentNodeId: string;
  beforeNodeId: string | null;
  affinity: SourceAffinity;
};

export type SourceAnchor = SourceTextAnchor | SourceChildBoundaryAnchor;

export type SourceTextSegment = {
  textNodeId: string;
  startOffset: number;
  endOffset: number;
};

export type SourceTextRun = {
  kind: "text";
  textNodeId: string;
  parentNodeId: string;
  text: string;
  sourceStart: number;
  sourceEnd: number;
  textStart: number;
  textEnd: number;
};

export type SourceBoundaryRun = {
  kind: "hard-break" | "structure";
  nodeId: string;
  parentNodeId: string;
  tagName: string | null;
  sourceStart: number;
  sourceEnd: number;
  textStart: number;
  textEnd: number;
  beforeAnchor: SourceChildBoundaryAnchor;
  afterAnchor: SourceChildBoundaryAnchor;
};

export type SourceInlineRange = {
  nodeId: string;
  parentNodeId: string;
  tagName: string;
  textStart: number;
  textEnd: number;
  beforeAnchor: SourceChildBoundaryAnchor;
  depth: number;
};

export type SourceTextMap = {
  sourceSha256: string;
  rootNodeId: string;
  rootTagName: string;
  resolution: "exact" | "rebound";
  textLength: number;
  text: string;
  startAnchor: SourceChildBoundaryAnchor;
  endAnchor: SourceChildBoundaryAnchor;
  runs: Array<SourceTextRun | SourceBoundaryRun>;
  inlineRanges: SourceInlineRange[];
  textRunCount: number;
  boundaryCount: number;
};

export declare class SourceTextMapError extends Error {
  code: string;
  details: Record<string, unknown>;
}

export declare const SOURCE_TEXT_HARD_BREAK: "\n";
export declare const SOURCE_TEXT_OBJECT: "\ufffc";

export declare function buildSourceTextMap(
  index: Record<string, unknown>,
  target: string | Record<string, unknown>,
  options?: { allowEmpty?: boolean; ignoreComments?: boolean },
): SourceTextMap;

export declare function textOffsetToSourceAnchor(
  map: SourceTextMap,
  offset: number,
  affinity?: SourceAffinity,
): SourceAnchor;

export declare function sourceAnchorToTextOffset(
  map: SourceTextMap,
  anchor: SourceAnchor,
): number;

export declare function textRangeToSourceSegments(
  map: SourceTextMap,
  startOffset: number,
  endOffset: number,
): SourceTextSegment[];

export declare function sourceSegmentsToTextRange(
  map: SourceTextMap,
  segments: readonly SourceTextSegment[],
): { startOffset: number; endOffset: number };

export declare function isTransparentSourceTextElement(tagName: unknown): boolean;
