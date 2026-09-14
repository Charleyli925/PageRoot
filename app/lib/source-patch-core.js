export {
  STEMMIO_ELEMENT_ID_ATTRIBUTE,
  STEMMIO_ELEMENT_ID_PREFIX,
  STEMMIO_ELEMENT_ID_SCHEMA_VERSION,
  StemmioElementIdentityError,
  generateStemmioElementId,
  isEphemeralStemmioAttribute,
  isPersistentStemmioAttribute,
  isValidStemmioElementId,
} from "./stemmio-element-identity.js";

export {
  SOURCE_NODE_ATTRIBUTE,
  SourceIndexError,
  buildSourceIndex,
  compareParseIntegrity,
  normalizeSourceText,
  scanStartTagAttributes,
  sourceSha256,
} from "./source-index.js";

export {
  TargetResolver,
  cleanTargetRef,
  createInsertionPointTargetRef,
  createTargetRef,
  resolveTargetRef,
} from "./target-resolver.js";

export {
  SourcePatchEngine,
  SourcePatchError,
  applyPatchPlan,
  parseInlineStyle,
  planEditableIslandPatch,
  planInlineStylePatch,
  planSemanticOperationPatch,
  planSiblingReorderPatch,
  planSourcePatch,
  planTextRangeStylePatch,
  supportsTextRangeEditing,
  validatePatchScope,
} from "./source-patch-engine.js";
