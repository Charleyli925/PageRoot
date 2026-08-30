function uniqueDescriptorMap(descriptors) {
  const map = new Map();
  for (const descriptor of descriptors) {
    if (!descriptor?.id) continue;
    map.set(descriptor.id, map.has(descriptor.id) ? null : descriptor);
  }
  for (const [id, descriptor] of map) {
    if (!descriptor) map.delete(id);
  }
  return map;
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
  const before = uniqueDescriptorMap(beforeDescriptors);
  const after = uniqueDescriptorMap(afterDescriptors);
  const commonIds = [...before.keys()].filter((id) => after.has(id));
  const addedIds = [...after.keys()].filter((id) => !before.has(id));
  const removedIds = [...before.keys()].filter((id) => !after.has(id));
  const movedIds = new Set();

  for (const id of commonIds) {
    if ((before.get(id).parentId || "") !== (after.get(id).parentId || "")) {
      movedIds.add(id);
    }
  }

  const parentIds = new Set(commonIds.map((id) => before.get(id).parentId || ""));
  for (const parentId of parentIds) {
    const beforeSiblings = commonIds
      .filter((id) => (
        !movedIds.has(id)
        && (before.get(id).parentId || "") === parentId
        && (after.get(id).parentId || "") === parentId
      ))
      .sort((left, right) => before.get(left).index - before.get(right).index);
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
  };
}
