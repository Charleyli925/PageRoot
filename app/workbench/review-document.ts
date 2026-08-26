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
  createReviewRuntimeVisualCaptureIdentity,
} from "./review-runtime-capture-adapter";
import {
  annotateReviewComments,
  clearReviewCommentScopeAttributes,
  reviewCommentBootstrapBindings,
} from "./review/comment-binding";
import {
  REVIEW_COMMENT_GLOBAL_ATTRIBUTE,
  REVIEW_COMMENT_KEY_ATTRIBUTE,
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
  ancestorMarkupSignature,
  panelPathForElement,
  regionGroupLabel,
  reviewProjectionFactsForElement,
  reviewStylesheetSignature,
  sourceElementsByNodeId,
} from "./review/parse";
import {
  annotateRuntimeVisualCandidates,
  reviewBootstrap,
} from "./review/runtime-projection";
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
  markStyleDifferences,
  semanticLayoutPairs,
} from "./review/style-diff";
import {
  markSemanticTextDifferences,
} from "./review/text-diff";
import type {
  ReviewChange,
  ReviewChangeType,
  ReviewDocumentBuildOptions,
  ReviewDocuments,
  ReviewOutlineItem,
  ReviewRuntimeVisualAnnotations,
  ReviewSemanticPairGraph,
  SectionPair,
} from "./review/types";

export {
  REVIEW_STRUCTURE_TONE_COLOR,
  REVIEW_STYLE_TONE_COLOR,
  REVIEW_SUSPECTED_TONE_COLOR,
} from "./review/tones";
export type {
  ReviewChange,
  ReviewChangeType,
  ReviewCommentGroup,
  ReviewCommentTarget,
  ReviewDocumentBuildOptions,
  ReviewDocuments,
  ReviewFilter,
  ReviewOutlineItem,
  ReviewSide,
} from "./review/types";

function* changeTypesForSemanticGraphSteps(
  graph: ReviewSemanticPairGraph,
): Generator<"semantic-row", ReviewChangeType[], void> {
  // Style inspection still runs against the unwrapped source DOM. The same
  // layout planner identifies visual-only pairs first; text marking consumes
  // it again below to avoid fabricating red/green evidence.
  const layoutPairs = semanticLayoutPairs(graph);
  const structureChanged = yield* markStructureDifferenceSteps(graph);
  const styleChanged = markStyleDifferences(graph, layoutPairs);
  const textMarking = markSemanticTextDifferences(graph);
  return [
    ...(textMarking.changed ? ["text" as const] : []),
    ...(structureChanged ? ["structure" as const] : []),
    ...(styleChanged ? ["style" as const] : []),
  ];
}

function* annotateChangePairSteps(
  pair: SectionPair,
): Generator<"semantic-row", ReviewChangeType[], void> {
  const graph = yield* buildReviewSemanticPairGraphSteps(pair);
  return yield* changeTypesForSemanticGraphSteps(graph);
}

