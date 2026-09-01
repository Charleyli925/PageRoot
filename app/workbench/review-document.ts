// Review analysis facade: parse → pair → diff → bind → project → serialize.
import {
  appendTrustedReviewProjectionFact,
  serializeReviewProjectionFacts,
} from "../lib/review-projection-facts.js";
import {
  REVIEW_SOURCE_NODE_ATTRIBUTE,
  prepareReviewCommentSourceProjection,
} from "../lib/review-comment-source-map.js";
import {
  annotateReviewComments,
  clearReviewCommentScopeAttributes,
  reviewCommentBootstrapBindings,
} from "./review/comment-binding";
import {
  REVIEW_MOVED_TEXT_ACCOUNTED_ATTRIBUTE,
  REVIEW_PROJECTION_FACTS_ATTRIBUTE,
} from "./review/constants";
import {
  annotateActionPairs,
  annotatePanelPairs,
  candidateSections,
  changeLabel,
  clearReservedReviewMarkup,
  helperText,
  normalizedMarkup,
  regionGroupLabel,
  reviewProjectionFactsForElement,
} from "./review/parse";
import {
  reviewBootstrap,
} from "./review/runtime-projection";
import {
  buildReviewVisualEvidence,
} from "./review/review-visual-model.js";
import {
  buildReviewSemanticPairGraphSteps,
  pairSections,
} from "./review/semantic-pairing";
import {
  prepareDocument,
} from "./review/serialize";
import {
  markStructureDifferenceSteps,
} from "./review/structure-diff";
import {
  markSemanticTextDifferences,
} from "./review/text-diff";
import {
  annotateStableSourceDifferences,
} from "./review/stable-source-diff";
import type {
  ReviewChange,
  ReviewChangeType,
  ReviewDiagnostic,
  ReviewDocumentBuildOptions,
  ReviewDocuments,
  ReviewOutlineItem,
  ReviewPresentation,
  ReviewRevealStep,
  ReviewSemanticPairGraph,
  SectionPair,
} from "./review/types";

export {
  REVIEW_STRUCTURE_TONE_COLOR,
} from "./review/tones";
export type {
  ReviewChange,
  ReviewChangeType,
  ReviewCommentGroup,
  ReviewCommentTarget,
  ReviewDiagnostic,
  ReviewDocumentBuildOptions,
  ReviewDocuments,
  ReviewImpact,
  ReviewPresentation,
  ReviewRevealStep,
  ReviewFilter,
  ReviewOutlineItem,
  ReviewSide,
} from "./review/types";

function* changeTypesForSemanticGraphSteps(
  graph: ReviewSemanticPairGraph,
): Generator<"semantic-row", ReviewChangeType[], void> {
  const structureChanged = yield* markStructureDifferenceSteps(graph);
  const textMarking = markSemanticTextDifferences(graph);
  return [
    ...(textMarking.changed ? ["text" as const] : []),
    ...(structureChanged ? ["structure" as const] : []),
  ];
}

function* annotateChangePairSteps(
  pair: SectionPair,
  usePersistentIdentity: boolean,
  ambiguousPersistentIds: ReadonlySet<string>,
): Generator<"semantic-row", ReviewChangeType[], void> {
  const graph = yield* buildReviewSemanticPairGraphSteps(pair, {
    usePersistentIdentity,
    ambiguousPersistentIds,
  });
  return yield* changeTypesForSemanticGraphSteps(graph);
}

function* annotateMovedStableSubtreeSteps(
  movedPairs: Array<{
    id: string;
    before: Element;
    after: Element;
    outermost: boolean;
  }>,
  ambiguousPersistentIds: ReadonlySet<string>,
): Generator<"semantic-row", void, void> {
  for (const movedPair of movedPairs) {
    const graph = yield* buildReviewSemanticPairGraphSteps({
      before: movedPair.before,
      after: movedPair.after,
      beforeIndex: -1,
      afterIndex: -1,
    }, {
      usePersistentIdentity: true,
      ambiguousPersistentIds,
      ownerNamespace: `moved-${movedPair.id}`,
    });
    if (movedPair.outermost) yield* markStructureDifferenceSteps(graph);
    markSemanticTextDifferences(graph);
    movedPair.before.setAttribute(REVIEW_MOVED_TEXT_ACCOUNTED_ATTRIBUTE, "true");
    movedPair.after.setAttribute(REVIEW_MOVED_TEXT_ACCOUNTED_ATTRIBUTE, "true");
  }
}

