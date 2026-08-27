import type {
  HtmlCanvasCommentLayoutState,
  HtmlCanvasSelection,
} from "../components/HtmlCanvasEditor";

export type CommentTargetLayout = HtmlCanvasCommentLayoutState["targets"][number];

export type CommentCanvasSnapshot = Readonly<{
  selection: HtmlCanvasSelection | null;
  layoutAuthority: Readonly<{
    sourceSha256: string;
    viewContextGeneration: number;
    targetIdsKey: string;
    ready: boolean;
    textEditing: boolean;
  }>;
  targetLayouts: Readonly<Record<string, CommentTargetLayout>>;
  canvasDocumentHeight: number;
  revealRequest: Readonly<{
    requestId: number;
    target: HtmlCanvasSelection;
    itemKey: string;
  }> | null;
  railResetRevision: number;
  composerFocusRevision: number;
}>;

export type CommentCanvasPort = Readonly<{
  getSnapshot: () => CommentCanvasSnapshot;
  subscribe: (listener: () => void) => () => void;
  setSelection: (selection: HtmlCanvasSelection | null) => void;
  publishLayout: (layout: HtmlCanvasCommentLayoutState) => void;
  resetLayout: () => void;
  requestReveal: (target: HtmlCanvasSelection, itemKey: string) => void;
  settleReveal: (requestId: number) => void;
  resetRail: () => void;
  requestComposerFocus: () => void;
}>;

export function createCommentCanvasPort(): CommentCanvasPort;
