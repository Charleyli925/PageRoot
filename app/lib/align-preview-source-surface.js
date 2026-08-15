export function alignPreviewSourceSurface(sourceIndex, liveNodes) {
  const elements = sourceIndex.elements;
  const liveLeaves = new Set(
    liveNodes.filter((node) => (
      !liveNodes.some((other) => other !== node && node.contains(other))
    )),
  );
  const skipDescendantsOf = new Set();
  const isSkipped = (element) => {
    let parentId = element.parentId;
    while (parentId) {
      if (skipDescendantsOf.has(parentId)) return true;
      const parent = sourceIndex.byNodeId.get(parentId);
      parentId = parent?.type === "element" ? parent.parentId : null;
    }
    return false;
  };
  const alignments = [];
  let cursor = 0;
  for (const node of liveNodes) {
    while (cursor < elements.length && isSkipped(elements[cursor])) cursor += 1;
    const sourceElement = elements[cursor];
    if (!sourceElement || sourceElement.tagName !== node.tagName.toLowerCase()) {
      return null;
    }
    alignments.push({ node, nodeId: sourceElement.nodeId });
    if (liveLeaves.has(node)) skipDescendantsOf.add(sourceElement.nodeId);
    cursor += 1;
  }
  while (cursor < elements.length && isSkipped(elements[cursor])) cursor += 1;
  if (cursor !== elements.length) return null;
  return alignments;
}
