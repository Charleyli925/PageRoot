const REVIEW_SIDES = ["before", "after"];
const DEFAULT_GESTURE_IDLE_MS = 140;
const CONTROL_POINT_EPSILON = 0.5;
const HORIZONTAL_SETTLE_EPSILON = 0.5;
const HORIZONTAL_BOUNDARY_EPSILON = 1;

function otherSide(side) {
  return side === "before" ? "after" : "before";
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function finiteNumber(value, fallback = 0) {
  return Number.isFinite(value) ? Number(value) : fallback;
}

/**
 * Keep the geometry boundary narrow: iframe measurements are untrusted message
 * payloads, and scroll mapping should never have to defend against malformed
 * numbers in its hot path.
 *
 * @param {unknown} value
 */
export function normalizeReviewScrollGeometry(value) {
  if (!value || typeof value !== "object") return null;
  const candidate = /** @type {Record<string, unknown>} */ (value);
  const viewportHeight = finiteNumber(candidate.viewportHeight, 0);
  const maximumScroll = finiteNumber(candidate.maximumScroll, -1);
  const revision = Math.max(0, Math.trunc(finiteNumber(candidate.revision, 0)));
  if (viewportHeight <= 0 || maximumScroll < 0 || !Array.isArray(candidate.anchors)) {
    return null;
  }

  const seen = new Set();
  const anchors = candidate.anchors.flatMap((rawAnchor) => {
    if (!rawAnchor || typeof rawAnchor !== "object") return [];
    const anchor = /** @type {Record<string, unknown>} */ (rawAnchor);
    const id = typeof anchor.id === "string"
      ? anchor.id.replace(/[^a-z0-9-]/giu, "")
      : "";
    const top = finiteNumber(anchor.top, -1);
    const height = finiteNumber(anchor.height, 0);
    if (
      !id
      || seen.has(id)
      || top < 0
      || height <= 0
      || top > 10_000_000
      || height > 10_000_000
    ) return [];
    seen.add(id);
    return [{ id, top, height }];
  });

  return {
    viewportHeight: Math.min(10_000_000, viewportHeight),
    maximumScroll: Math.min(10_000_000, maximumScroll),
    revision,
    anchors,
  };
}

/**
 * Find the largest set of shared semantic anchors whose order is stable on
 * both pages. Moved blocks remain reviewable, but are intentionally excluded
 * from scroll control points so one reordered section cannot fold the map
 * backwards.
 *
 * @param {import("./review-scroll-sync.js").ReviewScrollGeometry} source
 * @param {import("./review-scroll-sync.js").ReviewScrollGeometry} target
 */
function stableAnchorPairs(source, target) {
  const targetById = new Map(target.anchors.map((anchor, index) => [anchor.id, {
    anchor,
    index,
  }]));
  const candidates = source.anchors.flatMap((sourceAnchor) => {
    const match = targetById.get(sourceAnchor.id);
    return match ? [{ source: sourceAnchor, target: match.anchor, targetIndex: match.index }] : [];
  });
  if (candidates.length < 2) return candidates;

  const lengths = candidates.map(() => 1);
  const previous = candidates.map(() => -1);
  let bestIndex = 0;
  for (let index = 0; index < candidates.length; index += 1) {
    for (let prior = 0; prior < index; prior += 1) {
      if (
        candidates[prior].targetIndex < candidates[index].targetIndex
        && lengths[prior] + 1 > lengths[index]
      ) {
        lengths[index] = lengths[prior] + 1;
        previous[index] = prior;
      }
    }
    if (lengths[index] > lengths[bestIndex]) bestIndex = index;
  }

  const stable = [];
  for (let index = bestIndex; index >= 0; index = previous[index]) {
    stable.push(candidates[index]);
    if (previous[index] < 0) break;
  }
  return stable.reverse();
}

function anchorScrollTop(geometry, anchor, progress) {
  const referenceLine = geometry.viewportHeight / 3;
  return clamp(
    anchor.top + anchor.height * progress - referenceLine,
    0,
    geometry.maximumScroll,
  );
}

function appendControlPoint(points, source, target) {
  const prior = points.at(-1);
  if (!prior) {
    points.push({ source, target });
    return;
  }
  if (source <= prior.source + CONTROL_POINT_EPSILON) return;
  if (target < prior.target - CONTROL_POINT_EPSILON) return;
  points.push({ source, target: Math.max(prior.target, target) });
}

function buildDirection(source, target) {
  const points = [{ source: 0, target: 0 }];
  stableAnchorPairs(source, target).forEach((pair) => {
    appendControlPoint(
      points,
      anchorScrollTop(source, pair.source, 0),
      anchorScrollTop(target, pair.target, 0),
    );
    appendControlPoint(
      points,
      anchorScrollTop(source, pair.source, 1),
      anchorScrollTop(target, pair.target, 1),
    );
  });
  return {
    sourceMaximum: source.maximumScroll,
    targetMaximum: target.maximumScroll,
    points,
  };
}

/**
 * Build both directions independently. This keeps each direction monotonic
 * even when one document reaches a boundary before the other.
 *
 * @param {import("./review-scroll-sync.js").ReviewScrollGeometry} before
 * @param {import("./review-scroll-sync.js").ReviewScrollGeometry} after
 */
export function buildReviewScrollMap(before, after) {
  return {
    before: buildDirection(before, after),
    after: buildDirection(after, before),
    revision: `${before.revision}:${after.revision}`,
  };
}

function mapDirection(direction, rawTop) {
  const top = clamp(finiteNumber(rawTop, 0), 0, direction.sourceMaximum);
  const points = direction.points;
  for (let index = 1; index < points.length; index += 1) {
    const upper = points[index];
    if (top > upper.source) continue;
    const lower = points[index - 1];
    const progress = (top - lower.source) / Math.max(1, upper.source - lower.source);
    return clamp(
      lower.target + (upper.target - lower.target) * progress,
      0,
      direction.targetMaximum,
    );
  }
  const tail = points.at(-1) || { source: 0, target: 0 };
  return clamp(tail.target + top - tail.source, 0, direction.targetMaximum);
}

/**
 * @param {import("./review-scroll-sync.js").ReviewScrollMap | null} map
 * @param {import("./review-scroll-sync.js").ReviewScrollSide} sourceSide
 * @param {number} top
 * @param {number} [fallbackMaximum]
 */
export function mapReviewScrollTop(map, sourceSide, top, fallbackMaximum = Number.POSITIVE_INFINITY) {
  if (!map) return clamp(finiteNumber(top, 0), 0, fallbackMaximum);
  return mapDirection(map[sourceSide], top);
}

/**
 * Horizontal review scrolling lives on the pane viewport, so the follower has
 * to be told where to land. Boundaries match first: two pages with different
 * overflow widths must still agree on "fully left" and "fully right". Returns
 * null when the follower already sits on the target, which is how the echo of
 * an applied command stops instead of bouncing back to its source.
 *
 * @param {import("./review-scroll-sync.js").ReviewHorizontalFollowerInput} input
 */
export function followerReviewScrollLeft(input) {
  const sourceMaximum = Math.max(0, finiteNumber(input.sourceMaximum, 0));
  const followerMaximum = Math.max(0, finiteNumber(input.followerMaximum, 0));
  const sourceLeft = clamp(finiteNumber(input.sourceLeft, 0), 0, sourceMaximum);
  const followerLeft = clamp(finiteNumber(input.followerLeft, 0), 0, followerMaximum);
  const target = sourceLeft <= HORIZONTAL_BOUNDARY_EPSILON
    ? 0
    : sourceMaximum - sourceLeft <= HORIZONTAL_BOUNDARY_EPSILON
      ? followerMaximum
      : Math.min(sourceLeft, followerMaximum);
  return Math.abs(target - followerLeft) <= HORIZONTAL_SETTLE_EPSILON ? null : target;
}

/**
 * A wheel gesture latches onto the first scroller that can consume its combined
 * delta, so a mixed swipe over a vertically scrollable review frame keeps the
 * horizontal component inside the frame and drops it. The frame relays what it
 * cannot consume and the pane applies it here. `baseline` is the pane offset
 * recorded when the relay started: if the browser did chain the gesture out
 * natively the offset has already moved, and the relay is dropped rather than
 * applied a second time.
 *
 * @param {import("./review-scroll-sync.js").ReviewHorizontalRelayInput} input
 */
export function relayedReviewScrollLeft(input) {
  const maximum = Math.max(0, finiteNumber(input.maximum, 0));
  const baseline = clamp(finiteNumber(input.baseline, 0), 0, maximum);
  const current = clamp(finiteNumber(input.current, 0), 0, maximum);
  const delta = finiteNumber(input.delta, 0);
  if (!delta || Math.abs(current - baseline) > HORIZONTAL_SETTLE_EPSILON) return null;
  const target = clamp(baseline + delta, 0, maximum);
  return Math.abs(target - current) <= HORIZONTAL_SETTLE_EPSILON ? null : target;
}

/**
 * One owner, one command per animation frame. The coordinator deliberately has
 * no easing loop: the browser keeps native input/momentum on the leader, while
 * the follower consumes only the latest mapped position for that frame.
 */
export class ReviewScrollCoordinator {
  /** @param {import("./review-scroll-sync.js").ReviewScrollCoordinatorOptions} options */
  constructor(options) {
    this.requestFrame = options.requestFrame;
    this.cancelFrame = options.cancelFrame;
    this.setTimer = options.setTimer;
    this.clearTimer = options.clearTimer;
    this.now = options.now;
    this.applyFollower = options.applyFollower;
    this.onOwnerChange = options.onOwnerChange || (() => {});
    this.gestureIdleMs = options.gestureIdleMs || DEFAULT_GESTURE_IDLE_MS;
    this.linked = false;
    this.leader = null;
    this.gestureId = 0;
    this.commandSequence = 0;
    this.lastIntentAt = Number.NEGATIVE_INFINITY;
    this.activeUntil = Number.NEGATIVE_INFINITY;
    this.frameHandle = 0;
    this.idleTimer = null;
    this.takeoverOffset = 0;
    this.geometries = { before: null, after: null };
    this.pendingGeometries = { before: null, after: null };
    this.map = null;
    this.positions = {
      before: { top: 0, left: 0 },
      after: { top: 0, left: 0 },
    };
  }

  setLinked(linked) {
    const next = Boolean(linked);
    if (next === this.linked) return;
    this.linked = next;
    this.cancelPendingFrame();
    this.gestureId += 1;
    this.leader = null;
    this.takeoverOffset = 0;
    this.onOwnerChange({ linked: next, leader: null, gestureId: this.gestureId });
    if (!next) this.commitPendingGeometry();
  }

  reset() {
    this.cancelPendingFrame();
    if (this.idleTimer !== null) this.clearTimer(this.idleTimer);
    this.idleTimer = null;
    this.geometries = { before: null, after: null };
    this.pendingGeometries = { before: null, after: null };
    this.map = null;
    this.positions = {
      before: { top: 0, left: 0 },
      after: { top: 0, left: 0 },
    };
    this.leader = null;
    this.takeoverOffset = 0;
    this.gestureId += 1;
    this.onOwnerChange({ linked: this.linked, leader: null, gestureId: this.gestureId });
  }

  invalidateGesture() {
    this.cancelPendingFrame();
    if (this.idleTimer !== null) this.clearTimer(this.idleTimer);
    this.idleTimer = null;
    this.lastIntentAt = Number.NEGATIVE_INFINITY;
    this.activeUntil = Number.NEGATIVE_INFINITY;
    this.leader = null;
    this.takeoverOffset = 0;
    this.gestureId += 1;
    this.commitPendingGeometry();
    this.onOwnerChange({ linked: this.linked, leader: null, gestureId: this.gestureId });
    return this.gestureId;
  }

  /**
   * @param {import("./review-scroll-sync.js").ReviewScrollSide} side
   * @param {unknown} rawGeometry
   */
  updateGeometry(side, rawGeometry) {
    if (!REVIEW_SIDES.includes(side)) return false;
    const geometry = normalizeReviewScrollGeometry(rawGeometry);
    if (!geometry) return false;
    this.pendingGeometries[side] = geometry;
    if (this.now() >= this.activeUntil) this.commitPendingGeometry();
    else this.armIdleTimer();
    return true;
  }

  /** @param {import("./review-scroll-sync.js").ReviewScrollSide} side */
  handleIntent(side) {
    if (!this.linked || !REVIEW_SIDES.includes(side)) return this.gestureId;
    const now = this.now();
    const newGesture = this.leader !== side || now - this.lastIntentAt >= this.gestureIdleMs;
    this.lastIntentAt = now;
    this.activeUntil = now + this.gestureIdleMs;
    this.armIdleTimer();
    if (!newGesture) return this.gestureId;

    const hadLeader = this.leader !== null;
    this.cancelPendingFrame();
    this.leader = side;
    this.gestureId += 1;
    this.takeoverOffset = hadLeader
      ? this.positions[otherSide(side)].top - this.mappedTop(side, this.positions[side].top)
      : 0;
    this.onOwnerChange({ linked: true, leader: side, gestureId: this.gestureId });
    return this.gestureId;
  }

  /**
   * @param {import("./review-scroll-sync.js").ReviewScrollSide} side
   * @param {import("./review-scroll-sync.js").ReviewScrollPosition} position
   */
  handlePosition(side, position) {
    if (!REVIEW_SIDES.includes(side)) return;
    // A reported maximum can be short of reality: scrollbars change the layout
    // viewport and geometry is deliberately frozen for the duration of a
    // gesture. Record where the page actually is and let the mapping saturate,
    // otherwise the leader looks higher than it is and drags the follower
    // backwards at the page end.
    this.positions[side] = {
      top: Math.max(0, finiteNumber(position.top, 0)),
      left: Math.max(0, finiteNumber(position.left, 0)),
    };
    if (position.commandId || !this.linked) return;

    const now = this.now();
    if (this.leader !== side) {
      if (now < this.activeUntil) return;
      this.handleIntent(side);
    }
    if (this.leader !== side) return;
    this.activeUntil = now + this.gestureIdleMs;
    this.armIdleTimer();

    if (!this.frameHandle) {
      const gestureId = this.gestureId;
      this.frameHandle = this.requestFrame(() => this.flushFrame(gestureId));
    }
  }

  snapshot() {
    return {
      linked: this.linked,
      leader: this.leader,
      gestureId: this.gestureId,
      mapRevision: this.map?.revision || null,
      positions: {
        before: { ...this.positions.before },
        after: { ...this.positions.after },
      },
    };
  }

  mappedTop(sourceSide, top) {
    const follower = otherSide(sourceSide);
    const fallbackMaximum = (
      this.geometries[follower]
      || this.pendingGeometries[follower]
    )?.maximumScroll ?? Number.POSITIVE_INFINITY;
    return mapReviewScrollTop(this.map, sourceSide, top, fallbackMaximum);
  }

  flushFrame(gestureId) {
    this.frameHandle = 0;
    if (!this.linked || gestureId !== this.gestureId || !this.leader) return;
    const source = this.leader;
    const follower = otherSide(source);
    const followerMaximum = (
      this.geometries[follower]
      || this.pendingGeometries[follower]
    )?.maximumScroll ?? Number.POSITIVE_INFINITY;
    const top = clamp(
      this.mappedTop(source, this.positions[source].top) + this.takeoverOffset,
      0,
      Math.max(followerMaximum, this.positions[follower].top),
    );
    const commandId = `review-scroll-${gestureId}-${++this.commandSequence}`;
    this.positions[follower] = { top, left: this.positions[source].left };
    this.applyFollower(follower, {
      top,
      left: this.positions[source].left,
      commandId,
      gestureId,
    });
  }

  cancelPendingFrame() {
    if (!this.frameHandle) return;
    this.cancelFrame(this.frameHandle);
    this.frameHandle = 0;
  }

  armIdleTimer() {
    if (this.idleTimer !== null) this.clearTimer(this.idleTimer);
    const delay = Math.max(0, this.activeUntil - this.now());
    this.idleTimer = this.setTimer(() => {
      this.idleTimer = null;
      if (this.now() < this.activeUntil) {
        this.armIdleTimer();
        return;
      }
      this.commitPendingGeometry();
      this.takeoverOffset = 0;
    }, delay);
  }

  commitPendingGeometry() {
    REVIEW_SIDES.forEach((side) => {
      if (this.pendingGeometries[side]) {
        this.geometries[side] = this.pendingGeometries[side];
        this.pendingGeometries[side] = null;
      }
    });
    if (this.geometries.before && this.geometries.after) {
      this.map = buildReviewScrollMap(this.geometries.before, this.geometries.after);
    }
  }
}
