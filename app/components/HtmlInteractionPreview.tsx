"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import {
  PAGE_VIEW_CONTEXT_PROTOCOL,
  PAGE_VIEW_CONTEXT_VERSION,
  createPageViewContext,
  type PageViewContext,
  type RawPageViewSnapshot,
} from "../lib/page-view-context.js";
import {
  SOURCE_NODE_ATTRIBUTE,
  buildSourceIndex,
  instrumentPreviewHtml,
} from "../lib/source-index.js";
import styles from "./HtmlInteractionPreview.module.css";

export type HtmlInteractionPreviewHandle = {
  capturePageViewContext: () => Promise<PageViewContext | null>;
};

type HtmlInteractionPreviewProps = {
  html: string;
  documentKey: string;
  sourcePath?: string;
  height?: string;
  transport?: "independent-url" | "srcdoc";
  onInteraction?: () => void;
};

type DesktopPreviewSession = {
  sessionId: string;
  url: string;
};

type DesktopPreviewApi = {
  createSession: (payload: {
    html: string;
    bootstrapJavaScript: string;
    sourcePath?: string;
  }) => Promise<DesktopPreviewSession>;
  revokeSession: (sessionId: string) => Promise<{ revoked: boolean }>;
};

declare global {
  interface Window {
    htmlAIPreview?: DesktopPreviewApi;
  }
}

const PREVIEW_BOOTSTRAP_ATTRIBUTE = "data-pageroot-preview-bootstrap";
const PREVIEW_BASE_ATTRIBUTE = "data-pageroot-preview-base";
const PREVIEW_BOOTSTRAP_PATH = "/.pageroot/preview-bootstrap.js";
const CAPTURE_REQUEST_TYPE = "pageroot-page-view-context-request";
const CAPTURE_RESPONSE_TYPE = "pageroot-page-view-context-response";
const CAPTURE_TIMEOUT_MS = 1_200;
const MAX_CAPTURED_ELEMENTS = 512;
const MAX_CAPTURED_VISUALS = 24;
const MAX_CAPTURED_VISUAL_BYTES = 2_000_000;
const MAX_CAPTURED_TABLE_BYTES = 512_000;
const INDEPENDENT_PREVIEW_SANDBOX =
  "allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-downloads";
const SRCDOC_PREVIEW_SANDBOX =
  "allow-scripts allow-forms allow-modals allow-popups allow-downloads";

const PREVIEW_STORAGE_BOOTSTRAP = String.raw`
  const createMemoryStorage = () => {
    const values = new Map();
    return {
      get length() {
        return values.size;
      },
      clear() {
        values.clear();
      },
      getItem(key) {
        const normalizedKey = String(key);
        return values.has(normalizedKey) ? values.get(normalizedKey) : null;
      },
      key(index) {
        return Array.from(values.keys())[Number(index)] ?? null;
      },
      removeItem(key) {
        values.delete(String(key));
      },
      setItem(key, value) {
        values.set(String(key), String(value));
      },
    };
  };

  for (const name of ["localStorage", "sessionStorage"]) {
    try {
      void window[name].length;
    } catch {
      Object.defineProperty(window, name, {
        configurable: true,
        value: createMemoryStorage(),
      });
    }
  }
`;

