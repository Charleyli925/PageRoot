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

export function reviewFocusOutlineIsUseful(geometry: {
  left: number;
  top: number;
  right: number;
  bottom: number;
  viewportWidth: number;
  viewportHeight: number;
  documentWidth: number;
  documentHeight: number;
}): boolean;

export function reviewTargetScrollTop(geometry: {
  scrollTop: number;
  rectTop: number;
  rectHeight: number;
  viewportHeight: number;
  maximumScrollTop: number;
}): number | null;
