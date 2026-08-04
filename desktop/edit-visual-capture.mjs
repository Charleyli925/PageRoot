const PROJECTION_PROTOCOL = "pageroot-runtime-visual-projection";
const PROJECTION_VERSION = 1;
const SOURCE_NODE_ATTRIBUTE = "data-html-ai-source-node-id";
const SOURCE_SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const CLASS_TOKEN_PATTERN = /^[^\t\n\f\r \u0000-\u001f\u007f]{1,96}$/u;

const MAX_HTML_BYTES = 25 * 1024 * 1024;
const MAX_CANDIDATES = 256;
const MAX_VISUALS = 32;
const MAX_PRESENTATION_ENTRIES = 64;
const MAX_CLASS_TOKENS = 128;
const MAX_VISUAL_DATA_URL_BYTES = 2_000_000;
const MAX_TOTAL_VISUAL_BYTES = 16_000_000;
const MAX_VISUAL_DIMENSION = 4_096;
const MIN_VIEWPORT_WIDTH = 320;
const MAX_VIEWPORT_WIDTH = 4_096;
const MIN_VIEWPORT_HEIGHT = 320;
const MAX_VIEWPORT_HEIGHT = 2_400;
const LOAD_TIMEOUT_MS = 20_000;
const SCRIPT_SETTLE_MS = 900;
const REVEAL_SETTLE_MS = 80;

