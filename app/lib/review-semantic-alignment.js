import { reviewTextSimilarity } from "./review-text-diff.js";

export const REVIEW_SEMANTIC_ALIGNMENT_MATRIX_BUDGET = 60_000;

const DEFAULT_LOOKAHEAD = 32;
const SCORE_EPSILON = 1e-6;

function normalizedText(unit) {
  return String(unit.text || "").replace(/\s+/gu, " ").trim();
}

function normalizedParent(unit) {
  return String(unit.parentKey || "").trim();
}

function identityKey(unit) {
  const stableId = String(unit.stableId || "").trim();
  return stableId
    ? `${normalizedParent(unit)}\u0000${unit.kind}\u0000${stableId}`
    : null;
}

function exactKey(unit) {
  const signature = String(unit.exactSignature || normalizedText(unit)).trim();
  return signature
    ? `${normalizedParent(unit)}\u0000${unit.kind}\u0000${signature}`
    : null;
}

function uniqueIndexes(items, keyForUnit, excluded = new Set()) {
  const indexes = new Map();
  items.forEach((unit, index) => {
    if (excluded.has(index)) return;
    const key = keyForUnit(unit);
    if (!key) return;
    indexes.set(key, indexes.has(key) ? null : index);
  });
  return indexes;
}

function collectStrongPairs(before, after) {
  const pairs = [];
  const usedBefore = new Set();
  const usedAfter = new Set();
  const collect = (keyForUnit, match) => {
    const beforeIndexes = uniqueIndexes(before, keyForUnit, usedBefore);
    const afterIndexes = uniqueIndexes(after, keyForUnit, usedAfter);
    beforeIndexes.forEach((beforeIndex, key) => {
      const afterIndex = afterIndexes.get(key);
      if (beforeIndex === null || afterIndex === null || afterIndex === undefined) return;
      usedBefore.add(beforeIndex);
      usedAfter.add(afterIndex);
      pairs.push({ beforeIndex, afterIndex, match, moved: false });
    });
  };
  collect(identityKey, "stable-id");
  collect(exactKey, "exact-signature");
  return { pairs, usedBefore, usedAfter };
}

function longestIncreasingPairSet(pairs) {
  const ordered = [...pairs].sort((left, right) => (
    left.beforeIndex - right.beforeIndex || left.afterIndex - right.afterIndex
  ));
  if (!ordered.length) return new Set();
  const tails = [];
  const tailIndexes = [];
  const previous = new Int32Array(ordered.length).fill(-1);
  ordered.forEach((pair, index) => {
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (tails[middle] < pair.afterIndex) low = middle + 1;
      else high = middle;
    }
    if (low > 0) previous[index] = tailIndexes[low - 1];
    tails[low] = pair.afterIndex;
    tailIndexes[low] = index;
  });
  const selected = new Set();
  let cursor = tailIndexes[tails.length - 1];
  while (cursor >= 0) {
    selected.add(ordered[cursor]);
    cursor = previous[cursor];
  }
  return selected;
}

function markMovedStrongPairs(pairs) {
  const stableOrder = longestIncreasingPairSet(pairs);
  pairs.forEach((pair) => {
    pair.moved = !stableOrder.has(pair);
  });
  return pairs;
}

function sharedAffinityCount(before, after) {
  const beforeAffinities = new Set(before.affinities || []);
  return (after.affinities || []).filter((value) => beforeAffinities.has(value)).length;
}

function stableBoundaryAffinity(beforeText, afterText) {
  const beforeCharacters = [...beforeText];
  const afterCharacters = [...afterText];
  const shorterLength = Math.min(beforeCharacters.length, afterCharacters.length);
  if (!shorterLength) return 0;
  let prefix = 0;
  while (
    prefix < shorterLength
    && beforeCharacters[prefix] === afterCharacters[prefix]
  ) prefix += 1;
  let suffix = 0;
  while (
    prefix + suffix < shorterLength
    && beforeCharacters[beforeCharacters.length - suffix - 1]
      === afterCharacters[afterCharacters.length - suffix - 1]
  ) suffix += 1;
  const required = Math.min(shorterLength, Math.max(4, Math.ceil(shorterLength * 0.55)));
  const stableSingleBoundary = Math.max(prefix, suffix) >= required;
  const stablePairedBoundaries = prefix >= 2
    && suffix >= 2
    && prefix + suffix >= required;
  return stableSingleBoundary || stablePairedBoundaries
    ? (prefix + suffix) / shorterLength
    : 0;
}

