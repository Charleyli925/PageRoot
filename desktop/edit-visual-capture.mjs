import { createHash } from "node:crypto";

const PROJECTION_PROTOCOL = "pageroot-runtime-visual-projection";
const PROJECTION_VERSION = 2;
const SOURCE_NODE_ATTRIBUTE = "data-html-ai-source-node-id";
const SOURCE_SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const CLASS_TOKEN_PATTERN = /^[^\t\n\f\r \u0000-\u001f\u007f]{1,96}$/u;

const MAX_HTML_BYTES = 25 * 1024 * 1024;
const MAX_CANDIDATES = 256;
const MAX_VISUALS = 32;
const MAX_PRESENTATION_ENTRIES = 64;
const MAX_CLASS_TOKENS = 128;
const MAX_VISUAL_PNG_BYTES = 2_000_000;
const MAX_TOTAL_VISUAL_BYTES = 16_000_000;
const MAX_VISUAL_DIMENSION = 4_096;
const MIN_VIEWPORT_WIDTH = 320;
const MAX_VIEWPORT_WIDTH = 4_096;
const MIN_VIEWPORT_HEIGHT = 320;
const MAX_VIEWPORT_HEIGHT = 2_400;
const LOAD_TIMEOUT_MS = 20_000;
const INITIAL_QUIET_MS = 120;
const INITIAL_SETTLE_TIMEOUT_MS = 900;
const PRESENTATION_QUIET_MS = 80;
const PRESENTATION_SETTLE_TIMEOUT_MS = 300;
const CAPTURE_BOXES = new Set(["border", "content"]);

const VISUAL_HOST_TAGS = new Set([
  "article",
  "aside",
  "canvas",
  "div",
  "figure",
  "figcaption",
  "li",
  "main",
  "section",
  "span",
  "svg",
  "td",
  "th",
  "tbody",
]);
const CAPTURE_PAYLOAD_KEYS = new Set([
  "html",
  "sourcePath",
  "sourceSha256",
  "sourceNodeAttribute",
  "candidates",
  "presentationEntries",
  "viewport",
]);
const CANDIDATE_KEYS = new Set(["sourceNodeId", "tagName"]);
const PRESENTATION_ENTRY_KEYS = new Set([
  "sourceNodeId",
  "classAdd",
  "classRemove",
  "hidden",
  "open",
  "ariaSelected",
  "ariaExpanded",
]);

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function measureCapturePhase(phase, startedAt) {
  try {
    const name = `pageroot:edit-visual-capture:${phase}`;
    performance.clearMeasures(name);
    performance.measure(name, {
      start: startedAt,
      end: performance.now(),
    });
  } catch {
    // Diagnostics cannot own capture availability.
  }
}

function boundedInteger(value, minimum, maximum) {
  const normalized = Math.round(Number(value));
  return Number.isFinite(normalized)
    && normalized >= minimum
    && normalized <= maximum
    ? normalized
    : null;
}

function normalizedClassTokens(value) {
  if (!Array.isArray(value) || value.length > MAX_CLASS_TOKENS) return null;
  const tokens = value.map((token) => String(token ?? ""));
  return tokens.every((token) => CLASS_TOKEN_PATTERN.test(token))
    ? tokens
    : null;
}

function validOptionalAriaBoolean(value) {
  return value === undefined
    || value === "true"
    || value === "false"
    || value === null;
}