const VISUAL_HOST_TAGS = new Set([
  "article",
  "aside",
  "div",
  "figure",
  "figcaption",
  "li",
  "main",
  "section",
  "span",
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

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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

function populatedCandidateScript(candidates, sourceNodeAttribute) {
  return `(() => {
    const candidates = ${safeScriptValue(candidates)};
    const sourceNodeAttribute = ${safeScriptValue(sourceNodeAttribute)};
    const elements = Array.from(document.querySelectorAll("[" + sourceNodeAttribute + "]"));
    const populated = [];
    for (const candidate of candidates) {
      const matches = elements.filter((element) => (
        element.getAttribute(sourceNodeAttribute) === candidate.sourceNodeId
      ));
      if (matches.length !== 1) continue;
      const element = matches[0];
      const hasRuntimeContent = Array.from(element.childNodes).some((node) => (
        node.nodeType === Node.ELEMENT_NODE
        || (node.nodeType === Node.TEXT_NODE && (node.textContent || "").trim())
      ));
      if (hasRuntimeContent) populated.push(candidate);
      if (populated.length >= ${MAX_VISUALS}) break;
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
    for (let node = element; node && node !== document.documentElement; node = node.parentElement) {
      if (node.hasAttribute("hidden")) {
        changes.push({ kind: "hidden", node });
        node.removeAttribute("hidden");
      }
      const computed = window.getComputedStyle(node);
      if (computed.display === "none") {
        const fallback = node.tagName === "TBODY"
          ? "table-row-group"
          : node.tagName === "TR"
            ? "table-row"
            : ["TD", "TH"].includes(node.tagName)
              ? "table-cell"
              : "block";
        rememberStyle(node, "display", fallback);
      }
      if (computed.visibility === "hidden" || computed.visibility === "collapse") {
        rememberStyle(node, "visibility", "visible");
      }
      if (computed.opacity === "0") rememberStyle(node, "opacity", "1");
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
    element.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    window.dispatchEvent(new Event("resize"));
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
      const left = Math.max(0, rect.left);
      const top = Math.max(0, rect.top);
      const right = Math.min(window.innerWidth, rect.right);
      const bottom = Math.min(window.innerHeight, rect.bottom);
      if (
        !element.isConnected
        || style.display === "none"
        || style.visibility === "hidden"
        || style.visibility === "collapse"
        || right - left < 1
        || bottom - top < 1
      ) { resolve(null); return; }
      resolve({
        x: Math.floor(left),
        y: Math.floor(top),
        width: Math.max(1, Math.ceil(right) - Math.floor(left)),
        height: Math.max(1, Math.ceil(bottom) - Math.floor(top)),
        layoutWidth: Math.max(1, Math.round(rect.width)),
        layoutHeight: Math.max(1, Math.round(rect.height)),
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
  if (!isRecord(measurement)) return null;
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
  return { x, y, width, height, layoutWidth, layoutHeight };
}

function boundedPng(image) {
  if (!image || image.isEmpty()) return null;
  let candidate = image;
  let dataUrl = candidate.toDataURL();
  for (let attempt = 0; dataUrl.length > MAX_VISUAL_DATA_URL_BYTES && attempt < 4; attempt += 1) {
    const size = candidate.getSize();
    const scale = Math.max(
      0.25,
      Math.sqrt(MAX_VISUAL_DATA_URL_BYTES / dataUrl.length) * 0.9,
    );
    candidate = candidate.resize({
      width: Math.max(1, Math.floor(size.width * scale)),
      height: Math.max(1, Math.floor(size.height * scale)),
      quality: "good",
    });
    dataUrl = candidate.toDataURL();
  }
  const size = candidate.getSize();
  if (
    dataUrl.length > MAX_VISUAL_DATA_URL_BYTES
    || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/u.test(dataUrl)
    || size.width < 1
    || size.height < 1
    || size.width > MAX_VISUAL_DIMENSION
    || size.height > MAX_VISUAL_DIMENSION
  ) return null;
  return { dataUrl, width: size.width, height: size.height };
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
  wait = delay,
} = {}) {
  if (typeof BrowserWindowClass !== "function") {
    throw new TypeError("Edit visual capture requires BrowserWindow.");
  }
  if (typeof createSession !== "function" || typeof revokeSession !== "function") {
    throw new TypeError("Edit visual capture requires preview session ownership.");
  }

  let activeCapture = null;

  const capture = async (rawPayload) => {
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
      await wait(SCRIPT_SETTLE_MS);
      await captureWindow.webContents.executeJavaScript(
        presentationScript(
          payload.presentationEntries,
          payload.sourceNodeAttribute,
        ),
        true,
      );
      await wait(REVEAL_SETTLE_MS);
      const populatedCandidates = await captureWindow.webContents.executeJavaScript(
        populatedCandidateScript(payload.candidates, payload.sourceNodeAttribute),
        true,
      );
      const visuals = [];
      let totalBytes = 0;
      for (const candidate of Array.isArray(populatedCandidates)
        ? populatedCandidates.slice(0, MAX_VISUALS)
        : []) {
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
          if (!prepared) continue;
          await wait(REVEAL_SETTLE_MS);
          const measurement = await captureWindow.webContents.executeJavaScript(
            measureCandidateScript(candidate, payload.sourceNodeAttribute),
            true,
          );
          const rect = boundedCaptureRect(measurement, payload.viewport);
          if (!rect) continue;
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
          if (!png) continue;
          totalBytes += png.dataUrl.length;
          if (totalBytes > MAX_TOTAL_VISUAL_BYTES) break;
          visuals.push(Object.freeze({
            sourceNodeId: candidate.sourceNodeId,
            width: png.width,
            height: png.height,
            layoutWidth: rect.layoutWidth,
            layoutHeight: rect.layoutHeight,
            dataUrl: png.dataUrl,
          }));
        } catch {
          // A single unrenderable host must not hide the other runtime visuals.
          continue;
        } finally {
          if (!captureWindow.isDestroyed()) {
            await captureWindow.webContents.executeJavaScript(
              restoreCandidateScript(restoreKey),
              true,
            ).catch(() => undefined);
          }
        }
      }
      if (cancelled) throw new Error("Edit visual capture was superseded.");
      return Object.freeze({
        protocol: PROJECTION_PROTOCOL,
        version: PROJECTION_VERSION,
        sourceSha256: payload.sourceSha256,
        visuals: Object.freeze(visuals),
      });
    } finally {
      if (captureWindow && !captureWindow.isDestroyed()) captureWindow.destroy();
      if (session?.sessionId) await revokeSession(session.sessionId).catch(() => undefined);
      if (activeCapture === operation) activeCapture = null;
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
