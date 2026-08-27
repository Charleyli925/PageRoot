export type VersionReviewPlan =
  | Readonly<{ kind: "ready" }>
  | Readonly<{ kind: "reject"; code: string; reason: string }>;

export function planVersionPrepareReview(input?: {
  disposed?: boolean;
  ready?: boolean;
  baseHashOk?: boolean;
}): VersionReviewPlan;

export function planVersionActivate(input?: {
  disposed?: boolean;
  ready?: boolean;
  projectHydrating?: boolean;
}): VersionReviewPlan;
