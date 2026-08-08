const WORD_SEGMENTER = typeof Intl.Segmenter === "function"
  ? new Intl.Segmenter("zh-CN", { granularity: "word" })
  : null;

const FALLBACK_TOKEN_PATTERN = /[\p{Script=Han}]|[\p{Script=Latin}\p{N}_]+|[\p{L}]|[^\s]/gu;
const NON_WHITESPACE_PATTERN = /[^\s]/gu;
const HAN_CHARACTER_PATTERN = /^\p{Script=Han}$/u;
const SEMANTIC_BOUNDARY_PATTERN = /^[\s\p{P}\p{S}]$/u;
const SHORT_HAN_TEXT_PATTERN = /^\p{Script=Han}{3,12}$/u;
const MAX_TOKEN_MATRIX_CELLS = 60_000;
const MAX_SEMANTIC_UNIT_MATRIX_CELLS = 250_000;
const SEMANTIC_UNIT_LOOKAHEAD = 32;
const TOKEN_CHUNK_ANCHOR_LENGTHS = [4, 3, 2, 1];

function tokenizeFallback(value) {
  const tokens = [];
  for (const match of value.matchAll(FALLBACK_TOKEN_PATTERN)) {
    const start = match.index ?? 0;
    tokens.push({
      value: match[0],
      start,
      end: start + match[0].length,
      wordLike: /[\p{L}\p{N}_]/u.test(match[0]),
    });
  }
  return tokens;
}

function tokenizeReviewText(value) {
  if (!WORD_SEGMENTER) return tokenizeFallback(value);
  const tokens = [];
  for (const segment of WORD_SEGMENTER.segment(value)) {
    if (!segment.segment.trim()) continue;
    if (segment.isWordLike) {
      tokens.push({
        value: segment.segment,
        start: segment.index,
        end: segment.index + segment.segment.length,
        wordLike: true,
      });
      continue;
    }
    for (const match of segment.segment.matchAll(NON_WHITESPACE_PATTERN)) {
      const start = segment.index + (match.index ?? 0);
      tokens.push({
        value: match[0],
        start,
        end: start + match[0].length,
        wordLike: false,
      });
    }
  }
  return tokens;
}

function exactTokenMatches(before, after, beforeOffset = 0, afterOffset = 0) {
  const matrix = Array.from(
    { length: before.length + 1 },
    () => new Uint16Array(after.length + 1),
  );
  for (let beforeIndex = 1; beforeIndex <= before.length; beforeIndex += 1) {
    for (let afterIndex = 1; afterIndex <= after.length; afterIndex += 1) {
      matrix[beforeIndex][afterIndex] = before[beforeIndex - 1].value === after[afterIndex - 1].value
        ? matrix[beforeIndex - 1][afterIndex - 1] + 1
        : Math.max(matrix[beforeIndex - 1][afterIndex], matrix[beforeIndex][afterIndex - 1]);
    }
  }
  let beforeIndex = before.length;
  let afterIndex = after.length;
  const matches = [];
  while (beforeIndex > 0 && afterIndex > 0) {
    if (before[beforeIndex - 1].value === after[afterIndex - 1].value) {
      matches.push({
        before: beforeOffset + beforeIndex - 1,
        after: afterOffset + afterIndex - 1,
      });
      beforeIndex -= 1;
      afterIndex -= 1;
    } else if (matrix[beforeIndex - 1][afterIndex] >= matrix[beforeIndex][afterIndex - 1]) {
      beforeIndex -= 1;
    } else {
      afterIndex -= 1;
    }
  }
  matches.reverse();
  return matches;
}

function tokenSequenceKey(tokens, start, length) {
  return tokens.slice(start, start + length)
    .map(({ value }) => `${value.length}:${value}`)
    .join("|");
}

function uniqueTokenSequences(tokens, length) {
  const sequences = new Map();
  for (let index = 0; index <= tokens.length - length; index += 1) {
    const key = tokenSequenceKey(tokens, index, length);
    sequences.set(key, sequences.has(key) ? -1 : index);
  }
  return sequences;
}

