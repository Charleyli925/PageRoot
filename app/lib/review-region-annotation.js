/**
 * Spatially clustered region annotation for AI review.
 *
 * The quiet-by-default annotation model draws one caption and one page-edge
 * revision bar per contiguous stretch of a change instead of one caption per
 * fact box. One logical change may touch places far apart on the page (a
 * document-wide text pass easily spans thousands of pixels), so captions and
 * bars follow the change's *spatial clusters*: records of one change whose
 * vertical extents sit within `clusterGap` of each other form one cluster,
 * and every cluster carries its own content-language caption, fact-count
 * detail and revision-bar interval. Navigation and the "变化区域" count stay
 * per change; clustering only shapes the canvas annotation.
 *
 * The review canvas injects these functions into the projection iframe through
 * `${fn.toString()}`, where module-scope helpers do not exist. Each exported
 * function is therefore deliberately self-contained (no cross-references), so a
 * single toString() carries everything the iframe needs.
 */

/**
 * @typedef {Object} ReviewRegionRecord
 * @property {string} [changeId]
 * @property {string} [summary]
 * @property {string} [tone]
 * @property {number} [labelCount]
 * @property {number} left
 * @property {number} top
 * @property {number} right
 * @property {number} bottom
 */

/**
 * @typedef {Object} ReviewRegionAnnotation
 * @property {string} changeId
 * @property {boolean} suspected
 * @property {number} left
 * @property {number} top
 * @property {number} right
 * @property {number} bottom
 * @property {string} summary
 * @property {string} detail
 * @property {ReviewRegionRecord} carrier
 */

/**
 * Group one page's fact records into per-change spatial clusters. Records keep
 * their own geometry; a cluster only aggregates what one caption and one
 * revision bar stand for. A record joins a cluster only when it is within
 * `clusterGap` in *both* axes: vertical adjacency alone merged side-by-side
 * grid columns into one region, which forced a single caption to speak for two
 * separate cards and anchored it on whichever card happened to be topmost.
 * The resting caption reads the cluster's distinct
 * fact kinds in reading order ("新增内容 · 视觉调整"), collapses three or more
 * kinds into "综合调整", and never carries a count. The focused caption spells
 * every kind with its fact count ("新增内容 ×3 · 视觉调整 ×2"). `carrier` is
 * the cluster's topmost-leftmost input record — the box that anchors the
 * caption.
 * @param {ReviewRegionRecord[]} records
 * @param {{ clusterGap?: number }} [options]
 * @returns {ReviewRegionAnnotation[]}
 */
export function reviewRegionAnnotations(records, options = {}) {
  const clusterGap = Number.isFinite(options.clusterGap) && options.clusterGap >= 0
    ? options.clusterGap
    : 28;
  const changes = new Map();
  (Array.isArray(records) ? records : []).forEach((record) => {
    if (!record || typeof record !== "object") return;
    const changeId = String(record.changeId || "");
    if (!changeId) return;
    const left = Number(record.left);
    const top = Number(record.top);
    const right = Number(record.right);
    const bottom = Number(record.bottom);
    if (
      !Number.isFinite(left) || !Number.isFinite(top)
      || !Number.isFinite(right) || !Number.isFinite(bottom)
    ) return;
    const group = changes.get(changeId) || [];
    group.push({ record, left, top, right, bottom });
    changes.set(changeId, group);
  });
  const clusters = [];
  changes.forEach((group, changeId) => {
    const ordered = group
      .slice()
      .sort((first, second) => first.top - second.top || first.left - second.left);
    const open = [];
    ordered.forEach((entry) => {
      // Prefer the cluster this record shares the most horizontal extent with,
      // so a wrapped paragraph keeps one caption while a neighbouring column
      // keeps its own.
      let best = null;
      let bestOverlap = -Infinity;
      open.forEach((cluster) => {
        if (entry.top - cluster.bottom > clusterGap) return;
        const overlap = Math.min(entry.right, cluster.right)
          - Math.max(entry.left, cluster.left);
        if (overlap < -clusterGap) return;
        if (overlap > bestOverlap) {
          bestOverlap = overlap;
          best = cluster;
        }
      });
      if (best) {
        best.left = Math.min(best.left, entry.left);
        best.right = Math.max(best.right, entry.right);
        best.bottom = Math.max(best.bottom, entry.bottom);
        best.entries.push(entry);
        return;
      }
      const cluster = {
        changeId,
        left: entry.left,
        top: entry.top,
        right: entry.right,
        bottom: entry.bottom,
        entries: [entry],
      };
      open.push(cluster);
      clusters.push(cluster);
    });
  });
  return clusters.map((cluster) => {
    const kinds = [];
    let suspected = false;
    let carrier = cluster.entries[0];
    cluster.entries.forEach((entry) => {
      suspected = suspected || entry.record.tone === "suspected";
      if (
        entry.top < carrier.top
        || (entry.top === carrier.top && entry.left < carrier.left)
      ) carrier = entry;
      const summary = String(entry.record.summary || "").trim() || "内容调整";
      const count = Number(entry.record.labelCount);
      const facts = Number.isFinite(count) && count > 1 ? Math.trunc(count) : 1;
      const kind = kinds.find((candidate) => candidate.summary === summary);
      if (kind) {
        kind.count += facts;
        kind.top = Math.min(kind.top, entry.top);
        kind.left = Math.min(kind.left, entry.left);
      } else {
        kinds.push({ summary, count: facts, top: entry.top, left: entry.left });
      }
    });
    kinds.sort((first, second) => first.top - second.top || first.left - second.left);
    const summary = kinds.length > 2
      ? "综合调整"
      : kinds.map((kind) => kind.summary).join(" · ") || "内容调整";
    const detail = kinds.map((kind) => (
      kind.count > 1 ? kind.summary + " ×" + kind.count : kind.summary
    )).join(" · ") || summary;
    return {
      changeId: cluster.changeId,
      suspected,
      left: cluster.left,
      top: cluster.top,
      right: cluster.right,
      bottom: cluster.bottom,
      summary,
      detail,
      carrier: carrier.record,
    };
  }).sort((first, second) => (
    first.top - second.top
    || first.left - second.left
    || first.changeId.localeCompare(second.changeId)
  ));
}
