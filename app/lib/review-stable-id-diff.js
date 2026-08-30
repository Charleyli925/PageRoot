function uniqueDescriptorMap(descriptors) {
  const map = new Map();
  const duplicateIds = new Set();
  for (const descriptor of descriptors) {
    if (!descriptor?.id) continue;
    if (map.has(descriptor.id)) duplicateIds.add(descriptor.id);
    map.set(descriptor.id, map.has(descriptor.id) ? null : descriptor);
  }
  for (const [id, descriptor] of map) {
    if (!descriptor) map.delete(id);
  }
  return { map, duplicateIds };
}

function longestIncreasingIds(entries) {
  if (!entries.length) return new Set();
  const tails = [];
  const tailIndexes = [];
  const previous = new Int32Array(entries.length).fill(-1);
  entries.forEach((entry, index) => {
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (tails[middle] < entry.afterIndex) low = middle + 1;
      else high = middle;
    }
    if (low > 0) previous[index] = tailIndexes[low - 1];
    tails[low] = entry.afterIndex;
    tailIndexes[low] = index;
  });
  const ids = new Set();
  let cursor = tailIndexes[tails.length - 1];
  while (cursor >= 0) {
    ids.add(entries[cursor].id);
    cursor = previous[cursor];
  }
  return ids;
}

/**
 * Computes source topology facts only from unique persistent IDs. Legacy or
 * ambiguous elements deliberately stay outside this exact movement contract.
 */
export function analyzeReviewStableIdTopology(beforeDescriptors, afterDescriptors) {
  const beforeAnalysis = uniqueDescriptorMap(beforeDescriptors);
  const afterAnalysis = uniqueDescriptorMap(afterDescriptors);
  const before = beforeAnalysis.map;
  const after = afterAnalysis.map;
  const duplicateIds = [...new Set([
    ...beforeAnalysis.duplicateIds,
    ...afterAnalysis.duplicateIds,
  ])];
  const commonIds = [...before.keys()].filter((id) => after.has(id));
  const addedIds = [...after.keys()].filter((id) => !before.has(id));
  const removedIds = [...before.keys()].filter((id) => !after.has(id));
  const movedIds = new Set();

  for (const id of commonIds) {
    if ((before.get(id).parentId || "") !== (after.get(id).parentId || "")) {
      movedIds.add(id);
    }
  }

  const siblingIdsByParent = new Map();
  for (const id of commonIds) {
    if (movedIds.has(id)) continue;
    const parentId = before.get(id).parentId || "";
    if ((after.get(id).parentId || "") !== parentId) continue;
    const siblings = siblingIdsByParent.get(parentId) || [];
    siblings.push(id);
    siblingIdsByParent.set(parentId, siblings);
  }
  for (const beforeSiblings of siblingIdsByParent.values()) {
    beforeSiblings.sort((left, right) => before.get(left).index - before.get(right).index);
    const afterPositions = new Map(beforeSiblings
      .slice()
      .sort((left, right) => after.get(left).index - after.get(right).index)
      .map((id, index) => [id, index]));
    const entries = beforeSiblings.map((id) => ({ id, afterIndex: afterPositions.get(id) }));
    const orderedIds = longestIncreasingIds(entries);
    entries.forEach(({ id }) => {
      if (!orderedIds.has(id)) movedIds.add(id);
    });
  }

  return {
    commonIds,
    addedIds,
    removedIds,
    movedIds: [...movedIds],
    duplicateIds,
  };
}