export function validateEditVisualCapturePayload(payload) {
  if (!isRecord(payload)) {
    throw new TypeError("Edit visual capture payload must be an object.");
  }
  if (Object.keys(payload).some((key) => !CAPTURE_PAYLOAD_KEYS.has(key))) {
    throw new TypeError("Edit visual capture payload contains unsupported fields.");
  }
  const html = typeof payload.html === "string" ? payload.html : null;
  if (!html || Buffer.byteLength(html, "utf8") > MAX_HTML_BYTES) {
    throw new TypeError("Edit visual capture HTML is invalid or too large.");
  }
  const sourcePath = typeof payload.sourcePath === "string"
    ? payload.sourcePath
    : null;
  if (!sourcePath || sourcePath.length > 4096) {
    throw new TypeError("Edit visual capture sourcePath is invalid.");
  }
  const sourceSha256 = String(payload.sourceSha256 ?? "").toLowerCase();
  if (!SOURCE_SHA256_PATTERN.test(sourceSha256)) {
    throw new TypeError("Edit visual capture source hash is invalid.");
  }
  if (payload.sourceNodeAttribute !== SOURCE_NODE_ATTRIBUTE) {
    throw new TypeError("Edit visual capture source-node attribute is invalid.");
  }
  if (
    !Array.isArray(payload.candidates)
    || payload.candidates.length > MAX_CANDIDATES
  ) {
    throw new TypeError("Edit visual capture candidates are invalid.");
  }
  const candidateIds = new Set();
  const candidates = payload.candidates.map((candidate) => {
    const sourceNodeId = String(candidate?.sourceNodeId ?? "");
    const tagName = String(candidate?.tagName ?? "").toLowerCase();
    if (
      !sourceNodeId
      || !isRecord(candidate)
      || Object.keys(candidate).some((key) => !CANDIDATE_KEYS.has(key))
      || sourceNodeId.length > 256
      || candidateIds.has(sourceNodeId)
      || !VISUAL_HOST_TAGS.has(tagName)
    ) {
      throw new TypeError("Edit visual capture candidate identity is invalid.");
    }
    candidateIds.add(sourceNodeId);
    return Object.freeze({ sourceNodeId, tagName });
  });
  if (
    !Array.isArray(payload.presentationEntries)
    || payload.presentationEntries.length > MAX_PRESENTATION_ENTRIES
  ) {
    throw new TypeError("Edit visual presentation entries are invalid.");
  }
  const presentationNodeIds = new Set();
  const presentationEntries = payload.presentationEntries.map((entry) => {
    const sourceNodeId = String(entry?.sourceNodeId ?? "");
    const classAdd = normalizedClassTokens(entry?.classAdd);
    const classRemove = normalizedClassTokens(entry?.classRemove);
    if (
      !sourceNodeId
      || !isRecord(entry)
      || Object.keys(entry).some(
        (key) => !PRESENTATION_ENTRY_KEYS.has(key),
      )
      || presentationNodeIds.has(sourceNodeId)
      || sourceNodeId.length > 256
      || !classAdd
      || !classRemove
      || !validOptionalAriaBoolean(entry?.ariaSelected)
      || !validOptionalAriaBoolean(entry?.ariaExpanded)
      || (
        entry?.hidden !== undefined
        && typeof entry.hidden !== "boolean"
      )
      || (
        entry?.open !== undefined
        && typeof entry.open !== "boolean"
      )
    ) {
      throw new TypeError("Edit visual presentation entry is invalid.");
    }
    presentationNodeIds.add(sourceNodeId);
    return Object.freeze({
      sourceNodeId,
      classAdd: Object.freeze(classAdd),
      classRemove: Object.freeze(classRemove),
      ...(entry.hidden !== undefined ? { hidden: entry.hidden } : {}),
      ...(entry.open !== undefined ? { open: entry.open } : {}),
      ...(entry.ariaSelected !== undefined
        ? { ariaSelected: entry.ariaSelected }
        : {}),
      ...(entry.ariaExpanded !== undefined
        ? { ariaExpanded: entry.ariaExpanded }
        : {}),
    });
  });
  const width = boundedInteger(
    payload.viewport?.width,
    MIN_VIEWPORT_WIDTH,
    MAX_VIEWPORT_WIDTH,
  );
  const height = boundedInteger(
    payload.viewport?.height,
    MIN_VIEWPORT_HEIGHT,
    MAX_VIEWPORT_HEIGHT,
  );
  if (
    !isRecord(payload.viewport)
    || Object.keys(payload.viewport).some(
      (key) => key !== "width" && key !== "height",
    )
    || !width
    || !height
  ) {
    throw new TypeError("Edit visual capture viewport is invalid.");
  }
  return Object.freeze({
    html,
    sourcePath,
    sourceSha256,
    sourceNodeAttribute: SOURCE_NODE_ATTRIBUTE,
    candidates: Object.freeze(candidates),
    presentationEntries: Object.freeze(presentationEntries),
    viewport: Object.freeze({ width, height }),
  });
}

async function withTimeout(promise, milliseconds, onTimeout) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      try {
        onTimeout?.();
      } finally {
        reject(new Error("Edit visual capture timed out."));
      }
    }, milliseconds);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timeoutId);
  }
}

function safeScriptValue(value) {
  return JSON.stringify(value).replace(/</gu, "\\u003c");
}

