export type ReviewBadgeRecord = {
  summary?: string;
  changeId?: string;
  labelPrimary?: boolean;
  labelCount?: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export function reviewBadgesCrowd(
  left: ReviewBadgeRecord,
  right: ReviewBadgeRecord,
  labelReach?: number,
): boolean;

export function reviewBadgeLabelText(summary?: string, count?: number): string;

export function aggregateReviewBadgeLabels<T extends ReviewBadgeRecord>(
  records: T[],
  options?: { focus?: string; labelReach?: number },
): T[];