function stableTokenChunkAnchor(before, after) {
  for (const length of TOKEN_CHUNK_ANCHOR_LENGTHS) {
    if (before.length < length || after.length < length) continue;
    const beforeSequences = uniqueTokenSequences(before, length);
    const afterSequences = uniqueTokenSequences(after, length);
    let best = null;
    beforeSequences.forEach((beforeIndex, key) => {
      const afterIndex = afterSequences.get(key);
      if (beforeIndex < 0 || afterIndex === undefined || afterIndex < 0) return;
      const beforePosition = (beforeIndex + length / 2) / before.length;
      const afterPosition = (afterIndex + length / 2) / after.length;
      const orderDistance = Math.abs(beforePosition - afterPosition);
      const centerDistance = Math.abs((beforePosition + afterPosition) / 2 - 0.5);
      const score = orderDistance * 4 + centerDistance;
      if (!best || score < best.score) {
        best = { before: beforeIndex, after: afterIndex, length, score };
      }
    });
    if (best) return best;
  }
  return null;
}

function tokenMatches(before, after, beforeOffset = 0, afterOffset = 0) {
  if (!before.length || !after.length) return [];
  let prefix = 0;
  const prefixMatches = [];
  while (
    prefix < before.length
    && prefix < after.length
    && before[prefix].value === after[prefix].value
  ) {
    prefixMatches.push({
      before: beforeOffset + prefix,
      after: afterOffset + prefix,
    });
    prefix += 1;
  }

  let beforeEnd = before.length;
  let afterEnd = after.length;
  const suffixMatches = [];
  while (
    beforeEnd > prefix
    && afterEnd > prefix
    && before[beforeEnd - 1].value === after[afterEnd - 1].value
  ) {
    beforeEnd -= 1;
    afterEnd -= 1;
    suffixMatches.unshift({
      before: beforeOffset + beforeEnd,
      after: afterOffset + afterEnd,
    });
  }

  const beforeMiddle = before.slice(prefix, beforeEnd);
  const afterMiddle = after.slice(prefix, afterEnd);
  let middleMatches = [];
  if (beforeMiddle.length && afterMiddle.length) {
    const middleBeforeOffset = beforeOffset + prefix;
    const middleAfterOffset = afterOffset + prefix;
    if (beforeMiddle.length * afterMiddle.length <= MAX_TOKEN_MATRIX_CELLS) {
      middleMatches = exactTokenMatches(
        beforeMiddle,
        afterMiddle,
        middleBeforeOffset,
        middleAfterOffset,
      );
    } else {
      // Long punctuation-free copy must stay bounded without falling back to
      // one giant prefix/suffix replacement. A unique shared token sequence is
      // a stable semantic chunk boundary; recurse on both sides of that anchor.
      const anchor = stableTokenChunkAnchor(beforeMiddle, afterMiddle);
      if (anchor) {
        const leftMatches = tokenMatches(
          beforeMiddle.slice(0, anchor.before),
          afterMiddle.slice(0, anchor.after),
          middleBeforeOffset,
          middleAfterOffset,
        );
        const anchorMatches = Array.from({ length: anchor.length }, (_, index) => ({
          before: middleBeforeOffset + anchor.before + index,
          after: middleAfterOffset + anchor.after + index,
        }));
        const rightMatches = tokenMatches(
          beforeMiddle.slice(anchor.before + anchor.length),
          afterMiddle.slice(anchor.after + anchor.length),
          middleBeforeOffset + anchor.before + anchor.length,
          middleAfterOffset + anchor.after + anchor.length,
        );
        middleMatches = [...leftMatches, ...anchorMatches, ...rightMatches];
      }
    }
  }
  return [...prefixMatches, ...middleMatches, ...suffixMatches];
}

function unmatchedTokenIndexes(before, after) {
  const beforeUnmatched = new Set(before.map((_, index) => index));
  const afterUnmatched = new Set(after.map((_, index) => index));
  const matches = tokenMatches(before, after);
  matches.forEach((match) => {
    beforeUnmatched.delete(match.before);
    afterUnmatched.delete(match.after);
  });
  return { before: beforeUnmatched, after: afterUnmatched, matches };
}

