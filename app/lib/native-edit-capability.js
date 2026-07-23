import {
  SourceTextMapError,
  buildSourceTextMap,
} from "./source-text-map.js";
import { isNativeEditHostMode } from "./native-edit-policy.js";

export const NATIVE_EDIT_MODE = Object.freeze({
  EDITABLE: "native-editable",
  SELECT_COMMENT: "select-comment",
  COMMENT_ONLY: "comment-only",
});

const ESTABLISHED_TEXT_EDIT_ROOTS = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "li",
  "dt",
  "dd",
  "caption",
  "figcaption",
  "td",
  "th",
  "div",
]);

const DEDICATED_EDITOR_ROOTS = new Set([
  "input",
  "button",
  "textarea",
  "select",
  "option",
  "script",
  "style",
  "template",
  "title",
  "canvas",
  "audio",
  "video",
  "object",
  "embed",
  "iframe",
  "svg",
  "math",
  "pre",
  "code",
]);

// Native editing is now capability based rather than an allow-list of visual
// tags. Any authored HTML element can be a candidate when it is proved to be
// one continuous, uniquely source-backed text island. These roots are the
// exceptions: they are document/collection boundaries, void elements, or
// surfaces whose value/content needs a dedicated editor.
const NON_TEXT_ISLAND_ROOTS = new Set([
  ...DEDICATED_EDITOR_ROOTS,
  "html",
  "head",
  "body",
  "base",
  "link",
  "meta",
  "area",
  "br",
  "col",
  "hr",
  "img",
  "param",
  "source",
  "track",
  "wbr",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "colgroup",
  "ul",
  "ol",
  "menu",
  "dl",
  "form",
  "fieldset",
  "datalist",
  "details",
]);

function isNativeTextIslandCandidateRoot(tagName) {
  const normalized = String(tagName ?? "").toLowerCase();
  return Boolean(normalized) && !NON_TEXT_ISLAND_ROOTS.has(normalized);
}

const READABLE_MESSAGES = Object.freeze({
  native: "双击后可以像文档一样直接修改这段文字。",
  complex: "这段内容包含复杂网页结构，暂不支持直接改字。你仍可以选中文字并添加评论。",
  boundary: "这段文字旁有空的排版元素，直接输入可能跑到错误位置，因此暂不直接编辑。你仍可以选中文字并添加评论。",
  runtime: "这段文字暂时无法安全进入编辑状态。你仍可以选中文字并添加评论。",
  comment: "这部分不是可直接修改的网页文字，可以为它添加评论。",
});

function capability(mode, code, reason, details = {}, sourceMap = null) {
  return {
    mode,
    directlyEditable: mode === NATIVE_EDIT_MODE.EDITABLE,
    selectable: mode !== NATIVE_EDIT_MODE.COMMENT_ONLY,
    sourceBacked: Boolean(sourceMap),
    code,
    reason,
    userMessage: mode === NATIVE_EDIT_MODE.EDITABLE
      ? READABLE_MESSAGES.native
      : mode === NATIVE_EDIT_MODE.SELECT_COMMENT
        ? code === "SOURCE_AMBIGUOUS_ZERO_LENGTH_BOUNDARY"
          ? READABLE_MESSAGES.boundary
          : (code.startsWith("SOURCE_STRUCTURE_") ? READABLE_MESSAGES.complex : READABLE_MESSAGES.runtime)
        : READABLE_MESSAGES.comment,
    rootNodeId: sourceMap?.rootNodeId ?? null,
    sourceMap,
    details,
  };
}

function commentOnly(code, reason, details = {}, sourceMap = null) {
  return capability(NATIVE_EDIT_MODE.COMMENT_ONLY, code, reason, details, sourceMap);
}

function selectComment(code, reason, details = {}, sourceMap = null) {
  return capability(NATIVE_EDIT_MODE.SELECT_COMMENT, code, reason, details, sourceMap);
}

/**
 * The classifier is intentionally fail-closed. A source-safe paragraph is not
 * called editable until the live DOM preflight also proves mapping, geometry,
 * selection, and mutation observation are stable.
 */
