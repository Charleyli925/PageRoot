import type { HtmlCanvasSelection } from "../components/HtmlCanvasEditor";

export type CommentCanvasSnapshot = Readonly<{
  selection: HtmlCanvasSelection | null;
}>;

export type CommentCanvasPort = Readonly<{
  getSnapshot: () => CommentCanvasSnapshot;
  subscribe: (listener: () => void) => () => void;
  setSelection: (selection: HtmlCanvasSelection | null) => void;
}>;

export function createCommentCanvasPort(): CommentCanvasPort;