function presentationScript(entries, sourceNodeAttribute) {
  return `(() => {
    const entries = ${safeScriptValue(entries)};
    const sourceNodeAttribute = ${safeScriptValue(sourceNodeAttribute)};
    const elements = Array.from(document.querySelectorAll("[" + sourceNodeAttribute + "]"));
    const uniqueElement = (sourceNodeId) => {
      const matches = elements.filter((element) => (
        element.getAttribute(sourceNodeAttribute) === sourceNodeId
      ));
      return matches.length === 1 ? matches[0] : null;
    };
    for (const entry of entries) {
      const element = uniqueElement(entry.sourceNodeId);
      if (!element) continue;
      for (const token of entry.classRemove) element.classList.remove(token);
      for (const token of entry.classAdd) element.classList.add(token);
      if (Object.prototype.hasOwnProperty.call(entry, "hidden")) {
        element.toggleAttribute("hidden", entry.hidden);
      }
      if (Object.prototype.hasOwnProperty.call(entry, "open")) {
        element.toggleAttribute("open", entry.open);
      }
      if (Object.prototype.hasOwnProperty.call(entry, "ariaSelected")) {
        if (entry.ariaSelected === null) element.removeAttribute("aria-selected");
        else element.setAttribute("aria-selected", entry.ariaSelected);
      }
      if (Object.prototype.hasOwnProperty.call(entry, "ariaExpanded")) {
        if (entry.ariaExpanded === null) element.removeAttribute("aria-expanded");
        else element.setAttribute("aria-expanded", entry.ariaExpanded);
      }
    }
    window.dispatchEvent(new Event("resize"));
    return true;
  })()`;
}

function settleRuntimeScript(
  quietMilliseconds,
  maximumMilliseconds,
  {
    candidates = [],
    sourceNodeAttribute = null,
    initiallyPopulatedSourceNodeIds = [],
  } = {},
) {
  return `new Promise((resolve) => {
    const quietMilliseconds = ${Math.max(0, quietMilliseconds)};
    const maximumMilliseconds = ${Math.max(quietMilliseconds, maximumMilliseconds)};
    const candidates = ${safeScriptValue(candidates)};
    const sourceNodeAttribute = ${safeScriptValue(sourceNodeAttribute)};
    const initialSourceNodeIds = new Set(${safeScriptValue(
      initiallyPopulatedSourceNodeIds,
    )});
    const candidateSourceNodeIds = new Set(candidates
      .map((candidate) => candidate?.sourceNodeId)
      .filter((sourceNodeId) => typeof sourceNodeId === "string"));
    const tracksCandidateReadiness = candidateSourceNodeIds.size > 0
      && typeof sourceNodeAttribute === "string"
      && sourceNodeAttribute.length > 0;
    const pendingCandidateSourceNodeIds = new Set([...candidateSourceNodeIds]
      .filter((sourceNodeId) => !initialSourceNodeIds.has(sourceNodeId)));
    const startedAt = performance.now();
    let lastMutationAt = startedAt;
    const candidateSourceNodeId = (node) => {
      let current = node?.nodeType === 1 ? node : node?.parentElement;
      while (current?.nodeType === 1) {
        const sourceNodeId = current.getAttribute(sourceNodeAttribute);
        if (candidateSourceNodeIds.has(sourceNodeId)) return sourceNodeId;
        current = current.parentElement;
      }
      return null;
    };
    const observer = new MutationObserver((records) => {
      if (!tracksCandidateReadiness) {
        lastMutationAt = performance.now();
        return;
      }
      let changedPendingCandidate = false;
      for (const record of records) {
        const sourceNodeId = candidateSourceNodeId(record.target);
        if (sourceNodeId && pendingCandidateSourceNodeIds.delete(sourceNodeId)) {
          changedPendingCandidate = true;
        }
      }
      if (changedPendingCandidate) lastMutationAt = performance.now();
    });
    observer.observe(document, {
      attributes: true,
      childList: true,
      characterData: true,
      subtree: true,
    });
    const finish = () => {
      observer.disconnect();
      resolve(true);
    };
    const inspect = () => {
      const now = performance.now();
      if (
        (
          (!tracksCandidateReadiness
            || pendingCandidateSourceNodeIds.size === 0)
          && now - lastMutationAt >= quietMilliseconds
        )
        || now - startedAt >= maximumMilliseconds
      ) {
        finish();
        return;
      }
      requestAnimationFrame(inspect);
    };
    requestAnimationFrame(() => requestAnimationFrame(inspect));
  })`;
}

