export type PageViewTargetRef = Readonly<{
  targetId: string;
  label: string;
  level: "subregion";
  selector?: string;
  textQuote?: string;
  sourceAnchor?: Readonly<{
    startOffset: number;
    endOffset: number;
    sourceSha256: string;
  }>;
  fingerprint?: Readonly<{
    tagName: string;
    stableAttributes: Readonly<Record<string, string>>;
    ancestorFingerprint: readonly string[];
    textPrefix?: string;
    textSuffix?: string;
  }>;
  resolution: "exact" | "rebound" | "ambiguous" | "orphaned";
}>;

export type PagePresentationTargetRef = Readonly<{
  targetId: string;
  label: string;
  level: "module" | "subregion" | "insertion-point";
  selector?: string;
  textQuote?: string;
  sourceAnchor?: Readonly<{
    startOffset: number;
    endOffset: number;
    sourceSha256: string;
  }>;
  fingerprint?: Readonly<{
    tagName: string;
    stableAttributes: Readonly<Record<string, string>>;
    ancestorFingerprint: readonly string[];
    textPrefix?: string;
    textSuffix?: string;
  }>;
  resolution: "exact" | "rebound" | "ambiguous" | "orphaned";
}>;

export type PageViewContextEntry = Readonly<{
  targetRef: PageViewTargetRef;
  classAdd: readonly string[];
  classRemove: readonly string[];
  hidden?: boolean;
  open?: boolean;
  ariaSelected?: "true" | "false" | null;
  ariaExpanded?: "true" | "false" | null;
}>;

export type PageViewContextVisual = Readonly<
  | {
      targetRef: PageViewTargetRef;
      kind: "canvas-bitmap";
      width: number;
      height: number;
      dataUrl: string;
    }
  | {
      targetRef: PageViewTargetRef;
      kind: "table-body";
      html: string;
    }
>;

export type PageViewContext = Readonly<{
  protocol: "pageroot-page-view-context";
  version: 2;
  documentKey: string;
  generation: number;
  sourceSha256: string;
  entries: readonly PageViewContextEntry[];
  visuals: readonly PageViewContextVisual[];
}>;

export type PagePresentationAction = Readonly<{
  kind: "activate-tab" | "toggle-details" | "toggle-disclosure";
  label: "当前页签" | "切换到此页签" | "展开内容" | "收起内容";
  isCurrent: boolean;
  nextContext: PageViewContext | null;
}>;

export type RawPageViewSnapshot = {
  protocol: "pageroot-page-view-context";
  version: 2;
  sourceSha256: string;
  truncated?: boolean;
  entries: Array<{
    sourceNodeId: string;
    className: string;
    hidden: boolean;
    open: boolean;
    ariaSelected: string | null;
    ariaExpanded: string | null;
    display: string;
    visibility: string;
  }>;
  visuals?: Array<
    | {
        sourceNodeId: string;
        kind: "canvas-bitmap";
        width: number;
        height: number;
        dataUrl: string;
      }
    | {
        sourceNodeId: string;
        kind: "table-body";
        html: string;
      }
  >;
};

export const PAGE_VIEW_CONTEXT_PROTOCOL: "pageroot-page-view-context";
export const PAGE_VIEW_CONTEXT_VERSION: 2;

export function createPageViewContext(options?: {
  html?: string;
  documentKey?: string;
  generation?: number;
  snapshot?: RawPageViewSnapshot | null;
}): PageViewContext | null;

export function resolvePageViewContext(
  html: string,
  context: PageViewContext | null | undefined,
): {
  sourceIndex: unknown;
  entries: Array<{
    entry: PageViewContextEntry;
    sourceNodeId: string;
    resolution: "exact" | "rebound";
    sourceState: {
      classTokens: string[];
      hidden: boolean;
      open: boolean;
      ariaSelected: string | null;
      ariaExpanded: string | null;
    };
  }>;
  visuals: Array<{
    visual: PageViewContextVisual;
    sourceNodeId: string;
    resolution: "exact" | "rebound";
  }>;
};

export function createPagePresentationAction(options?: {
  html?: string;
  sourceIndex?: unknown;
  documentKey?: string;
  generation?: number;
  currentContext?: PageViewContext | null;
  targetRef?: PagePresentationTargetRef | null;
}): PagePresentationAction | null;
