import type { HtmlCanvasSelection } from "../../components/HtmlCanvasEditor.types";
import { buildSourceIndex } from "../../lib/source-patch-core.js";
import {
  REVIEW_SOURCE_NODE_ATTRIBUTE,
  resolveReviewCommentSourceElement,
} from "../../lib/review-comment-source-map.js";
import type { CommentItem } from "../types";
import {
  REVIEW_COMMENT_GLOBAL_ATTRIBUTE,
  REVIEW_COMMENT_KEY_ATTRIBUTE,
} from "./constants";
import {
  reviewBootstrapElementBinding,
} from "./runtime-projection";
import type {
  ReviewCommentAnnotations,
  ReviewCommentBootstrapBinding,
  ReviewCommentTarget,
} from "./types";

export function resolvedCommentElement(
  document: Document,
  sourceIndex: ReturnType<typeof buildSourceIndex>,
  sourceElementsByNodeId: ReadonlyMap<string, Element>,
  target: HtmlCanvasSelection,
): Element | null {
  if (target.selector.trim().toLowerCase() === "body" && target.level === "module") {
    return document.body;
  }
  const sourceElement = resolveReviewCommentSourceElement(sourceIndex, target);
  if (sourceElement) {
    const sourceMappedElement = sourceElementsByNodeId.get(sourceElement.nodeId);
    if (sourceMappedElement) return sourceMappedElement;
    if (sourceElement.selector) {
      try {
        const matches = document.querySelectorAll(sourceElement.selector);
        if (matches.length === 1) return matches[0];
      } catch {
        // Fall through to the frozen selector below.
      }
    }
  }
  // The frozen target remains authoritative; a selector fallback is allowed
  // only when it resolves uniquely in that same immutable source document.
  try {
    const matches = target.selector ? document.querySelectorAll(target.selector) : [];
    return matches.length === 1 ? matches[0] : null;
  } catch {
    return null;
  }
}

export function clearReviewCommentScopeAttributes(
  document: Document,
): void {
  document.querySelectorAll(
    `[${REVIEW_COMMENT_KEY_ATTRIBUTE}], [${REVIEW_COMMENT_GLOBAL_ATTRIBUTE}]`,
  ).forEach((element) => {
    element.removeAttribute(REVIEW_COMMENT_KEY_ATTRIBUTE);
    element.removeAttribute(REVIEW_COMMENT_GLOBAL_ATTRIBUTE);
  });
}

export function reviewCommentBootstrapBindings(
  document: Document,
  reviewCommentTargets: readonly ReviewCommentTarget[],
): ReviewCommentBootstrapBinding[] {
  const sourceNodeIdsByKey = new Map(
    reviewCommentTargets.flatMap((target) => (
      target.sourceNodeId ? [[target.key, target.sourceNodeId] as const] : []
    )),
  );
  const bindings: ReviewCommentBootstrapBinding[] = [];
  const seenSourceNodeIds = new Set<string>();
  document.querySelectorAll(`[${REVIEW_COMMENT_KEY_ATTRIBUTE}]`).forEach((element) => {
    const key = element.getAttribute(REVIEW_COMMENT_KEY_ATTRIBUTE) || "";
    const sourceNodeId = sourceNodeIdsByKey.get(key);
    if (!sourceNodeId || seenSourceNodeIds.has(sourceNodeId)) return;
    const binding = reviewBootstrapElementBinding(document, element, true);
    if (!binding) return;
    seenSourceNodeIds.add(sourceNodeId);
    bindings.push({ ...binding, sourceNodeId });
  });
  return bindings;
}

export function durableReviewCommentTargetSelector(
  document: Document,
  sourceIndex: ReturnType<typeof buildSourceIndex>,
  element: Element,
  target: HtmlCanvasSelection,
): string | null {
  const sourceElement = resolveReviewCommentSourceElement(sourceIndex, target);
  const selector = sourceElement?.selector || "";
  // A positional selector can drift when authored code inserts, removes or
  // reorders same-tag siblings. A source-index selector is durable only when
  // it is rooted in the target's unique id, data attribute, name or aria label.
  if (
    !selector
    || /:nth-(?:child|of-type)\(/iu.test(selector)
    || !(
      selector.startsWith("#")
      || /\[\s*(?:data-[\w-]+|name|aria-label)\s*=/iu.test(selector)
    )
  ) return null;
  try {
    const matches = document.querySelectorAll(selector);
    return matches.length === 1 && matches[0] === element ? selector : null;
  } catch {
    return null;
  }
}

export function annotateReviewComments(
  document: Document,
  sourceHtml: string,
  comments: readonly CommentItem[],
  indexedSource?: ReturnType<typeof buildSourceIndex> | null,
): ReviewCommentAnnotations {
  if (!comments.length || !document.body) return { groups: [], targets: [] };
  let sourceIndex = indexedSource ?? null;
  try {
    sourceIndex ??= buildSourceIndex(sourceHtml);
  } catch {
    return { groups: [], targets: [] };
  }
  const sourceElementsByNodeId = new Map<string, Element>();
  const sourceNodeIdsByElement = new Map<Element, string>();
  document.querySelectorAll(`[${REVIEW_SOURCE_NODE_ATTRIBUTE}]`).forEach((element) => {
    const nodeId = element.getAttribute(REVIEW_SOURCE_NODE_ATTRIBUTE);
    if (nodeId && !sourceElementsByNodeId.has(nodeId)) {
      sourceElementsByNodeId.set(nodeId, element);
      sourceNodeIdsByElement.set(element, nodeId);
    }
  });
  const groups = new Map<Element, CommentItem[]>();
  comments.forEach((comment) => {
    if (!comment.text.trim() && !comment.attachments?.length) return;
    const element = resolvedCommentElement(
      document,
      sourceIndex,
      sourceElementsByNodeId,
      comment.target,
    );
    if (!element) return;
    const existing = groups.get(element);
    if (existing) existing.push(comment);
    else groups.set(element, [comment]);
  });
  if (!groups.size) return { groups: [], targets: [] };

  const targets: ReviewCommentTarget[] = [];
  const reviewGroups = [...groups.entries()].map(([element, items], index) => {
    const key = `review-comment-${index + 1}`;
    const global = element === document.body;
    element.setAttribute(REVIEW_COMMENT_KEY_ATTRIBUTE, key);
    if (global) {
      element.setAttribute(REVIEW_COMMENT_GLOBAL_ATTRIBUTE, "true");
    }
    const selector = global
      ? "body"
      : items.reduce<string | null>(
        (matched, item) => matched || durableReviewCommentTargetSelector(
          document,
          sourceIndex,
          element,
          item.target,
        ),
        null,
      );
    const sourceNodeId = global ? undefined : sourceNodeIdsByElement.get(element);
    if (selector || sourceNodeId) {
      targets.push({
        key,
        global,
        ...(selector ? { selector } : {}),
        ...(sourceNodeId ? { sourceNodeId } : {}),
      });
    }
    return {
      key,
      items: items.map((comment) => ({
        text: comment.text.trim()
          || `已添加 ${comment.attachments?.length || 0} 个参考附件`,
        attachmentCount: comment.attachments?.length || 0,
      })),
    };
  });
  return { groups: reviewGroups, targets };
}
