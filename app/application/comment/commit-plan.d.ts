export type CommentCommitPlan =
  | Readonly<{ kind: "ready" }>
  | Readonly<{ kind: "reject"; code: string; reason: string }>;

export function isSavableCommentTarget(target?: {
  resolution?: string;
  elementId?: string;
  selector?: string;
  level?: string;
} | null): boolean;

export function planCommentCommit(input?: {
  disposed?: boolean;
  target?: {
    resolution?: string;
    elementId?: string;
    selector?: string;
    level?: string;
  } | null;
  uploadCount?: number;
  text?: string;
  attachmentCount?: number;
}): CommentCommitPlan;
