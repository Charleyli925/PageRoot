import type {
  SourceAffinity,
  SourceAnchor,
  SourceTextSegment,
} from "./source-text-map";

export type DomSourceTextSpan = {
  domStart: number;
  domEnd: number;
  textNodeId: string;
  sourceStartOffset: number;
  sourceEndOffset: number;
};

export type RuntimeElementBinding = {
  kind: "element";
  runtimeId: string;
  sourceNodeId: string;
  targetRef: Record<string, unknown> | null;
};

export type RuntimeTextBinding = {
  kind: "text";
  runtimeId: string;
  spans: DomSourceTextSpan[];
  complete: boolean;
  emptyAnchor: SourceAnchor | null;
};

export declare class RuntimeDomSourceMapError extends Error {
  code: string;
  details: Record<string, unknown>;
}

export declare const RUNTIME_NODE_ATTRIBUTE: "data-pageroot-runtime-node";

export declare class RuntimeDomSourceMap {
  constructor(options?: { epoch?: string; idPrefix?: string });
  readonly epoch: string;
  createRuntimeId(): string;
  bindElement(
    node: Node,
    binding: { sourceNodeId: string; targetRef?: Record<string, unknown> | null },
    options?: { exposeAttribute?: boolean },
  ): string;
  bindText(
    node: Node,
    binding: { spans?: DomSourceTextSpan[]; emptyAnchor?: SourceAnchor | null },
  ): string;
  bindTextSequence(
    root: Node,
    entries: Array<{
      node: Node;
      spans?: DomSourceTextSpan[];
      emptyAnchor?: SourceAnchor | null;
    }>,
  ): string[];
  rebindRuntimeNode(
    runtimeId: string,
    nextNode: Node,
    nextBinding?: Record<string, unknown> | null,
  ): RuntimeElementBinding | RuntimeTextBinding;
  unbindNode(node: Node): boolean;
  bindingForNode(node: Node): RuntimeElementBinding | RuntimeTextBinding | null;
  runtimeIdForNode(node: Node): string | null;
  nodeForRuntimeId(runtimeId: string): Node | null;
  bindingForRuntimeId(runtimeId: string): RuntimeElementBinding | RuntimeTextBinding | null;
  domPointToSourceAnchor(
    node: Node,
    offset: number,
    affinity?: SourceAffinity,
  ): SourceAnchor;
  sourceAnchorToDomPoint(
    anchor: SourceAnchor,
    options?: { root?: Node | null },
  ): { node: Node; offset: number };
  domRangeToSource(
    root: Node,
    startNode: Node,
    startOffset: number,
    endNode: Node,
    endOffset: number,
  ): {
    collapsed: boolean;
    segments: SourceTextSegment[];
    insertAt: SourceAnchor;
  };
}