function characterBefore(source, token) {
  return token.start > 0 ? [...source.slice(0, token.start)].at(-1) || "" : "";
}

function characterAfter(source, token) {
  return token.end < source.length ? [...source.slice(token.end)][0] || "" : "";
}

function tokenIsDelimited(source, token) {
  const before = characterBefore(source, token);
  const after = characterAfter(source, token);
  const startsAtBoundary = !before || SEMANTIC_BOUNDARY_PATTERN.test(before);
  const endsAtBoundary = !after || SEMANTIC_BOUNDARY_PATTERN.test(after);
  return startsAtBoundary && endsAtBoundary;
}

function matchedRuns(matches) {
  return matches.reduce((runs, match) => {
    const previousRun = runs.at(-1);
    const previousMatch = previousRun?.at(-1);
    if (
      previousRun
      && previousMatch
      && match.before === previousMatch.before + 1
      && match.after === previousMatch.after + 1
    ) {
      previousRun.push(match);
    } else {
      runs.push([match]);
    }
    return runs;
  }, []);
}

function absorbAccidentalHanMatches(
  beforeSource,
  beforeTokens,
  afterSource,
  afterTokens,
  unmatched,
) {
  if (!unmatched.before.size || !unmatched.after.size) return unmatched;
  for (const run of matchedRuns(unmatched.matches)) {
    if (run.length !== 1) continue;
    const match = run[0];
    const beforeToken = beforeTokens[match.before];
    const afterToken = afterTokens[match.after];
    if (
      !HAN_CHARACTER_PATTERN.test(beforeToken.value)
      || !HAN_CHARACTER_PATTERN.test(afterToken.value)
    ) continue;
    const alignedPrefix = match.before === 0 && match.after === 0;
    const alignedSuffix = match.before === beforeTokens.length - 1
      && match.after === afterTokens.length - 1;
    const independentlyDelimited = tokenIsDelimited(beforeSource, beforeToken)
      && tokenIsDelimited(afterSource, afterToken);
    if (alignedPrefix || alignedSuffix || independentlyDelimited) continue;
    unmatched.before.add(match.before);
    unmatched.after.add(match.after);
  }
  return unmatched;
}

export function reviewTextSimilarity(left, right) {
  if (!left || !right) return 0;
  if (left === right) return 1;
  const leftTokens = tokenizeReviewText(left);
  const rightTokens = tokenizeReviewText(right);
  if (!leftTokens.length || !rightTokens.length) return 0;
  const unmatched = unmatchedTokenIndexes(leftTokens, rightTokens);
  const matched = Math.min(
    leftTokens.length - unmatched.before.size,
    rightTokens.length - unmatched.after.size,
  );
  const wordSimilarity = matched / Math.max(leftTokens.length, rightTokens.length);
  const leftCharacters = [...left.replace(/\s+/gu, "")];
  const rightCharacters = [...right.replace(/\s+/gu, "")];
  if (
    !SHORT_HAN_TEXT_PATTERN.test(leftCharacters.join(""))
    || !SHORT_HAN_TEXT_PATTERN.test(rightCharacters.join(""))
  ) return wordSimilarity;
  const characterMatches = tokenMatches(
    leftCharacters.map((value) => ({ value })),
    rightCharacters.map((value) => ({ value })),
  ).length;
  if (characterMatches < 2) return wordSimilarity;
  return Math.max(
    wordSimilarity,
    characterMatches / Math.max(leftCharacters.length, rightCharacters.length),
  );
}