function weightedPairScore(before, after) {
  if (before.kind !== after.kind) return Number.NEGATIVE_INFINITY;
  if (normalizedParent(before) !== normalizedParent(after)) return Number.NEGATIVE_INFINITY;
  if (identityKey(before) || identityKey(after)) return Number.NEGATIVE_INFINITY;
  const beforeText = normalizedText(before);
  const afterText = normalizedText(after);
  if (!beforeText || !afterText) return Number.NEGATIVE_INFINITY;
  const exact = beforeText === afterText;
  const similarity = reviewTextSimilarity(beforeText, afterText);
  const boundaryAffinity = stableBoundaryAffinity(beforeText, afterText);
  const sharedAffinities = sharedAffinityCount(before, after);
  if (
    !exact
    && similarity < 0.52
    && boundaryAffinity === 0
    && !(sharedAffinities > 0 && similarity >= 0.28)
  ) {
    return Number.NEGATIVE_INFINITY;
  }
  return (exact ? 420 : 0)
    + Math.round(Math.max(similarity, boundaryAffinity) * 180)
    + Math.min(72, sharedAffinities * 24);
}

function uniqueBestCandidates(before, after) {
  const scores = Array.from({ length: before.length }, () => new Float64Array(after.length));
  const beforeBest = Array.from({ length: before.length }, () => ({ score: Number.NEGATIVE_INFINITY, count: 0 }));
  const afterBest = Array.from({ length: after.length }, () => ({ score: Number.NEGATIVE_INFINITY, count: 0 }));
  before.forEach((beforeUnit, beforeIndex) => {
    after.forEach((afterUnit, afterIndex) => {
      const score = weightedPairScore(beforeUnit, afterUnit);
      scores[beforeIndex][afterIndex] = score;
      if (!Number.isFinite(score)) return;
      const beforeState = beforeBest[beforeIndex];
      if (score > beforeState.score + SCORE_EPSILON) {
        beforeState.score = score;
        beforeState.count = 1;
      } else if (Math.abs(score - beforeState.score) <= SCORE_EPSILON) {
        beforeState.count += 1;
      }
      const afterState = afterBest[afterIndex];
      if (score > afterState.score + SCORE_EPSILON) {
        afterState.score = score;
        afterState.count = 1;
      } else if (Math.abs(score - afterState.score) <= SCORE_EPSILON) {
        afterState.count += 1;
      }
    });
  });
  return (beforeIndex, afterIndex) => {
    const score = scores[beforeIndex]?.[afterIndex] ?? Number.NEGATIVE_INFINITY;
    return Number.isFinite(score)
      && beforeBest[beforeIndex].count === 1
      && afterBest[afterIndex].count === 1
      && Math.abs(score - beforeBest[beforeIndex].score) <= SCORE_EPSILON
      && Math.abs(score - afterBest[afterIndex].score) <= SCORE_EPSILON
      ? score
      : Number.NEGATIVE_INFINITY;
  };
}

