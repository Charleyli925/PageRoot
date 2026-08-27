import type {
  CommentAttachment,
  CommentEditSession,
} from "./types";
import type {
  CommentDraft,
  ComposerState,
} from "./comment-rail-contract";
import type { HtmlCanvasSelection } from "../components/HtmlCanvasEditor";

export function deriveComposerState(input: {
  relinkingTarget: string | null;
  editingCommentId: string | null;
  commentEditSession: CommentEditSession | null;
  commentEditDraft: string;
  commentEditAttachments: CommentAttachment[];
  composerOpen: boolean;
  draftTarget: HtmlCanvasSelection | null;
  draft: string;
  draftCommentId: string | null;
  draftAttachments: CommentAttachment[];
  hasCollapsedCommentDraft: boolean;
}): ComposerState;

export function composerViewFields(composer: ComposerState): {
  composerOpen: boolean;
  draftTarget: HtmlCanvasSelection | null;
  draft: string;
  draftCommentId: string | null;
  draftAttachments: CommentAttachment[];
  hasCollapsedCommentDraft: boolean;
  editingCommentId: string | null;
  commentEditSession: CommentEditSession | null;
  commentEditDraft: string;
  commentEditAttachments: CommentAttachment[];
  relinkingTarget: string | null;
};

export type { CommentDraft, ComposerState };
