/**
 * Pure product policy for projecting an accepted Working HTML edit.
 * Saving has already succeeded when this decision is consumed; this policy
 * only decides whether the disposable Canvas projection may stay mounted.
 *
 * Structural in-place requires a current, internally verified projection
 * capability. A mutationKind of "structure" alone never authorizes in-place.
 */
export function decideEditRuntimeRefresh({
  hasRuntime = false,
  mutationKind,
  programIdentityChanged = false,
  structuralProjection = null,
} = {}) {
  if (programIdentityChanged) {
    return Object.freeze({
      action: "candidate-now",
      reason: "program-identity-changed",
      synchronizeCurrentFrame: false,
    });
  }

  const provenStructuralInPlace = mutationKind === "structure"
    && structuralProjection?.kind === "in-place";
  const safeInPlaceMutation = mutationKind === "text"
    || mutationKind === "style"
    || mutationKind === "reorder"
    || provenStructuralInPlace;
  const structuralReason = provenStructuralInPlace
    ? (structuralProjection.reason || "verified-structure")
    : (structuralProjection?.reason || mutationKind || "structural");

  if (!hasRuntime) {
    const synchronizeCurrentFrame = safeInPlaceMutation;
    return Object.freeze({
      action: synchronizeCurrentFrame ? "in-place" : "candidate-now",
      reason: synchronizeCurrentFrame
        ? (provenStructuralInPlace ? `static-${structuralReason}` : `static-${mutationKind || "source"}`)
        : (structuralProjection?.kind === "candidate"
          ? `static-${structuralReason}`
          : "static-structural-change"),
      synchronizeCurrentFrame,
    });
  }

  if (safeInPlaceMutation) {
    return Object.freeze({
      action: "in-place",
      reason: provenStructuralInPlace
        ? `runtime-${structuralReason}`
        : `runtime-${mutationKind}`,
      synchronizeCurrentFrame: true,
    });
  }

  return Object.freeze({
    action: "candidate-now",
    reason: structuralProjection?.reason
      ? `runtime-${structuralReason}`
      : `runtime-${mutationKind || "structural"}`,
    synchronizeCurrentFrame: false,
  });
}
