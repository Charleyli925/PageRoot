function normalizedTokens(text) {
  return String(text ?? "")
    .toLocaleLowerCase("zh-CN")
    .match(/[\p{Script=Han}]|[\p{L}\p{N}]+(?:[.,:%+\-][\p{L}\p{N}]+)*|[^\s]/gu) ?? [];
}

export function reviewTextSimilarity(beforeText, afterText) {
  const beforeTokens = normalizedTokens(beforeText);
  const afterTokens = normalizedTokens(afterText);
  if (!beforeTokens.length || !afterTokens.length) return 0;

  const columns = afterTokens.length + 1;
  const next = new Uint32Array(columns);
  for (let beforeIndex = beforeTokens.length - 1; beforeIndex >= 0; beforeIndex -= 1) {
    const current = new Uint32Array(columns);
    for (let afterIndex = afterTokens.length - 1; afterIndex >= 0; afterIndex -= 1) {
      current[afterIndex] = beforeTokens[beforeIndex] === afterTokens[afterIndex]
        ? next[afterIndex + 1] + 1
        : Math.max(next[afterIndex], current[afterIndex + 1]);
    }
    next.set(current);
  }
  return next[0] / Math.max(beforeTokens.length, afterTokens.length);
}

function unmatchedValueCounts(entries, used, field) {
  const counts = new Map();
  entries.forEach((entry, index) => {
    if (used.has(index)) return;
    const value = entry[field];
    if (!value) return;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  });
  return counts;
}

/**
 * Pairs visual review entries without letting repeated copy jump across rows or
 * cards. Semantic identity wins; copy is only an identity when it is unique on
 * both sides. Remaining duplicates are matched by context and nearby order.
 */
export function pairReviewEntries(beforeEntries, afterEntries) {
  const usedBefore = new Set();
  const usedAfter = new Set();
  const pairs = [];

  const pair = (beforeIndex, afterIndex) => {
    usedBefore.add(beforeIndex);
    usedAfter.add(afterIndex);
    pairs.push({
      before: beforeEntries[beforeIndex],
      after: afterEntries[afterIndex],
    });
  };

  const matchUnique = (field, requireSameTag = true) => {
    const beforeCounts = unmatchedValueCounts(beforeEntries, usedBefore, field);
    const afterCounts = unmatchedValueCounts(afterEntries, usedAfter, field);
    beforeEntries.forEach((before, beforeIndex) => {
      if (usedBefore.has(beforeIndex)) return;
      const value = before[field];
      if (!value || beforeCounts.get(value) !== 1 || afterCounts.get(value) !== 1) return;
      const afterIndex = afterEntries.findIndex((after, candidateIndex) => (
        !usedAfter.has(candidateIndex)
        && after[field] === value
        && (!requireSameTag || before.tagName === after.tagName)
      ));
      if (afterIndex >= 0) pair(beforeIndex, afterIndex);
    });
  };

  matchUnique("identity");
  matchUnique("text");

  const candidates = [];
  const maximumOrder = Math.max(beforeEntries.length, afterEntries.length, 1);
  beforeEntries.forEach((before, beforeIndex) => {
    if (usedBefore.has(beforeIndex)) return;
    afterEntries.forEach((after, afterIndex) => {
      if (usedAfter.has(afterIndex) || before.tagName !== after.tagName) return;
      const similarity = reviewTextSimilarity(before.text, after.text);
      const sameIdentity = Boolean(before.identity && before.identity === after.identity);
      const sameContext = Boolean(before.context && before.context === after.context);
      const orderAffinity = 1 - Math.min(1, Math.abs(before.order - after.order) / maximumOrder);
      if (!sameIdentity && similarity < (sameContext ? .28 : .48)) return;
      const score = similarity * .64
        + (sameIdentity ? .56 : 0)
        + (sameContext ? .2 : 0)
        + orderAffinity * .16;
      candidates.push({ beforeIndex, afterIndex, score });
    });
  });

  candidates
    .sort((left, right) => (
      right.score - left.score
      || left.beforeIndex - right.beforeIndex
      || left.afterIndex - right.afterIndex
    ))
    .forEach(({ beforeIndex, afterIndex }) => {
      if (usedBefore.has(beforeIndex) || usedAfter.has(afterIndex)) return;
      pair(beforeIndex, afterIndex);
    });

  pairs.sort((left, right) => left.before.order - right.before.order);
  return {
    pairs,
    beforeOnly: beforeEntries.filter((_, index) => !usedBefore.has(index)),
    afterOnly: afterEntries.filter((_, index) => !usedAfter.has(index)),
  };
}