function semanticTextUnitPairScore(before, after, beforeIndex, afterIndex) {
  if (before.kind !== after.kind) return Number.NEGATIVE_INFINITY;
  const beforeIdentity = before.identity || "";
  const afterIdentity = after.identity || "";
  if ((beforeIdentity || afterIdentity) && beforeIdentity !== afterIdentity) {
    return Number.NEGATIVE_INFINITY;
  }
  const beforeText = before.text.replace(/\s+/gu, " ").trim();
  const afterText = after.text.replace(/\s+/gu, " ").trim();
  const exactText = Boolean(beforeText && beforeText === afterText);
  const similarity = reviewTextSimilarity(beforeText, afterText);
  const beforeAffinities = new Set(before.affinities || []);
  const sharedAffinities = (after.affinities || [])
    .filter((affinity) => beforeAffinities.has(affinity));
  if (!exactText && similarity < 0.48 && !(sharedAffinities.length && similarity >= 0.24)) {
    return Number.NEGATIVE_INFINITY;
  }
  return (beforeIdentity ? 600 : 0)
    + (exactText ? 420 : 0)
    + Math.round(similarity * 160)
    + Math.min(80, sharedAffinities.length * 24)
    + Math.max(0, 24 - Math.abs(beforeIndex - afterIndex) * 2);
}

function semanticTextUnitSignature(unit) {
  const text = unit.text.replace(/\s+/gu, " ").trim();
  if (!text) return null;
  return `${unit.kind}\u0000${unit.identity || ""}\u0000${text}`;
}

function boundedSemanticTextUnitPairs(before, after) {
  const pairs = [];
  let beforeIndex = 0;
  let afterIndex = 0;
  const exactDistance = (items, start, signature) => {
    if (!signature) return -1;
    const end = Math.min(items.length, start + SEMANTIC_UNIT_LOOKAHEAD + 1);
    for (let index = start; index < end; index += 1) {
      if (semanticTextUnitSignature(items[index]) === signature) return index - start;
    }
    return -1;
  };
  while (beforeIndex < before.length && afterIndex < after.length) {
    const beforeSignature = semanticTextUnitSignature(before[beforeIndex]);
    const afterSignature = semanticTextUnitSignature(after[afterIndex]);
    const afterDistance = exactDistance(after, afterIndex + 1, beforeSignature);
    const beforeDistance = exactDistance(before, beforeIndex + 1, afterSignature);
    if (afterDistance >= 0 && (beforeDistance < 0 || afterDistance <= beforeDistance)) {
      pairs.push({ beforeIndex: null, afterIndex });
      afterIndex += 1;
      continue;
    }
    if (beforeDistance >= 0) {
      pairs.push({ beforeIndex, afterIndex: null });
      beforeIndex += 1;
      continue;
    }
    const pairScore = semanticTextUnitPairScore(
      before[beforeIndex],
      after[afterIndex],
      beforeIndex,
      afterIndex,
    );
    if (Number.isFinite(pairScore)) {
      pairs.push({ beforeIndex, afterIndex });
      beforeIndex += 1;
      afterIndex += 1;
      continue;
    }
    if (after.length - afterIndex > before.length - beforeIndex) {
      pairs.push({ beforeIndex: null, afterIndex });
      afterIndex += 1;
    } else {
      pairs.push({ beforeIndex, afterIndex: null });
      beforeIndex += 1;
    }
  }
  while (beforeIndex < before.length) {
    pairs.push({ beforeIndex, afterIndex: null });
    beforeIndex += 1;
  }
  while (afterIndex < after.length) {
    pairs.push({ beforeIndex: null, afterIndex });
    afterIndex += 1;
  }
  return pairs;
}