function attachChangeMarkerMetadata(
  pair: SectionPair,
  changeId: string,
  helper: string,
) {
  [pair.before, pair.after].forEach((root) => {
    if (!root) return;
    [root, ...root.querySelectorAll("[data-pageroot-review-text-anchors]")]
      .filter((element) => element.hasAttribute("data-pageroot-review-text-anchors"))
      .forEach((element) => {
        element.setAttribute("data-pageroot-review-anchor-change", changeId);
      });
    const markerElements = [root, ...root.querySelectorAll("*")].filter((element) => (
      element.hasAttribute("data-pageroot-review-text")
      || element.hasAttribute("data-pageroot-review-structure")
      || element.hasAttribute("data-pageroot-review-style")
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
        || textOperation === "layout"
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
        facts = appendTrustedReviewProjectionFact(facts, {
          id: `structure-${semanticOwnerId}-${structureChange}`,
          type: "structure",
          semanticOwnerId,
          ...(geometryOwnerId ? { geometryOwnerId } : {}),
          scope: "element",
          structureChange,
          summary: structureChange === "from" || structureChange === "to"
            ? "位置调整"
            : "结构调整",
        });
      }
      const markerTypes = [...new Set(facts.map((fact) => fact.type))] as ReviewChangeType[];
      const textFact = facts.find((fact) => fact.type === "text");
      const visualFact = facts.find((fact) => (
        fact.type === "style" && fact.operation !== "layout"
      ));
      const layoutFact = facts.find((fact) => (
        fact.type === "style" && fact.operation === "layout"
      ));
      const structureFact = facts.find((fact) => fact.type === "structure");
      const summary = textFact?.summary
        || visualFact?.summary
        || layoutFact?.summary
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
}

function* buildReviewDocumentSteps(
  beforeHtml: string,
  afterHtml: string,
  options: ReviewDocumentBuildOptions,
): Generator<string, ReviewDocuments, void> {
  const runtimeVisualCaptureIdentity = createReviewRuntimeVisualCaptureIdentity({
    sessionId: options.sessionId,
    sourceSha256BySide: options.sourceSha256BySide,
  });
  if (typeof DOMParser === "undefined") {
    return {
      before: beforeHtml,
      after: afterHtml,
      bootstrapJavaScript: {
        before: reviewBootstrap(
          runtimeVisualCaptureIdentity.sessionId,
          "before",
          runtimeVisualCaptureIdentity.sourceSha256BySide.before,
        ),
        after: reviewBootstrap(
          runtimeVisualCaptureIdentity.sessionId,
          "after",
          runtimeVisualCaptureIdentity.sourceSha256BySide.after,
        ),
      },
      bootstrapFallbackJavaScript: {
        before: reviewBootstrap(
          runtimeVisualCaptureIdentity.sessionId,
          "before",
          runtimeVisualCaptureIdentity.sourceSha256BySide.before,
        ),
        after: reviewBootstrap(
          runtimeVisualCaptureIdentity.sessionId,
          "after",
          runtimeVisualCaptureIdentity.sourceSha256BySide.after,
        ),
      },
      changes: [],
      outline: [],
      runtimeVisualCandidates: [],
      runtimeVisualCaptureCandidates: { before: [], after: [] },
      runtimeVisualSourceHtml: { before: beforeHtml, after: afterHtml },
      runtimeVisualCaptureIdentity,
      commentGroups: [],
      commentTargets: [],
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
  const beforeSourceElements = sourceElementsByNodeId(beforeDocument);
  const afterSourceElements = sourceElementsByNodeId(afterDocument);
  yield "parse";
  const commentAnnotations = annotateReviewComments(
    beforeDocument,
    beforeHtml,
    comments,
    beforeSourceProjection.sourceIndex,
  );
  const commentGroups = commentAnnotations.groups;
  const reviewCommentTargets = commentAnnotations.targets;
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
  const beforeSections = candidateSections(beforeDocument);
  yield "candidate-sections-before";
  const afterSections = candidateSections(afterDocument);
  yield "candidate-sections-after";
  const pairs = pairSections(beforeSections, afterSections);
  const changes: ReviewChange[] = [];
  const outline: ReviewOutlineItem[] = [];
  const stylesheetsMatch = reviewStylesheetSignature(beforeDocument)
    === reviewStylesheetSignature(afterDocument);
  yield "section-pairing";

  for (const [pairIndex, pair] of pairs.entries()) {
    const outlineId = `outline-${outline.length + 1}`;
    const label = changeLabel(pair.before, pair.after, pairIndex);
    const exactStablePair = Boolean(
      !pair.moved
      && stylesheetsMatch
      && pair.before
      && pair.after
      && normalizedMarkup(pair.before) === normalizedMarkup(pair.after)
      && ancestorMarkupSignature(pair.before)
        === ancestorMarkupSignature(pair.after),
    );
    let types: ReviewChangeType[] = [];
    if (!exactStablePair) {
      const annotationSteps = annotateChangePairSteps(pair);
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
    const movement = pair.moved
      ? { from: pair.beforeIndex + 1, to: pair.afterIndex + 1 }
      : undefined;
    const panelPath = panelPathForElement(pair.after).length
      ? panelPathForElement(pair.after)
      : panelPathForElement(pair.before);
    const panelKey = panelPath.at(-1);
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
        label,
        helper,
        types,
        beforePresent: Boolean(pair.before),
        afterPresent: Boolean(pair.after),
        ...(panelKey ? { panelKey } : {}),
        ...(panelPath.length ? { panelPath } : {}),
        ...(movement ? { movement } : {}),
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
      ...(panelKey ? { panelKey } : {}),
      ...(panelPath.length ? { panelPath } : {}),
      ...(movement ? { movement } : {}),
    });
    if ((pairIndex + 1) % 24 === 0) yield "change-annotation";
  }

  const runtimeVisualAnnotations: ReviewRuntimeVisualAnnotations = options.externalBootstrap
    ? annotateRuntimeVisualCandidates({
        beforeHtml,
        afterHtml,
        beforeIndex: beforeSourceProjection.sourceIndex,
        afterIndex: afterSourceProjection.sourceIndex,
        beforeSourceElements,
        afterSourceElements,
        outline,
        // Comment scope attributes are still present here; they are cleared
        // right after candidate annotation and before serialization. A global
        // page comment anchors on <body> and must not mark every host as
        // commented, so only element-anchored comment scopes qualify.
        commentAnchors: [...beforeDocument.querySelectorAll(
          `[${REVIEW_COMMENT_KEY_ATTRIBUTE}]:not([${REVIEW_COMMENT_GLOBAL_ATTRIBUTE}])`,
        )],
      })
    : {
        candidates: [],
        captureCandidates: { before: [], after: [] },
        bindings: { before: [], after: [] },
      };
  const runtimeVisualCandidates = runtimeVisualAnnotations.candidates;
  // Comment attributes are analyzer-only scope hints. Bind every resolved
  // source target in the private first bootstrap, then remove the hints before
  // either document is serialized or can be read back by authored page code.
  const reviewCommentBindings = reviewCommentBootstrapBindings(
    beforeDocument,
    reviewCommentTargets,
  );
  clearReviewCommentScopeAttributes(beforeDocument);
  yield "runtime-candidates";

  const preparedBefore = prepareDocument(
    beforeDocument,
    "before",
    runtimeVisualCaptureIdentity,
    options.sourcePath,
    options.externalBootstrap,
    reviewCommentBindings,
    runtimeVisualAnnotations.bindings.before,
  );
  yield "prepare-before";
  const preparedAfter = prepareDocument(
    afterDocument,
    "after",
    runtimeVisualCaptureIdentity,
    options.sourcePath,
    options.externalBootstrap,
    [],
    runtimeVisualAnnotations.bindings.after,
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
    runtimeVisualCandidates,
    runtimeVisualCaptureCandidates: runtimeVisualAnnotations.captureCandidates,
    runtimeVisualSourceHtml: { before: beforeHtml, after: afterHtml },
    runtimeVisualCaptureIdentity,
    commentGroups,
    commentTargets: reviewCommentTargets,
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
    "candidate-sections-before",
    "candidate-sections-after",
    "section-pairing",
    "semantic-row",
    "change-annotation",
    "runtime-candidates",
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
