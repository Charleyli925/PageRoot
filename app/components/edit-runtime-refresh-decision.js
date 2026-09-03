const IN_PLACE_ATTRIBUTE = /^(?!(?:on|src$|srcset$|href$|xlink:href$|action$|formaction$|data$|codebase$|integrity$|crossorigin$|referrerpolicy$))/iu;

export function isRuntimeInPlaceAttribute(attributeName) {
  const normalized = String(attributeName ?? "").trim().toLowerCase();
  return normalized !== "" && IN_PLACE_ATTRIBUTE.test(normalized);
}

/**
 * Pure product policy for projecting an accepted Working HTML edit.
 * Saving has already succeeded when this decision is consumed; this policy
 * only decides whether the disposable Canvas projection may stay mounted.
 */
export function decideEditRuntimeRefresh({
  hasRuntime = false,
  nativeEditActive = false,
  mutationKind,
  programIdentityChanged = false,
  attributeName = null,
} = {}) {
  if (programIdentityChanged) {
    return Object.freeze({
      action: "candidate-now",
      reason: "program-identity-changed",
      synchronizeCurrentFrame: false,
      markRuntimeRefreshPending: false,
    });
  }

  const safeInPlaceMutation = mutationKind === "text"
    || mutationKind === "style"
    || mutationKind === "reorder"
    || (
      mutationKind === "attribute"
      && isRuntimeInPlaceAttribute(attributeName)
    );

  if (!hasRuntime) {
    const synchronizeCurrentFrame = safeInPlaceMutation;
    return Object.freeze({
      action: synchronizeCurrentFrame ? "in-place" : "candidate-now",
      reason: synchronizeCurrentFrame
        ? `static-${mutationKind || "source"}`
        : "static-structural-change",
      synchronizeCurrentFrame,
      markRuntimeRefreshPending: false,
    });
  }

  if (
    mutationKind === "text"
    || mutationKind === "style"
    || (
      mutationKind === "attribute"
      && isRuntimeInPlaceAttribute(attributeName)
    )
  ) {
    return Object.freeze({
      action: "defer-until-boundary",
      reason: nativeEditActive
        ? "continuous-native-edit"
        : `runtime-${mutationKind}`,
      synchronizeCurrentFrame: true,
      markRuntimeRefreshPending: true,
    });
  }

  return Object.freeze({
    action: "candidate-now",
    reason: mutationKind === "attribute"
      ? "script-sensitive-attribute"
      : `runtime-${mutationKind || "structural"}`,
    synchronizeCurrentFrame: false,
    markRuntimeRefreshPending: false,
  });
}