function matrixSemanticTextUnitPairs(before, after) {
  const columnCount = after.length + 1;
  const scores = new Float64Array((before.length + 1) * columnCount);
  const decisions = new Uint8Array(before.length * Math.max(1, after.length));
  const scoreAt = (beforeIndex, afterIndex) => (
    scores[beforeIndex * columnCount + afterIndex]
  );
  for (let beforeIndex = before.length - 1; beforeIndex >= 0; beforeIndex -= 1) {
    for (let afterIndex = after.length - 1; afterIndex >= 0; afterIndex -= 1) {
      const skipBefore = scoreAt(beforeIndex + 1, afterIndex);
      const skipAfter = scoreAt(beforeIndex, afterIndex + 1);
      const pairScore = semanticTextUnitPairScore(
        before[beforeIndex],
        after[afterIndex],
        beforeIndex,
        afterIndex,
      );
      const match = Number.isFinite(pairScore)
        ? pairScore + scoreAt(beforeIndex + 1, afterIndex + 1)
        : Number.NEGATIVE_INFINITY;
      const preferSkipAfter = after.length - afterIndex > before.length - beforeIndex;
      let decision = skipAfter > skipBefore || (skipAfter === skipBefore && preferSkipAfter)
        ? 2
        : 1;
      let best = decision === 2 ? skipAfter : skipBefore;
      if (match >= best && Number.isFinite(match)) {
        decision = 3;
        best = match;
      }
      scores[beforeIndex * columnCount + afterIndex] = best;
      decisions[beforeIndex * Math.max(1, after.length) + afterIndex] = decision;
    }
  }

  const pairs = [];
  let beforeIndex = 0;
  let afterIndex = 0;
  while (beforeIndex < before.length || afterIndex < after.length) {
    if (beforeIndex >= before.length) {
      pairs.push({ beforeIndex: null, afterIndex });
      afterIndex += 1;
      continue;
    }
    if (afterIndex >= after.length) {
      pairs.push({ beforeIndex, afterIndex: null });
      beforeIndex += 1;
      continue;
    }
    const decision = decisions[
      beforeIndex * Math.max(1, after.length) + afterIndex
    ];
    if (decision === 3) {
      pairs.push({ beforeIndex, afterIndex });
      beforeIndex += 1;
      afterIndex += 1;
    } else if (decision === 2) {
      pairs.push({ beforeIndex: null, afterIndex });
      afterIndex += 1;
    } else {
      pairs.push({ beforeIndex, afterIndex: null });
      beforeIndex += 1;
    }
  }
  return pairs;
}

export function pairReviewSemanticTextUnits(before, after) {
  return before.length * after.length <= MAX_SEMANTIC_UNIT_MATRIX_CELLS
    ? matrixSemanticTextUnitPairs(before, after)
    : boundedSemanticTextUnitPairs(before, after);
}

function rangesForTokens(source, tokens, indexes) {
  const ranges = [];
  [...indexes].sort((left, right) => left - right).forEach((index) => {
    const token = tokens[index];
    const previous = ranges.at(-1);
    if (previous && /^\s*$/u.test(source.slice(previous.end, token.start))) {
      previous.end = token.end;
    } else {
      ranges.push({ start: token.start, end: token.end });
    }
  });
  return ranges;
}

function reviewSentenceRanges(value) {
  if (!value) return [];
  const ranges = [];
  const boundary = /[\u3002\uff01\uff1f!?\uff1b;]+|\n+/gu;
  let start = 0;
  for (const match of value.matchAll(boundary)) {
    const end = (match.index ?? 0) + match[0].length;
    if (value.slice(start, end).trim()) ranges.push({ start, end });
    start = end;
  }
  if (value.slice(start).trim()) ranges.push({ start, end: value.length });
  return ranges.length ? ranges : [{ start: 0, end: value.length }];
}

function unmatchedSentenceIndexes(
  beforeText,
  beforeRanges,
  afterText,
  afterRanges,
) {
  const beforeValues = beforeRanges.map((range) => (
    beforeText.slice(range.start, range.end).replace(/\s+/g, " ").trim()
  ));
  const afterValues = afterRanges.map((range) => (
    afterText.slice(range.start, range.end).replace(/\s+/g, " ").trim()
  ));
  const beforeTokens = beforeValues.map((value) => ({ value }));
  const afterTokens = afterValues.map((value) => ({ value }));
  const unmatched = unmatchedTokenIndexes(beforeTokens, afterTokens);
  return { before: unmatched.before, after: unmatched.after };
}

export function mergeReviewTextRanges(ranges) {
  return [...ranges]
    .sort((left, right) => left.start - right.start || left.end - right.end)
    .reduce((merged, range) => {
      const previous = merged.at(-1);
      if (previous && range.start <= previous.end) {
        previous.end = Math.max(previous.end, range.end);
      } else {
        merged.push({ ...range });
      }
      return merged;
    }, []);
}

