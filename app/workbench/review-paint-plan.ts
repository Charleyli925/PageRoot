import type {
  ReviewChange,
  ReviewFocusGroup,
  ReviewSide,
} from "./review-document";
import type { ReviewFocusRegionSelection } from "./review-state";
import type { ReviewVisualVerdict } from "./review/review-visual-model.js";
import type { SourceEvidence } from "./review/review-visual-model.js";

export type ReviewPaintPlanSide = Readonly<{
  evidenceMarks: "all-source-facts";
  navigationCues: "all-regions";
  contextMask: Readonly<{ regionId: string }> | null;
  focusOutline: Readonly<{ regionId: string }> | null;
}>;

export type ReviewPaintPlan = Readonly<Record<ReviewSide, ReviewPaintPlanSide>>;

const EMPTY_SIDE: ReviewPaintPlanSide = Object.freeze({
  evidenceMarks: "all-source-facts",
  navigationCues: "all-regions",
  contextMask: null,
  focusOutline: null,
});

export const EMPTY_REVIEW_PAINT_PLAN: ReviewPaintPlan = Object.freeze({
  before: EMPTY_SIDE,
  after: EMPTY_SIDE,
});

function regionHasConfirmedVisualChange(
  region: ReviewFocusGroup["regions"][ReviewSide][number],
  changes: readonly ReviewChange[],
  visualEvidence: readonly SourceEvidence[],
  verdicts: Readonly<Record<string, ReviewVisualVerdict>>,
) {
  return region.visualEvidenceStableIds.some((stableId) => {
    if (verdicts[stableId] !== "changed") return false;
    const sourceCandidate = visualEvidence.find((evidence) => evidence.stableId === stableId);
    // A mixed text/attribute candidate cannot prove that this locality's style
    // changed. Failing closed may omit a box, but never borrows unrelated proof.
    if (!sourceCandidate?.kinds.length
      || sourceCandidate.kinds.some((kind) => kind !== "style")) return false;
    return changes.some((change) => (
      region.changeIds.includes(change.id)
      && (change.evidenceStableIds || []).includes(stableId)
    ));
  });
}

export function buildReviewPaintPlan({
  focusGroups,
  changes,
  visualEvidence,
  visualVerdicts,
  activeFocusGroupId,
  activeFocusRegionIds,
}: Readonly<{
  focusGroups: readonly ReviewFocusGroup[];
  changes: readonly ReviewChange[];
  visualEvidence: readonly SourceEvidence[];
  visualVerdicts: Readonly<Record<string, ReviewVisualVerdict>>;
  activeFocusGroupId: string | null;
  activeFocusRegionIds: ReviewFocusRegionSelection;
}>): ReviewPaintPlan {
  if (!activeFocusGroupId) return EMPTY_REVIEW_PAINT_PLAN;
  const group = focusGroups.find((candidate) => candidate.id === activeFocusGroupId);
  if (!group) return EMPTY_REVIEW_PAINT_PLAN;

  const sidePlan = (side: ReviewSide): ReviewPaintPlanSide => {
    const regionId = activeFocusRegionIds[side];
    const region = group.regions[side].find((candidate) => candidate.id === regionId);
    if (!regionId || !region) {
      return EMPTY_SIDE;
    }
    const outlineAllowed = group.focusOutlinePolicy === "source-change"
      || (group.focusOutlinePolicy === "visual-change"
        && regionHasConfirmedVisualChange(region, changes, visualEvidence, visualVerdicts));
    const target = Object.freeze({ regionId });
    return Object.freeze({
      evidenceMarks: "all-source-facts",
      navigationCues: "all-regions",
      contextMask: target,
      focusOutline: outlineAllowed ? target : null,
    });
  };

  return Object.freeze({
    before: sidePlan("before"),
    after: sidePlan("after"),
  });
}
