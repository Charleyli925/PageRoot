const RESOURCE_BOUNDARY_ATTRIBUTES_BY_ELEMENT = Object.freeze({
  a: new Set(["href", "ping", "target"]),
  area: new Set(["href", "ping", "target"]),
  audio: new Set(["autoplay", "crossorigin", "preload", "src"]),
  base: new Set(["href", "target"]),
  button: new Set(["formaction", "formenctype", "formmethod", "formtarget"]),
  embed: new Set(["src", "type"]),
  form: new Set(["action", "enctype", "method", "target"]),
  iframe: new Set(["allow", "referrerpolicy", "sandbox", "src", "srcdoc"]),
  image: new Set(["href", "xlink:href"]),
  img: new Set(["crossorigin", "decoding", "fetchpriority", "referrerpolicy", "sizes", "src", "srcset"]),
  input: new Set(["formaction", "formenctype", "formmethod", "formtarget", "src", "type"]),
  link: new Set(["as", "crossorigin", "fetchpriority", "href", "integrity", "media", "referrerpolicy", "rel", "type"]),
  meta: new Set(["charset", "content", "http-equiv"]),
  object: new Set(["classid", "codebase", "data", "type"]),
  script: new Set(["async", "crossorigin", "defer", "fetchpriority", "integrity", "nomodule", "nonce", "referrerpolicy", "src", "type"]),
  source: new Set(["media", "sizes", "src", "srcset", "type"]),
  track: new Set(["default", "kind", "src", "srclang"]),
  use: new Set(["href", "xlink:href"]),
  video: new Set(["autoplay", "crossorigin", "poster", "preload", "src"]),
});

const RESOURCE_BOUNDARY_ATTRIBUTE_NAMES = new Set(
  Object.values(RESOURCE_BOUNDARY_ATTRIBUTES_BY_ELEMENT).flatMap((names) => [...names]),
);

export function isRuntimeInPlaceAttribute(attributeName, elementTagName = null) {
  const normalized = String(attributeName ?? "").trim().toLowerCase();
  if (
    normalized === ""
    || normalized.startsWith("on")
    || normalized.startsWith("data-pageroot-")
  ) return false;
  const tagName = String(elementTagName ?? "").trim().toLowerCase();
  if (!tagName) return !RESOURCE_BOUNDARY_ATTRIBUTE_NAMES.has(normalized);
  return !RESOURCE_BOUNDARY_ATTRIBUTES_BY_ELEMENT[tagName]?.has(normalized);
}

/**
 * Pure product policy for projecting an accepted Working HTML edit.
 * Saving has already succeeded when this decision is consumed; this policy
 * only decides whether the disposable Canvas projection may stay mounted.
 */
export function decideEditRuntimeRefresh({
  hasRuntime = false,
  mutationKind,
  programIdentityChanged = false,
  attributeName = null,
  elementTagName = null,
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
      && isRuntimeInPlaceAttribute(attributeName, elementTagName)
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
    || mutationKind === "reorder"
  ) {
    return Object.freeze({
      action: "in-place",
      reason: `runtime-${mutationKind}`,
      synchronizeCurrentFrame: true,
      markRuntimeRefreshPending: false,
    });
  }

  if (
    mutationKind === "attribute"
    && isRuntimeInPlaceAttribute(attributeName, elementTagName)
  ) {
    return Object.freeze({
      action: "in-place",
      reason: `runtime-${mutationKind}`,
      synchronizeCurrentFrame: true,
      markRuntimeRefreshPending: false,
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
