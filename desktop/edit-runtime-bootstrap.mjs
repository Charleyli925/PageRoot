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
    scriptStubAttribute: "data-pageroot-edit-runtime-script",
    disabledScriptAttribute: "data-html-canvas-disabled-script",
    originalScriptTypeAttribute: "data-html-canvas-original-script-type",
    missingAttributeValue: "__html_canvas_missing__",
    registrationProperty,
  }).replace(/</gu, "\\u003c");
  return String.raw`
(() => {
  "use strict";
  const config = ${configuration};
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

  const proveParsedSource = () => {
    const claimedIds = new Set();
    const sourceElements = [];
    for (const element of candidates(document.documentElement)) {
      const sourceNodeId = element.getAttribute(config.markerAttribute) || "";
      if (!sourceNodeId) {
        reject(element);
        continue;
      }
      const publicSourceNodeId = element.getAttribute(config.sourceNodeAttribute) || "";
      if (
        claimedIds.has(sourceNodeId)
        || (publicSourceNodeId && publicSourceNodeId !== sourceNodeId)
      ) {
        reject(element);
        continue;
      }
      claimedIds.add(sourceNodeId);
      if (publicSourceNodeId === sourceNodeId) sourceElements.push(element);
    }
    if (sourceElements.length > 0 && typeof registerProved === "function") {
      registerProved(sourceElements);
    }
  };

  const activateAuthorScripts = async () => {
    const placeholders = Array.from(document.querySelectorAll(
      "script[" + config.scriptStubAttribute + "]",
    ));
    for (const placeholder of placeholders) {
      if (!placeholder.isConnected) continue;
      const script = document.createElement("script");
      for (const attribute of Array.from(placeholder.attributes)) {
        if (
          attribute.name === config.markerAttribute
          || attribute.name === config.sourceNodeAttribute
          || attribute.name === config.scriptStubAttribute
          || attribute.name === config.disabledScriptAttribute
          || attribute.name === config.originalScriptTypeAttribute
        ) continue;
        script.setAttribute(attribute.name, attribute.value);
      }
      const originalType = placeholder.getAttribute(config.originalScriptTypeAttribute);
      if (originalType && originalType !== config.missingAttributeValue) {
        script.setAttribute("type", originalType);
      } else {
        script.removeAttribute("type");
      }
      if (!placeholder.hasAttribute("async")) script.async = false;
      const settled = new Promise((resolve) => {
        script.addEventListener("load", resolve, { once: true });
        script.addEventListener("error", resolve, { once: true });
      });
      placeholder.replaceWith(script);
      if (!script.async) await settled;
    }
  };

  let activationStarted = false;
  let activationComplete = false;
  let deferredDomContentLoaded = false;
  const holdDomContentLoaded = (event) => {
    if (activationComplete || !event.isTrusted) return;
    deferredDomContentLoaded = true;
    event.stopImmediatePropagation();
  };
  document.addEventListener("DOMContentLoaded", holdDomContentLoaded, true);

  const start = async () => {
    if (activationStarted) return;
    activationStarted = true;
    try {
      proveParsedSource();
      await activateAuthorScripts();
    } finally {
      activationComplete = true;
      document.removeEventListener("DOMContentLoaded", holdDomContentLoaded, true);
      if (deferredDomContentLoaded) {
        document.dispatchEvent(new Event("DOMContentLoaded", { bubbles: true }));
      }
    }
  };
  const startWhenParsed = () => {
    if (document.readyState === "loading") return;
    document.removeEventListener("readystatechange", startWhenParsed);
    void start();
  };
  if (document.readyState === "loading") {
    document.addEventListener("readystatechange", startWhenParsed);
  } else {
    void start();
  }

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
