"use client";

import { useEffect, useRef, useState } from "react";

function previewSessionKey(
  sourcePath: string | undefined,
  disabled: boolean,
): string {
  if (disabled || !sourcePath) return "";
  return sourcePath;
}

export function usePreviewResourceBase(
  html: string,
  sourcePath: string | undefined,
  disabled: boolean,
): { resourceBase: string | undefined; ready: boolean } {
  const activeKey = previewSessionKey(sourcePath, disabled);
  const [resourceBase, setResourceBase] = useState<string | undefined>(undefined);
  const [seenKey, setSeenKey] = useState(activeKey);
  const [ready, setReady] = useState(!activeKey);
  const sessionIdRef = useRef<string | null>(null);
  const sessionKeyRef = useRef("");
  const createChainRef = useRef(Promise.resolve());

  const previewApi = typeof window === "undefined" ? undefined : window.htmlAIPreview;
  const canCreatePreviewSession = Boolean(
    previewApi?.createSession && previewApi?.revokeSession,
  );

  if (activeKey !== seenKey) {
    setSeenKey(activeKey);
    setResourceBase(undefined);
    setReady(!activeKey || !canCreatePreviewSession);
  } else if (activeKey && !canCreatePreviewSession && !ready) {
    setReady(true);
  }

  useEffect(() => {
    const livePreviewApi = window.htmlAIPreview;
    const revoke = (sessionId: string | null) => {
      if (sessionId && livePreviewApi?.revokeSession) {
        void livePreviewApi.revokeSession(sessionId);
      }
    };

    if (!activeKey || !sourcePath || !livePreviewApi?.createSession || !livePreviewApi.revokeSession) {
      revoke(sessionIdRef.current);
      sessionIdRef.current = null;
      sessionKeyRef.current = "";
      return undefined;
    }

    let cancelled = false;
    createChainRef.current = createChainRef.current.then(async () => {
      if (cancelled) return;
      const reuseId = sessionKeyRef.current === activeKey ? sessionIdRef.current : null;
      try {
        const session = await livePreviewApi.createSession({
          html,
          bootstrapJavaScript: "void 0;",
          sourcePath,
          ...(reuseId ? { sessionId: reuseId } : {}),
        });
        if (cancelled) {
          if (session.sessionId !== sessionIdRef.current) {
            void livePreviewApi.revokeSession(session.sessionId);
          }
          return;
        }
        const previousId = sessionIdRef.current;
        sessionIdRef.current = session.sessionId;
        sessionKeyRef.current = activeKey;
        try {
          const url = new URL(session.url);
          url.pathname = "/";
          url.search = "";
          url.hash = "";
          setResourceBase(url.href);
        } catch {
          setResourceBase(undefined);
        }
        setReady(true);
        if (previousId && previousId !== session.sessionId) {
          void livePreviewApi.revokeSession(previousId);
        }
      } catch {
        if (!cancelled && !sessionIdRef.current) {
          setResourceBase(undefined);
          setReady(true);
        }
      }
    });

    return () => {
      cancelled = true;
    };
  }, [activeKey, html, sourcePath]);

  useEffect(() => () => {
    const sessionId = sessionIdRef.current;
    sessionIdRef.current = null;
    sessionKeyRef.current = "";
    if (sessionId) void window.htmlAIPreview?.revokeSession?.(sessionId);
  }, []);

  return { resourceBase, ready };
}