function populatedCandidateScript(
  candidates,
  sourceNodeAttribute,
  maximumCandidates = MAX_VISUALS,
) {
  const boundedMaximumCandidates = Math.max(
    1,
    Math.min(MAX_CANDIDATES, Math.floor(Number(maximumCandidates) || 0)),
  );
  return `(() => {
    const candidates = ${safeScriptValue(candidates)};
    const sourceNodeAttribute = ${safeScriptValue(sourceNodeAttribute)};
    const maximumCandidates = ${boundedMaximumCandidates};
    const elements = Array.from(document.querySelectorAll("[" + sourceNodeAttribute + "]"));
    const populated = [];
    for (const candidate of candidates) {
      const matches = elements.filter((element) => (
        element.getAttribute(sourceNodeAttribute) === candidate.sourceNodeId
      ));
      if (matches.length !== 1) continue;
      const element = matches[0];
      const hasChildContent = Array.from(element.childNodes).some((node) => (
        node.nodeType === Node.ELEMENT_NODE
        || (node.nodeType === Node.TEXT_NODE && (node.textContent || "").trim())
      ));
      let hasCanvasPixels = false;
      if (candidate.tagName === "canvas") {
        try {
          const probe = document.createElement("canvas");
          probe.width = 32;
          probe.height = 32;
          const context = probe.getContext("2d", { willReadFrequently: true });
          context.drawImage(element, 0, 0, probe.width, probe.height);
          const pixels = context.getImageData(0, 0, probe.width, probe.height).data;
          for (let offset = 3; offset < pixels.length; offset += 4) {
            if (pixels[offset] !== 0) { hasCanvasPixels = true; break; }
          }
        } catch {
          // A tainted canvas can only be inspected by capturing its pixels.
          hasCanvasPixels = true;
        }
      }
      const hasRuntimeContent = hasChildContent || hasCanvasPixels;
      if (hasRuntimeContent) populated.push(candidate);
      if (populated.length >= maximumCandidates) break;
    }
    return populated;
  })()`;
}

function prepareCandidateScript(candidate, sourceNodeAttribute, restoreKey) {
  return `(() => {
    const sourceNodeId = ${safeScriptValue(candidate.sourceNodeId)};
    const sourceNodeAttribute = ${safeScriptValue(sourceNodeAttribute)};
    const restoreKey = ${safeScriptValue(restoreKey)};
    try { window[restoreKey]?.(); } catch {}
    const matches = Array.from(document.querySelectorAll("[" + sourceNodeAttribute + "]"))
      .filter((element) => element.getAttribute(sourceNodeAttribute) === sourceNodeId);
    if (matches.length !== 1) return false;
    const element = matches[0];
    if (!element.isConnected) return false;
    element.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    window.dispatchEvent(new Event("resize"));
    const changes = [];
    const rememberStyle = (node, property, value) => {
      changes.push({
        kind: "style",
        node,
        property,
        value: node.style.getPropertyValue(property),
        priority: node.style.getPropertyPriority(property),
      });
      node.style.setProperty(property, value, "important");
    };
    const preservesPaintedGeometry = (transform) => {
      if (transform === "none") return true;
      const match = /^matrix\\(([^)]+)\\)$/u.exec(transform);
      if (!match) return false;
      const values = match[1].split(",").map((value) => Number.parseFloat(value));
      if (values.length !== 6 || values.some((value) => !Number.isFinite(value))) {
        return false;
      }
      const [scaleX, skewY, skewX, scaleY] = values;
      return scaleX > 0
        && scaleY > 0
        && Math.abs(skewX) < 0.000001
        && Math.abs(skewY) < 0.000001;
    };
    const affectedNodes = [];
    for (let node = element; node; node = node.parentElement) {
      const computed = window.getComputedStyle(node);
      if (
        node.hasAttribute("hidden")
        || computed.display === "none"
        || computed.visibility === "hidden"
        || computed.visibility === "collapse"
        || Number(computed.opacity) <= 0
      ) return false;
      affectedNodes.push({ node, computed });
      if (node === document.documentElement) break;
    }
    for (const { node, computed } of affectedNodes) {
      if (!preservesPaintedGeometry(computed.transform)) {
        rememberStyle(node, "transform", "none");
      }
      if (computed.opacity !== "1") rememberStyle(node, "opacity", "1");
      if (computed.filter !== "none") rememberStyle(node, "filter", "none");
      if (computed.backdropFilter && computed.backdropFilter !== "none") {
        rememberStyle(node, "backdrop-filter", "none");
      }
      if (computed.clipPath !== "none") rememberStyle(node, "clip-path", "none");
      if (computed.mixBlendMode !== "normal") {
        rememberStyle(node, "mix-blend-mode", "normal");
      }
      if (computed.perspective !== "none") rememberStyle(node, "perspective", "none");
    }
    window[restoreKey] = () => {
      for (const change of changes.reverse()) {
        if (change.kind === "hidden") change.node.setAttribute("hidden", "");
        else if (change.value) {
          change.node.style.setProperty(change.property, change.value, change.priority);
        } else {
          change.node.style.removeProperty(change.property);
        }
      }
      delete window[restoreKey];
      window.dispatchEvent(new Event("resize"));
    };
    return true;
  })()`;
}

