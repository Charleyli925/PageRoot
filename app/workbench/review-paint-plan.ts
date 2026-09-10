import type {
  ReviewChange,
  ReviewFocusGroup,
  ReviewSide,
} from "./review-document";
import type { ReviewFocusRegionSelection } from "./review-state";
import type { ReviewVisualVerdict } from "./review/review-visual-model.js";

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

function groupHasConfirmedVisualChange(
  group: ReviewFocusGroup,
  changes: readonly ReviewChange[],
  verdicts: Readonly<Record<string, ReviewVisualVerdict>>,
) {
  return changes.some((change) => (
    group.changeIds.includes(change.id)
    && (change.evidenceStableIds || []).some((stableId) => verdicts[stableId] === "changed")
  ));
}

export function buildReviewPaintPlan({
  focusGroups,
  changes,
  visualVerdicts,
  activeFocusGroupId,
  activeFocusRegionIds,
}: Readonly<{
  focusGroups: readonly ReviewFocusGroup[];
  changes: readonly ReviewChange[];
  visualVerdicts: Readonly<Record<string, ReviewVisualVerdict>>;
  activeFocusGroupId: string | null;
  activeFocusRegionIds: ReviewFocusRegionSelection;
}>): ReviewPaintPlan {
  if (!activeFocusGroupId) return EMPTY_REVIEW_PAINT_PLAN;
  const group = focusGroups.find((candidate) => candidate.id === activeFocusGroupId);
  if (!group) return EMPTY_REVIEW_PAINT_PLAN;

  const outlineAllowed = group.focusOutlinePolicy === "source-change"
    || (group.focusOutlinePolicy === "visual-change"
      && groupHasConfirmedVisualChange(group, changes, visualVerdicts));
  const sidePlan = (side: ReviewSide): ReviewPaintPlanSide => {
    const regionId = activeFocusRegionIds[side];
    if (!regionId || !group.regions[side].some((region) => region.id === regionId)) {
      return EMPTY_SIDE;
    }
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