function previewBootstrapJavaScript({
  channelToken,
  sourceSha256,
  visualCandidates,
}: {
  channelToken: string;
  sourceSha256: string;
  visualCandidates: Array<{
    sourceNodeId: string;
    tagName: "div" | "tbody";
  }>;
}): string {
  const config = JSON.stringify({
    channelToken,
    sourceSha256,
    sourceNodeAttribute: SOURCE_NODE_ATTRIBUTE,
    protocol: PAGE_VIEW_CONTEXT_PROTOCOL,
    version: PAGE_VIEW_CONTEXT_VERSION,
    requestType: CAPTURE_REQUEST_TYPE,
    responseType: CAPTURE_RESPONSE_TYPE,
    maxElements: MAX_CAPTURED_ELEMENTS,
    maxVisuals: MAX_CAPTURED_VISUALS,
    maxVisualBytes: MAX_CAPTURED_VISUAL_BYTES,
    maxTableBytes: MAX_CAPTURED_TABLE_BYTES,
    visualCandidates,
  }).replace(/</gu, "\\u003c");
  return String.raw`
(() => {
  "use strict";
  const config = ${config};
  ${PREVIEW_STORAGE_BOOTSTRAP}

  const capture = () => {
    const entries = [];
    const visuals = [];
    const seen = new Set();
    const elements = document.querySelectorAll(
      "[" + config.sourceNodeAttribute + "]",
    );
    let truncated = false;
    for (const element of elements) {
      const sourceNodeId = element.getAttribute(config.sourceNodeAttribute) || "";
      if (!sourceNodeId || seen.has(sourceNodeId)) {
        if (sourceNodeId) {
          entries.push({
            sourceNodeId,
            className: "",
            hidden: false,
            open: false,
            ariaSelected: null,
            ariaExpanded: null,
            display: "",
            visibility: "",
          });
        }
        continue;
      }
      seen.add(sourceNodeId);
      const className = element.getAttribute("class") || "";
      const hidden = element.hasAttribute("hidden");
      const open = element.hasAttribute("open");
      const ariaSelected = element.getAttribute("aria-selected");
      const ariaExpanded = element.getAttribute("aria-expanded");
      if (
        !className
        && !hidden
        && !open
        && ariaSelected === null
        && ariaExpanded === null
      ) continue;
      let display = "";
      let visibility = "";
      try {
        const computed = window.getComputedStyle(element);
        display = computed.display || "";
        visibility = computed.visibility || "";
      } catch {
        // A malformed authored node simply contributes no visibility signal.
      }
      entries.push({
        sourceNodeId,
        className,
        hidden,
        open,
        ariaSelected,
        ariaExpanded,
        display,
        visibility,
      });
      if (entries.length > config.maxElements) {
        truncated = true;
        break;
      }
    }
    if (!truncated) {
      for (const candidate of config.visualCandidates) {
        const selector = "[" + config.sourceNodeAttribute + '="' +
          CSS.escape(candidate.sourceNodeId) + '"]';
        const matches = document.querySelectorAll(selector);
        if (matches.length !== 1) continue;
        const element = matches[0];
        if (
          !element.isConnected
          || element.closest("[hidden]")
          || element.getClientRects().length === 0
        ) continue;
        if (candidate.tagName === "div") {
          const canvases = Array.from(element.querySelectorAll("canvas"))
            .filter((canvas) => (
              canvas.width > 0
              && canvas.height > 0
              && canvas.getClientRects().length > 0
            ))
            .sort((left, right) => (
              right.width * right.height - left.width * left.height
            ));
          const canvas = canvases[0];
          if (!canvas) continue;
          try {
            const dataUrl = canvas.toDataURL("image/png");
            if (
              dataUrl.length <= config.maxVisualBytes
              && /^data:image\/png;base64,/u.test(dataUrl)
            ) {
              visuals.push({
                sourceNodeId: candidate.sourceNodeId,
                kind: "canvas-bitmap",
                width: canvas.width,
                height: canvas.height,
                dataUrl,
              });
            }
          } catch {
            // Cross-origin pixels stay preview-only instead of weakening capture.
          }
        } else if (
          candidate.tagName === "tbody"
          && element.children.length > 0
          && element.innerHTML.length <= config.maxTableBytes
        ) {
          visuals.push({
            sourceNodeId: candidate.sourceNodeId,
            kind: "table-body",
            html: element.innerHTML,
          });
        }
        if (visuals.length > config.maxVisuals) {
          truncated = true;
          break;
        }
      }
    }
    return {
      protocol: config.protocol,
      version: config.version,
      sourceSha256: config.sourceSha256,
      truncated,
      entries: truncated ? [] : entries,
      visuals: truncated ? [] : visuals,
    };
  };

  window.addEventListener("message", (event) => {
    const payload = event.data;
    if (
      event.source !== window.parent
      || !payload
      || payload.type !== config.requestType
      || payload.channelToken !== config.channelToken
      || typeof payload.requestId !== "string"
    ) return;
    window.parent.postMessage({
      type: config.responseType,
      channelToken: config.channelToken,
      requestId: payload.requestId,
      snapshot: capture(),
    }, "*");
  });
})();
`;
}

