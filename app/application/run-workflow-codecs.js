function requiredFunction(overrides, name) {
  const value = overrides?.[name];
  if (typeof value !== "function") {
    throw new TypeError(`RunWorkflow codec ${name} must be a function.`);
  }
  return value;
}

// RunWorkflow receives the existing renderer-model conversions at composition
// time. Keeping those codecs injected prevents a reverse Application ->
// Workbench dependency while the staged migration is in progress.
export function createRunWorkflowCodecs(overrides = {}) {
  return Object.freeze({
    isRecord: requiredFunction(overrides, "isRecord"),
    sameSourcePath: requiredFunction(overrides, "sameSourcePath"),
    activeRunFromRecord: requiredFunction(overrides, "activeRunFromRecord"),
    canonicalLifecycleState: requiredFunction(overrides, "canonicalLifecycleState"),
    commentHasContent: requiredFunction(overrides, "commentHasContent"),
    commentEditSessionHasChanges: requiredFunction(
      overrides,
      "commentEditSessionHasChanges",
    ),
    canLocateTarget: requiredFunction(overrides, "canLocateTarget"),
    persistedComment: requiredFunction(overrides, "persistedComment"),
    persistedChangeEvent: requiredFunction(overrides, "persistedChangeEvent"),
    persistedTargetRef: requiredFunction(overrides, "persistedTargetRef"),
    uniqueTargets: requiredFunction(overrides, "uniqueTargets"),
    fileStem: requiredFunction(overrides, "fileStem"),
    projectMarkdown: requiredFunction(overrides, "projectMarkdown"),
    operationKey: requiredFunction(overrides, "operationKey"),
    errorMessage: requiredFunction(overrides, "errorMessage"),
  });
}
