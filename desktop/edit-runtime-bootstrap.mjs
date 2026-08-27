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

/*
 * This function deliberately closes over nothing. createEditRuntimeBootstrap()
 * serializes it into the one-use protocol resource so author code only gets a
 * tiny, disposable final-frame surface.
 */
function oneShotRuntimeBootstrap(config) {
  "use strict";
  const attributes = config.attributes;
  const sourceAttribute = attributes.source;
  const hostAttribute = attributes.host;
  const ownedAttribute = attributes.owned;
  const stubAttribute = attributes.stub;
  const frozenAttribute = attributes.frozen;
  const resultAttribute = attributes.result;
  const sourceSelector = "[" + sourceAttribute + "]";
  const hostSelector = "[" + hostAttribute + "]";
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
    createElement: Document.prototype.createElement,
    createElementNS: Document.prototype.createElementNS,
    documentOpen: Document.prototype.open,
    documentWrite: Document.prototype.write,
    messageChannel: window.MessageChannel,
    messagePortClose: MessagePort.prototype.close,
    messagePortOnMessage: Object.getOwnPropertyDescriptor(
      MessagePort.prototype,
      "onmessage",
    ),
    messagePortOnMessageError: Object.getOwnPropertyDescriptor(
      MessagePort.prototype,
      "onmessageerror",
    ),
  };
  const state = {
    phase: "booting",
    frozen: false,
    violations: new Set(),
    timeouts: new Set(),
    intervals: new Set(),
    animationFrames: new Set(),
    listeners: [],
    observers: [],
    ports: new Set(),
    baseline: null,
    preflightStyle: null,
    result: null,
  };
  const runtimeForbiddenTags = new Set([
    "audio", "base", "button", "dialog", "embed", "form", "frame", "frameset",
    "iframe", "input", "link", "meta", "object", "option", "script", "select",
    "source", "style", "textarea", "track", "video",
  ]);
  // ECharts initializes an otherwise empty host by adding these layout-only
  // declarations (and, below, a bounded scale transform). They are required
  // for its owned descendants to paint, but may not overwrite source styling.
  const isAllowedRuntimeHostStyle = (property, value, priority) => {
    if (priority) return false;
    const normalized = String(value || "").trim().toLowerCase();
    if (property === "position") return normalized === "relative";
    if (property === "user-select") return normalized === "none";
    if (property === "-webkit-tap-highlight-color") {
      return /^rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)$/u.test(normalized);
    }
    if (property !== "transform") return false;
    const match = /^scale\(\s*([0-9]+(?:\.[0-9]+)?)\s*\)$/u.exec(String(value || ""));
    if (!match) return false;
    const scale = Number(match[1]);
    return Number.isFinite(scale) && scale > 0 && scale <= 1;
  };
  const eventProperties = [
    "onanimationend", "onanimationstart", "onbeforeinput", "onblur", "onchange",
    "onclick", "oncompositionend", "oncompositionstart", "oncontextmenu", "oncopy",
    "oncut", "ondblclick", "ondrag", "ondrop", "onerror", "onfocus", "oninput",
    "onkeydown", "onkeypress", "onkeyup", "onload", "onmousedown", "onmousemove",
    "onmouseout", "onmouseover", "onmouseup", "onpointerdown", "onpointermove",
    "onpointerup", "onresize", "onscroll", "onselect", "onsubmit", "ontouchend",
    "ontouchmove", "ontouchstart", "onwheel",
  ];
  const violation = (value) => {
    state.violations.add(String(value || "runtime-violation"));
  };
  const isOwned = (element) => (
    element instanceof Element
    && element.hasAttribute(ownedAttribute)
  );
  const hostFor = (node) => {
    const element = node instanceof Element ? node : node?.parentElement;
    return element instanceof Element ? element.closest(hostSelector) : null;
  };
  const sourceNodes = () => {
    const root = document.documentElement;
    if (!root) return [];
    const seen = new Set();
    return [root, ...root.querySelectorAll(sourceSelector)].filter((element) => {
      const marker = element.getAttribute(sourceAttribute);
      if (!marker || seen.has(marker)) return false;
      seen.add(marker);
      return true;
    });
  };
  const parentMarker = (element) => {
    let parent = element.parentElement;
    while (parent instanceof Element) {
      const marker = parent.getAttribute(sourceAttribute);
      if (marker) return marker;
      parent = parent.parentElement;
    }
    return null;
  };
  const sourceAttributes = (element, ignoreStyle = false) => {
    const values = [];
    for (const attribute of Array.from(element.attributes)) {
      const name = String(attribute.name || "").toLowerCase();
      if (name.startsWith("data-pageroot-edit-runtime-")) continue;
      if (
        ignoreStyle
        && (
          name === "style"
          || (
            element.tagName.toLowerCase() === "canvas"
            && (name === "width" || name === "height")
          )
        )
      ) continue;
      if (
        name === "_echarts_instance_"
        || name === "data-ecid"
        || name === "data-zr-dom-id"
      ) continue;
      values.push(name + "=" + String(attribute.value || ""));
    }
    return values.sort().join("\u0000");
  };
  const authoredAttributeSnapshot = (element) => Array.from(element.attributes)
    .filter((attribute) => !String(attribute.name || "").toLowerCase()
      .startsWith("data-pageroot-edit-runtime-"))
    .map((attribute) => [attribute.name, String(attribute.value || "")]);
  const styleSnapshot = (element) => {
    if (!(element instanceof Element) || !element.style) return [];
    return Array.from(element.style).map((property) => [
      property,
      element.style.getPropertyValue(property),
      element.style.getPropertyPriority(property),
    ]).sort((left, right) => left[0].localeCompare(right[0]));
  };
  const hostStylePreservesSource = (element, before) => {
    const styleMap = (snapshot) => new Map((snapshot || []).map(([
      property,
      value,
      priority,
    ]) => [property, [value, priority]]));
    const initial = styleMap(before);
    const current = styleMap(styleSnapshot(element));
    for (const [property, value] of initial) {
      const currentValue = current.has(property) ? current.get(property) : null;
      if (JSON.stringify(currentValue) !== JSON.stringify(value)) {
        return false;
      }
    }
    for (const [property, [value, priority]] of current) {
      if (
        !initial.has(property)
        && !isAllowedRuntimeHostStyle(property, value, priority)
      ) {
        return false;
      }
    }
    return true;
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
        && !isOwned(parent)
        && !parent.closest("script,style")
      ) {
        values.push((parentMarker(parent) || "root") + "\u0000" + node.data);
      }
      node = walker.nextNode();
    }
    return values;
  };
  const captureBaseline = () => {
    const nodes = new Map();
    const hosts = new Map();
    const source = sourceNodes();
    if (!source.length || source.length > config.sourceNodeCount) {
      violation("source-node-budget");
      return null;
    }
    for (const element of source) {
      const marker = element.getAttribute(sourceAttribute);
      if (!marker || nodes.has(marker)) {
        violation("source-node-identity-invalid");
        continue;
      }
      const hostKey = element.getAttribute(hostAttribute);
      const approvedHost = Boolean(hostKey);
      if (hostKey) {
        if (hosts.has(hostKey)) violation("host-identity-invalid");
        hosts.set(hostKey, {
          tagName: element.tagName.toLowerCase(),
          marker,
          authoredAttributes: authoredAttributeSnapshot(element),
        });
      }
      nodes.set(marker, {
        tagName: element.tagName.toLowerCase(),
        parentMarker: parentMarker(element),
        attributes: sourceAttributes(element, approvedHost),
        authoredAttributes: authoredAttributeSnapshot(element),
        hostStyle: approvedHost ? styleSnapshot(element) : null,
      });
    }
    if (!hosts.size) violation("no-approved-host");
    return { nodes, hosts, text: textSnapshot() };
  };
  const restoreAuthoredAttributes = (element, authoredAttributes) => {
    const authoredNames = new Set(authoredAttributes.map(([name]) => name));
    for (const attribute of Array.from(element.attributes)) {
      const name = String(attribute.name || "");
      if (
        name.toLowerCase().startsWith("data-pageroot-edit-runtime-")
        || authoredNames.has(name)
      ) continue;
      element.removeAttribute(name);
    }
    for (const [name, value] of authoredAttributes) element.setAttribute(name, value);
  };
  const restoreNonHostSourceAttributes = () => {
    const before = state.baseline;
    if (!before) return;
    for (const element of sourceNodes()) {
      if (element.hasAttribute(hostAttribute)) continue;
      const record = before.nodes.get(element.getAttribute(sourceAttribute));
      if (record) restoreAuthoredAttributes(element, record.authoredAttributes);
    }
  };
  const normalizeDirectSvgHosts = () => {
    const before = state.baseline;
    if (!before) return;
    for (const [key, record] of before.hosts) {
      if (record.tagName !== "svg") continue;
      const host = Array.from(document.querySelectorAll(hostSelector)).find((element) => (
        element.getAttribute(hostAttribute) === key
      ));
      if (!(host instanceof SVGElement)) continue;
      const runtimeNodes = Array.from(host.childNodes).filter((node) => (
        !(node instanceof Element) || !node.hasAttribute(sourceAttribute)
      ));
      const viewBox = host.getAttribute("viewBox");
      const preserveAspectRatio = host.getAttribute("preserveAspectRatio");
      restoreAuthoredAttributes(host, record.authoredAttributes);
      if (!runtimeNodes.length) continue;
      const inner = native.createElementNS.call(
        document,
        "http://www.w3.org/2000/svg",
        "svg",
      );
      inner.setAttribute(ownedAttribute, "runtime-svg-surface");
      inner.setAttribute("width", "100%");
      inner.setAttribute("height", "100%");
      if (viewBox) inner.setAttribute("viewBox", viewBox);
      if (preserveAspectRatio) inner.setAttribute("preserveAspectRatio", preserveAspectRatio);
      for (const node of runtimeNodes) inner.appendChild(node);
      host.appendChild(inner);
    }
  };
  const sealRuntimeNode = (element) => {
    try {
      element.style.setProperty("pointer-events", "none", "important");
      element.style.setProperty("user-select", "none", "important");
      element.setAttribute("tabindex", "-1");
      element.setAttribute(ownedAttribute, "runtime");
    } catch {
      violation("runtime-node-unsealable");
    }
  };
  const audit = () => {
    const before = state.baseline;
    if (!before) return { state: "rejected", reason: "baseline-unavailable", hostKeys: [] };
    const current = sourceNodes();
    if (current.length !== before.nodes.size) violation("source-node-count-changed");
    const seen = new Set();
    for (const element of current) {
      const marker = element.getAttribute(sourceAttribute);
      const record = before.nodes.get(marker);
      if (!record || seen.has(marker)) {
        violation("source-node-identity-changed");
        continue;
      }
      seen.add(marker);
      if (
        element.tagName.toLowerCase() !== record.tagName
        || parentMarker(element) !== record.parentMarker
        || sourceAttributes(element, Boolean(element.getAttribute(hostAttribute))) !== record.attributes
        || (
          Boolean(element.getAttribute(hostAttribute))
          && !hostStylePreservesSource(element, record.hostStyle)
        )
      ) violation("source-node-mutated");
    }
    if (seen.size !== before.nodes.size) violation("source-node-missing");
    const texts = textSnapshot();
    if (
      texts.length !== before.text.length
      || texts.some((value, index) => value !== before.text[index])
    ) violation("source-text-changed");
    const currentHosts = new Map();
    for (const host of Array.from(document.querySelectorAll(hostSelector))) {
      const key = host.getAttribute(hostAttribute);
      if (!key || currentHosts.has(key)) {
        violation("host-identity-invalid");
        continue;
      }
      currentHosts.set(key, host);
    }
    if (currentHosts.size !== before.hosts.size) violation("host-binding-changed");
    for (const [key, record] of before.hosts) {
      const host = currentHosts.get(key);
      if (
        !host
        || host.tagName.toLowerCase() !== record.tagName
        || host.getAttribute(sourceAttribute) !== record.marker
      ) violation("host-binding-changed");
    }
    for (const element of Array.from(document.querySelectorAll("*"))) {
      if (element.hasAttribute(sourceAttribute) || isOwned(element)) continue;
      const host = hostFor(element);
      if (!host) {
        violation("runtime-node-outside-host");
        continue;
      }
      if (runtimeForbiddenTags.has(element.tagName.toLowerCase())) {
        violation("runtime-node-surface-rejected");
        continue;
      }
      sealRuntimeNode(element);
    }
    const reason = [...state.violations].sort()[0] || null;
    return {
      state: reason ? "rejected" : "frozen",
      reason,
      hostKeys: [...before.hosts.keys()].sort(),
    };
  };
  const clearTrackedAsync = () => {
    state.timeouts.forEach((value) => native.clearTimeout(value));
    state.intervals.forEach((value) => native.clearInterval(value));
    state.animationFrames.forEach((value) => native.cancelAnimationFrame(value));
    state.timeouts.clear();
    state.intervals.clear();
    state.animationFrames.clear();
  };
  const removeTrackedListeners = () => {
    for (const listener of state.listeners.splice(0)) {
      try {
        native.removeEventListener.call(
          listener.target,
          listener.type,
          listener.listener,
          listener.options,
        );
      } catch {
        // A listener can become invalid while a page is being frozen.
      }
    }
  };
  const disconnectTrackedObservers = () => {
    for (const observer of state.observers.splice(0)) {
      try {
        observer.disconnect();
      } catch {
        // A page observer cannot prevent final freeze.
      }
    }
  };
  const clearPropertyHandlers = () => {
    const targets = [window, document, ...document.querySelectorAll("*")];
    for (const target of targets) {
      for (const property of eventProperties) {
        try {
          if (property in target) target[property] = null;
        } catch {
          // Some browser-owned properties are intentionally read-only.
        }
      }
    }
  };
  const closeTrackedPorts = () => {
    for (const port of state.ports) {
      try { port.onmessage = null; } catch {}
      try { port.onmessageerror = null; } catch {}
      try { native.messagePortClose.call(port); } catch {}
    }
    state.ports.clear();
  };
  const restorePrimitives = () => {
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
    try { Document.prototype.open = native.documentOpen; } catch {}
    try { Document.prototype.write = native.documentWrite; } catch {}
    try { window.MessageChannel = native.messageChannel; } catch {}
    if (native.messagePortOnMessage) {
      try {
        Object.defineProperty(
          MessagePort.prototype,
          "onmessage",
          native.messagePortOnMessage,
        );
      } catch {}
    }
    if (native.messagePortOnMessageError) {
      try {
        Object.defineProperty(
          MessagePort.prototype,
          "onmessageerror",
          native.messagePortOnMessageError,
        );
      } catch {}
    }
  };
  const freeze = () => {
    if (state.frozen) return state.result;
    state.frozen = true;
    state.phase = "freezing";
    clearTrackedAsync();
    removeTrackedListeners();
    disconnectTrackedObservers();
    clearPropertyHandlers();
    closeTrackedPorts();
    try {
      document.getAnimations?.().forEach((animation) => animation.cancel());
    } catch {
      violation("animation-freeze-failed");
    }
    restoreNonHostSourceAttributes();
    normalizeDirectSvgHosts();
    state.result = Object.freeze({
      ...audit(),
      contractVersion: config.contractVersion,
      executionId: config.executionId,
      sessionId: config.sessionId,
    });
    state.phase = state.result.state;
    document.documentElement?.setAttribute(frozenAttribute, "true");
    document.documentElement?.setAttribute(resultAttribute, JSON.stringify(state.result));
    restorePrimitives();
    return state.result;
  };
  const installTracking = () => {
    EventTarget.prototype.addEventListener = function(type, listener, options) {
      const result = native.addEventListener.call(this, type, listener, options);
      if (!state.frozen && (typeof listener === "function" || typeof listener === "object")) {
        state.listeners.push({ target: this, type, listener, options });
      }
      return result;
    };
    window.setTimeout = function(callback, delay, ...args) {
      if (state.frozen) return 0;
      const timer = native.setTimeout(callback, delay, ...args);
      state.timeouts.add(timer);
      return timer;
    };
    window.clearTimeout = function(timer) {
      state.timeouts.delete(timer);
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
    const trackObserver = (Constructor, name) => {
      if (typeof Constructor !== "function") return Constructor;
      const Wrapped = function(...args) {
        const observer = new Constructor(...args);
        state.observers.push(observer);
        return observer;
      };
      Object.setPrototypeOf(Wrapped, Constructor);
      Wrapped.prototype = Constructor.prototype;
      try { Object.defineProperty(Wrapped, "name", { value: name }); } catch {}
      return Wrapped;
    };
    window.MutationObserver = trackObserver(native.mutationObserver, "MutationObserver");
    window.ResizeObserver = trackObserver(native.resizeObserver, "ResizeObserver");
    window.IntersectionObserver = trackObserver(native.intersectionObserver, "IntersectionObserver");
    const denyDocumentReplacement = () => {
      violation("document-replacement");
      throw new Error("PageRoot Edit runtime cannot replace its document.");
    };
    try { Document.prototype.open = denyDocumentReplacement; } catch {}
    try { Document.prototype.write = denyDocumentReplacement; } catch {}
    if (typeof native.messageChannel === "function") {
      const WrappedChannel = function MessageChannel() {
        const channel = new native.messageChannel();
        state.ports.add(channel.port1);
        state.ports.add(channel.port2);
        return channel;
      };
      Object.setPrototypeOf(WrappedChannel, native.messageChannel);
      WrappedChannel.prototype = native.messageChannel.prototype;
      try { Object.defineProperty(WrappedChannel, "name", { value: "MessageChannel" }); } catch {}
      window.MessageChannel = WrappedChannel;
    }
    const wrapPortHandler = (descriptor, property) => {
      if (!descriptor || typeof descriptor.set !== "function") return;
      try {
        Object.defineProperty(MessagePort.prototype, property, {
          configurable: true,
          enumerable: descriptor.enumerable,
          get: descriptor.get,
          set(handler) {
            state.ports.add(this);
            return descriptor.set.call(this, handler);
          },
        });
      } catch {
        // Some environments freeze MessagePort accessors.
      }
    };
    wrapPortHandler(native.messagePortOnMessage, "onmessage");
    wrapPortHandler(native.messagePortOnMessageError, "onmessageerror");
  };
  const prepareHiddenHostGeometry = () => {
    const hiddenAncestors = new Set();
    for (const host of Array.from(document.querySelectorAll(hostSelector))) {
      let rect = null;
      try { rect = host.getBoundingClientRect(); } catch {}
      if (rect && rect.width >= 1 && rect.height >= 1) continue;
      let parent = host;
      while (parent instanceof Element && parent !== document.documentElement) {
        try {
          if (getComputedStyle(parent).display === "none") hiddenAncestors.add(parent);
        } catch {}
        parent = parent.parentElement;
      }
    }
    if (!hiddenAncestors.size) return;
    const marker = "data-pageroot-edit-runtime-preflight";
    for (const element of hiddenAncestors) element.setAttribute(marker, "");
    const style = native.createElement.call(document, "style");
    style.setAttribute(ownedAttribute, "preflight");
    style.textContent = "[" + marker + "]{display:block!important;visibility:hidden!important}";
    (document.head || document.documentElement).appendChild(style);
    state.preflightStyle = style;
  };
  const restoreHiddenHostGeometry = () => {
    try { state.preflightStyle?.remove(); } catch {}
    state.preflightStyle = null;
    for (const element of Array.from(
      document.querySelectorAll("[data-pageroot-edit-runtime-preflight]"),
    )) {
      try { element.removeAttribute("data-pageroot-edit-runtime-preflight"); } catch {}
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
  const nextFrame = () => new Promise((resolve) => {
    native.requestAnimationFrame(() => resolve());
  });
  const settle = () => new Promise((resolve) => {
    native.setTimeout(resolve, config.runtimeSettleMs);
  });
  const begin = async () => {
    if (state.phase !== "booting") return;
    state.baseline = captureBaseline();
    installTracking();
    prepareHiddenHostGeometry();
    state.phase = "running";
    let origin = "";
    try {
      const bootstrap = document.currentScript
        || document.querySelector("script[" + attributes.bootstrap + "]");
      const url = new URL(bootstrap?.src || "");
      origin = url.protocol + "//" + url.hostname;
    } catch {
      violation("bootstrap-origin-invalid");
    }
    try {
      for (const stub of Array.from(document.querySelectorAll("script[" + stubAttribute + "]"))) {
        const scriptId = stub.getAttribute(stubAttribute);
        if (!/^[0-9]+$/u.test(scriptId || "") || !origin) {
          violation("script-stub-invalid");
          break;
        }
        await loadOne(scriptId, origin);
      }
      await nextFrame();
      await settle();
      await nextFrame();
      try {
        window.dispatchEvent(new Event("resize"));
      } catch {}
      await nextFrame();
      await Promise.resolve();
    } catch {
      violation("author-script-failed");
    } finally {
      restoreHiddenHostGeometry();
      freeze();
    }
  };
  if (document.readyState === "loading") {
    native.addEventListener.call(document, "DOMContentLoaded", () => {
      void begin();
    }, { once: true });
  } else {
    void begin();
  }
}

export function createEditRuntimeBootstrap({
  executionId,
  sessionId,
  runtimeSettleMs = EDIT_AUTHOR_RUNTIME_BUDGET.runtimeSettleMs,
} = {}) {
  if (!/^[a-f0-9]{24}$/u.test(String(executionId || ""))) {
    throw new TypeError("Edit runtime bootstrap requires an execution identity.");
  }
  if (!/^[a-f0-9]{32}$/u.test(String(sessionId || ""))) {
    throw new TypeError("Edit runtime bootstrap requires a session identity.");
  }
  const config = {
    contractVersion: EDIT_AUTHOR_RUNTIME_CONTRACT_VERSION,
    executionId: String(executionId).toLowerCase(),
    sessionId: String(sessionId).toLowerCase(),
    runtimeSettleMs: Math.max(0, Math.min(
      EDIT_AUTHOR_RUNTIME_BUDGET.runtimeDeadlineMs,
      Math.floor(Number(runtimeSettleMs) || 0),
    )),
    sourceNodeCount: EDIT_AUTHOR_RUNTIME_BUDGET.sourceNodeCount,
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
  return "(" + oneShotRuntimeBootstrap.toString() + ")(" + safeScriptValue(config) + ");";
}
