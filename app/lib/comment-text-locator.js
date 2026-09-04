/**
 * Converts one source-backed DOM text selection into offsets within the owning
 * element's decoded descendant text. Runtime text never enters this function.
 */
export function createElementTextLocator(sourceIndex, range) {
  if (!sourceIndex || !range || range.segments?.length === 0) return null;
  const element = (
    (range.target?.elementId && sourceIndex.byPagerootId.get(range.target.elementId))
    || (range.target?.nodeId && sourceIndex.byNodeId.get(range.target.nodeId))
    || null
  );
  if (element?.type !== "element") return null;
  const elementNodeId = element.nodeId;
  const isWithin = (nodeId) => {
    let current = sourceIndex.byNodeId.get(nodeId);
    while (current?.parentId) {
      if (current.parentId === elementNodeId) return true;
      current = sourceIndex.byNodeId.get(current.parentId);
    }
    return false;
  };
  const segments = new Map(range.segments.map((segment) => [segment.textNodeId, segment]));
  let text = "";
  let startOffset = null;
  let endOffset = null;
  for (const textNode of sourceIndex.textNodes) {
    if (!isWithin(textNode.nodeId)) continue;
    const segment = segments.get(textNode.nodeId);
    if (segment) {
      if (
        !Number.isInteger(segment.startOffset)
        || !Number.isInteger(segment.endOffset)
        || segment.startOffset < 0
        || segment.endOffset > textNode.value.length
        || segment.endOffset <= segment.startOffset
      ) return null;
      if (startOffset === null) startOffset = text.length + segment.startOffset;
      endOffset = text.length + segment.endOffset;
    }
    text += textNode.value;
  }
  if (startOffset === null || endOffset === null || endOffset <= startOffset) return null;
  const quote = text.slice(startOffset, endOffset);
  if (quote !== range.text || quote.length === 0 || quote.length > 5_000) return null;
  if (range.direction !== "forward" && range.direction !== "backward") return null;
  return {
    quote,
    startOffset,
    endOffset,
    affinity: range.direction,
  };
}
