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
    stableIdAttribute: "data-pageroot-id",
    scriptStubAttribute: "data-pageroot-edit-runtime-script",
    disabledScriptAttribute: "data-html-canvas-disabled-script",
    originalScriptTypeAttribute: "data-html-canvas-original-script-type",
    missingAttributeValue: "__html_canvas_missing__",
    registrationProperty,
    sessionId: normalizedSessionId,
    executionId: normalizedExecutionId,
    frameToken: `edit-runtime-frame-${normalizedExecutionId}`,
  }).replace(/</gu, "\\u003c");
  return String.raw`
(() => {
  "use strict";
  const config = ${configuration};
  const openRegistration = window.parent?.[config.registrationProperty];
  const registration = typeof openRegistration === "function"
    ? openRegistration(window, {
        sessionId: config.sessionId,
        executionId: config.executionId,
        frameToken: config.frameToken,
      })
    : null;
  const registerProved = registration?.registerProved;
  const reportActivationOutcome = registration?.reportActivationOutcome;

  const candidates = (root) => {
    if (!root || root.nodeType !== Node.ELEMENT_NODE) return [];
    const elements = (
      root.hasAttribute(config.markerAttribute)
      || root.hasAttribute(config.stableIdAttribute)
    ) ? [root] : [];
    return elements.concat(Array.from(root.querySelectorAll(
      "[" + config.markerAttribute + "],[" + config.stableIdAttribute + "]",
    )));
  };

  const reject = (element) => {
    element.removeAttribute(config.markerAttribute);
  };

  const proveParsedSource = () => {
    const claimedIds = new Set();
    const sourceElements = [];
    for (const element of candidates(document.documentElement)) {
      const markerId = element.getAttribute(config.markerAttribute) || "";
      const stableId = element.getAttribute(config.stableIdAttribute) || "";
      if (!markerId || !stableId || markerId !== stableId) {
        reject(element);
        continue;
      }
      if (claimedIds.has(stableId)) {
        reject(element);
        continue;
      }
      claimedIds.add(stableId);
      sourceElements.push(element);
    }
    if (sourceElements.length > 0 && typeof registerProved === "function") {
      registerProved(sourceElements);
    }
  };

  const activateAuthorScripts = async (asyncSettlements) => {
    const placeholders = Array.from(document.querySelectorAll(
      "script[" + config.scriptStubAttribute + "]",
    ));
    let scriptLoadFailed = false;
    for (const placeholder of placeholders) {
      if (!placeholder.isConnected) continue;
      const script = document.createElement("script");
      for (const attribute of Array.from(placeholder.attributes)) {
        if (
          attribute.name === config.markerAttribute
          || attribute.name === config.stableIdAttribute
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
      const waitsForResource = Boolean(
        script.getAttribute("src")
        || (script.getAttribute("type") || "").trim().toLowerCase() === "module"
      );
      const settled = waitsForResource
        ? new Promise((resolve) => {
            script.addEventListener("load", () => resolve(true), { once: true });
            script.addEventListener("error", () => resolve(false), { once: true });
          })
        : Promise.resolve(true);
      placeholder.replaceWith(script);
      if (!script.async) {
        if (!await settled) scriptLoadFailed = true;
      } else {
        asyncSettlements.push(settled);
      }
    }
    return !scriptLoadFailed;
  };

  let activationStarted = false;
  let activationComplete = false;
  let deferredDomContentLoaded = false;
  const holdDomContentLoaded = (event) => {
    if (activationComplete || !event.isTrusted) return;
    deferredDomContentLoaded = true;
    event.stopImmediatePropagation();
  };
  window.addEventListener("DOMContentLoaded", holdDomContentLoaded, true);

  const start = async () => {
    if (activationStarted) return;
    activationStarted = true;
    let activationFailed = false;
    let activationReported = false;
    const asyncSettlements = [];
    const reportOnce = (outcome) => {
      if (activationReported || typeof reportActivationOutcome !== "function") return;
      activationReported = true;
      reportActivationOutcome(outcome);
    };
    const captureActivationError = (event) => {
      if (event instanceof ErrorEvent) activationFailed = true;
    };
    const captureActivationRejection = () => {
      activationFailed = true;
    };
    window.addEventListener("error", captureActivationError, true);
    window.addEventListener("unhandledrejection", captureActivationRejection, true);
    try {
      proveParsedSource();
      if (!await activateAuthorScripts(asyncSettlements)) activationFailed = true;
    } catch {
      activationFailed = true;
    } finally {
      activationComplete = true;
      window.removeEventListener("DOMContentLoaded", holdDomContentLoaded, true);
      try {
        if (deferredDomContentLoaded) {
          document.dispatchEvent(new Event("DOMContentLoaded", { bubbles: true }));
        }
        const asyncResults = await Promise.all(asyncSettlements);
        if (asyncResults.some((loaded) => !loaded)) activationFailed = true;
        // Keep the activation window open through the next task so an
        // immediately rejected author promise, including one created by a
        // deferred DOMContentLoaded handler, reaches unhandledrejection.
        await new Promise((resolve) => setTimeout(resolve, 0));
      } catch {
        activationFailed = true;
      } finally {
        window.removeEventListener("error", captureActivationError, true);
        window.removeEventListener("unhandledrejection", captureActivationRejection, true);
        reportOnce(activationFailed ? "activation-failed" : "activation-ready");
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
