import {
  EDIT_AUTHOR_RUNTIME_BUDGET,
  EDIT_AUTHOR_RUNTIME_CONTRACT_VERSION,
  EDIT_RUNTIME_BOOTSTRAP_ATTRIBUTE,
  EDIT_RUNTIME_FROZEN_ATTRIBUTE,
  EDIT_RUNTIME_HOST_ATTRIBUTE,
  EDIT_RUNTIME_OWNED_ATTRIBUTE,
  EDIT_RUNTIME_RESULT_ATTRIBUTE,
  EDIT_RUNTIME_SCRIPT_STUB_ATTRIBUTE,
  EDIT_RUNTIME_SOURCE_MARKER_ATTRIBUTE,
} from "../app/domain/edit-runtime-contract.js";

function safeScriptValue(value) {
  return JSON.stringify(value).replace(/</gu, "\\u003c");
}

/**
 * Produces the only executable program injected into an Edit one-shot frame.
 * It runs before every author program, captures the completely parsed static
 * document, loads the fixed author bytes in source order, then tears down the
 * author event/async surface before PageRoot attaches editing listeners.
 */
export function createEditRuntimeBootstrap({
  freezeKey,
  executionId,
  sessionId,
  geometryTolerancePx = EDIT_AUTHOR_RUNTIME_BUDGET.geometryTolerancePx,
  mutationRecordLimit = EDIT_AUTHOR_RUNTIME_BUDGET.mutationRecordCount,
} = {}) {
  if (typeof freezeKey !== "string" || freezeKey.length < 16) {
    throw new TypeError("Edit runtime bootstrap requires a private freeze key.");
  }
  if (typeof executionId !== "string" || !executionId) {
    throw new TypeError("Edit runtime bootstrap requires an execution identity.");
  }
  if (typeof sessionId !== "string" || !sessionId) {
    throw new TypeError("Edit runtime bootstrap requires a session identity.");
  }
  const config = {
    freezeKey,
    executionId,
    sessionId,
    geometryTolerancePx: Math.max(0, Number(geometryTolerancePx) || 0),
    mutationRecordLimit: Math.max(1, Math.floor(Number(mutationRecordLimit) || 1)),
    attributes: {
      source: EDIT_RUNTIME_SOURCE_MARKER_ATTRIBUTE,
      host: EDIT_RUNTIME_HOST_ATTRIBUTE,
      owned: EDIT_RUNTIME_OWNED_ATTRIBUTE,
      stub: EDIT_RUNTIME_SCRIPT_STUB_ATTRIBUTE,
      bootstrap: EDIT_RUNTIME_BOOTSTRAP_ATTRIBUTE,
      frozen: EDIT_RUNTIME_FROZEN_ATTRIBUTE,
      result: EDIT_RUNTIME_RESULT_ATTRIBUTE,
    },
  };
  return String.raw`(() => {
  "use strict";
  const config = ${safeScriptValue(config)};
  const sourceAttribute = config.attributes.source;
  const hostAttribute = config.attributes.host;
  const ownedAttribute = config.attributes.owned;
  const stubAttribute = config.attributes.stub;
  const frozenAttribute = config.attributes.frozen;
  const resultAttribute = config.attributes.result;
  const sourceSelector = "[" + sourceAttribute + "]";
  const hostSelector = "[" + hostAttribute + "]";
  const ownedSelector = "[" + ownedAttribute + "]";
  const native = {
    addEventListener: EventTarget.prototype.addEventListener,
    removeEventListener: EventTarget.prototype.removeEventListener,
    setTimeout: window.setTimeout.bind(window),
    clearTimeout: window.clearTimeout.bind(window),
    setInterval: window.setInterval.bind(window),
    clearInterval: window.clearInterval.bind(window),
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
    mutationObserver: window.MutationObserver,
    resizeObserver: window.ResizeObserver,
    intersectionObserver: window.IntersectionObserver,
    fetch: window.fetch,
    xmlHttpRequest: window.XMLHttpRequest,
    webSocket: window.WebSocket,
    eventSource: window.EventSource,
    worker: window.Worker,
    sharedWorker: window.SharedWorker,
    open: window.open,
    sendBeacon: navigator.sendBeacon,
    createElement: Document.prototype.createElement,
  };
  const state = {
    phase: "booting",
    frozen: false,
    violations: new Set(),
    timers: new Set(),
    intervals: new Set(),
    animationFrames: new Set(),
    listeners: [],
    observers: [],
    auditObserver: null,
    mutationRecords: 0,
    baseline: null,
    result: null,
  };
  const maxListeners = 4096;
  const maxObservers = 512;
  const blocked = (reason) => {
    state.violations.add(String(reason || "blocked-api"));
    throw new Error("PageRoot Edit runtime blocked " + String(reason || "API") + ".");
  };
  const ownAttribute = (name) => (
    name === sourceAttribute
    || name === hostAttribute
    || name === ownedAttribute
    || name === frozenAttribute
    || name === resultAttribute
  );
  const isInsideOwned = (element) => (
    element instanceof Element && (
      element.hasAttribute(ownedAttribute)
      || element.parentElement?.hasAttribute(ownedAttribute) === true
    )
  );
  const isPageRootFrameNode = (element) => (
    element instanceof Element && (
      element.hasAttribute(ownedAttribute)
      || element.hasAttribute(config.attributes.bootstrap)
      || element.tagName.toLowerCase() === "meta"
        && element.hasAttribute("data-html-canvas-render-verification")
      || element.tagName.toLowerCase() === "style"
        && element.hasAttribute("data-html-canvas-editor-style")
    )
  );
  const hostFor = (node) => {
    const element = node instanceof Element ? node : node?.parentElement;
    return element instanceof Element ? element.closest(hostSelector) : null;
  };
  const sourceNodes = () => {
    const root = document.documentElement;
    const nodes = root ? [root, ...root.querySelectorAll(sourceSelector)] : [];
    const seen = new Set();
    return nodes.filter((node) => {
      const marker = node.getAttribute(sourceAttribute);
      if (!marker || seen.has(marker)) return false;
      seen.add(marker);
      return true;
    });
  };
  const sourceParentMarker = (element) => {
    let parent = element.parentElement;
    while (parent instanceof Element) {
      const marker = parent.getAttribute(sourceAttribute);
      if (marker) return marker;
      parent = parent.parentElement;
    }
    return null;
  };
  const attributesFor = (element, host) => {
    const attributes = [];
    for (const attribute of Array.from(element.attributes)) {
      const name = String(attribute.name || "").toLowerCase();
      if (ownAttribute(name)) continue;
      if (
        host
        && (name === "_echarts_instance_" || name === "data-ecid" || name === "data-zr-dom-id")
      ) continue;
      attributes.push(name + "=" + String(attribute.value || ""));
    }
    return attributes.sort().join("\u0000");
  };
  const rectFor = (element) => {
    try {
      const rect = element.getBoundingClientRect();
      return [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)
        ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
        : null;
    } catch {
      return null;
    }
  };
  const comparedRect = (left, right) => {
    if (!left || !right) return left === right;
    const tolerance = config.geometryTolerancePx;
    return Math.abs(left.x - right.x) <= tolerance
      && Math.abs(left.y - right.y) <= tolerance
      && Math.abs(left.width - right.width) <= tolerance
      && Math.abs(left.height - right.height) <= tolerance;
  };
  const textSnapshot = () => {
    const root = document.documentElement;
    if (!root) return [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const values = [];
    let node = walker.nextNode();
    while (node) {
      const parent = node.parentElement;
      if (
        parent
        && !hostFor(parent)
        && !isInsideOwned(parent)
        && !isPageRootFrameNode(parent)
        && !parent.closest("script,style")
      ) {
        values.push((sourceParentMarker(parent) || "root") + "\u0000" + node.data);
      }
      node = walker.nextNode();
    }
    return values;
  };
  const baseline = () => {
    const source = sourceNodes();
    if (!source.length || source.length > ${safeScriptValue(EDIT_AUTHOR_RUNTIME_BUDGET.sourceNodeCount)}) {
      state.violations.add("source-node-budget");
      return null;
    }
    const nodes = new Map();
    const hosts = new Map();
    for (const element of source) {
      const marker = element.getAttribute(sourceAttribute);
      const host = element.hasAttribute(hostAttribute);
      const record = {
        marker,
        tagName: element.tagName.toLowerCase(),
        parentMarker: sourceParentMarker(element),
        attributes: attributesFor(element, host),
        rect: /^(?:script|style|meta|link|title)$/u.test(element.tagName.toLowerCase())
          ? null
          : rectFor(element),
        host,
      };
      nodes.set(marker, record);
      if (host) {
        const hostKey = element.getAttribute(hostAttribute);
        if (!hostKey || hosts.has(hostKey)) {
          state.violations.add("host-identity-invalid");
          continue;
        }
        if (!record.rect || record.rect.width < 1 || record.rect.height < 1) {
          state.violations.add("host-geometry-unavailable");
        }
        hosts.set(hostKey, record);
      }
    }
    if (!hosts.size) state.violations.add("no-approved-host");
    return { nodes, hosts, text: textSnapshot() };
  };
  const allowedRuntimeTags = new Set([
    "a", "canvas", "circle", "clipPath", "defs", "div", "ellipse", "g", "image",
    "line", "linearGradient", "path", "polygon", "polyline", "rect", "span", "stop",
    "svg", "text", "tspan", "use",
  ].map((tag) => tag.toLowerCase()));
  const audit = () => {
    const before = state.baseline;
    if (!before) return { state: "rejected", reason: "baseline-unavailable", hostKeys: [] };
    const afterNodes = sourceNodes();
    if (afterNodes.length !== before.nodes.size) {
      state.violations.add("source-node-count-changed");
    }
    const seen = new Set();
    for (const element of afterNodes) {
      const marker = element.getAttribute(sourceAttribute);
      const record = before.nodes.get(marker);
      if (!record || seen.has(marker)) {
        state.violations.add("source-node-identity-changed");
        continue;
      }
      seen.add(marker);
      const host = record.host;
      if (
        element.tagName.toLowerCase() !== record.tagName
        || sourceParentMarker(element) !== record.parentMarker
        || attributesFor(element, host) !== record.attributes
      ) state.violations.add("source-node-mutated");
      const rect = record.rect ? rectFor(element) : null;
      if (host) {
        if (!rect || rect.width < 1 || rect.height < 1 || !comparedRect(record.rect, rect)) {
          state.violations.add("host-geometry-changed");
        }
      } else if (record.rect && !comparedRect(record.rect, rect)) {
        state.violations.add("source-layout-changed");
      }
    }
    if (seen.size !== before.nodes.size) state.violations.add("source-node-missing");
    const afterText = textSnapshot();
    if (
      afterText.length !== before.text.length
      || afterText.some((value, index) => value !== before.text[index])
    ) state.violations.add("source-text-changed");
    for (const element of Array.from(document.querySelectorAll("*"))) {
      if (
        element.hasAttribute(sourceAttribute)
        || isInsideOwned(element)
        || isPageRootFrameNode(element)
      ) continue;
      const host = hostFor(element);
      if (!host) {
        state.violations.add("runtime-node-outside-host");
        continue;
      }
      if (!allowedRuntimeTags.has(element.tagName.toLowerCase())) {
        state.violations.add("runtime-node-tag-rejected");
        continue;
      }
      element.style.setProperty("pointer-events", "none", "important");
      element.style.setProperty("user-select", "none", "important");
      element.setAttribute("tabindex", "-1");
    }
    const hostKeys = [...before.hosts.keys()].sort();
    const reason = [...state.violations].sort()[0] || null;
    return {
      state: reason ? "rejected" : "frozen",
      reason,
      hostKeys,
      mutationRecords: state.mutationRecords,
    };
  };
  const clearTrackedAsync = () => {
    state.timers.forEach((timer) => native.clearTimeout(timer));
    state.intervals.forEach((timer) => native.clearInterval(timer));
    state.animationFrames.forEach((frame) => native.cancelAnimationFrame(frame));
    state.timers.clear();
    state.intervals.clear();
    state.animationFrames.clear();
  };
  const clearPropertyHandlers = () => {
    const properties = [
      "onabort", "onanimationcancel", "onanimationend", "onanimationiteration",
      "onanimationstart", "onauxclick", "onbeforeinput", "onbeforeunload",
      "onblur", "oncancel", "oncanplay", "onchange", "onclick", "onclose",
      "oncompositionend", "oncompositionstart", "oncompositionupdate", "oncontextmenu",
      "oncopy", "oncuechange", "oncut", "ondblclick", "ondrag", "ondragend",
      "ondragenter", "ondragexit", "ondragleave", "ondragover", "ondragstart",
      "ondrop", "ondurationchange", "onemptied", "onended", "onerror", "onfocus",
      "onformdata", "onfullscreenchange", "onfullscreenerror", "ongotpointercapture",
      "onhashchange", "oninput", "oninvalid", "onkeydown", "onkeypress", "onkeyup",
      "onload", "onloadeddata", "onloadedmetadata", "onloadstart", "onlostpointercapture",
      "onmessage", "onmousedown", "onmouseenter", "onmouseleave", "onmousemove",
      "onmouseout", "onmouseover", "onmouseup", "onmousewheel", "onoffline", "ononline",
      "onpagehide", "onpageshow", "onpaste", "onpause", "onplay", "onplaying",
      "onpointercancel", "onpointerdown", "onpointerenter", "onpointerleave",
      "onpointermove", "onpointerout", "onpointerover", "onpointerup", "onpopstate",
      "onprogress", "onratechange", "onrejectionhandled", "onreset", "onresize",
      "onscroll", "onsecuritypolicyviolation", "onseeked", "onseeking", "onselect",
      "onselectionchange", "onselectstart", "onstalled", "onsubmit", "onsuspend",
      "ontimeupdate", "ontoggle", "ontouchcancel", "ontouchend", "ontouchmove",
      "ontouchstart", "ontransitioncancel", "ontransitionend", "ontransitionrun",
      "ontransitionstart", "onunhandledrejection", "onunload", "onvolumechange",
      "onwaiting", "onwheel",
    ];
    const targets = [window, document, ...document.querySelectorAll("*")];
    for (const target of targets) {
      for (const property of properties) {
        try { if (property in target) target[property] = null; } catch {}
      }
    }
  };
  const restorePageRootPrimitives = () => {
    try { EventTarget.prototype.addEventListener = native.addEventListener; } catch {}
    try { EventTarget.prototype.removeEventListener = native.removeEventListener; } catch {}
    try { window.setTimeout = native.setTimeout; } catch {}
    try { window.clearTimeout = native.clearTimeout; } catch {}
    try { window.setInterval = native.setInterval; } catch {}
    try { window.clearInterval = native.clearInterval; } catch {}
    try { window.requestAnimationFrame = native.requestAnimationFrame; } catch {}
    try { window.cancelAnimationFrame = native.cancelAnimationFrame; } catch {}
    try { window.MutationObserver = native.mutationObserver; } catch {}
    try { window.ResizeObserver = native.resizeObserver; } catch {}
    try { window.IntersectionObserver = native.intersectionObserver; } catch {}
    try { window.fetch = native.fetch; } catch {}
    try { window.XMLHttpRequest = native.xmlHttpRequest; } catch {}
    try { window.WebSocket = native.webSocket; } catch {}
    try { window.EventSource = native.eventSource; } catch {}
    try { window.Worker = native.worker; } catch {}
    try { window.SharedWorker = native.sharedWorker; } catch {}
    try { window.open = native.open; } catch {}
    try { navigator.sendBeacon = native.sendBeacon; } catch {}
  };
  const freeze = () => {
    if (state.frozen) return state.result;
    state.frozen = true;
    state.phase = "freezing";
    clearTrackedAsync();
    for (const listener of state.listeners.splice(0)) {
      try {
        native.removeEventListener.call(
          listener.target,
          listener.type,
          listener.listener,
          listener.options,
        );
      } catch {}
    }
    for (const observer of state.observers.splice(0)) {
      try { observer.disconnect(); } catch {}
    }
    clearPropertyHandlers();
    try {
      document.getAnimations?.().forEach((animation) => animation.cancel());
    } catch {}
    state.result = Object.freeze({
      ...audit(),
      contractVersion: ${safeScriptValue(EDIT_AUTHOR_RUNTIME_CONTRACT_VERSION)},
      executionId: config.executionId,
      sessionId: config.sessionId,
    });
    state.phase = state.result.state;
    document.documentElement?.setAttribute(frozenAttribute, "true");
    document.documentElement?.setAttribute(resultAttribute, JSON.stringify(state.result));
    restorePageRootPrimitives();
    return state.result;
  };
  const installTracking = () => {
    const recordListener = (target, type, listener, options) => {
      if (state.frozen || typeof listener !== "function" && typeof listener !== "object") return;
      if (state.listeners.length >= maxListeners) {
        state.violations.add("listener-budget");
        return;
      }
      state.listeners.push({ target, type, listener, options });
    };
    EventTarget.prototype.addEventListener = function(type, listener, options) {
      const result = native.addEventListener.call(this, type, listener, options);
      recordListener(this, type, listener, options);
      return result;
    };
    window.setTimeout = function(callback, delay, ...args) {
      if (state.frozen) return 0;
      const timer = native.setTimeout(callback, delay, ...args);
      state.timers.add(timer);
      return timer;
    };
    window.clearTimeout = function(timer) {
      state.timers.delete(timer);
      return native.clearTimeout(timer);
    };
    window.setInterval = function(callback, delay, ...args) {
      if (state.frozen) return 0;
      const timer = native.setInterval(callback, delay, ...args);
      state.intervals.add(timer);
      return timer;
    };
    window.clearInterval = function(timer) {
      state.intervals.delete(timer);
      return native.clearInterval(timer);
    };
    window.requestAnimationFrame = function(callback) {
      if (state.frozen) return 0;
      const frame = native.requestAnimationFrame(callback);
      state.animationFrames.add(frame);
      return frame;
    };
    window.cancelAnimationFrame = function(frame) {
      state.animationFrames.delete(frame);
      return native.cancelAnimationFrame(frame);
    };
    const trackedObserver = (Constructor, name) => {
      if (typeof Constructor !== "function") return Constructor;
      const Wrapped = function(...args) {
        if (state.observers.length >= maxObservers) {
          state.violations.add("observer-budget");
          throw new Error("PageRoot Edit runtime observer budget exceeded.");
        }
        const observer = new Constructor(...args);
        state.observers.push(observer);
        return observer;
      };
      Object.setPrototypeOf(Wrapped, Constructor);
      Wrapped.prototype = Constructor.prototype;
      try { Object.defineProperty(Wrapped, "name", { value: name }); } catch {}
      return Wrapped;
    };
    window.MutationObserver = trackedObserver(native.mutationObserver, "MutationObserver");
    window.ResizeObserver = trackedObserver(native.resizeObserver, "ResizeObserver");
    window.IntersectionObserver = trackedObserver(native.intersectionObserver, "IntersectionObserver");
    const deny = (name) => () => blocked(name);
    window.fetch = deny("fetch");
    window.XMLHttpRequest = function() { return blocked("XMLHttpRequest"); };
    window.WebSocket = function() { return blocked("WebSocket"); };
    window.EventSource = function() { return blocked("EventSource"); };
    window.Worker = function() { return blocked("Worker"); };
    window.SharedWorker = function() { return blocked("SharedWorker"); };
    window.open = deny("window.open");
    window.alert = () => undefined;
    window.confirm = () => false;
    window.prompt = () => null;
    try { navigator.sendBeacon = () => { state.violations.add("sendBeacon"); return false; }; } catch {}
    try { Document.prototype.write = deny("document.write"); } catch {}
    try { Document.prototype.open = deny("document.open"); } catch {}
    try { HTMLFormElement.prototype.submit = deny("form.submit"); } catch {}
    try { HTMLFormElement.prototype.requestSubmit = deny("form.requestSubmit"); } catch {}
    try { HTMLMediaElement.prototype.play = () => Promise.reject(new Error("Media playback is unavailable in Edit.")); } catch {}
  };
  const observeMutations = () => {
    if (typeof native.mutationObserver !== "function" || !document.documentElement) return;
    try {
      state.auditObserver = new native.mutationObserver((records) => {
        state.mutationRecords += records.length;
        if (state.mutationRecords > config.mutationRecordLimit) {
          state.violations.add("mutation-record-budget");
        }
      });
      state.auditObserver.observe(document.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true,
      });
      state.observers.push(state.auditObserver);
    } catch {
      state.violations.add("mutation-observer-unavailable");
    }
  };
  const loadOne = (scriptId, origin) => new Promise((resolve, reject) => {
    const script = native.createElement.call(document, "script");
    script.setAttribute(ownedAttribute, "author-loader");
    script.async = false;
    script.src = origin + "/.pageroot/author/" + encodeURIComponent(scriptId) + ".js";
    native.addEventListener.call(script, "load", () => {
      script.remove();
      resolve();
    }, { once: true });
    native.addEventListener.call(script, "error", () => {
      script.remove();
      reject(new Error("author-script-load-failed"));
    }, { once: true });
    (document.head || document.documentElement).appendChild(script);
  });
  const twoFrames = () => new Promise((resolve) => {
    native.requestAnimationFrame(() => native.requestAnimationFrame(resolve));
  });
  const begin = async () => {
    if (state.phase !== "booting") return;
    state.baseline = baseline();
    observeMutations();
    installTracking();
    state.phase = "running";
    const bootstrap = document.currentScript
      || document.querySelector("script[${EDIT_RUNTIME_BOOTSTRAP_ATTRIBUTE}]");
    let origin = "";
    try {
      const url = new URL(bootstrap?.src || "");
      origin = url.protocol + "//" + url.hostname;
    } catch {
      state.violations.add("bootstrap-origin-invalid");
    }
    const stubs = Array.from(document.querySelectorAll("script[" + stubAttribute + "]"));
    try {
      for (const stub of stubs) {
        const scriptId = stub.getAttribute(stubAttribute);
        if (!/^[0-9]+$/u.test(scriptId || "") || !origin) {
          state.violations.add("script-stub-invalid");
          break;
        }
        await loadOne(scriptId, origin);
      }
      await twoFrames();
      await Promise.resolve();
    } catch {
      state.violations.add("author-script-failed");
    } finally {
      freeze();
    }
  };
  const api = Object.freeze({
    result: () => state.result,
    freeze,
  });
  Object.defineProperty(window, config.freezeKey, {
    value: api,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  if (document.readyState === "loading") {
    native.addEventListener.call(document, "DOMContentLoaded", () => { void begin(); }, { once: true });
  } else {
    void begin();
  }
})();`;
}