const HARD_FOOTPRINT_BOUNDARY_PATTERN = /[\n\u3002\uff01\uff1f!?\uff1b;]/u;

function visibleCharacterCount(value) {
  return [...value.replace(/\s/gu, "")].length;
}

function visibleRangeLength(source, ranges) {
  return ranges.reduce((total, range) => (
    total + visibleCharacterCount(source.slice(range.start, range.end))
  ), 0);
}

function rangeSpanCoverage(source, ranges) {
  if (!ranges.length) return 0;
  const total = visibleCharacterCount(source);
  if (!total) return 0;
  const first = ranges[0];
  const last = ranges[ranges.length - 1];
  return visibleCharacterCount(source.slice(first.start, last.end)) / total;
}

function readableRangeGroups(source, ranges) {
  const sorted = mergeReviewTextRanges(ranges);
  return sorted.reduce((groups, range) => {
    const previousGroup = groups.at(-1);
    const previousRange = previousGroup?.at(-1);
    if (!previousGroup || !previousRange) {
      groups.push([{ ...range }]);
      return groups;
    }
    const gap = source.slice(previousRange.end, range.start);
    const gapLength = visibleCharacterCount(gap);
    const joinedRanges = [...previousGroup, range];
    const joinedStart = joinedRanges[0].start;
    const joinedEnd = range.end;
    const joinedLength = Math.max(
      1,
      visibleCharacterCount(source.slice(joinedStart, joinedEnd)),
    );
    const joinedDensity = visibleRangeLength(source, joinedRanges) / joinedLength;
    const crossesHardBoundary = HARD_FOOTPRINT_BOUNDARY_PATTERN.test(gap);
    const belongsToSameReadablePhrase = !crossesHardBoundary && (
      gapLength <= 2
      || (gapLength <= 6 && joinedDensity >= 0.58)
    );
    if (belongsToSameReadablePhrase) previousGroup.push({ ...range });
    else groups.push([{ ...range }]);
    return groups;
  }, []);
}

export function readableReviewTextFootprintPlan(
  beforeText,
  afterText,
  differences,
) {
  const beforeRanges = mergeReviewTextRanges(differences.before || []);
  const afterRanges = mergeReviewTextRanges(differences.after || []);
  const operation = beforeRanges.length
    ? afterRanges.length ? "replace" : "delete"
    : afterRanges.length ? "insert" : "none";
  const beforeLength = visibleCharacterCount(beforeText);
  const afterLength = visibleCharacterCount(afterText);
  const changedLength = visibleRangeLength(beforeText, beforeRanges)
    + visibleRangeLength(afterText, afterRanges);
  const totalLength = beforeLength + afterLength;
  const density = totalLength ? changedLength / totalLength : 0;
  const fragmentCount = beforeRanges.length + afterRanges.length;
  const pairedReplacement = beforeRanges.length > 0 && afterRanges.length > 0;
  const spanCoverage = Math.max(
    rangeSpanCoverage(beforeText, beforeRanges),
    rangeSpanCoverage(afterText, afterRanges),
  );
  const longEnoughForBlock = Math.max(beforeLength, afterLength) >= 20;
  const denseRewrite = pairedReplacement && longEnoughForBlock && (
    density >= 0.45
    || (
      fragmentCount >= 5
      && density >= 0.28
      && spanCoverage >= 0.65
    )
  );
  const scope = denseRewrite ? "block" : "inline";
  return {
    operation,
    scope,
    density,
    before: {
      evidenceRanges: beforeRanges,
      groups: denseRewrite && beforeRanges.length
        ? [beforeRanges]
        : readableRangeGroups(beforeText, beforeRanges),
      anchorOffset: operation === "insert"
        ? Math.min(beforeText.length, afterRanges[0]?.start ?? beforeText.length)
        : null,
    },
    after: {
      evidenceRanges: afterRanges,
      groups: denseRewrite && afterRanges.length
        ? [afterRanges]
        : readableRangeGroups(afterText, afterRanges),
      anchorOffset: operation === "delete"
        ? Math.min(afterText.length, beforeRanges[0]?.start ?? afterText.length)
        : null,
    },
  };
}

