import { isTransparentSourceTextElement } from "./source-text-map.js";
import { isFrozenEditableIslandSubtree } from "./editable-island.js";

const ATOM_TAGS = new Set([
  "audio",
  "button",
  "canvas",
  "embed",
  "iframe",
  "img",
  "input",
  "math",
  "object",
  "ol",
  "select",
  "svg",
  "textarea",
  "ul",
  "video",
]);

export type NativeDomPoint = {
  node: Node;
  offset: number;
};

export type NativeDomLogicalToken = {
  kind: "text" | "hard-break" | "atom";
  node: Node;
  text: string;
  start: number;
  end: number;
};

export type NativeDomLogicalIndex = {
  tokens: NativeDomLogicalToken[];
  text: string;
  logicalLength: number;
  startByNode: WeakMap<Node, number>;
  endByNode: WeakMap<Node, number>;
  childIndexByNode: WeakMap<Node, number>;
  transparentInlineRanges: Array<{ startOffset: number; endOffset: number }>;
};

export function isNativeDomAtomElement(element: Element): boolean {
  return (
    ATOM_TAGS.has(element.localName)
    || isFrozenEditableIslandSubtree(element.localName, element.namespaceURI || undefined)
    || element.getAttribute("contenteditable") === "false"
  );
}

export function logicalIndexForHost(
  hostElement: HTMLElement,
): NativeDomLogicalIndex {
  const tokens: NativeDomLogicalToken[] = [];
  const textParts: string[] = [];
  const startByNode = new WeakMap<Node, number>();
  const endByNode = new WeakMap<Node, number>();
  const childIndexByNode = new WeakMap<Node, number>();
  const transparentInlineRanges: Array<{
    startOffset: number;
    endOffset: number;
  }> = [];
  let logicalOffset = 0;
  const visit = (node: Node) => {
    const startOffset = logicalOffset;
    startByNode.set(node, startOffset);
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node as Text).data;
      if (text.length === 0) {
        endByNode.set(node, logicalOffset);
        return;
      }
      tokens.push({
        kind: "text",
        node,
        text,
        start: logicalOffset,
        end: logicalOffset + text.length,
      });
      textParts.push(text);
      logicalOffset += text.length;
      endByNode.set(node, logicalOffset);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
      endByNode.set(node, logicalOffset);
      return;
    }
    const element = node as Element;
    if (element.localName === "br") {
      tokens.push({
        kind: "hard-break",
        node,
        text: "\n",
        start: logicalOffset,
        end: logicalOffset + 1,
      });
      textParts.push("\n");
      logicalOffset += 1;
      endByNode.set(node, logicalOffset);
      return;
    }
    if (element !== hostElement && isNativeDomAtomElement(element)) {
      tokens.push({
        kind: "atom",
        node,
        text: "\ufffc",
        start: logicalOffset,
        end: logicalOffset + 1,
      });
      textParts.push("\ufffc");
      logicalOffset += 1;
      endByNode.set(node, logicalOffset);
      return;
    }
    node.childNodes.forEach((child, childIndex) => {
      childIndexByNode.set(child, childIndex);
      visit(child);
    });
    if (
      node !== hostElement
      && isTransparentSourceTextElement(element.localName)
    ) {
      transparentInlineRanges.push({
        startOffset,
        endOffset: logicalOffset,
      });
    }
    endByNode.set(node, logicalOffset);
  };
  visit(hostElement);
  return {
    tokens,
    text: textParts.join(""),
    logicalLength: logicalOffset,
    startByNode,
    endByNode,
    childIndexByNode,
    transparentInlineRanges,
  };
}

export function tokensForHost(
  hostElement: HTMLElement,
): NativeDomLogicalToken[] {
  return logicalIndexForHost(hostElement).tokens;
}

export function nativeLogicalText(hostElement: HTMLElement): string {
  return logicalIndexForHost(hostElement).text;
}

/**
 * Resolves several DOM points in one traversal and stops as soon as every
 * point is known. Common collapsed selections near the start avoid a full
 * host scan; distant or cross-wrapper selections still share one scan.
 */
