"use client";

import { useMemo, useState, type CSSProperties } from "react";

import styles from "./HtmlInteractionPreview.module.css";

type HtmlInteractionPreviewProps = {
  html: string;
  sourcePath?: string;
  height?: string;
  onInteraction?: () => void;
};

const PREVIEW_BOOTSTRAP_ATTRIBUTE = "data-pageroot-preview-bootstrap";
const PREVIEW_BASE_ATTRIBUTE = "data-pageroot-preview-base";
const PREVIEW_STORAGE_BOOTSTRAP = String.raw`
(() => {
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
})();
`;

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

function preparePreviewDocument(source: string, baseUrl?: string): string {
  if (typeof DOMParser === "undefined") return source;

  const parsed = new DOMParser().parseFromString(source, "text/html");
  if (baseUrl && !parsed.head.querySelector("base")) {
    const base = parsed.createElement("base");
    base.href = baseUrl;
    base.setAttribute(PREVIEW_BASE_ATTRIBUTE, "true");
    parsed.head.prepend(base);
  }

  const bootstrap = parsed.createElement("script");
  bootstrap.setAttribute(PREVIEW_BOOTSTRAP_ATTRIBUTE, "true");
  bootstrap.textContent = PREVIEW_STORAGE_BOOTSTRAP;
  parsed.head.prepend(bootstrap);

  return `${doctypeString(parsed.doctype)}\n${parsed.documentElement.outerHTML}`;
}

export default function HtmlInteractionPreview({
  html,
  sourcePath,
  height = "100%",
  onInteraction,
}: HtmlInteractionPreviewProps) {
  const [reloadRevision, setReloadRevision] = useState(0);
  const previewHtml = useMemo(
    () => preparePreviewDocument(html, baseHrefFromSourcePath(sourcePath)),
    [html, sourcePath],
  );

  return (
    <div
      className={styles.preview}
      style={{ "--preview-height": height } as CSSProperties}
      onPointerDown={onInteraction}
    >
      <div className={styles.statusBar} role="status">
        <span>预览模式 · 页面操作不会保存</span>
        <button
          type="button"
          onClick={() => setReloadRevision((revision) => revision + 1)}
        >
          重新载入
        </button>
      </div>
      <iframe
        key={reloadRevision}
        className={styles.frame}
        title="HTML 交互预览"
        srcDoc={previewHtml}
        sandbox="allow-scripts allow-forms allow-modals allow-popups allow-downloads"
        allow="autoplay; clipboard-write; fullscreen; picture-in-picture"
        referrerPolicy="no-referrer"
      />
    </div>
  );
}
