function escapeIdentifier(documentNode: Document, value: string): string {
  const cssApi = documentNode.defaultView?.CSS;
  if (cssApi?.escape) return cssApi.escape(value);
  return value.replace(/(^-?\d)|[^a-zA-Z0-9_-]/g, (match, leadingDigit: string | undefined) => {
    if (leadingDigit) return `\\3${leadingDigit} `;
    return `\\${match}`;
  });
}

function isUniqueSelector(documentNode: Document, selector: string): boolean {
  try {
    return documentNode.querySelectorAll(selector).length === 1;
  } catch {
    return false;
  }
}

export function selectorForElement(element: HTMLElement): string {
  const documentNode = element.ownerDocument;
  if (element === documentNode.body) return "body";
  if (element === documentNode.documentElement) return "html";

  if (element.id) {
    const idSelector = `#${escapeIdentifier(documentNode, element.id)}`;
    if (isUniqueSelector(documentNode, idSelector)) return idSelector;
  }

  for (const attributeName of ["data-ai-id", "data-testid", "data-section"]) {
    const value = element.getAttribute(attributeName);
    if (!value) continue;
    const escapedValue = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const attributeSelector = `[${attributeName}="${escapedValue}"]`;
    if (isUniqueSelector(documentNode, attributeSelector)) return attributeSelector;
  }

  const parts: string[] = [];
  let current: HTMLElement | null = element;

  while (current && current !== documentNode.body) {
    const tagName = current.tagName.toLowerCase();
    const classSelector = Array.from(current.classList)
      .filter((className) => !className.startsWith("html-canvas-"))
      .slice(0, 2)
      .map((className) => `.${escapeIdentifier(documentNode, className)}`)
      .join("");
    let part = `${tagName}${classSelector}`;

    const sameTagSiblings = current.parentElement
      ? Array.from(current.parentElement.children).filter((sibling) => sibling.tagName === current?.tagName)
      : [];
    if (sameTagSiblings.length > 1) {
      part += `:nth-of-type(${sameTagSiblings.indexOf(current) + 1})`;
    }
    parts.unshift(part);

    const candidate = parts.join(" > ");
    if (isUniqueSelector(documentNode, candidate)) return candidate;
    current = current.parentElement;
  }

  return `body > ${parts.join(" > ")}`;
}