function matrixIntervalPairs(before, after, beforeIndexes, afterIndexes) {
  const beforeUnits = beforeIndexes.map((index) => before[index]);
  const afterUnits = afterIndexes.map((index) => after[index]);
  const candidateScore = uniqueBestCandidates(beforeUnits, afterUnits);
  const columnCount = afterUnits.length + 1;
  const scores = new Float64Array((beforeUnits.length + 1) * columnCount);
  const decisions = new Uint8Array(beforeUnits.length * Math.max(1, afterUnits.length));
  const scoreAt = (beforeIndex, afterIndex) => scores[beforeIndex * columnCount + afterIndex];
  for (let beforeIndex = beforeUnits.length - 1; beforeIndex >= 0; beforeIndex -= 1) {
    for (let afterIndex = afterUnits.length - 1; afterIndex >= 0; afterIndex -= 1) {
      const skipBefore = scoreAt(beforeIndex + 1, afterIndex);
      const skipAfter = scoreAt(beforeIndex, afterIndex + 1);
      const pairScore = candidateScore(beforeIndex, afterIndex);
      const match = Number.isFinite(pairScore)
        ? pairScore + scoreAt(beforeIndex + 1, afterIndex + 1)
        : Number.NEGATIVE_INFINITY;
      let decision = skipBefore > skipAfter + SCORE_EPSILON ? 1 : 2;
      let best = decision === 1 ? skipBefore : skipAfter;
      if (match > best + SCORE_EPSILON) {
        decision = 3;
        best = match;
      }
      scores[beforeIndex * columnCount + afterIndex] = best;
      decisions[beforeIndex * Math.max(1, afterUnits.length) + afterIndex] = decision;
    }
  }
  const pairs = [];
  let beforeIndex = 0;
  let afterIndex = 0;
  while (beforeIndex < beforeUnits.length || afterIndex < afterUnits.length) {
    if (beforeIndex >= beforeUnits.length) {
      pairs.push({ beforeIndex: null, afterIndex: afterIndexes[afterIndex], match: "unmatched", moved: false });
      afterIndex += 1;
      continue;
    }
    if (afterIndex >= afterUnits.length) {
      pairs.push({ beforeIndex: beforeIndexes[beforeIndex], afterIndex: null, match: "unmatched", moved: false });
      beforeIndex += 1;
      continue;
    }
    const decision = decisions[beforeIndex * Math.max(1, afterUnits.length) + afterIndex];
    if (decision === 3) {
      pairs.push({
        beforeIndex: beforeIndexes[beforeIndex],
        afterIndex: afterIndexes[afterIndex],
        match: "weighted",
        moved: false,
      });
      beforeIndex += 1;
      afterIndex += 1;
    } else if (decision === 1) {
      pairs.push({ beforeIndex: beforeIndexes[beforeIndex], afterIndex: null, match: "unmatched", moved: false });
      beforeIndex += 1;
    } else {
      pairs.push({ beforeIndex: null, afterIndex: afterIndexes[afterIndex], match: "unmatched", moved: false });
      afterIndex += 1;
    }
  }
  return pairs;
}

function windowBestMatch(before, after, beforeIndexes, afterIndexes, beforeCursor, afterCursor, lookahead) {
  const candidates = [];
  const beforeEnd = Math.min(beforeIndexes.length, beforeCursor + lookahead + 1);
  const afterEnd = Math.min(afterIndexes.length, afterCursor + lookahead + 1);
  for (let beforeOffset = beforeCursor; beforeOffset < beforeEnd; beforeOffset += 1) {
    for (let afterOffset = afterCursor; afterOffset < afterEnd; afterOffset += 1) {
      const score = weightedPairScore(
        before[beforeIndexes[beforeOffset]],
        after[afterIndexes[afterOffset]],
      );
      if (!Number.isFinite(score)) continue;
      candidates.push({ beforeOffset, afterOffset, score });
    }
  }
  const viable = candidates.filter((candidate) => {
    const beforeCandidates = candidates.filter((item) => (
      item.beforeOffset === candidate.beforeOffset
    ));
    const afterCandidates = candidates.filter((item) => (
      item.afterOffset === candidate.afterOffset
    ));
    const beforeBest = Math.max(...beforeCandidates.map((item) => item.score));
    const afterBest = Math.max(...afterCandidates.map((item) => item.score));
    return Math.abs(candidate.score - beforeBest) <= SCORE_EPSILON
      && Math.abs(candidate.score - afterBest) <= SCORE_EPSILON
      && beforeCandidates.filter((item) => (
        Math.abs(item.score - beforeBest) <= SCORE_EPSILON
      )).length === 1
      && afterCandidates.filter((item) => (
        Math.abs(item.score - afterBest) <= SCORE_EPSILON
      )).length === 1;
  });
  viable.sort((left, right) => {
    const leftDistance = (left.beforeOffset - beforeCursor) + (left.afterOffset - afterCursor);
    const rightDistance = (right.beforeOffset - beforeCursor) + (right.afterOffset - afterCursor);
    return leftDistance - rightDistance
      || right.score - left.score
      || left.beforeOffset - right.beforeOffset
      || left.afterOffset - right.afterOffset;
  });
  return viable[0] || null;
}

