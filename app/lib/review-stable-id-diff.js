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

function uniqueSingleMovedId(entries) {
  if (entries.length < 2) return null;
  const increasingPrefix = new Array(entries.length).fill(true);
  const increasingSuffix = new Array(entries.length).fill(true);
  for (let index = 1; index < entries.length; index += 1) {
    increasingPrefix[index] = increasingPrefix[index - 1]
      && entries[index - 1].afterIndex < entries[index].afterIndex;
  }
  if (increasingPrefix.at(-1)) return null;
  for (let index = entries.length - 2; index >= 0; index -= 1) {
    increasingSuffix[index] = increasingSuffix[index + 1]
      && entries[index].afterIndex < entries[index + 1].afterIndex;
  }
  const candidates = entries.filter((entry, index) => (
    (index === 0 || increasingPrefix[index - 1])
    && (index === entries.length - 1 || increasingSuffix[index + 1])
    && (
      index === 0
      || index === entries.length - 1
      || entries[index - 1].afterIndex < entries[index + 1].afterIndex
    )
  ));
  return candidates.length === 1 ? candidates[0].id : null;
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
  const reorderedRanges = [];

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
  for (const [parentId, beforeSiblings] of siblingIdsByParent) {
    beforeSiblings.sort((left, right) => before.get(left).index - before.get(right).index);
    const afterPositions = new Map(beforeSiblings
      .slice()
      .sort((left, right) => after.get(left).index - after.get(right).index)
      .map((id, index) => [id, index]));
    const entries = beforeSiblings.map((id) => ({ id, afterIndex: afterPositions.get(id) }));
    const uniqueMovedId = uniqueSingleMovedId(entries);
    if (uniqueMovedId) {
      movedIds.add(uniqueMovedId);
      continue;
    }
    const reordered = entries.some((entry, index) => (
      index > 0 && entries[index - 1].afterIndex > entry.afterIndex
    ));
    if (reordered) reorderedRanges.push({
      parentId,
      beforeIds: beforeSiblings,
      afterIds: beforeSiblings.slice().sort((left, right) => (
        after.get(left).index - after.get(right).index
      )),
    });
  }

  return {
    commonIds,
    addedIds,
    removedIds,
    movedIds: [...movedIds],
    reorderedRanges,
    duplicateIds,
  };
}
