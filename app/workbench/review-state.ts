import type { ReviewFilter, ReviewSide } from "./review-document";

export type ReviewPageView = "split" | ReviewSide;
export type ReviewChangeFilter = ReviewFilter;
export type ReviewScrollMode = "linked" | "independent";
export type ReviewZoomMode = "fit" | "actual";

export type ReviewState = {
  pageView: ReviewPageView;
  changeFilter: ReviewChangeFilter;
  contextVisibility: number;
  navigationTarget: string;
  pagePresentationPath: string[];
  scrollMode: ReviewScrollMode;
  zoomMode: ReviewZoomMode;
};

export type ReviewStateAction =
  | { type: "set-page-view"; value: ReviewPageView }
  | { type: "set-change-filter"; value: ReviewChangeFilter }
  | { type: "set-context-visibility"; value: number }
  | { type: "set-navigation-target"; value: string }
  | { type: "set-page-presentation"; value: string[] }
  | { type: "set-scroll-mode"; value: ReviewScrollMode }
  | { type: "set-zoom-mode"; value: ReviewZoomMode };

export const DEFAULT_REVIEW_STATE: ReviewState = {
  pageView: "split",
  changeFilter: "all",
  contextVisibility: 18,
  navigationTarget: "all",
  pagePresentationPath: [],
  scrollMode: "linked",
  zoomMode: "fit",
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
      const value = [...new Set(action.value.filter(Boolean))];
      const unchanged = value.length === state.pagePresentationPath.length
        && value.every((item, index) => item === state.pagePresentationPath[index]);
      return unchanged ? state : { ...state, pagePresentationPath: value };
    }
    case "set-scroll-mode":
      return state.scrollMode === action.value ? state : { ...state, scrollMode: action.value };
    case "set-zoom-mode":
      return state.zoomMode === action.value ? state : { ...state, zoomMode: action.value };
    default:
      return state;
  }
}
