import {
  EDIT_RUNTIME_SOURCE_MARKER_ATTRIBUTE,
  editRuntimeProofProperty,
  isEditRuntimeExecutionId,
  isEditRuntimeSessionId,
} from "../app/domain/edit-runtime-contract.js";

/**
 * Installs source provenance before authored programs run. The proof is a
 * non-copying DOM expando: cloneNode, innerHTML and script-created descendants
 * cannot inherit source authority merely by copying an attribute.
 *
 * The bootstrap never freezes timers, listeners, observers, animations or
 * author DOM. Runtime state remains a disposable display projection until the
 * iframe itself is replaced.
 */
export function createEditRuntimeBootstrap({ executionId, sessionId } = {}) {
  const normalizedExecutionId = String(executionId || "").toLowerCase();
  const normalizedSessionId = String(sessionId || "").toLowerCase();
  const proofProperty = editRuntimeProofProperty(normalizedExecutionId);
  if (
    !isEditRuntimeExecutionId(normalizedExecutionId)
    || !isEditRuntimeSessionId(normalizedSessionId)
    || !proofProperty
  ) {
    throw new TypeError("Edit runtime bootstrap identity is invalid.");
  }
  const configuration = JSON.stringify({
    markerAttribute: EDIT_RUNTIME_SOURCE_MARKER_ATTRIBUTE,
    sourceNodeAttribute: "data-html-ai-source-node-id",
    proofProperty,
  }).replace(/</gu, "\\u003c");
  return String.raw`
(() => {
  "use strict";
  const config = ${configuration};
  const claimedIds = new Set();

  const candidates = (root) => {
    if (!root || root.nodeType !== Node.ELEMENT_NODE) return [];
    const elements = (
      root.hasAttribute(config.markerAttribute)
      || root.hasAttribute(config.sourceNodeAttribute)
    ) ? [root] : [];
    return elements.concat(Array.from(root.querySelectorAll(
      "[" + config.markerAttribute + "],[" + config.sourceNodeAttribute + "]",
    )));
  };

  const claim = (root) => {
    for (const element of candidates(root)) {
      const sourceNodeId = element.getAttribute(config.markerAttribute) || "";
      if (!sourceNodeId) {
        element.removeAttribute(config.markerAttribute);
        element.removeAttribute(config.sourceNodeAttribute);
        continue;
      }
      if (!claimedIds.has(sourceNodeId)) {
        claimedIds.add(sourceNodeId);
        Object.defineProperty(element, config.proofProperty, {
          configurable: false,
          enumerable: false,
          writable: false,
          value: sourceNodeId,
        });
        continue;
      }
      if (element[config.proofProperty] !== sourceNodeId) {
        element.removeAttribute(config.markerAttribute);
        element.removeAttribute(config.sourceNodeAttribute);
      }
    }
  };

  claim(document.documentElement);
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "attributes") {
        if (
          record.attributeName === config.sourceNodeAttribute
          && !record.target.hasAttribute(config.markerAttribute)
        ) {
          record.target.removeAttribute(config.sourceNodeAttribute);
          continue;
        }
        claim(record.target);
        continue;
      }
      for (const node of record.addedNodes) claim(node);
    }
  });
  observer.observe(document, {
    attributes: true,
    attributeFilter: [config.markerAttribute, config.sourceNodeAttribute],
    childList: true,
    subtree: true,
  });
  document.addEventListener("DOMContentLoaded", () => claim(document.documentElement), {
    once: true,
  });

  document.addEventListener("click", (event) => {
    if (event.target?.closest?.("a[href], area[href]")) event.preventDefault();
  }, true);
  document.addEventListener("submit", (event) => event.preventDefault(), true);
  try {
    Object.defineProperty(window, "open", {
      configurable: false,
      writable: false,
      value: () => null,
    });
  } catch {
    window.open = () => null;
  }
})();
`;
}
