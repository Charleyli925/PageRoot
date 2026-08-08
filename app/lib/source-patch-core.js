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
  parseInlineStyle,
  planDirectTextNodePatch,
  planEditableIslandPatch,
  planInlineStylePatch,
  planSiblingReorderPatch,
  planSourcePatch,
  planTextRangeStylePatch,
  supportsTextRangeEditing,
  validatePatchScope,
} from "./source-patch-engine.js";
