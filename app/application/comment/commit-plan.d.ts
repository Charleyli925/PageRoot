export type CommentCommitPlan =
  | Readonly<{ kind: "ready" }>
  | Readonly<{ kind: "reject"; code: string; reason: string }>;

export function planCommentCommit(input?: {
  disposed?: boolean;
  target?: { resolution?: string } | null;
  uploadCount?: number;
  text?: string;
  attachmentCount?: number;
}): CommentCommitPlan;