function attachChangeMarkerMetadata(
  pair: SectionPair,
  changeId: string,
  helper: string,
  includeDescendants = true,
) {
  const structureSummary = (change: string) => ({
    added: "新增元素",
    removed: "删除元素",
    moved: "移动元素",
    reordered: "元素顺序调整",
    attribute: "属性调整",
    style: "样式调整",
  }[change] || "元素调整");
  const attachRoots = (roots: Array<Element | null>) => roots.forEach((root) => {
    if (!root) return;
    [root, ...(includeDescendants
      ? root.querySelectorAll("[data-pageroot-review-text-anchors]")
      : [])]
      .filter((element) => element.hasAttribute("data-pageroot-review-text-anchors"))
      .forEach((element) => {
        element.setAttribute("data-pageroot-review-anchor-change", changeId);
      });
    const markerElements = [root, ...(includeDescendants ? root.querySelectorAll("*") : [])]
      .filter((element) => (
      element.hasAttribute("data-pageroot-review-text")
      || element.hasAttribute("data-pageroot-review-structure")
      || element.hasAttribute(REVIEW_PROJECTION_FACTS_ATTRIBUTE)
    ));
    markerElements.forEach((element, index) => {
      let facts = reviewProjectionFactsForElement(element);
      const textMarker = element.hasAttribute("data-pageroot-review-text");
      const textOperation = element.getAttribute("data-pageroot-review-text-operation");
      const normalizedTextOperation = textOperation === "none"
        || textOperation === "insert"
        || textOperation === "delete"
        || textOperation === "replace"
        ? textOperation
        : null;
      const textSummary = textMarker
        ? textOperation === "insert"
          ? "新增内容"
          : textOperation === "delete"
            ? "删除内容"
            : "文本调整"
        : "";
      if (textMarker) {
        const semanticOwnerId = element.getAttribute("data-pageroot-review-semantic-owner")
          || `fallback-owner-${changeId}-text-${index + 1}`;
        const geometryOwnerId = element.getAttribute("data-pageroot-review-geometry-owner") || "";
        const textGroup = element.getAttribute("data-pageroot-review-text-group")
          || `text-marker-${index + 1}`;
        facts = appendTrustedReviewProjectionFact(facts, {
          id: textGroup,
          type: "text",
          semanticOwnerId,
          ...(geometryOwnerId ? { geometryOwnerId } : {}),
          scope: "text",
          tone: element.getAttribute("data-pageroot-review-text") === "removed"
            ? "removed"
            : "added",
          textGroup,
          ...(normalizedTextOperation ? { operation: normalizedTextOperation } : {}),
          summary: textSummary,
        });
      }
      if (element.hasAttribute("data-pageroot-review-structure")) {
        const semanticOwnerId = element.getAttribute("data-pageroot-review-semantic-owner")
          || `fallback-owner-${changeId}-structure-${index + 1}`;
        const geometryOwnerId = element.getAttribute("data-pageroot-review-geometry-owner") || "";
        const structureChange = element.getAttribute("data-pageroot-review-structure") || "changed";
        if (!facts.some((fact) => (
          fact.type === "structure"
          && fact.semanticOwnerId === semanticOwnerId
          && fact.structureChange === structureChange
        ))) {
          facts = appendTrustedReviewProjectionFact(facts, {
            id: `structure-${semanticOwnerId}-${structureChange}`,
            type: "structure",
            semanticOwnerId,
            ...(geometryOwnerId ? { geometryOwnerId } : {}),
            scope: "element",
            structureChange,
            summary: structureSummary(structureChange),
          });
        }
      }
      const markerTypes = [...new Set(facts.map((fact) => fact.type))] as ReviewChangeType[];
      const textFact = facts.find((fact) => fact.type === "text");
      const structureFact = facts.find((fact) => fact.type === "structure");
      const summary = textFact?.summary
        || structureFact?.summary
        || helper;
      element.setAttribute("data-pageroot-review-marker", changeId);
      element.setAttribute("data-pageroot-review-marker-types", markerTypes.join(" "));
      element.setAttribute("data-pageroot-review-summary", summary);
      element.setAttribute(REVIEW_PROJECTION_FACTS_ATTRIBUTE, serializeReviewProjectionFacts(facts));
      element.setAttribute("data-pageroot-review-active", "false");
      if (index === 0) element.setAttribute("data-pageroot-review-primary", "true");
    });
  });
  attachRoots([pair.before, pair.after]);
}

