export type ReviewScrollSide = "before" | "after";

export type ReviewScrollAnchor = {
  id: string;
  top: number;
  height: number;
};

export type ReviewScrollGeometry = {
  viewportHeight: number;
  maximumScroll: number;
  revision: number;
  anchors: ReviewScrollAnchor[];
};

export type ReviewScrollDirection = {
  sourceMaximum: number;
  targetMaximum: number;
  points: Array<{ source: number; target: number }>;
};

export type ReviewScrollMap = {
  before: ReviewScrollDirection;
  after: ReviewScrollDirection;
  revision: string;
};

export type ReviewScrollPosition = {
  top: number;
  left: number;
  commandId?: string;
};

export type ReviewScrollCommand = {
  top: number;
  left: number;
  commandId: string;
  gestureId: number;
};

export type ReviewScrollOwner = {
  linked: boolean;
  leader: ReviewScrollSide | null;
  gestureId: number;
};

export type ReviewScrollCoordinatorOptions = {
  requestFrame: (callback: FrameRequestCallback) => number;
  cancelFrame: (handle: number) => void;
  setTimer: (callback: () => void, delay: number) => number;
  clearTimer: (handle: number) => void;
  now: () => number;
  applyFollower: (side: ReviewScrollSide, command: ReviewScrollCommand) => void;
  onOwnerChange?: (owner: ReviewScrollOwner) => void;
  gestureIdleMs?: number;
};

export function normalizeReviewScrollGeometry(value: unknown): ReviewScrollGeometry | null;
export function buildReviewScrollMap(
  before: ReviewScrollGeometry,
  after: ReviewScrollGeometry,
): ReviewScrollMap;
export function mapReviewScrollTop(
  map: ReviewScrollMap | null,
  sourceSide: ReviewScrollSide,
  top: number,
  fallbackMaximum?: number,
): number;

export class ReviewScrollCoordinator {
  constructor(options: ReviewScrollCoordinatorOptions);
  setLinked(linked: boolean): void;
  reset(): void;
  updateGeometry(side: ReviewScrollSide, rawGeometry: unknown): boolean;
  handleIntent(side: ReviewScrollSide): number;
  handlePosition(side: ReviewScrollSide, position: ReviewScrollPosition): void;
  snapshot(): {
    linked: boolean;
    leader: ReviewScrollSide | null;
    gestureId: number;
    mapRevision: string | null;
    positions: Record<ReviewScrollSide, { top: number; left: number }>;
  };
}
