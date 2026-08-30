import {
  EDIT_RUNTIME_SOURCE_MARKER_ATTRIBUTE,
  editRuntimeRegistrationProperty,
  isEditRuntimeExecutionId,
  isEditRuntimeSessionId,
} from "../app/domain/edit-runtime-contract.js";

/**
 * Installs source provenance before authored programs run. The bootstrap opens
 * one parent-owned registration capability, captures the returned batch port
 * in this private closure, and never publishes it to author code. DOM
 * attributes remain routing hints rather than edit authority.
 *
 * The bootstrap never freezes timers, listeners, observers, animations or
 * author DOM. Runtime state remains a disposable display projection until the
 * iframe itself is replaced.
 */
export function createEditRuntimeBootstrap({ executionId, sessionId } = {}) {
  const normalizedExecutionId = String(executionId || "").toLowerCase();
  const normalizedSessionId = String(sessionId || "").toLowerCase();
  const registrationProperty = editRuntimeRegistrationProperty(normalizedExecutionId);
  if (
    !isEditRuntimeExecutionId(normalizedExecutionId)
    || !isEditRuntimeSessionId(normalizedSessionId)
    || !registrationProperty
  ) {
    throw new TypeError("Edit runtime bootstrap identity is invalid.");
  }
  const configuration = JSON.stringify({
    markerAttribute: EDIT_RUNTIME_SOURCE_MARKER_ATTRIBUTE,
    sourceNodeAttribute: "data-html-ai-source-node-id",
    registrationProperty,
  }).replace(/</gu, "\\u003c");
  return String.raw`
(() => {
  "use strict";
  const config = ${configuration};
  const claimedIds = new Set();
  const provedIds = new WeakMap();
  const openRegistration = window.parent?.[config.registrationProperty];
  const registerProved = typeof openRegistration === "function"
    ? openRegistration(window)
    : null;

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

  const reject = (element) => {
    element.removeAttribute(config.markerAttribute);
    element.removeAttribute(config.sourceNodeAttribute);
  };

  const claim = (root) => {
    const sourceElements = [];
    for (const element of candidates(root)) {
      const sourceNodeId = element.getAttribute(config.markerAttribute) || "";
      if (!sourceNodeId) {
        reject(element);
        continue;
      }
      const publicSourceNodeId = element.getAttribute(config.sourceNodeAttribute) || "";
      const provedId = provedIds.get(element);
      if (provedId) {
        if (sourceNodeId !== provedId) reject(element);
        continue;
      }
      if (
        claimedIds.has(sourceNodeId)
        || (publicSourceNodeId && publicSourceNodeId !== sourceNodeId)
      ) {
        reject(element);
        continue;
      }
      claimedIds.add(sourceNodeId);
      provedIds.set(element, sourceNodeId);
      if (publicSourceNodeId === sourceNodeId) sourceElements.push(element);
    }
    if (sourceElements.length > 0 && typeof registerProved === "function") {
      registerProved(sourceElements);
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