function randomToken(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function doctypeString(doctype: DocumentType | null): string {
  if (!doctype) return "<!DOCTYPE html>";
  const publicId = doctype.publicId ? ` PUBLIC "${doctype.publicId}"` : "";
  const systemId = doctype.systemId
    ? `${publicId ? "" : " SYSTEM"} "${doctype.systemId}"`
    : "";
  return `<!DOCTYPE ${doctype.name}${publicId}${systemId}>`;
}

function baseHrefFromSourcePath(sourcePath?: string): string | undefined {
  if (!sourcePath) return undefined;
  const trimmedPath = sourcePath.trim();
  if (!trimmedPath) return undefined;

  try {
    if (/^[a-z][a-z\d+.-]*:/i.test(trimmedPath)) {
      const sourceUrl = new URL(trimmedPath);
      if (!sourceUrl.pathname.endsWith("/")) {
        sourceUrl.pathname = sourceUrl.pathname.slice(0, sourceUrl.pathname.lastIndexOf("/") + 1);
      }
      sourceUrl.search = "";
      sourceUrl.hash = "";
      return sourceUrl.href;
    }
  } catch {
    return undefined;
  }

  const normalizedPath = trimmedPath.replace(/\\/g, "/");
  if (!normalizedPath.startsWith("/")) return undefined;
  const directoryPath = normalizedPath.endsWith("/")
    ? normalizedPath
    : normalizedPath.slice(0, normalizedPath.lastIndexOf("/") + 1);
  const encodedPath = directoryPath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `file://${encodedPath}`;
}

function preparePreviewDocument(
  source: string,
  {
    baseUrl,
    externalBootstrap,
  }: {
    baseUrl?: string;
    externalBootstrap: boolean;
  },
): {
  html: string;
  sourceSha256: string;
  channelToken: string;
  bootstrapJavaScript: string;
} {
  const sourceIndex = buildSourceIndex(source);
  const visualCandidates = (sourceIndex.elements as Array<{
    nodeId: string;
    tagName: string;
    contentRange?: {
      startOffset: number;
      endOffset: number;
    };
  }>)
    .filter((element) => {
      if (element.tagName !== "div" && element.tagName !== "tbody") return false;
      if (!element.contentRange) return false;
      const innerHtml = sourceIndex.source.slice(
        element.contentRange.startOffset,
        element.contentRange.endOffset,
      );
      return innerHtml.replace(/<!--[\s\S]*?-->/gu, "").trim().length === 0;
    })
    .slice(0, 256)
    .map((element) => ({
      sourceNodeId: element.nodeId,
      tagName: element.tagName as "div" | "tbody",
    }));
  const channelToken = randomToken();
  const bootstrapJavaScript = previewBootstrapJavaScript({
    channelToken,
    sourceSha256: sourceIndex.sourceSha256,
    visualCandidates,
  });
  if (typeof DOMParser === "undefined") {
    return {
      html: source,
      sourceSha256: sourceIndex.sourceSha256,
      channelToken,
      bootstrapJavaScript,
    };
  }

  let instrumentedSource = source;
  try {
    instrumentedSource = instrumentPreviewHtml(sourceIndex, {
      attributeName: SOURCE_NODE_ATTRIBUTE,
    }).html;
  } catch {
    // The page can still be previewed when it already uses the reserved
    // attribute; only the optional view-context handoff is unavailable.
  }
  const parsed = new DOMParser().parseFromString(instrumentedSource, "text/html");
  if (baseUrl && !parsed.head.querySelector("base")) {
    const base = parsed.createElement("base");
    base.href = baseUrl;
    base.setAttribute(PREVIEW_BASE_ATTRIBUTE, "true");
    parsed.head.prepend(base);
  }

  const bootstrap = parsed.createElement("script");
  bootstrap.setAttribute(PREVIEW_BOOTSTRAP_ATTRIBUTE, "true");
  if (externalBootstrap) {
    bootstrap.src = PREVIEW_BOOTSTRAP_PATH;
  } else {
    bootstrap.textContent = bootstrapJavaScript;
  }
  parsed.head.prepend(bootstrap);

  return {
    html: `${doctypeString(parsed.doctype)}\n${parsed.documentElement.outerHTML}`,
    sourceSha256: sourceIndex.sourceSha256,
    channelToken,
    bootstrapJavaScript,
  };
}

const HtmlInteractionPreview = forwardRef<
  HtmlInteractionPreviewHandle,
  HtmlInteractionPreviewProps
>(function HtmlInteractionPreview({
  html,
  documentKey,
  sourcePath,
  height = "100%",
  transport = "srcdoc",
  onInteraction,
}, forwardedRef) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const sessionGenerationRef = useRef(0);
  const [reloadRevision, setReloadRevision] = useState(0);
  const [desktopSession, setDesktopSession] = useState<DesktopPreviewSession | null>(null);
  const [frameReady, setFrameReady] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const independentTransport = transport === "independent-url";
  const prepared = useMemo(
    () => preparePreviewDocument(html, {
      baseUrl: independentTransport
        ? undefined
        : baseHrefFromSourcePath(sourcePath),
      externalBootstrap: independentTransport,
    }),
    [html, independentTransport, sourcePath],
  );

  useEffect(() => {
    if (!independentTransport) {
      setDesktopSession(null);
      setFrameReady(false);
      setLoadFailed(false);
      sessionGenerationRef.current += 1;
      return undefined;
    }
    const previewApi = window.htmlAIPreview;
    let cancelled = false;
    let createdSession: DesktopPreviewSession | null = null;
    setDesktopSession(null);
    setFrameReady(false);
    setLoadFailed(false);
    sessionGenerationRef.current += 1;
    if (!previewApi) {
      setLoadFailed(true);
      return undefined;
    }
    void previewApi.createSession({
      html: prepared.html,
      bootstrapJavaScript: prepared.bootstrapJavaScript,
      ...(sourcePath ? { sourcePath } : {}),
    }).then((session) => {
      createdSession = session;
      if (cancelled) {
        void previewApi.revokeSession(session.sessionId);
        return;
      }
      setDesktopSession(session);
    }).catch(() => {
      if (!cancelled) setLoadFailed(true);
    });
    return () => {
      cancelled = true;
      if (createdSession) {
        void previewApi.revokeSession(createdSession.sessionId);
      }
    };
  }, [
    independentTransport,
    prepared.bootstrapJavaScript,
    prepared.html,
    reloadRevision,
    sourcePath,
  ]);

  useImperativeHandle(forwardedRef, () => ({
    capturePageViewContext: () => new Promise<PageViewContext | null>((resolve) => {
      const iframe = iframeRef.current;
      const frameWindow = iframe?.contentWindow;
      if (!iframe || !frameWindow || !frameReady || loadFailed) {
        resolve(null);
        return;
      }
      const requestId = randomToken();
      let settled = false;
      const finish = (context: PageViewContext | null) => {
        if (settled) return;
        settled = true;
        window.removeEventListener("message", handleMessage);
        window.clearTimeout(timeoutId);
        resolve(context);
      };
      const handleMessage = (event: MessageEvent) => {
        const payload = event.data;
        if (
          event.source !== frameWindow
          || !payload
          || payload.type !== CAPTURE_RESPONSE_TYPE
          || payload.channelToken !== prepared.channelToken
          || payload.requestId !== requestId
        ) return;
        finish(createPageViewContext({
          html,
          documentKey,
          generation: sessionGenerationRef.current,
          snapshot: payload.snapshot as RawPageViewSnapshot,
        }));
      };
      const timeoutId = window.setTimeout(() => finish(null), CAPTURE_TIMEOUT_MS);
      window.addEventListener("message", handleMessage);
      frameWindow.postMessage({
        type: CAPTURE_REQUEST_TYPE,
        channelToken: prepared.channelToken,
        requestId,
      }, "*");
    }),
  }), [
    documentKey,
    frameReady,
    html,
    loadFailed,
    prepared.channelToken,
  ]);

  const frameSource = independentTransport
    ? desktopSession?.url
    : undefined;
  const frameSandbox = independentTransport
    ? INDEPENDENT_PREVIEW_SANDBOX
    : SRCDOC_PREVIEW_SANDBOX;
  const statusLabel = loadFailed
    ? "预览模式 · 页面没有成功载入"
    : frameReady
      ? "预览模式 · 页面操作不会保存"
      : "预览模式 · 正在载入页面…";

  return (
    <div
      className={styles.preview}
      style={{ "--preview-height": height } as CSSProperties}
      onPointerDown={onInteraction}
    >
      <div className={styles.statusBar} role="status">
        <span>{statusLabel}</span>
        <button
          type="button"
          onClick={() => setReloadRevision((revision) => revision + 1)}
        >
          重新载入
        </button>
      </div>
      <iframe
        ref={iframeRef}
        key={independentTransport
          ? desktopSession?.sessionId ?? `pending-${reloadRevision}`
          : reloadRevision}
        className={styles.frame}
        title="HTML 交互预览"
        {...(independentTransport
          ? { src: frameSource ?? "about:blank" }
          : { srcDoc: prepared.html })}
        sandbox={frameSandbox}
        allow="autoplay; clipboard-write; fullscreen; picture-in-picture"
        referrerPolicy="no-referrer"
        onLoad={() => {
          if (independentTransport && !desktopSession) return;
          setFrameReady(true);
          setLoadFailed(false);
        }}
        onError={() => setLoadFailed(true)}
      />
    </div>
  );
});

export default HtmlInteractionPreview;
