export {
  PAGEROOT_ELEMENT_ID_ATTRIBUTE,
  PAGEROOT_ELEMENT_ID_PREFIX,
  PAGEROOT_ELEMENT_ID_SCHEMA_VERSION,
  PagerootElementIdentityError,
  generatePagerootElementId,
  isEphemeralPagerootAttribute,
  isPersistentPagerootAttribute,
  isValidPagerootElementId,
} from "./pageroot-element-identity.js";

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
  planSemanticOperationPatch,
  planSiblingReorderPatch,
  planSourcePatch,
  planTextRangeStylePatch,
  supportsTextRangeEditing,
  validatePatchScope,
} from "./source-patch-engine.js";
