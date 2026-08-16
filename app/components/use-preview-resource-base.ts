"use client";

import { useEffect, useRef, useState } from "react";

function previewSessionKey(
  html: string,
  sourcePath: string | undefined,
  disabled: boolean,
): string {
  if (disabled || !sourcePath || typeof html !== "string") return "";
  return `${sourcePath}\0${html}`;
}

export function usePreviewResourceBase(
  html: string,
  sourcePath: string | undefined,
  disabled: boolean,
): string | undefined {
  const activeKey = previewSessionKey(html, sourcePath, disabled);
  const [resourceBase, setResourceBase] = useState<string | undefined>(undefined);
  const [seenKey, setSeenKey] = useState(activeKey);
  const sessionIdRef = useRef<string | null>(null);

  if (activeKey !== seenKey) {
    setSeenKey(activeKey);
    setResourceBase(undefined);
  }

  useEffect(() => {
    const previewApi = window.htmlAIPreview;
    const revoke = (sessionId: string | null) => {
      if (sessionId && previewApi?.revokeSession) {
        void previewApi.revokeSession(sessionId);
      }
    };

    if (!activeKey || !sourcePath || !previewApi?.createSession || !previewApi.revokeSession) {
      revoke(sessionIdRef.current);
      sessionIdRef.current = null;
      return undefined;
    }

    let cancelled = false;
    void previewApi.createSession({
      html,
      bootstrapJavaScript: "void 0;",
      sourcePath,
    }).then((session) => {
      if (cancelled) {
        void previewApi.revokeSession(session.sessionId);
        return;
      }
      const previousId = sessionIdRef.current;
      sessionIdRef.current = session.sessionId;
      try {
        const url = new URL(session.url);
        url.pathname = "/";
        url.search = "";
        url.hash = "";
        setResourceBase(url.href);
      } catch {
        setResourceBase(undefined);
      }
      if (previousId && previousId !== session.sessionId) {
        void previewApi.revokeSession(previousId);
      }
    }).catch(() => {
      if (!cancelled && !sessionIdRef.current) setResourceBase(undefined);
    });

    return () => {
      cancelled = true;
    };
  }, [activeKey, html, sourcePath]);

  useEffect(() => () => {
    const sessionId = sessionIdRef.current;
    sessionIdRef.current = null;
    if (sessionId) void window.htmlAIPreview?.revokeSession?.(sessionId);
  }, []);

  return resourceBase;
}
