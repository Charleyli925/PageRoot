function requiredFunction(value, name) {
  if (typeof value !== "function") {
    throw new TypeError(`WorkspaceController codec ${name} must be a function.`);
  }
  return value;
}

// The controller deliberately receives these pure codecs from its composition
// root. The existing renderer codecs remain their single decoder source during
// the staged migration; importing app/workbench from application code would
// reverse the architecture boundary.
export function createWorkspaceControllerCodecs({
  isRecord,
  sameSourcePath,
  draftAuthorityFromWorkspace,
  authoritativeDraftRevision,
  recoveryIdentityFromRecord,
  versionsFromWorkspace,
  rebindTargetsPreservingGlobal,
} = {}) {
  return Object.freeze({
    isRecord: requiredFunction(isRecord, "isRecord"),
    sameSourcePath: requiredFunction(sameSourcePath, "sameSourcePath"),
    draftAuthorityFromWorkspace: requiredFunction(
      draftAuthorityFromWorkspace,
      "draftAuthorityFromWorkspace",
    ),
    authoritativeDraftRevision: requiredFunction(
      authoritativeDraftRevision,
      "authoritativeDraftRevision",
    ),
    recoveryIdentityFromRecord: requiredFunction(
      recoveryIdentityFromRecord,
      "recoveryIdentityFromRecord",
    ),
    versionsFromWorkspace: requiredFunction(
      versionsFromWorkspace,
      "versionsFromWorkspace",
    ),
    rebindTargetsPreservingGlobal: requiredFunction(
      rebindTargetsPreservingGlobal,
      "rebindTargetsPreservingGlobal",
    ),
  });
}
