import type { ClipboardEvent, RefObject } from "react";

import type {
  HtmlCanvasCommentLayoutState,
  HtmlCanvasSelection,
} from "../components/HtmlCanvasEditor";
import type { RelinkNoticeCopy } from "./comment-relink-model.js";
import type {
  CommentAttachment,
  CommentEditSession,
  CommentItem,
  DirectEditEvent,
  OtherTabCommentEntry,
  CanvasMode,
} from "./types";

export type OtherTabCommentGroup = {
  key: string;
  label: string;
  entries: OtherTabCommentEntry[];
};

export type CommentAttachmentTarget = {
  kind: "composer" | "comment";
  commentId: string;
};

export type CommentDraft = {
  text: string;
  commentId: string | null;
  attachments: CommentAttachment[];
  target: HtmlCanvasSelection | null;
};

export type ComposerState =
  | { kind: "closed"; collapsedDraft: CommentDraft | null }
  | { kind: "new"; target: HtmlCanvasSelection; draft: CommentDraft }
  | {
    kind: "editing";
    commentId: string;
    draft: CommentDraft;
    session: CommentEditSession;
  }
  | { kind: "relinking"; commentId: string };

export type CommentRailModel = {
  composer: ComposerState;
  commentsPanelRef: RefObject<HTMLElement | null>;
  commentsHeaderRef: RefObject<HTMLElement | null>;
  composerRef: RefObject<HTMLTextAreaElement | null>;
  commentEditRef: RefObject<HTMLTextAreaElement | null>;
  viewMode: "current" | "history";
  commentLayoutReady: boolean;
  commentLayoutAuthority: {
    viewContextGeneration: number;
    textEditing: boolean;
  };
  commentRailMinimumOffset: number;
  commentRailFollowsFocus: boolean;
  canvasDocumentHeight: number;
  commentRailContentHeight: number;
  commentRailOffset: number;
  commentRailMinimumTop: number;
  visibleCommentItems: CommentItem[];
  draftInCurrentTab: boolean;
  hasUnsavedCommentEdit: boolean;
  otherTabCommentEntryCount: number;
  otherTabCommentsContextKey: string;
  otherTabCommentsOpen: boolean;
  interactionLocked: boolean;
  unfinishedEditedComment: CommentItem | null | undefined;
  otherTabCommentGroups: OtherTabCommentGroup[];
  activeCommentCount: number;
  changeEvents: DirectEditEvent[];
  composerInCurrentTab: boolean;
  composerTop: number | undefined;
  focusedCommentId: string | null;
  relinkRailCardVisible: boolean;
  relinkCardCopy: RelinkNoticeCopy;
  relinkCardActive: boolean;
  projectLoadError: string | null | undefined;
  draftTargetScope: string;
  attachmentUploadCount: number;
  draftTargetCanSave: boolean;
  composerMeasurementKey: string;
  attachmentObjectUrls: Record<string, string>;
  pendingDeleteCommentId: string | null;
  draftRecoveryTop: number | undefined;
  draftRecoveryMeasurementKey: string;
  expectedCommentLayoutTargetIds: string[];
  sortedVisibleCommentItems: CommentItem[];
  renderedVisibleCommentItems: CommentItem[];
  commentTargetLayouts: Record<string, HtmlCanvasCommentLayoutState["targets"][number]>;
  selection: HtmlCanvasSelection | null;
  commentMeasurementKeys: Record<string, string | undefined>;
  visibleCommentPositions: Record<string, number | undefined>;
};

export type CommentRailContainerContext = {
  reviewStageRef: RefObject<HTMLDivElement | null>;
  canvasMode: CanvasMode;
  viewMode: "current" | "history";
  expectedCommentLayoutSourceSha256: string;
  activePageViewGeneration: number;
  visibleCommentItems: CommentItem[];
  activeCommentCount: number;
  changeEvents: DirectEditEvent[];
  interactionLocked: boolean;
  unfinishedEditedComment: CommentItem | null | undefined;
  unsafeRelinkCommentItems: CommentItem[];
  projectLoadError: string | null | undefined;
  otherTabCommentsContextKey: string;
  attachmentObjectUrls: Record<string, string>;
};

export type CommentRailActions = {
  openGlobalCommentComposer: () => void;
  resumeCurrentComposer: () => void;
  resumeCommentEdit: (commentId: string) => void;
  toggleOtherTabComments: () => void;
  collapseOtherTabComments: () => void;
  hideCommentComposer: () => void;
  requestDeleteComment: (commentId: string) => void;
  clearDeleteRequest: () => void;
  focusCommentTarget: (target: HtmlCanvasSelection, commentId: string) => void;
  startUnsafeTargetRelink: () => void;
  cancelTargetRelink: () => void;
  onRetryProjectHydration: () => void;
  closeCommentComposer: () => void;
  beginTargetRelink: (itemId: string) => void;
  updateDraft: (value: string) => void;
  onComposerPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
  commit: () => void | Promise<void>;
  ensureAttachmentObjectUrl: (attachment: CommentAttachment) => Promise<string> | void;
  openAttachmentPreview: (attachment: CommentAttachment) => void | Promise<void>;
  downloadAttachment: (attachment: CommentAttachment) => void | Promise<void>;
  removeComposerAttachment: (attachment: CommentAttachment) => void;
  discardCurrentComposer: () => void;
  openAttachmentPicker: (
    target: CommentAttachmentTarget,
    accept?: "all" | "image",
  ) => void;
  commentTargetIsLocatable: (target: HtmlCanvasSelection) => boolean;
  updateCommentEditDraft: (value: string) => void;
  cancelCommentEdit: () => void;
  confirmEdit: (commentId: string) => void;
  pasteImages: (
    event: ClipboardEvent<HTMLTextAreaElement>,
    target: CommentAttachmentTarget,
  ) => void;
  removeCommentAttachment: (commentId: string, attachment: CommentAttachment) => void;
  queueReviewCommentFocus: (target: HtmlCanvasSelection, commentId: string) => void;
  deleteComment: (commentId: string) => void;
  beginEdit: (comment: CommentItem, focusText?: boolean) => boolean;
};

export type CommentRailHostActions = Omit<
  CommentRailActions,
  | "toggleOtherTabComments"
  | "collapseOtherTabComments"
  | "requestDeleteComment"
  | "clearDeleteRequest"
  | "hideCommentComposer"
> & {
  uploadAttachments: (
    files: File[],
    target: CommentAttachmentTarget,
    source: "clipboard" | "file-picker",
  ) => void | Promise<void>;
};

export {
  composerViewFields,
  deriveComposerState,
} from "./comment-rail-state.js";