export function sentenceAwareTextDifferences(beforeText, afterText) {
  const beforeSentences = reviewSentenceRanges(beforeText);
  const afterSentences = reviewSentenceRanges(afterText);
  const unmatchedSentences = unmatchedSentenceIndexes(
    beforeText,
    beforeSentences,
    afterText,
    afterSentences,
  );
  const beforeIndexes = [...unmatchedSentences.before].sort((left, right) => left - right);
  const afterIndexes = [...unmatchedSentences.after].sort((left, right) => left - right);
  const beforeDifferences = [];
  const afterDifferences = [];
  const beforeOrder = new Map(beforeIndexes.map((index, order) => [index, order]));
  const afterOrder = new Map(afterIndexes.map((index, order) => [index, order]));
  const sentencePairs = beforeIndexes.flatMap((beforeIndex) => afterIndexes.map((afterIndex) => {
    const beforeRange = beforeSentences[beforeIndex];
    const afterRange = afterSentences[afterIndex];
    const similarity = reviewTextSimilarity(
      beforeText.slice(beforeRange.start, beforeRange.end),
      afterText.slice(afterRange.start, afterRange.end),
    );
    const orderDistance = Math.abs(
      (beforeOrder.get(beforeIndex) ?? 0) - (afterOrder.get(afterIndex) ?? 0),
    );
    return { beforeIndex, afterIndex, similarity, orderDistance };
  })).filter((pair) => pair.similarity >= 0.28)
    .sort((left, right) => (
      right.similarity - left.similarity || left.orderDistance - right.orderDistance
    ));
  const pairedBefore = new Set();
  const pairedAfter = new Set();
  sentencePairs.forEach((pair) => {
    if (pairedBefore.has(pair.beforeIndex) || pairedAfter.has(pair.afterIndex)) return;
    pairedBefore.add(pair.beforeIndex);
    pairedAfter.add(pair.afterIndex);
    const beforeRange = beforeSentences[pair.beforeIndex];
    const afterRange = afterSentences[pair.afterIndex];
    const beforeSentence = beforeText.slice(beforeRange.start, beforeRange.end);
    const afterSentence = afterText.slice(afterRange.start, afterRange.end);
    const beforeTokens = tokenizeReviewText(beforeSentence);
    const afterTokens = tokenizeReviewText(afterSentence);
    const unmatchedTokens = absorbAccidentalHanMatches(
      beforeSentence,
      beforeTokens,
      afterSentence,
      afterTokens,
      unmatchedTokenIndexes(beforeTokens, afterTokens),
    );
    const matchedCount = Math.min(
      beforeTokens.length - unmatchedTokens.before.size,
      afterTokens.length - unmatchedTokens.after.size,
    );
    const similarity = matchedCount / Math.max(1, beforeTokens.length, afterTokens.length);
    if (similarity < 0.2) {
      beforeDifferences.push(beforeRange);
      afterDifferences.push(afterRange);
      return;
    }
    const beforeTokenRanges = rangesForTokens(
      beforeSentence,
      beforeTokens,
      unmatchedTokens.before,
    ).map((range) => ({
      start: beforeRange.start + range.start,
      end: beforeRange.start + range.end,
    }));
    const afterTokenRanges = rangesForTokens(
      afterSentence,
      afterTokens,
      unmatchedTokens.after,
    ).map((range) => ({
      start: afterRange.start + range.start,
      end: afterRange.start + range.end,
    }));
    beforeDifferences.push(...beforeTokenRanges);
    afterDifferences.push(...afterTokenRanges);
  });
  beforeIndexes.forEach((index) => {
    if (!pairedBefore.has(index)) beforeDifferences.push(beforeSentences[index]);
  });
  afterIndexes.forEach((index) => {
    if (!pairedAfter.has(index)) afterDifferences.push(afterSentences[index]);
  });

  return {
    before: mergeReviewTextRanges(beforeDifferences),
    after: mergeReviewTextRanges(afterDifferences),
  };
}
