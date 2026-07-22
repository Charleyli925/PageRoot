export {
  SOURCE_NODE_ATTRIBUTE,
  SourceIndexError,
  buildSourceIndex,
  compareParseIntegrity,
  instrumentPreviewHtml,
  normalizeSourceText,
  scanStartTagAttributes,
  sourceSha256,
} from "./source-index.js";

export {
  TargetResolver,
  cleanTargetRef,
  createInsertionPointTargetRef,
  createTargetRef,
  resolveFromPreview,
  resolveTargetRef,
} from "./target-resolver.js";

export {
  SourcePatchEngine,
  SourcePatchError,
  applyPatchPlan,
  isDisposableSourceTextWrapper,
  parseInlineStyle,
  planInlineStylePatch,
  planSiblingReorderPatch,
  planSourcePatch,
  planTextRangePatch,
  planTextRangeStylePatch,
  planTextPatch,
  supportsTextRangeEditing,
  validatePatchScope,
} from "./source-patch-engine.js";
