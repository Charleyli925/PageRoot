const IGNORED_SUBSTANCE_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"]);
const TEXT_NODE = 3;

function isIgnoredSubstanceTag(tagName) {
  return IGNORED_SUBSTANCE_TAGS.has(String(tagName || "").toUpperCase());
}

export function moduleHasSubstance(element) {
  if (!element) return false;
  const children = Array.from(element.children || []);
  for (const child of children) {
    if (!isIgnoredSubstanceTag(child.tagName)) return true;
  }
  const nodes = element.childNodes;
  if (nodes && typeof nodes.length === "number") {
    for (const node of Array.from(nodes)) {
      if (
        node.nodeType === TEXT_NODE
        && String(node.textContent || "").replace(/\s+/gu, "")
      ) {
        return true;
      }
    }
    return false;
  }
  if (children.length > 0) return false;
  return Boolean(String(element.textContent || "").replace(/\s+/gu, ""));
}
