/**
 * Adjacent same-summary review badge aggregation.
 *
 * Every review overlay box may carry one summary label ("视觉调整", "新增内容"…)
 * anchored above its top-right corner. Because label chrome is counter-scaled to
 * stay a constant on-screen size, densely stacked same-kind changes crowd and
 * overlap each other and the content beneath, especially at "适应" zoom.
 *
 * This module collapses a cluster of adjacent, same-summary label-bearing boxes
 * into one representative badge that reads "{summary} ×N". It is geometry
 * preserving: it only decides which boxes render a label and the count each
 * label shows. It never merges different summaries, never links spatially
 * distant boxes, and never mutates footprints, masks, tones or box identity.
 *
 * The review canvas injects these functions into the projection iframe through
 * `${fn.toString()}`, where module-scope helpers do not exist. Each exported
 * function is therefore deliberately self-contained (no cross-references), so a
 * single toString() carries everything the iframe needs.
 */

/**
 * @typedef {Object} ReviewBadgeRecord
 * @property {string} [summary]
 * @property {string} [changeId]
 * @property {boolean} [labelPrimary]
 * @property {number} [labelCount]
 * @property {number} left
 * @property {number} top
 * @property {number} right
 * @property {number} bottom
 */

/**
 * Compose the visible badge text for a summary and its cluster count.
 * @param {string} [summary]
 * @param {number} [count]
 * @returns {string}
 */
export function reviewBadgeLabelText(summary, count) {
  const base = summary || "内容调整";
  return count > 1 ? base + " ×" + count : base;
}

/**
 * A box may already stand for several collapsed facts, so a cluster counts the
 * facts its members represent rather than the number of boxes.
 * @param {ReviewBadgeRecord} record
 * @returns {number}
 */
export function reviewBadgeFactCount(record) {
  const count = Number(record?.labelCount);
  return Number.isFinite(count) && count > 1 ? Math.trunc(count) : 1;
}

/**
 * Two same-summary boxes crowd when they sit in the same column and either
 * overlap vertically or fall within one badge's vertical reach.
 * @param {ReviewBadgeRecord} left
 * @param {ReviewBadgeRecord} right
 * @param {number} [labelReach]
 * @returns {boolean}
 */
export function reviewBadgesCrowd(left, right, labelReach) {
  const overlap = Math.max(
    0,
    Math.min(left.right, right.right) - Math.max(left.left, right.left),
  );
  const minimumWidth = Math.max(
    1,
    Math.min(left.right - left.left, right.right - right.left),
  );
  if (overlap / minimumWidth < 0.35) return false;
  const verticalOverlap = Math.max(
    0,
    Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top),
  );
  if (verticalOverlap > 0) return true;
  const verticalGap = Math.max(
    0,
    Math.max(left.top, right.top) - Math.min(left.bottom, right.bottom),
  );
  const reach = Number.isFinite(labelReach) && labelReach > 0 ? labelReach : 28;
  return verticalGap <= reach;
}

/**
 * Collapse adjacent same-summary badges. Returns a new array of shallow record
 * copies; clustered followers get labelPrimary=false, and the representative
 * carries labelCount=N. Records without a primary label or summary pass through.
 * Self-contained by design (see module note) — the crowd predicate is inlined.
 * @param {ReviewBadgeRecord[]} records
 * @param {{ focus?: string, labelReach?: number }} [options]
 * @returns {ReviewBadgeRecord[]}
 */
export function aggregateReviewBadgeLabels(records, options = {}) {
  const focus = options.focus && options.focus !== "all" ? options.focus : null;
  const labelReach = Number.isFinite(options.labelReach) && options.labelReach > 0
    ? options.labelReach
    : 28;
  const crowd = (left, right) => {
    const overlap = Math.max(
      0,
      Math.min(left.right, right.right) - Math.max(left.left, right.left),
    );
    const minimumWidth = Math.max(
      1,
      Math.min(left.right - left.left, right.right - right.left),
    );
    if (overlap / minimumWidth < 0.35) return false;
    const verticalOverlap = Math.max(
      0,
      Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top),
    );
    if (verticalOverlap > 0) return true;
    const verticalGap = Math.max(
      0,
      Math.max(left.top, right.top) - Math.min(left.bottom, right.bottom),
    );
    return verticalGap <= labelReach;
  };
  const next = records.map((record) => ({ ...record }));
  const eligible = [];
  next.forEach((record, index) => {
    if (record.labelPrimary !== false && record.summary) eligible.push(index);
  });
  const claimed = new Set();
  eligible.forEach((seedIndex) => {
    if (claimed.has(seedIndex)) return;
    const seed = next[seedIndex];
    const cluster = [seedIndex];
    claimed.add(seedIndex);
    let expanded = true;
    while (expanded) {
      expanded = false;
      for (const index of eligible) {
        if (claimed.has(index)) continue;
        if (next[index].summary !== seed.summary) continue;
        if (cluster.some((memberIndex) => crowd(next[memberIndex], next[index]))) {
          cluster.push(index);
          claimed.add(index);
          expanded = true;
        }
      }
    }
    if (cluster.length < 2) return;
    const factCount = cluster.reduce((total, index) => {
      const count = Number(next[index].labelCount);
      return total + (Number.isFinite(count) && count > 1 ? Math.trunc(count) : 1);
    }, 0);
    const focusedIndex = focus
      ? cluster.find((index) => next[index].changeId === focus)
      : undefined;
    const representativeIndex = focusedIndex !== undefined
      ? focusedIndex
      : cluster.slice().sort((left, right) => (
        next[left].top - next[right].top || next[left].left - next[right].left
      ))[0];
    cluster.forEach((index) => {
      if (index === representativeIndex) {
        next[index].labelCount = factCount;
      } else {
        next[index].labelPrimary = false;
        next[index].labelCount = 1;
      }
    });
  });
  return next;
}
