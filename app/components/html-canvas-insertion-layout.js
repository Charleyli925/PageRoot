export function insertionLayoutNeedsRefresh(previous, next) {
  if (!next) return Boolean(previous);
  if (!previous) return true;
  return previous.sourceSha256 !== next.sourceSha256
    || previous.documentNode !== next.documentNode;
}
