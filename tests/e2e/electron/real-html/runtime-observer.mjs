// Self-contained callbacks passed directly to Playwright locator.evaluate.
// Keep all state on the renderer global so the same observer can be exercised
// by a tiny DOM fixture without launching the real-HTML corpus runner.

export function startRuntimeCandidateObservation(element) {
  const key = "__PAGEROOT_REAL_HTML_RUNTIME_OBSERVER__";
  globalThis[key]?.observer?.disconnect();
  const candidate = element.querySelector('iframe[data-frame-role="runtime-candidate"]');
  const candidateId = element.getAttribute("data-runtime-candidate-id");
  if (candidate || candidateId) {
    throw new Error("Runtime Candidate observation requires a clean absent precondition.");
  }
  const records = [];
  const recorded = new Set();
  const observer = new MutationObserver((mutations) => {
    const recordCandidate = (evidence, candidateValue, generation = null) => {
      if (typeof candidateValue !== "string" || candidateValue.trim() === "") return;
      const recordKey = `${evidence}:${candidateValue}:${generation || "unknown"}`;
      if (recorded.has(recordKey)) return;
      recorded.add(recordKey);
      records.push({
        kind: "candidate-created",
        evidence,
        candidateId: candidateValue,
        generation,
      });
    };
    for (const [index, mutation] of mutations.entries()) {
      if (
        mutation.type === "attributes"
        && mutation.target === element
        && mutation.attributeName === "data-runtime-candidate-id"
        && mutation.oldValue === null
      ) {
        const current = element.getAttribute("data-runtime-candidate-id");
        const removedLater = mutations.slice(index + 1).find((later) => (
          later.type === "attributes"
          && later.target === element
          && later.attributeName === "data-runtime-candidate-id"
          && later.oldValue
        ));
        recordCandidate("candidate-id-absent-to-present", current || removedLater?.oldValue);
      }
      if (
        mutation.type === "attributes"
        && mutation.attributeName === "data-frame-role"
        && mutation.oldValue !== "runtime-candidate"
      ) {
        const frame = mutation.target;
        if (!(frame instanceof element.ownerDocument.defaultView.HTMLIFrameElement)) continue;
        const currentRole = frame.getAttribute("data-frame-role");
        const retiredLater = mutations.slice(index + 1).some((later) => (
          later.type === "attributes"
          && later.target === frame
          && later.attributeName === "data-frame-role"
          && later.oldValue === "runtime-candidate"
        ));
        if (currentRole === "runtime-candidate" || retiredLater) {
          recordCandidate(
            "candidate-frame-role-transition",
            element.getAttribute("data-runtime-candidate-id"),
            frame.getAttribute("data-frame-generation"),
          );
        }
      }
      if (mutation.type !== "childList") continue;
      for (const node of mutation.addedNodes) {
        if (!(node instanceof element.ownerDocument.defaultView.Element)) continue;
        const frames = node.matches("iframe") ? [node] : [...node.querySelectorAll("iframe")];
        for (const frame of frames) {
          if (frame.getAttribute("data-frame-role") === "runtime-candidate") {
            recordCandidate(
              "candidate-frame-added",
              element.getAttribute("data-runtime-candidate-id"),
              frame.getAttribute("data-frame-generation"),
            );
          }
        }
      }
    }
  });
  observer.observe(element, {
    attributes: true,
    attributeOldValue: true,
    childList: true,
    subtree: true,
    attributeFilter: [
      "data-runtime-candidate-id",
      "data-runtime-candidate-phase",
      "data-runtime-slot-role",
      "data-frame-role",
      "data-frame-generation",
    ],
  });
  globalThis[key] = { observer, records };
}

export function stopRuntimeCandidateObservation() {
  const key = "__PAGEROOT_REAL_HTML_RUNTIME_OBSERVER__";
  const state = globalThis[key];
  state?.observer?.disconnect();
  delete globalThis[key];
  return state?.records || [];
}