function measureCandidateScript(candidate, sourceNodeAttribute) {
  return `new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const sourceNodeId = ${safeScriptValue(candidate.sourceNodeId)};
      const sourceNodeAttribute = ${safeScriptValue(sourceNodeAttribute)};
      const matches = Array.from(document.querySelectorAll("[" + sourceNodeAttribute + "]"))
        .filter((element) => element.getAttribute(sourceNodeAttribute) === sourceNodeId);
      if (matches.length !== 1) { resolve(null); return; }
      const element = matches[0];
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      const numeric = (value) => {
        const parsed = Number.parseFloat(value);
        return Number.isFinite(parsed) ? parsed : 0;
      };
      const borderLeft = numeric(style.borderLeftWidth);
      const borderRight = numeric(style.borderRightWidth);
      const borderTop = numeric(style.borderTopWidth);
      const borderBottom = numeric(style.borderBottomWidth);
      const paddingLeft = numeric(style.paddingLeft);
      const paddingRight = numeric(style.paddingRight);
      const paddingTop = numeric(style.paddingTop);
      const paddingBottom = numeric(style.paddingBottom);
      const viewportScale = (node, nodeRect) => {
        const offsetWidth = Number(node.offsetWidth);
        const offsetHeight = Number(node.offsetHeight);
        return {
          x: Number.isFinite(offsetWidth) && offsetWidth >= 1
            ? nodeRect.width / offsetWidth
            : 1,
          y: Number.isFinite(offsetHeight) && offsetHeight >= 1
            ? nodeRect.height / offsetHeight
            : 1,
        };
      };
      const captureBox = element.tagName === "TBODY" ? "border" : "content";
      let left = rect.left;
      let top = rect.top;
      let layoutWidth = rect.width;
      let layoutHeight = rect.height;
      if (captureBox === "content") {
        const scale = viewportScale(element, rect);
        left += (borderLeft + paddingLeft) * scale.x;
        top += (borderTop + paddingTop) * scale.y;
        layoutWidth = (
          element.clientWidth - paddingLeft - paddingRight
        ) * scale.x;
        layoutHeight = (
          element.clientHeight - paddingTop - paddingBottom
        ) * scale.y;
        if (layoutWidth < 1) {
          layoutWidth = rect.width
            - (borderLeft + borderRight + paddingLeft + paddingRight) * scale.x;
        }
        if (layoutHeight < 1) {
          layoutHeight = rect.height
            - (borderTop + borderBottom + paddingTop + paddingBottom) * scale.y;
        }
      }
      const right = left + layoutWidth;
      const bottom = top + layoutHeight;
      if (
        !element.isConnected
        || style.display === "none"
        || style.visibility === "hidden"
        || style.visibility === "collapse"
        || layoutWidth < 1
        || layoutHeight < 1
      ) { resolve(null); return; }
      let visibleLeft = Math.max(0, left);
      let visibleTop = Math.max(0, top);
      let visibleRight = Math.min(window.innerWidth, right);
      let visibleBottom = Math.min(window.innerHeight, bottom);
      for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
        const ancestorStyle = window.getComputedStyle(ancestor);
        const clipsX = ancestorStyle.overflowX !== "visible";
        const clipsY = ancestorStyle.overflowY !== "visible";
        if (clipsX || clipsY) {
          const ancestorRect = ancestor.getBoundingClientRect();
          const ancestorScale = viewportScale(ancestor, ancestorRect);
          const ancestorBorderLeft = numeric(ancestorStyle.borderLeftWidth);
          const ancestorBorderTop = numeric(ancestorStyle.borderTopWidth);
          if (clipsX) {
            const clipLeft = ancestorRect.left
              + ancestorBorderLeft * ancestorScale.x;
            visibleLeft = Math.max(visibleLeft, clipLeft);
            visibleRight = Math.min(
              visibleRight,
              clipLeft + ancestor.clientWidth * ancestorScale.x,
            );
          }
          if (clipsY) {
            const clipTop = ancestorRect.top
              + ancestorBorderTop * ancestorScale.y;
            visibleTop = Math.max(visibleTop, clipTop);
            visibleBottom = Math.min(
              visibleBottom,
              clipTop + ancestor.clientHeight * ancestorScale.y,
            );
          }
        }
        if (ancestor === document.documentElement) break;
      }
      const epsilon = 0.75;
      if (
        visibleLeft > left + epsilon
        || visibleTop > top + epsilon
        || visibleRight < right - epsilon
        || visibleBottom < bottom - epsilon
      ) { resolve(null); return; }
      resolve({
        x: Math.floor(left),
        y: Math.floor(top),
        width: Math.max(1, Math.ceil(right) - Math.floor(left)),
        height: Math.max(1, Math.ceil(bottom) - Math.floor(top)),
        layoutWidth: Math.max(1, Math.round(layoutWidth)),
        layoutHeight: Math.max(1, Math.round(layoutHeight)),
        deviceScaleFactor: Math.max(0.5, Math.min(8, window.devicePixelRatio || 1)),
        captureBox,
        complete: true,
      });
    }));
  })`;
}

