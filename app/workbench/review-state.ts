import type { ReviewFilter, ReviewPresentation, ReviewSide } from "./review-document";

export type ReviewPageView = "split" | ReviewSide;
export type ReviewChangeFilter = ReviewFilter;
export type ReviewScrollMode = "linked" | "independent";
export type ReviewZoomMode = "fit" | "actual";

export type ReviewState = {
  pageView: ReviewPageView;
  changeFilter: ReviewChangeFilter;
  contextVisibility: number;
  navigationTarget: string;
  pagePresentation: ReviewPresentation;
  scrollMode: ReviewScrollMode;
  zoomMode: ReviewZoomMode;
};

export type ReviewStateAction =
  | { type: "set-page-view"; value: ReviewPageView }
  | { type: "set-change-filter"; value: ReviewChangeFilter }
  | { type: "set-context-visibility"; value: number }
  | { type: "set-navigation-target"; value: string }
  | { type: "set-page-presentation"; value: ReviewPresentation }
  | { type: "set-scroll-mode"; value: ReviewScrollMode }
  | { type: "set-zoom-mode"; value: ReviewZoomMode };

export const DEFAULT_REVIEW_STATE: ReviewState = {
  pageView: "split",
  changeFilter: "all",
  contextVisibility: 18,
  navigationTarget: "all",
  pagePresentation: { before: [], after: [] },
  scrollMode: "linked",
  zoomMode: "actual",
};

export function reduceReviewState(
  state: ReviewState,
  action: ReviewStateAction,
): ReviewState {
  switch (action.type) {
    case "set-page-view":
      return state.pageView === action.value ? state : { ...state, pageView: action.value };
    case "set-change-filter":
      return state.changeFilter === action.value
        ? state
        : { ...state, changeFilter: action.value };
    case "set-context-visibility": {
      const nextVisibility = Math.round(Math.max(0, Math.min(100, action.value)));
      return state.contextVisibility === nextVisibility
        ? state
        : { ...state, contextVisibility: nextVisibility };
    }
    case "set-navigation-target":
      return state.navigationTarget === action.value
        ? state
        : { ...state, navigationTarget: action.value };
    case "set-page-presentation": {
      const normalize = (side: ReviewSide) => {
        const seen = new Set<string>();
        return action.value[side].filter((step) => {
          const key = step.kind === "panel" ? `panel:${step.key}` : `details:${step.stableId}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      };
      const value: ReviewPresentation = { before: normalize("before"), after: normalize("after") };
      const unchanged = (["before", "after"] as const).every((side) => (
        value[side].length === state.pagePresentation[side].length
        && value[side].every((step, index) => (
          JSON.stringify(step) === JSON.stringify(state.pagePresentation[side][index])
        ))
      ));
      return unchanged ? state : { ...state, pagePresentation: value };
    }
    case "set-scroll-mode":
      return state.scrollMode === action.value ? state : { ...state, scrollMode: action.value };
    case "set-zoom-mode":
      return state.zoomMode === action.value ? state : { ...state, zoomMode: action.value };
    default:
      return state;
  }
}
