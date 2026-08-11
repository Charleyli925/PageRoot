function requiredFunction(overrides, name) {
  const value = overrides?.[name];
  if (typeof value !== "function") {
    throw new TypeError(`DocumentWorkflow codec ${name} must be a function.`);
  }
  return value;
}

// The workflow deliberately receives renderer-model codecs instead of importing
// `app/workbench`. Those codecs are pure, but their presentation-level types
// remain outside the Application dependency direction during the migration.
export function createDocumentWorkflowCodecs(overrides = {}) {
  return Object.freeze({
    isRecord: requiredFunction(overrides, "isRecord"),
    sameSourcePath: requiredFunction(overrides, "sameSourcePath"),
    persistedChangeEvent: requiredFunction(overrides, "persistedChangeEvent"),
    recoveryIdentityFromRecord: requiredFunction(
      overrides,
      "recoveryIdentityFromRecord",
    ),
    sourceHistoryOperationsFromRecord: requiredFunction(
      overrides,
      "sourceHistoryOperationsFromRecord",
    ),
    changesFromRecords: requiredFunction(overrides, "changesFromRecords"),
    historyTextSelectionFromRecord: requiredFunction(
      overrides,
      "historyTextSelectionFromRecord",
    ),
    selectionFromRecord: requiredFunction(overrides, "selectionFromRecord"),
    rebindTargetsPreservingGlobal: requiredFunction(
      overrides,
      "rebindTargetsPreservingGlobal",
    ),
    rebindTargetsAcrossHistoryPreservingGlobal: requiredFunction(
      overrides,
      "rebindTargetsAcrossHistoryPreservingGlobal",
    ),
    canLocateTarget: requiredFunction(overrides, "canLocateTarget"),
    appendDirectEditEvent: requiredFunction(overrides, "appendDirectEditEvent"),
    auditEventKey: requiredFunction(overrides, "auditEventKey"),
    removeAcknowledgedAuditEvents: requiredFunction(
      overrides,
      "removeAcknowledgedAuditEvents",
    ),
    errorMessage: requiredFunction(overrides, "errorMessage"),
  });
}