export function classifyNativeEditCapability(index, target, options = {}) {
  let sourceMap;
  try {
    sourceMap = buildSourceTextMap(index, target, { allowEmpty: true });
  } catch (error) {
    if (!(error instanceof SourceTextMapError)) throw error;
    return commentOnly(error.code, error.message, error.details);
  }

  const tagName = sourceMap.rootTagName;
  if (DEDICATED_EDITOR_ROOTS.has(tagName)) {
    return commentOnly(
      "DEDICATED_EDITOR_REQUIRED",
      `Content inside <${tagName}> requires its own editor.`,
      { tagName },
      sourceMap,
    );
  }
  if (!isNativeTextIslandCandidateRoot(tagName)) {
    return selectComment(
      "UNSUPPORTED_NATIVE_EDIT_ROOT",
      "This source element is a document, collection, void, or dedicated-editor boundary.",
      { tagName },
      sourceMap,
    );
  }

  // A transparent authored wrapper with no logical text creates several
  // distinct DOM/source caret anchors at one logical offset: before it,
  // inside it, and after it. Native Selection intentionally preserves that
  // distinction, while a text-only SourcePatch cannot. Entering direct edit
  // would therefore let text appear with the wrapper's layout/style but be
  // committed beside the wrapper. Fail closed until the transaction model
  // carries an exact DOM/source boundary anchor.
  const zeroLengthInlineRanges = (sourceMap.inlineRanges ?? []).filter(
    (range) => range.textStart === range.textEnd,
  );
  if (zeroLengthInlineRanges.length > 0) {
    return selectComment(
      "SOURCE_AMBIGUOUS_ZERO_LENGTH_BOUNDARY",
      "An empty authored inline element creates multiple source anchors at one logical text offset.",
      {
        boundaries: zeroLengthInlineRanges.map((range) => ({
          nodeId: range.nodeId,
          tagName: range.tagName,
          textOffset: range.textStart,
        })),
      },
      sourceMap,
    );
  }

  const hardBreaks = sourceMap.runs.filter((run) => run.kind === "hard-break");
  if (hardBreaks.length > 0 && options.features?.hardBreak !== true) {
    return selectComment(
      "SOURCE_STRUCTURE_HARD_BREAK_UNSUPPORTED",
      "This text contains a hard break that needs a structural source command.",
      { nodeIds: hardBreaks.map((run) => run.nodeId) },
      sourceMap,
    );
  }
  const structures = sourceMap.runs.filter((run) => run.kind === "structure");
  if (structures.length > 0 && options.features?.structuralRange !== true) {
    return selectComment(
      "SOURCE_STRUCTURE_RANGE_UNSUPPORTED",
      "This text contains source structure that is not yet safe to edit directly.",
      {
        boundaries: structures.map((run) => ({
          nodeId: run.nodeId,
          tagName: run.tagName,
        })),
      },
      sourceMap,
    );
  }
  if (sourceMap.textRunCount === 0 && options.features?.emptyHost !== true) {
    return selectComment(
      "EMPTY_SOURCE_HOST_UNSUPPORTED",
      "Empty text hosts need a structural insertion command before native editing.",
      {},
      sourceMap,
    );
  }

  const runtime = options.runtime;
  if (!runtime || runtime.preflightComplete !== true) {
    return selectComment(
      "RUNTIME_PREFLIGHT_REQUIRED",
      "Live DOM safety has not been checked for this text island.",
      {},
      sourceMap,
    );
  }
  if (runtime.isSingleTextIsland !== true) {
    return selectComment(
      "TEXT_ISLAND_NOT_PROVEN",
      "Runtime inspection did not prove one continuous source-backed text island.",
      { tagName },
      sourceMap,
    );
  }
  if (
    runtime.isConnected === false
    || runtime.sourceBacked === false
    || runtime.crossOrigin === true
    || runtime.insideShadowRoot === true
    || runtime.generatedContent === true
    || (runtime.pseudoContent === true && sourceMap.textRunCount === 0)
  ) {
    return commentOnly(
      "RUNTIME_CONTENT_NOT_DIRECTLY_EDITABLE",
      "The visible content is not a directly editable source-backed DOM island.",
      {
        isConnected: runtime.isConnected,
        sourceBacked: runtime.sourceBacked,
        crossOrigin: runtime.crossOrigin,
        insideShadowRoot: runtime.insideShadowRoot,
        generatedContent: runtime.generatedContent,
        pseudoContent: runtime.pseudoContent,
      },
      sourceMap,
    );
  }

  const runtimeBlockers = [];
  if (runtime.mappingComplete !== true) runtimeBlockers.push("mapping-incomplete");
  if (!isNativeEditHostMode(runtime.contentEditableMode)) {
    runtimeBlockers.push("contenteditable-mode-unproven");
  }
  if (runtime.styleStable !== true) runtimeBlockers.push("style-unstable");
  if (runtime.layoutStable !== true) runtimeBlockers.push("layout-unstable");
  if (runtime.selectionStable !== true) runtimeBlockers.push("selection-unstable");
  if (runtime.observerReady !== true) runtimeBlockers.push("mutation-observer-not-ready");
  const nativeEventDeliveryProven = (
    runtime.nativeEventDeliveryMode === "native"
    && runtime.nativeEventDeliveryStable === true
  );
  const nativeEventDeliveryGuarded = (
    runtime.nativeEventDeliveryMode === "observer-guarded"
    && runtime.nativeEventDeliveryGuarded === true
    && runtime.observerReady === true
  );
  // display:contents no longer fails from a static heuristic alone. It may
  // enter only through the observer-guarded lane, where a missing event pair
  // becomes an unowned mutation and is rolled back before SourcePatch.
  if (!nativeEventDeliveryProven && !nativeEventDeliveryGuarded) {
    runtimeBlockers.push("native-editing-event-delivery-unstable");
  }
  if (runtime.authorMutationRisk !== false) runtimeBlockers.push("author-mutation-risk-unknown");
  if (runtimeBlockers.length > 0) {
    return selectComment(
      "RUNTIME_NATIVE_EDIT_UNSAFE",
      "The live page cannot guarantee a stable native editing session.",
      { blockers: runtimeBlockers },
      sourceMap,
    );
  }

  return capability(
    NATIVE_EDIT_MODE.EDITABLE,
    "NATIVE_EDITABLE",
    null,
    {
      textLength: sourceMap.textLength,
      boundaryCount: sourceMap.boundaryCount,
      contentEditableMode: runtime.contentEditableMode,
      nativeEventDeliveryMode: runtime.nativeEventDeliveryMode,
    },
    sourceMap,
  );
}

export function isNativeEditableCapability(value) {
  return value?.mode === NATIVE_EDIT_MODE.EDITABLE
    && value.directlyEditable === true;
}

export function isNativeDirectEditRoot(tagName) {
  return isNativeTextIslandCandidateRoot(tagName);
}

export function isEstablishedNativeEditRoot(tagName) {
  return ESTABLISHED_TEXT_EDIT_ROOTS.has(String(tagName ?? "").toLowerCase());
}