function restoreCandidateScript(restoreKey) {
  return `(() => {
    try { window[${safeScriptValue(restoreKey)}]?.(); } catch {}
    return true;
  })()`;
}

function boundedCaptureRect(measurement, viewport) {
  if (
    !isRecord(measurement)
    || measurement.complete !== true
    || !CAPTURE_BOXES.has(measurement.captureBox)
  ) return null;
  const x = boundedInteger(measurement.x, 0, viewport.width - 1);
  const y = boundedInteger(measurement.y, 0, viewport.height - 1);
  const width = boundedInteger(measurement.width, 1, viewport.width);
  const height = boundedInteger(measurement.height, 1, viewport.height);
  const layoutWidth = boundedInteger(
    measurement.layoutWidth,
    1,
    MAX_VISUAL_DIMENSION,
  );
  const layoutHeight = boundedInteger(
    measurement.layoutHeight,
    1,
    MAX_VISUAL_DIMENSION,
  );
  if (
    x === null
    || y === null
    || width === null
    || height === null
    || layoutWidth === null
    || layoutHeight === null
    || x + width > viewport.width
    || y + height > viewport.height
  ) return null;
  return {
    x,
    y,
    width,
    height,
    layoutWidth,
    layoutHeight,
    captureBox: measurement.captureBox,
  };
}

function boundedPng(image) {
  if (!image || image.isEmpty()) return null;
  let candidate = image;
  let pngBytes = candidate.toPNG();
  for (let attempt = 0; pngBytes.length > MAX_VISUAL_PNG_BYTES && attempt < 4; attempt += 1) {
    const size = candidate.getSize();
    const scale = Math.max(
      0.25,
      Math.sqrt(MAX_VISUAL_PNG_BYTES / pngBytes.length) * 0.9,
    );
    candidate = candidate.resize({
      width: Math.max(1, Math.floor(size.width * scale)),
      height: Math.max(1, Math.floor(size.height * scale)),
      quality: "good",
    });
    pngBytes = candidate.toPNG();
  }
  const pngView = pngBytes instanceof Uint8Array && pngBytes.byteLength >= 24
    ? new DataView(
      pngBytes.buffer,
      pngBytes.byteOffset,
      pngBytes.byteLength,
    )
    : null;
  const pngWidth = pngView?.getUint32(16, false) ?? 0;
  const pngHeight = pngView?.getUint32(20, false) ?? 0;
  if (
    !(pngBytes instanceof Uint8Array)
    || pngBytes.length < 20
    || pngBytes.length > MAX_VISUAL_PNG_BYTES
    || ![137, 80, 78, 71, 13, 10, 26, 10].every(
      (value, index) => pngBytes[index] === value,
    )
    || ![73, 72, 68, 82].every(
      (value, index) => pngBytes[12 + index] === value,
    )
    || pngWidth < 1
    || pngHeight < 1
    || pngWidth > MAX_VISUAL_DIMENSION
    || pngHeight > MAX_VISUAL_DIMENSION
  ) return null;
  return {
    pngBytes: new Uint8Array(pngBytes),
    width: pngWidth,
    height: pngHeight,
    byteLength: pngBytes.length,
    runtimeContentSha256: `sha256:${createHash("sha256")
      .update(pngBytes)
      .digest("hex")}`,
  };
}

