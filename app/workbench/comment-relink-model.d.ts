import type { HtmlCanvasSelection } from "../components/HtmlCanvasEditor";
import type { CommentItem } from "./types";

export function canLocateTarget(target: HtmlCanvasSelection): boolean;

export function commentHasContent(
  comment: Pick<CommentItem, "text" | "attachments">,
): boolean;

export function unsafeRelinkComments(
  comments: readonly CommentItem[],
): CommentItem[];

export type RelinkNoticeCopy = {
  count: number;
  title: string;
  detail: string;
  actionLabel: string;
};

export function relinkNoticeCopy(
  comments: readonly CommentItem[],
): RelinkNoticeCopy;
