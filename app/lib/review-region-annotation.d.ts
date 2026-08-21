export type ReviewRegionRecord = {
  changeId?: string;
  summary?: string;
  tone?: string;
  labelCount?: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export type ReviewRegionAnnotation = {
  changeId: string;
  suspected: boolean;
  left: number;
  top: number;
  right: number;
  bottom: number;
  summary: string;
  detail: string;
  carrier: ReviewRegionRecord;
};

export function reviewRegionAnnotations(
  records: ReviewRegionRecord[],
  options?: { clusterGap?: number },
): ReviewRegionAnnotation[];
