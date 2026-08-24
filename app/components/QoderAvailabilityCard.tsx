"use client";

import { useEffect, useRef, useState } from "react";

import {
  qoderAvailabilityPresentation,
  type QoderAvailabilitySnapshot,
  type QoderGuidanceKind,
} from "../domain/qoder-availability.js";

type QoderActionOutcome = Readonly<{
  status: string;
  reason?: string;
}> | null | undefined;

type QoderAvailabilityCardProps = {
  availability: QoderAvailabilitySnapshot;
  surface: "delivery" | "about";
  expanded?: boolean;
  disabled?: boolean;
  onToggle?: () => void;
  onActivate?: () => Promise<boolean>;
  onRefreshLocal: () => Promise<QoderActionOutcome>;
  onCheckUsability: () => Promise<QoderActionOutcome>;
  onCopyGuidance: (kind: QoderGuidanceKind) => Promise<QoderActionOutcome>;
};

export default function QoderAvailabilityCard({
  availability,
  surface,
  expanded = false,
  disabled = false,
  onToggle,
  onActivate,
  onRefreshLocal,
  onCheckUsability,
  onCopyGuidance,
}: QoderAvailabilityCardProps) {
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");
  const focusRefreshCleanupRef = useRef<(() => void) | null>(null);
  const presentation = qoderAvailabilityPresentation(availability);
  const checking = availability.status === "checking";
  const readyAfterInstall = availability.status === "ready"
    && availability.guidanceCopied === "install";
  const showDetails = expanded
    || availability.status === "not-installed"
    || availability.status === "auth-required"
    || availability.status === "unavailable"
    || readyAfterInstall;

  useEffect(() => () => focusRefreshCleanupRef.current?.(), []);

  const runAction = async (
    action: string,
    invoke: () => Promise<QoderActionOutcome | boolean>,
  ) => {
    if (pendingAction || disabled) return;
    setPendingAction(action);
    setActionError("");
    try {
      const outcome = await invoke();
      const succeeded = typeof outcome === "boolean"
        ? outcome
        : Boolean(outcome && ["succeeded", "stale"].includes(outcome.status));
      if (!succeeded) {
        if (action.startsWith("copy-")) {
          setActionError("指令暂时无法复制，请重试。");
        }
      } else if (action === "copy-install") {
        focusRefreshCleanupRef.current?.();
        const refreshAfterReturn = () => {
          focusRefreshCleanupRef.current = null;
          void onRefreshLocal();
        };
        window.addEventListener("focus", refreshAfterReturn, { once: true });
        focusRefreshCleanupRef.current = () => (
          window.removeEventListener("focus", refreshAfterReturn)
        );
      }
    } catch {
      setActionError(
        action.startsWith("copy-")
          ? "指令暂时无法复制，请重试。"
          : "这次检查没有完成，请重试。",
      );
    } finally {
      setPendingAction(null);
    }
  };

  const summary = (
    <>
      <span className="qoder-card-brand" aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="./qoder-logo.png" alt="" />
      </span>
      <span className="qoder-card-copy">
        <strong>Qoder CLI</strong>
        {availability.status === "ready" || availability.status === "checking"
          ? <small>{presentation.detail}</small>
          : null}
      </span>
      <span
        className="qoder-card-status"
        data-tone={presentation.tone}
        aria-live="polite"
        aria-atomic="true"
      >
        <i aria-hidden="true" />
        {presentation.statusLabel}
      </span>
    </>
  );

  // On the About surface the summary is a details toggle whatever the
  // availability status is, so the node keeps its tag across the async
  // refreshes (catalog ready → usability auth-required) instead of swapping
  // button ↔ div and detaching under a click on a slow runner (#282). Only
  // the delivery surface ties interactivity to a ready status.
  const summaryInteractive = surface === "about"
    ? !disabled
    : availability.status === "ready"
      && !readyAfterInstall
      && !checking
      && !disabled;
  const summaryNode = summaryInteractive ? (
    <button
      className="qoder-card-summary"
      type="button"
      data-qoder-primary="true"
      disabled={Boolean(pendingAction)}
      aria-expanded={surface === "about" ? expanded : undefined}
      onClick={() => {
        if (surface === "about") onToggle?.();
        else if (onActivate) void runAction("activate", onActivate);
      }}
    >
      {summary}
    </button>
  ) : (
    <div className="qoder-card-summary" aria-live="polite" aria-atomic="true">
      {summary}
    </div>
  );

  return (
    <section
      className="qoder-availability-card"
      data-status={availability.status}
      data-tone={presentation.tone}
      data-expanded={showDetails ? "true" : "false"}
    >
      {summaryNode}

      {showDetails ? (
        <div className="qoder-card-details">
          {availability.status === "not-installed" ? (
            <>
              <p>{presentation.detail}</p>
              {availability.guidanceCopied === "install" ? (
                <div className="qoder-guidance-confirmation" role="status">
                  <strong>✓ 安装指令已复制</strong>
                  <span>粘贴到 Qoder 发送。安装完成后回到这里继续。</span>
                </div>
              ) : null}
            </>
          ) : null}

          {availability.status === "auth-required" ? (
            <>
              <p>{presentation.detail}</p>
              {availability.guidanceCopied === "login" ? (
                <div className="qoder-guidance-confirmation" role="status">
                  <strong>✓ 登录指令已复制</strong>
                  <span>粘贴到 Qoder 发送。完成登录后回到这里继续。</span>
                </div>
              ) : null}
            </>
          ) : null}

          {availability.status === "unavailable" ? (
            <p>{presentation.detail}</p>
          ) : null}

          {availability.status === "ready" && surface === "about" ? (
            <p>检查登录和当前可用性，不会创建本轮任务。</p>
          ) : null}

          <div className="qoder-card-actions">
            {availability.status === "not-installed" ? (
              <>
                <button
                  type="button"
                  data-qoder-primary="true"
                  disabled={Boolean(pendingAction)}
                  onClick={() => void runAction(
                    "copy-install",
                    () => onCopyGuidance("install"),
                  )}
                >
                  {pendingAction === "copy-install"
                    ? "正在复制…"
                    : availability.guidanceCopied === "install"
                      ? "重新复制"
                      : "复制给 Qoder 的安装指令"}
                </button>
                <button
                  className="secondary"
                  type="button"
                  disabled={Boolean(pendingAction)}
                  onClick={() => void runAction("refresh", onRefreshLocal)}
                >
                  {pendingAction === "refresh" ? "正在检查…" : "重新检查"}
                </button>
              </>
            ) : null}

            {availability.status === "auth-required" ? (
              <>
                <button
                  type="button"
                  data-qoder-primary="true"
                  disabled={Boolean(pendingAction)}
                  onClick={() => void runAction(
                    "copy-login",
                    () => onCopyGuidance("login"),
                  )}
                >
                  {pendingAction === "copy-login" ? "正在复制…" : "复制登录指令"}
                </button>
                <button
                  className="secondary"
                  type="button"
                  disabled={Boolean(pendingAction)}
                  onClick={() => void runAction(
                    "check",
                    surface === "delivery" && onActivate
                      ? onActivate
                      : onCheckUsability,
                  )}
                >
                  {pendingAction === "check" ? "正在检查…" : "重新检查"}
                </button>
              </>
            ) : null}

            {availability.status === "unavailable" ? (
              <button
                type="button"
                data-qoder-primary="true"
                disabled={Boolean(pendingAction)}
                onClick={() => void runAction(
                  "check",
                  surface === "delivery" && onActivate
                    ? onActivate
                    : onCheckUsability,
                )}
              >
                {pendingAction === "check" ? "正在检查…" : "重新检查"}
              </button>
            ) : null}

            {availability.status === "ready" && readyAfterInstall && surface === "delivery" ? (
              <button
                type="button"
                data-qoder-primary="true"
                disabled={Boolean(pendingAction)}
                onClick={() => onActivate && void runAction("activate", onActivate)}
              >
                {pendingAction === "activate" ? "正在检查…" : "检查并继续"}
              </button>
            ) : null}

            {availability.status === "ready" && surface === "about" ? (
              <button
                type="button"
                data-qoder-primary="true"
                disabled={Boolean(pendingAction)}
                onClick={() => void runAction("check", onCheckUsability)}
              >
                {pendingAction === "check" ? "正在检查…" : "重新检查"}
              </button>
            ) : null}
          </div>

          {actionError ? (
            <p className="qoder-card-error" role="alert">{actionError}</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