export function createEditVisualCaptureOperation({
  capture,
  authorizeSourcePath,
} = {}) {
  if (typeof capture !== "function") {
    throw new TypeError("Edit visual capture operation requires capture.");
  }
  if (typeof authorizeSourcePath !== "function") {
    throw new TypeError(
      "Edit visual capture operation requires source path authorization.",
    );
  }
  return async (payload) => {
    const sourcePath = await authorizeSourcePath(payload?.sourcePath);
    return capture({ ...payload, sourcePath });
  };
}

export function createEditVisualCaptureController({
  BrowserWindowClass,
  createSession,
  revokeSession,
} = {}) {
  if (typeof BrowserWindowClass !== "function") {
    throw new TypeError("Edit visual capture requires BrowserWindow.");
  }
  if (typeof createSession !== "function" || typeof revokeSession !== "function") {
    throw new TypeError("Edit visual capture requires preview session ownership.");
  }

  let activeCapture = null;

  const capture = async (rawPayload) => {
    const captureStartedAt = performance.now();
    const payload = validateEditVisualCapturePayload(rawPayload);
    activeCapture?.cancel();
    let cancelled = false;
    let captureWindow = null;
    let session = null;
    const operation = {
      cancel: () => {
        cancelled = true;
        if (captureWindow && !captureWindow.isDestroyed()) captureWindow.destroy();
      },
    };
    activeCapture = operation;

    try {
      session = await createSession({
        html: payload.html,
        bootstrapJavaScript: "",
        sourcePath: payload.sourcePath,
      });
      if (cancelled) throw new Error("Edit visual capture was superseded.");
      captureWindow = new BrowserWindowClass({
        show: false,
        frame: false,
        useContentSize: true,
        width: payload.viewport.width,
        height: payload.viewport.height,
        paintWhenInitiallyHidden: true,
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          webSecurity: true,
          offscreen: true,
          backgroundThrottling: false,
        },
      });
      captureWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      captureWindow.webContents.on("will-attach-webview", (event) => {
        event.preventDefault();
      });
      captureWindow.webContents.on("will-navigate", (event, url) => {
        if (url !== session.url) event.preventDefault();
      });
      await withTimeout(
        captureWindow.loadURL(session.url),
        LOAD_TIMEOUT_MS,
        operation.cancel,
      );
      if (cancelled || captureWindow.isDestroyed()) {
        throw new Error("Edit visual capture was superseded.");
      }
      await captureWindow.webContents.executeJavaScript(
        "document.fonts?.ready?.catch?.(() => undefined) ?? Promise.resolve()",
        true,
      ).catch(() => undefined);
      const initiallyPopulatedCandidates = await captureWindow.webContents
        .executeJavaScript(
          populatedCandidateScript(
            payload.candidates,
            payload.sourceNodeAttribute,
            payload.candidates.length,
          ),
          true,
        )
        .catch(() => []);
      const candidateSourceNodeIds = new Set(
        payload.candidates.map((candidate) => candidate.sourceNodeId),
      );
      const initiallyPopulatedSourceNodeIds = Array.isArray(
        initiallyPopulatedCandidates,
      )
        ? [...new Set(initiallyPopulatedCandidates
          .map((candidate) => candidate?.sourceNodeId)
          .filter((sourceNodeId) => (
            typeof sourceNodeId === "string"
            && candidateSourceNodeIds.has(sourceNodeId)
          )))]
        : [];
      await captureWindow.webContents.executeJavaScript(
        settleRuntimeScript(
          INITIAL_QUIET_MS,
          INITIAL_SETTLE_TIMEOUT_MS,
          {
            candidates: payload.candidates,
            sourceNodeAttribute: payload.sourceNodeAttribute,
            initiallyPopulatedSourceNodeIds,
          },
        ),
        true,
      );
      await captureWindow.webContents.executeJavaScript(
        presentationScript(
          payload.presentationEntries,
          payload.sourceNodeAttribute,
        ),
        true,
      );
      await captureWindow.webContents.executeJavaScript(
        settleRuntimeScript(
          PRESENTATION_QUIET_MS,
          PRESENTATION_SETTLE_TIMEOUT_MS,
        ),
        true,
      );
      const populatedCandidates = await captureWindow.webContents.executeJavaScript(
        populatedCandidateScript(payload.candidates, payload.sourceNodeAttribute),
        true,
      );
      const capturableCandidates = Array.isArray(populatedCandidates)
        ? populatedCandidates.slice(0, MAX_VISUALS)
        : [];
      const visuals = [];
      const deferredSourceNodeIds = [];
      let totalBytes = 0;
      for (
        let candidateIndex = 0;
        candidateIndex < capturableCandidates.length;
        candidateIndex += 1
      ) {
        const candidate = capturableCandidates[candidateIndex];
        const candidateStartedAt = performance.now();
        if (cancelled || captureWindow.isDestroyed()) break;
        const restoreKey = `__pagerootEditVisualRestore_${visuals.length}`;
        try {
          const prepared = await captureWindow.webContents.executeJavaScript(
            prepareCandidateScript(
              candidate,
              payload.sourceNodeAttribute,
              restoreKey,
            ),
            true,
          );
          if (!prepared) {
            deferredSourceNodeIds.push(candidate.sourceNodeId);
            continue;
          }
          const measurement = await captureWindow.webContents.executeJavaScript(
            measureCandidateScript(candidate, payload.sourceNodeAttribute),
            true,
          );
          const rect = boundedCaptureRect(measurement, payload.viewport);
          if (!rect) {
            deferredSourceNodeIds.push(candidate.sourceNodeId);
            continue;
          }
          const image = await captureWindow.capturePage(
            {
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
            },
            { stayHidden: true },
          );
          const png = boundedPng(image);
          if (!png) {
            deferredSourceNodeIds.push(candidate.sourceNodeId);
            continue;
          }
          totalBytes += png.byteLength;
          if (totalBytes > MAX_TOTAL_VISUAL_BYTES) {
            deferredSourceNodeIds.push(
              ...capturableCandidates
                .slice(candidateIndex)
                .map((item) => item.sourceNodeId),
            );
            break;
          }
          visuals.push(Object.freeze({
            sourceNodeId: candidate.sourceNodeId,
            width: png.width,
            height: png.height,
            layoutWidth: rect.layoutWidth,
            layoutHeight: rect.layoutHeight,
            deviceScaleFactor: Math.max(
              0.5,
              Math.min(8, Number(measurement.deviceScaleFactor) || 1),
            ),
            captureBox: rect.captureBox,
            crop: Object.freeze({
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
            }),
            sizingMode: "contain",
            runtimeContentSha256: png.runtimeContentSha256,
            byteLength: png.byteLength,
            pngBytes: png.pngBytes,
          }));
        } catch {
          // A single unrenderable host must not hide the other runtime visuals.
          deferredSourceNodeIds.push(candidate.sourceNodeId);
          continue;
        } finally {
          if (!captureWindow.isDestroyed()) {
            await captureWindow.webContents.executeJavaScript(
              restoreCandidateScript(restoreKey),
              true,
            ).catch(() => undefined);
          }
          measureCapturePhase("host", candidateStartedAt);
        }
      }
      if (cancelled) throw new Error("Edit visual capture was superseded.");
      return Object.freeze({
        protocol: PROJECTION_PROTOCOL,
        version: PROJECTION_VERSION,
        sourceSha256: payload.sourceSha256,
        visuals: Object.freeze(visuals),
        deferredSourceNodeIds: Object.freeze(deferredSourceNodeIds),
      });
    } finally {
      if (captureWindow && !captureWindow.isDestroyed()) captureWindow.destroy();
      if (session?.sessionId) await revokeSession(session.sessionId).catch(() => undefined);
      if (activeCapture === operation) activeCapture = null;
      measureCapturePhase("total", captureStartedAt);
    }
  };

  return Object.freeze({
    capture,
    dispose: () => {
      activeCapture?.cancel();
      activeCapture = null;
    },
  });
}