function visualStableIdsForChange(pair: SectionPair, changeId: string) {
  const stableIds = new Set<string>();
  [pair.before, pair.after].forEach((root) => {
    if (!root) return;
    [root, ...root.querySelectorAll(`[data-pageroot-review-marker="${changeId}"]`)]
      .filter((element) => element.getAttribute("data-pageroot-review-marker") === changeId)
      .forEach((element) => {
        const stableHost = element.closest("[data-pageroot-id]");
        const stableId = stableHost?.getAttribute("data-pageroot-id") || "";
        if (stableId) stableIds.add(stableId);
      });
  });
  if (!stableIds.size) {
    const rootStableId = (pair.after || pair.before)?.getAttribute("data-pageroot-id") || "";
    if (rootStableId) stableIds.add(rootStableId);
  }
  return [...stableIds];
}

function revealStepsForElement(element: Element | null): ReviewRevealStep[] {
  if (!element) return [];
  const steps: ReviewRevealStep[] = [];
  let candidate: Element | null = element;
  while (candidate && candidate !== element.ownerDocument.body) {
    if (candidate.getAttribute("data-pageroot-review-panel-container") === "true") {
      const key = candidate.getAttribute("data-pageroot-review-panel-key") || "";
      if (key) steps.unshift({ kind: "panel", key });
    }
    if (candidate.tagName === "DETAILS") {
      const stableId = candidate.getAttribute("data-pageroot-id") || "";
      if (stableId) steps.unshift({ kind: "details", stableId });
    }
    candidate = candidate.parentElement;
  }
  const seen = new Set<string>();
  return steps.filter((step) => {
    const key = step.kind === "panel" ? `panel:${step.key}` : `details:${step.stableId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function presentationElement(
  root: Element | null,
  changeId: string,
  evidenceStableIds: readonly string[],
): Element | null {
  if (!root) return null;
  const selector = `[data-pageroot-review-marker="${changeId}"]`;
  const markers = [
    ...(root.matches(selector) ? [root] : []),
    ...root.querySelectorAll(selector),
  ];
  const preciseMarker = markers.find((element) => (
    element.matches("[data-pageroot-review-text],[data-pageroot-review-structure]")
  ));
  if (preciseMarker) return preciseMarker;
  const stableHost = [
    ...(root.hasAttribute("data-pageroot-id") ? [root] : []),
    ...root.querySelectorAll("[data-pageroot-id]"),
  ].find((element) => evidenceStableIds.includes(
    element.getAttribute("data-pageroot-id") || "",
  ));
  if (stableHost) return stableHost;
  return markers.find((element) => {
      const stableId = element.closest("[data-pageroot-id]")?.getAttribute("data-pageroot-id") || "";
      return evidenceStableIds.includes(stableId);
    })
    || markers.find((element) => element.getAttribute("data-pageroot-review-primary") === "true")
    || markers[0]
    || root;
}

function reviewPresentationForChange(
  pair: SectionPair,
  changeId: string,
  evidenceStableIds: readonly string[],
): ReviewPresentation {
  const preciseStableIds = [...new Set([pair.before, pair.after].flatMap((root) => {
    if (!root) return [];
    const selector = `[data-pageroot-review-marker="${changeId}"]`;
    return [
      ...(root.matches(selector) ? [root] : []),
      ...root.querySelectorAll(selector),
    ].flatMap((element) => {
      if (!element.matches("[data-pageroot-review-text],[data-pageroot-review-structure]")) {
        return [];
      }
      const stableId = element.closest("[data-pageroot-id]")
        ?.getAttribute("data-pageroot-id") || "";
      return stableId ? [stableId] : [];
    });
  }))];
  const presentationStableIds = preciseStableIds.length
    ? preciseStableIds
    : evidenceStableIds;
  return {
    before: revealStepsForElement(presentationElement(
      pair.before,
      changeId,
      presentationStableIds,
    )),
    after: revealStepsForElement(presentationElement(
      pair.after,
      changeId,
      presentationStableIds,
    )),
  };
}

function hasPreannotatedStableDifference(pair: SectionPair): boolean {
  const selector = "[data-pageroot-review-text],[data-pageroot-review-structure]";
  return [pair.before, pair.after].some((root) => Boolean(
    root && (root.matches(selector) || root.querySelector(selector)),
  ));
}

export function pageSourceOnlyReviewDiagnostics(
  beforeHtml: string,
  afterHtml: string,
): ReviewDiagnostic[] | null {
  if (typeof DOMParser === "undefined" || beforeHtml === afterHtml) return null;
  const visual = buildReviewVisualEvidence(beforeHtml, afterHtml, "source-only-check");
  if (visual.binding.identity !== "supported" || visual.evidence.length) return null;
  const parser = new DOMParser();
  const beforeDocument = parser.parseFromString(beforeHtml, "text/html");
  const afterDocument = parser.parseFromString(afterHtml, "text/html");
  clearReservedReviewMarkup(beforeDocument);
  clearReservedReviewMarkup(afterDocument);
  const analysis = annotateStableSourceDifferences(beforeDocument, afterDocument);
  if (beforeDocument.querySelector("[data-pageroot-review-structure]")
    || afterDocument.querySelector("[data-pageroot-review-structure]")) return null;
  const diagnostics = analysis.sourceKinds.map((kind) => ({
    kind,
    summary: kind === "css-source" ? "CSS 源码发生变化" : "Script 源码发生变化",
  }));
  return diagnostics.length ? diagnostics : null;
}

function* buildReviewDocumentSteps(
  beforeHtml: string,
  afterHtml: string,
  options: ReviewDocumentBuildOptions,
): Generator<string, ReviewDocuments, void> {
  const visual = buildReviewVisualEvidence(beforeHtml, afterHtml, options.sessionId);
  const visualStableIds = (side: "before" | "after") => visual.evidence
    .filter((evidence) => side === "before" ? evidence.beforePresent : evidence.afterPresent)
    .map((evidence) => evidence.stableId);
  if (typeof DOMParser === "undefined") {
    return {
      before: beforeHtml,
      after: afterHtml,
      bootstrapJavaScript: {
        before: reviewBootstrap(
          options.sessionId,
          "before",
          [],
          visualStableIds("before"),
        ),
        after: reviewBootstrap(
          options.sessionId,
          "after",
          [],
          visualStableIds("after"),
        ),
      },
      bootstrapFallbackJavaScript: {
        before: reviewBootstrap(
          options.sessionId,
          "before",
          [],
          visualStableIds("before"),
        ),
        after: reviewBootstrap(
          options.sessionId,
          "after",
          [],
          visualStableIds("after"),
        ),
      },
      changes: [],
      outline: [],
      commentGroups: [],
      commentTargets: [],
      visualBinding: visual.binding,
      visualEvidence: visual.evidence,
      diagnostics: [],
      ...(options.reviewImpact ? { reviewImpact: options.reviewImpact } : {}),
    };
  }
  const parser = new DOMParser();
  const comments = options.comments || [];
  const beforeSourceProjection = prepareReviewCommentSourceProjection(beforeHtml, true);
  const afterSourceProjection = prepareReviewCommentSourceProjection(afterHtml, true);
  const beforeDocument = parser.parseFromString(beforeSourceProjection.html, "text/html");
  const afterDocument = parser.parseFromString(afterSourceProjection.html, "text/html");
  clearReservedReviewMarkup(beforeDocument, beforeSourceProjection.projected);
  clearReservedReviewMarkup(afterDocument, afterSourceProjection.projected);
  yield "parse";
  const commentAnnotations = annotateReviewComments(
    beforeDocument,
    beforeHtml,
    comments,
    beforeSourceProjection.sourceIndex,
  );
  const commentGroups = commentAnnotations.groups;
  const reviewCommentTargets = commentAnnotations.targets;
  const preparedVisualStableIds = (side: "before" | "after") => [...new Set([
    ...visualStableIds(side),
    ...reviewCommentTargets.flatMap((target) => target.stableId ? [target.stableId] : []),
  ])];
  [beforeDocument, afterDocument].forEach((document) => {
    document.querySelectorAll(`[${REVIEW_SOURCE_NODE_ATTRIBUTE}]`).forEach((element) => {
      element.removeAttribute(REVIEW_SOURCE_NODE_ATTRIBUTE);
    });
  });
  yield "comments";
  annotatePanelPairs(beforeDocument, afterDocument);
  yield "panels";
  annotateActionPairs(beforeDocument, afterDocument);
  yield "actions";
  const stableSourceAnalysis = annotateStableSourceDifferences(beforeDocument, afterDocument);
  const ambiguousPersistentIds = new Set(stableSourceAnalysis.ambiguousPersistentIds);
  yield "stable-source";
  if (
    visual.binding.identity === "supported"
    && visual.evidence.length === 0
    && stableSourceAnalysis.sourceKinds.length > 0
    && !beforeDocument.querySelector("[data-pageroot-review-structure]")
    && !afterDocument.querySelector("[data-pageroot-review-structure]")
  ) {
    const diagnostics: ReviewDiagnostic[] = stableSourceAnalysis.sourceKinds.map((kind) => ({
      kind,
      summary: kind === "css-source" ? "CSS 源码发生变化" : "Script 源码发生变化",
    }));
    const reviewCommentBindings = reviewCommentBootstrapBindings(
      beforeDocument,
      reviewCommentTargets,
    );
    clearReviewCommentScopeAttributes(beforeDocument);
    const preparedBefore = prepareDocument(
      beforeDocument,
      "before",
      options.sessionId,
      options.sourcePath,
      options.externalBootstrap,
      reviewCommentBindings,
      preparedVisualStableIds("before"),
    );
    yield "prepare-before";
    const preparedAfter = prepareDocument(
      afterDocument,
      "after",
      options.sessionId,
      options.sourcePath,
      options.externalBootstrap,
      [],
      preparedVisualStableIds("after"),
    );
    yield "prepare-after";
    return {
      before: preparedBefore.html,
      after: preparedAfter.html,
      bootstrapJavaScript: {
        before: preparedBefore.bootstrapJavaScript,
        after: preparedAfter.bootstrapJavaScript,
      },
      bootstrapFallbackJavaScript: {
        before: preparedBefore.bootstrapFallbackJavaScript,
        after: preparedAfter.bootstrapFallbackJavaScript,
      },
      changes: [],
      outline: [],
      commentGroups,
      commentTargets: reviewCommentTargets,
      visualBinding: visual.binding,
      visualEvidence: visual.evidence,
      diagnostics,
      ...(options.reviewImpact ? { reviewImpact: options.reviewImpact } : {}),
    };
  }
  // Freeze authored candidate regions and their pairing before moved-text
  // annotation inserts disposable review spans. The pre-pass may mutate text
  // nodes, but it must never redefine which authored element owns a movement.
  const beforeSections = candidateSections(beforeDocument);
  yield "candidate-sections-before";
  const afterSections = candidateSections(afterDocument);
  yield "candidate-sections-after";
  const pairs = pairSections(beforeSections, afterSections, {
    usePersistentIdentity: stableSourceAnalysis.hasPersistentContinuity,
    ambiguousPersistentIds,
  });
  yield* annotateMovedStableSubtreeSteps(
    stableSourceAnalysis.movedPairs,
    ambiguousPersistentIds,
  );
  const changes: ReviewChange[] = [];
  const outline: ReviewOutlineItem[] = [];
  yield "section-pairing";

  for (const [pairIndex, pair] of pairs.entries()) {
    const outlineId = `outline-${outline.length + 1}`;
    const label = changeLabel(pair.before, pair.after, pairIndex);
    const exactStablePair = Boolean(
      pair.before
      && pair.after
      && normalizedMarkup(pair.before) === normalizedMarkup(pair.after)
      && !hasPreannotatedStableDifference(pair)
    );
    let types: ReviewChangeType[] = [];
    if (!exactStablePair) {
      const annotationSteps = annotateChangePairSteps(
        pair,
        stableSourceAnalysis.hasPersistentContinuity,
        ambiguousPersistentIds,
      );
      let annotationStep = annotationSteps.next();
      while (!annotationStep.done) {
        yield annotationStep.value;
        annotationStep = annotationSteps.next();
      }
      types = annotationStep.value;
    }
    const changeId = types.length ? `change-${changes.length + 1}` : undefined;
    const helper = types.length
      ? helperText(types, Boolean(pair.before), Boolean(pair.after), pair)
      : "本轮未修改";
    if (changeId) attachChangeMarkerMetadata(pair, changeId, helper);
    const evidenceStableIds = changeId ? visualStableIdsForChange(pair, changeId) : [];
    const presentation = changeId
      ? reviewPresentationForChange(pair, changeId, evidenceStableIds)
      : undefined;
    [pair.before, pair.after].forEach((element) => {
      if (!element) return;
      element.setAttribute("data-pageroot-outline-id", outlineId);
      element.setAttribute("data-pageroot-review-active", "false");
      if (changeId) {
        element.setAttribute("data-pageroot-review-id", changeId);
        element.setAttribute("data-pageroot-review-types", types.join(" "));
        element.setAttribute("data-pageroot-review-summary", helper);
      }
    });
    if (changeId) {
      changes.push({
        id: changeId,
        ...(evidenceStableIds.length ? { evidenceStableIds } : {}),
        label,
        helper,
        types,
        beforePresent: Boolean(pair.before),
        afterPresent: Boolean(pair.after),
        presentation: presentation!,
      });
    }
    const preferredElement = pair.after || pair.before;
    const preferredDocument = pair.after ? afterDocument : beforeDocument;
    outline.push({
      id: outlineId,
      group: regionGroupLabel(preferredElement, preferredDocument),
      label,
      helper,
      types,
      ...(changeId ? { changeId } : {}),
      ...(presentation ? { presentation } : {}),
    });
    if ((pairIndex + 1) % 24 === 0) yield "change-annotation";
  }

  const diagnostics: ReviewDiagnostic[] = stableSourceAnalysis.sourceKinds.map((kind) => ({
    kind,
    summary: kind === "css-source" ? "CSS 源码发生变化" : "Script 源码发生变化",
  }));

  // Comment attributes are analyzer-only scope hints. Bind every resolved
  // source target in the private first bootstrap, then remove the hints before
  // either document is serialized or can be read back by authored page code.
  const reviewCommentBindings = reviewCommentBootstrapBindings(
    beforeDocument,
    reviewCommentTargets,
  );
  clearReviewCommentScopeAttributes(beforeDocument);
  const preparedBefore = prepareDocument(
    beforeDocument,
    "before",
    options.sessionId,
    options.sourcePath,
    options.externalBootstrap,
    reviewCommentBindings,
    preparedVisualStableIds("before"),
  );
  yield "prepare-before";
  const preparedAfter = prepareDocument(
    afterDocument,
    "after",
    options.sessionId,
    options.sourcePath,
    options.externalBootstrap,
    [],
    preparedVisualStableIds("after"),
  );
  yield "prepare-after";
  return {
    before: preparedBefore.html,
    after: preparedAfter.html,
    bootstrapJavaScript: {
      before: preparedBefore.bootstrapJavaScript,
      after: preparedAfter.bootstrapJavaScript,
    },
    bootstrapFallbackJavaScript: {
      before: preparedBefore.bootstrapFallbackJavaScript,
      after: preparedAfter.bootstrapFallbackJavaScript,
    },
    changes,
    outline,
    commentGroups,
    commentTargets: reviewCommentTargets,
    visualBinding: visual.binding,
    visualEvidence: visual.evidence,
    diagnostics,
    ...(options.reviewImpact ? { reviewImpact: options.reviewImpact } : {}),
  };
}

export function buildReviewDocuments(
  beforeHtml: string,
  afterHtml: string,
  options: ReviewDocumentBuildOptions,
): ReviewDocuments {
  const steps = buildReviewDocumentSteps(beforeHtml, afterHtml, options);
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}

/**
 * Builds the minimum safe formal-review transport before semantic diffing.
 * It preserves the same authored-page sandbox/bootstrap contract as the full
 * review, but intentionally carries no change, comment or runtime facts.
 */
export function buildReviewShellDocuments(
  beforeHtml: string,
  afterHtml: string,
  options: ReviewDocumentBuildOptions,
): ReviewDocuments {
  const visual = buildReviewVisualEvidence(beforeHtml, afterHtml, options.sessionId);
  const visualStableIds = (side: "before" | "after") => visual.evidence
    .filter((evidence) => side === "before" ? evidence.beforePresent : evidence.afterPresent)
    .map((evidence) => evidence.stableId);
  if (typeof DOMParser === "undefined") {
    return {
      before: beforeHtml,
      after: afterHtml,
      bootstrapJavaScript: {
        before: reviewBootstrap(options.sessionId, "before", [], visualStableIds("before")),
        after: reviewBootstrap(options.sessionId, "after", [], visualStableIds("after")),
      },
      bootstrapFallbackJavaScript: {
        before: reviewBootstrap(options.sessionId, "before", [], visualStableIds("before")),
        after: reviewBootstrap(options.sessionId, "after", [], visualStableIds("after")),
      },
      changes: [],
      outline: [],
      commentGroups: [],
      commentTargets: [],
      visualBinding: visual.binding,
      visualEvidence: visual.evidence,
      diagnostics: [],
      ...(options.reviewImpact ? { reviewImpact: options.reviewImpact } : {}),
    };
  }
  const parser = new DOMParser();
  const beforeDocument = parser.parseFromString(beforeHtml, "text/html");
  const afterDocument = parser.parseFromString(afterHtml, "text/html");
  clearReservedReviewMarkup(beforeDocument);
  clearReservedReviewMarkup(afterDocument);
  const preparedBefore = prepareDocument(
    beforeDocument,
    "before",
    options.sessionId,
    options.sourcePath,
    options.externalBootstrap,
    [],
    visualStableIds("before"),
  );
  const preparedAfter = prepareDocument(
    afterDocument,
    "after",
    options.sessionId,
    options.sourcePath,
    options.externalBootstrap,
    [],
    visualStableIds("after"),
  );
  return {
    before: preparedBefore.html,
    after: preparedAfter.html,
    bootstrapJavaScript: {
      before: preparedBefore.bootstrapJavaScript,
      after: preparedAfter.bootstrapJavaScript,
    },
    bootstrapFallbackJavaScript: {
      before: preparedBefore.bootstrapFallbackJavaScript,
      after: preparedAfter.bootstrapFallbackJavaScript,
    },
    changes: [],
    outline: [],
    commentGroups: [],
    commentTargets: [],
    visualBinding: visual.binding,
    visualEvidence: visual.evidence,
    diagnostics: [],
    ...(options.reviewImpact ? { reviewImpact: options.reviewImpact } : {}),
  };
}

function yieldReviewAnalysisTask(): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, 0));
}

function measureReviewAnalysisPhase(
  phase: string,
  startedAt: number,
  endedAt: number,
) {
  try {
    globalThis.performance?.measure?.(
      `pageroot:review-analysis:${phase}`,
      { start: startedAt, end: endedAt },
    );
  } catch {
    // Performance diagnostics cannot own review availability.
  }
}

export async function buildReviewDocumentsAsync(
  beforeHtml: string,
  afterHtml: string,
  options: ReviewDocumentBuildOptions,
  control: { isCancelled?: () => boolean } = {},
): Promise<ReviewDocuments> {
  [
    "parse",
    "comments",
    "panels",
    "actions",
    "stable-source",
    "candidate-sections-before",
    "candidate-sections-after",
    "section-pairing",
    "semantic-row",
    "change-annotation",
    "prepare-before",
    "prepare-after",
    "complete",
  ].forEach((phase) => {
    try {
      globalThis.performance?.clearMeasures?.(
        `pageroot:review-analysis:${phase}`,
      );
    } catch {
      // Diagnostics cannot own review analysis.
    }
  });
  const steps = buildReviewDocumentSteps(beforeHtml, afterHtml, options);
  const assertCurrent = () => {
    if (control.isCancelled?.()) {
      throw new Error("Review document analysis was superseded.");
    }
  };
  assertCurrent();
  let segmentStartedAt = globalThis.performance?.now?.() ?? Date.now();
  let step = steps.next();
  let segmentEndedAt = globalThis.performance?.now?.() ?? Date.now();
  measureReviewAnalysisPhase(
    step.done ? "complete" : step.value,
    segmentStartedAt,
    segmentEndedAt,
  );
  while (!step.done) {
    await yieldReviewAnalysisTask();
    assertCurrent();
    segmentStartedAt = globalThis.performance?.now?.() ?? Date.now();
    step = steps.next();
    segmentEndedAt = globalThis.performance?.now?.() ?? Date.now();
    measureReviewAnalysisPhase(
      step.done ? "complete" : step.value,
      segmentStartedAt,
      segmentEndedAt,
    );
  }
  assertCurrent();
  return step.value;
}