function boundedIntervalPairs(before, after, beforeIndexes, afterIndexes, lookahead) {
  const pairs = [];
  let beforeCursor = 0;
  let afterCursor = 0;
  while (beforeCursor < beforeIndexes.length && afterCursor < afterIndexes.length) {
    const match = windowBestMatch(
      before,
      after,
      beforeIndexes,
      afterIndexes,
      beforeCursor,
      afterCursor,
      lookahead,
    );
    if (match) {
      while (beforeCursor < match.beforeOffset) {
        pairs.push({ beforeIndex: beforeIndexes[beforeCursor], afterIndex: null, match: "unmatched", moved: false });
        beforeCursor += 1;
      }
      while (afterCursor < match.afterOffset) {
        pairs.push({ beforeIndex: null, afterIndex: afterIndexes[afterCursor], match: "unmatched", moved: false });
        afterCursor += 1;
      }
      pairs.push({
        beforeIndex: beforeIndexes[beforeCursor],
        afterIndex: afterIndexes[afterCursor],
        match: "weighted",
        moved: false,
      });
      beforeCursor += 1;
      afterCursor += 1;
      continue;
    }
    if (afterIndexes.length - afterCursor > beforeIndexes.length - beforeCursor) {
      pairs.push({ beforeIndex: null, afterIndex: afterIndexes[afterCursor], match: "unmatched", moved: false });
      afterCursor += 1;
    } else {
      pairs.push({ beforeIndex: beforeIndexes[beforeCursor], afterIndex: null, match: "unmatched", moved: false });
      beforeCursor += 1;
    }
  }
  while (beforeCursor < beforeIndexes.length) {
    pairs.push({ beforeIndex: beforeIndexes[beforeCursor], afterIndex: null, match: "unmatched", moved: false });
    beforeCursor += 1;
  }
  while (afterCursor < afterIndexes.length) {
    pairs.push({ beforeIndex: null, afterIndex: afterIndexes[afterCursor], match: "unmatched", moved: false });
    afterCursor += 1;
  }
  return pairs;
}

function intervalIndexes(start, end, used) {
  const indexes = [];
  for (let index = start + 1; index < end; index += 1) {
    if (!used.has(index)) indexes.push(index);
  }
  return indexes;
}

function pairSortPosition(pair) {
  if (pair.afterIndex !== null) return pair.afterIndex * 2;
  return (pair.beforeIndex ?? 0) * 2 + 1;
}

export function alignReviewSemanticUnits(before, after, options = {}) {
  const matrixBudget = Math.max(
    1,
    Math.trunc(options.matrixBudget || REVIEW_SEMANTIC_ALIGNMENT_MATRIX_BUDGET),
  );
  const lookahead = Math.max(1, Math.trunc(options.lookahead || DEFAULT_LOOKAHEAD));
  const strong = collectStrongPairs(before, after);
  markMovedStrongPairs(strong.pairs);
  const stableAnchors = strong.pairs
    .filter((pair) => !pair.moved)
    .sort((left, right) => left.beforeIndex - right.beforeIndex);
  const boundaries = [
    { beforeIndex: -1, afterIndex: -1 },
    ...stableAnchors,
    { beforeIndex: before.length, afterIndex: after.length },
  ];
  const aligned = [];
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const left = boundaries[index];
    const right = boundaries[index + 1];
    const beforeIndexes = intervalIndexes(left.beforeIndex, right.beforeIndex, strong.usedBefore);
    const afterIndexes = intervalIndexes(left.afterIndex, right.afterIndex, strong.usedAfter);
    aligned.push(...(
      beforeIndexes.length * afterIndexes.length <= matrixBudget
        ? matrixIntervalPairs(before, after, beforeIndexes, afterIndexes)
        : boundedIntervalPairs(before, after, beforeIndexes, afterIndexes, lookahead)
    ));
    if (right.beforeIndex < before.length && right.afterIndex < after.length) {
      aligned.push(right);
    }
  }
  aligned.push(...strong.pairs.filter((pair) => pair.moved));
  return aligned.sort((left, right) => (
    pairSortPosition(left) - pairSortPosition(right)
    || (left.beforeIndex ?? Number.MAX_SAFE_INTEGER) - (right.beforeIndex ?? Number.MAX_SAFE_INTEGER)
  ));
}
