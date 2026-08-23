"use client";

import { CheckCircleIcon } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { PaperPlaneTiltIcon } from "@phosphor-icons/react/dist/csr/PaperPlaneTilt";

export type AgentDeliveryMode = "qoder-acp" | "clipboard";

function triggerLabel({
  generating,
  status,
  deliveryMode,
  runInProgress,
  pendingCount,
  candidateReady,
}: {
  generating: boolean;
  status: string;
  deliveryMode: AgentDeliveryMode;
  runInProgress: boolean;
  pendingCount: number;
  candidateReady: boolean;
}) {
  /*
   * A candidate on screen outranks a failed attempt. A refused retry still reports
   * failure on the handoff, and saying so here put 「本轮没完成」 next to a decision bar
   * offering to adopt version 2 — the user could not tell whether the round worked.
   */
  if (candidateReady) return "结果等你决定";
  if (generating) return "正在准备…";
  if (status === "copying") return "正在复制…";
  if (status === "starting") return "正在启动 Qoder…";
  if (status === "running") return "Qoder 正在处理";
  if (status === "completed") return "正在确认结果";
  if (status === "interrupted") return "Qoder 会话已中断";
  if (status === "failed") {
    // 「Qoder 需处理」 told the user a state, not a next step, and left them guessing
    // what was expected of them. Both branches now name the action.
    return deliveryMode === "qoder-acp" ? "本轮没完成 · 看看怎么办" : "复制失败，再试一次";
  }
  if (status === "copied" || runInProgress) return "查看本轮";
  return pendingCount === 0 ? "写评论后再发送" : "发给 AI";
}

/**
 * Hands this round to the AI. It used to ask "怎样交给 AI？" in a modal before
 * anything could happen; the choice now lives in the AI conversation, where the
 * disclosure, the payload summary, the local-Agent action and the clipboard
 * alternative all sit together. This button only opens that surface, so the
 * number of clicks to submit is unchanged and nothing covers the page.
 */
export function AgentDeliveryButton({
  status,
  deliveryMode,
  generating,
  runInProgress,
  pendingCount,
  disabled,
  candidateReady = false,
  onOpenRun,
  onCompose,
}: {
  status: string;
  deliveryMode: AgentDeliveryMode;
  generating: boolean;
  runInProgress: boolean;
  pendingCount: number;
  disabled: boolean;
  /** This round already produced a Candidate awaiting the user's decision. */
  candidateReady?: boolean;
  onOpenRun: () => void;
  onCompose: () => void;
}) {
  const copied = status === "copied";
  return (
    <button
      className="header-send-button"
      type="button"
      data-handoff-status={status}
      data-copied={copied ? "true" : undefined}
      disabled={disabled}
      onClick={() => {
        if (runInProgress || copied) onOpenRun();
        else onCompose();
      }}
    >
      {copied ? (
        <CheckCircleIcon aria-hidden="true" size={15} weight="fill" />
      ) : (
        <PaperPlaneTiltIcon aria-hidden="true" size={15} weight="fill" />
      )}
      <span>
        {triggerLabel({
          generating,
          status,
          deliveryMode,
          runInProgress,
          pendingCount,
          candidateReady,
        })}
      </span>
      {pendingCount > 0 && !runInProgress && !["copied", "failed"].includes(status)
        ? <small>{pendingCount}</small>
        : null}
    </button>
  );
}

export default AgentDeliveryButton;
