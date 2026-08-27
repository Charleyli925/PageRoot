import React from "react";
import { createRoot } from "react-dom/client";
import Home from "../../app/page";
import {
  captureUsageEvent,
  usageFingerprint,
} from "../../app/application/usage-telemetry";
import "../../app/globals.css";

type PrepareCloseRequest = {
  requestId: string;
  reason: string;
  deadlineAt: number;
};

type CloseAbortedRequest = {
  requestId: string;
  reason: string;
};

type CloseReadiness =
  | { ready: true }
  | {
      ready: false;
      reason: string;
      presentation: "in-app" | "native";
    };

type PrepareCloseDetail = PrepareCloseRequest & {
  waitUntil: (readiness: Promise<CloseReadiness>) => void;
};

type WorkspaceUnavailable = {
  title: string;
  message: string;
};

type ExternalOpenRequest = {
  requestId: string;
  sourcePath: string;
};

declare global {
  interface Window {
    htmlAIAppLifecycle?: {
      onAboutRequested: (listener: () => void) => () => void;
      onPrepareClose: (listener: (request: PrepareCloseRequest) => void) => () => void;
      reportReady: (requestId: string) => Promise<{ accepted: boolean }>;
      reportBlocked: (
        requestId: string,
        reason: string,
        presentation?: "in-app" | "native",
      ) => Promise<{ accepted: boolean }>;
      onCloseAborted: (
        listener: (request: CloseAbortedRequest) => void,
      ) => () => void;
      onWorkspaceUnavailable: (
        listener: (issue: WorkspaceUnavailable) => void,
      ) => () => void;
      onExternalOpenRequested: (
        listener: (request: ExternalOpenRequest) => void,
      ) => () => void;
      getInitialExternalOpen: () => Promise<ExternalOpenRequest | null>;
      relaunch: () => Promise<{ relaunched: boolean }>;
      openUserNotice: () => Promise<{ opened: boolean }>;
    };
  }
}

const PREPARE_CLOSE_EVENT = "html-ai:prepare-close";
const CLOSE_ABORTED_EVENT = "html-ai:close-aborted";

window.addEventListener("error", (event) => {
  captureUsageEvent("renderer_fault", {
    kind: "window_error",
    fingerprint: usageFingerprint(event.error || event.message),
    fatal: false,
  });
});

window.addEventListener("unhandledrejection", (event) => {
  captureUsageEvent("renderer_fault", {
    kind: "unhandled_rejection",
    fingerprint: usageFingerprint(event.reason),
    fatal: false,
  });
});

window.htmlAIAppLifecycle?.onCloseAborted((request) => {
  window.dispatchEvent(new CustomEvent<CloseAbortedRequest>(CLOSE_ABORTED_EVENT, {
    detail: request,
  }));
});

window.htmlAIAppLifecycle?.onPrepareClose(async (request) => {
  const readinessChecks: Promise<CloseReadiness>[] = [];
  let acceptingChecks = true;
  const detail: PrepareCloseDetail = {
    ...request,
    waitUntil(readiness) {
      if (!acceptingChecks) {
        throw new Error("waitUntil must be called while handling html-ai:prepare-close.");
      }
      readinessChecks.push(Promise.resolve(readiness));
    },
  };

  window.dispatchEvent(new CustomEvent<PrepareCloseDetail>(PREPARE_CLOSE_EVENT, {
    detail,
  }));
  acceptingChecks = false;

  if (readinessChecks.length === 0) {
    await window.htmlAIAppLifecycle?.reportBlocked(
      request.requestId,
      "编辑器尚未注册关闭前写入处理器。为避免丢失更改，本次关闭已取消。",
    );
    return;
  }

  try {
    const results = await Promise.all(readinessChecks);
    const blocked = results.find((result) => !result.ready);
    if (blocked && !blocked.ready) {
      await window.htmlAIAppLifecycle?.reportBlocked(
        request.requestId,
        blocked.reason || "仍有更改尚未安全写入。",
        blocked.presentation,
      );
      return;
    }
    await window.htmlAIAppLifecycle?.reportReady(request.requestId);
  } catch (error) {
    await window.htmlAIAppLifecycle?.reportBlocked(
      request.requestId,
      error instanceof Error ? error.message : "关闭前写入检查失败。",
    );
  }
});

const root = document.getElementById("root");

if (!root) {
  throw new Error("Desktop renderer root is missing.");
}

createRoot(root, {
  onCaughtError(error, errorInfo) {
    captureUsageEvent("renderer_fault", {
      kind: "react_caught",
      fingerprint: usageFingerprint(
        `${usageFingerprint(error)}\n${errorInfo.componentStack || ""}`,
      ),
      fatal: false,
    });
  },
  onRecoverableError(error, errorInfo) {
    captureUsageEvent("renderer_fault", {
      kind: "react_recoverable",
      fingerprint: usageFingerprint(
        `${usageFingerprint(error)}\n${errorInfo.componentStack || ""}`,
      ),
      fatal: false,
    });
  },
  onUncaughtError(error, errorInfo) {
    captureUsageEvent("renderer_fault", {
      kind: "react_uncaught",
      fingerprint: usageFingerprint(
        `${usageFingerprint(error)}\n${errorInfo.componentStack || ""}`,
      ),
      fatal: true,
    });
  },
}).render(
  <React.StrictMode>
    <Home />
  </React.StrictMode>,
);
