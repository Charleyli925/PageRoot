export const REVIEW_TEXT_EVIDENCE_REMOVED_COLOR: "#c74f4a";
export const REVIEW_TEXT_EVIDENCE_ADDED_COLOR: "#239b56";
export const REVIEW_TEXT_EVIDENCE_MARKER_CSS: string;

export type ReviewTextEvidenceUnit = {
  start: number;
  end: number;
};

export type ReviewTextEvidenceRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export type ReviewTextEvidenceMarkGeometry = {
  centerX: number;
  glyphTop: number;
  glyphBottom: number;
  strikeY: number;
  strikeLeft: number;
  strikeRight: number;
  strikeThickness: number;
  visibleDash: number;
  visibleGap: number;
  dash: number;
  gap: number;
  dotX: number;
  dotY: number;
  dotRadius: number;
  em: number;
  addedClearance: number;
};

export type ReviewTextEvidenceDot = {
  x: number;
  y: number;
  radius: number;
  em: number;
};

export function reviewTextEvidenceMarkerBlocks(css: string): Array<{
  tone: "added" | "removed";
  declarations: Array<{ property: string; value: string }>;
}>;
export function reviewTextEvidenceStyleViolations(css: string): string[];
export function reviewTextEvidenceGraphemeEnd(value: string, start: number): number;
export function reviewTextEvidenceIsWhitespaceCode(code: number): boolean;
export function reviewTextEvidenceIsPunctuationCode(code: number): boolean;
export function reviewTextEvidenceUnits(value: string): ReviewTextEvidenceUnit[];
export function alignReviewTextEvidenceDotRows<T extends ReviewTextEvidenceDot>(
  dots: T[],
): T[];
export function reviewTextEvidenceMarkGeometry(
  rect: ReviewTextEvidenceRect,
  fontSize: number,
  scale?: number,
): ReviewTextEvidenceMarkGeometry;
