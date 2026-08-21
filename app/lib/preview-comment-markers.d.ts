export type PreviewCommentItem = {
  text: string;
  attachmentCount: number;
};

export type PreviewCommentGroup = {
  key: string;
  nodeId: string;
  items: PreviewCommentItem[];
};

export type PreviewCommentMeasureTarget = {
  key: string;
  nodeId: string;
};

export type PreviewCommentLayout = {
  key: string;
  left: number;
  top: number;
};

export function previewCommentMarkerGroups(
  sourceIndex: unknown,
  comments: readonly unknown[],
): PreviewCommentGroup[];

export function previewCommentMeasureRequest(
  groups: readonly PreviewCommentGroup[],
): PreviewCommentMeasureTarget[];

export function safePreviewCommentLayouts(
  value: unknown,
  allowedKeys: ReadonlySet<string>,
): PreviewCommentLayout[];

export const MAX_PREVIEW_COMMENT_GROUPS: number;
export const MAX_PREVIEW_COMMENT_ITEMS: number;