export function logicalOffsetsForDomPoints(
  hostElement: HTMLElement,
  points: Array<{ node: Node; offset: number }>,
): Array<number | null> {
  const results: Array<number | null> = points.map(() => null);
  const eligible = points.map(({ node }) => (
    node === hostElement || hostElement.contains(node)
  ));
  let unresolved = eligible.filter(Boolean).length;
  let consumed = 0;
  if (unresolved === 0) return results;

  const resolve = (node: Node, value: number) => {
    for (let index = 0; index < points.length; index += 1) {
      if (
        eligible[index]
        && results[index] === null
        && points[index].node === node
      ) {
        results[index] = value;
        unresolved -= 1;
      }
    }
  };

  const visit = (node: Node): void => {
    if (unresolved === 0) return;
    if (node.nodeType === Node.TEXT_NODE) {
      const length = (node as Text).data.length;
      for (let index = 0; index < points.length; index += 1) {
        if (
          eligible[index]
          && results[index] === null
          && points[index].node === node
        ) {
          results[index] = consumed + Math.max(
            0,
            Math.min(length, points[index].offset),
          );
          unresolved -= 1;
        }
      }
      consumed += length;
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
      resolve(node, consumed);
      return;
    }

    const element = node as Element;
    const children = node.childNodes;
    const pointChildLimits = points.map((point, index) => (
      eligible[index] && results[index] === null && point.node === node
        ? Math.max(0, Math.min(children.length, point.offset))
        : null
    ));
    for (let index = 0; index < pointChildLimits.length; index += 1) {
      if (pointChildLimits[index] === 0 && results[index] === null) {
        results[index] = consumed;
        unresolved -= 1;
      }
    }
    if (unresolved === 0) return;

    if (
      element !== hostElement
      && (
        element.localName === "br"
        || isNativeDomAtomElement(element)
      )
    ) {
      consumed += 1;
      return;
    }
    for (let childIndex = 0; childIndex < children.length; childIndex += 1) {
      const child = children.item(childIndex);
      if (child) visit(child);
      if (unresolved === 0) return;
      for (let index = 0; index < pointChildLimits.length; index += 1) {
        if (
          pointChildLimits[index] === childIndex + 1
          && results[index] === null
        ) {
          results[index] = consumed;
          unresolved -= 1;
        }
      }
      if (unresolved === 0) return;
    }
  };

  visit(hostElement);
  return results;
}

export function logicalOffsetForDomPoint(
  hostElement: HTMLElement,
  targetNode: Node,
  targetOffset: number,
  index: NativeDomLogicalIndex = logicalIndexForHost(hostElement),
): number | null {
  if (targetNode !== hostElement && !hostElement.contains(targetNode)) return null;
  const nodeStart = index.startByNode.get(targetNode);
  if (nodeStart === undefined) return null;
  if (targetNode.nodeType === Node.TEXT_NODE) {
    const length = (targetNode as Text).data.length;
    return nodeStart + Math.max(0, Math.min(length, targetOffset));
  }
  const children = targetNode.childNodes;
  const childLimit = Math.max(0, Math.min(children.length, targetOffset));
  if (childLimit === 0) return nodeStart;
  const precedingChild = children.item(childLimit - 1);
  return precedingChild
    ? index.endByNode.get(precedingChild) ?? nodeStart
    : nodeStart;
}

export function transparentInlineLogicalRanges(
  hostElement: HTMLElement,
  index: NativeDomLogicalIndex = logicalIndexForHost(hostElement),
): Array<{ startOffset: number; endOffset: number }> {
  return index.transparentInlineRanges;
}

export function domPointForLogicalOffset(
  hostElement: HTMLElement,
  logicalOffset: number,
  affinity: "left" | "right",
  hostIndex: NativeDomLogicalIndex = logicalIndexForHost(hostElement),
): NativeDomPoint {
  const tokens = hostIndex.tokens;
  const logicalLength = hostIndex.logicalLength;
  const clamped = Math.max(0, Math.min(logicalLength, logicalOffset));
  for (const token of tokens) {
    if (token.kind === "text") {
      if (clamped > token.start && clamped < token.end) {
        return { node: token.node, offset: clamped - token.start };
      }
      if (clamped === token.start && affinity === "right") {
        return { node: token.node, offset: 0 };
      }
      if (clamped === token.end && affinity === "left") {
        return { node: token.node, offset: token.text.length };
      }
    }
  }
  for (const token of tokens) {
    if (clamped === token.start || clamped === token.end) {
      const parent = token.node.parentNode;
      if (!parent) continue;
      const childIndex = hostIndex.childIndexByNode.get(token.node);
      if (childIndex === undefined) continue;
      return {
        node: parent,
        offset: childIndex + (clamped === token.end ? 1 : 0),
      };
    }
  }
  const lastText = [...tokens].reverse().find((token) => token.kind === "text");
  if (lastText?.node.nodeType === Node.TEXT_NODE) {
    return { node: lastText.node, offset: (lastText.node as Text).data.length };
  }
  return { node: hostElement, offset: hostElement.childNodes.length };
}
