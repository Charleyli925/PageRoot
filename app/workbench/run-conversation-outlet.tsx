"use client";

import { memo, useSyncExternalStore } from "react";

import type { RunControllerCapability } from "../application/workspace-controller-capabilities.js";
import { deriveRunProgressPresentation } from "../domain/run-lifecycle.js";
import AiConversationSidebar, {
  type AiConversationSidebarProps,
} from "./AiConversationSidebar";
import { sidebarStateFromRun } from "./ai-conversation-model.js";

export const RunConversationOutlet = memo(function RunConversationOutlet({
  capability,
  sidebarProps,
  reviewing,
  deliveryMode,
}: {
  capability: RunControllerCapability;
  sidebarProps: AiConversationSidebarProps;
  reviewing: boolean;
  deliveryMode: "managed-agent" | "clipboard";
}) {
  const snapshot = useSyncExternalStore(
    capability.subscribe,
    capability.getSnapshot,
    capability.getSnapshot,
  );
  const runSession = snapshot.session;
  const activeRun = runSession?.activeRun ?? null;
  const activeHandoff = runSession?.activeHandoff ?? null;
  const handoffMatchesRun = Boolean(
    activeRun
    && activeHandoff
    && activeRun.requestId === activeHandoff.requestId
    && activeRun.attemptId === activeHandoff.attemptId
  );
  const currentHandoff = handoffMatchesRun ? activeHandoff : null;
  const state = sidebarStateFromRun({
    activeRun,
    activeHandoff: currentHandoff,
    submissionPending: runSession?.submissionPending === true,
    reviewing,
  });
  const progress = deriveRunProgressPresentation(
    activeRun,
    currentHandoff || "idle",
  );

  return (
    <AiConversationSidebar
      {...sidebarProps}
      state={state}
      runStatus={activeRun?.status ?? null}
      candidateVersionLabel={activeRun?.candidateVersionLabel ?? null}
      candidateStatus={activeRun?.candidateAssessment?.status ?? null}
      failureMessage={currentHandoff?.errorMessage || activeRun?.errorDetail || activeRun?.error || null}
      failureCode={currentHandoff?.errorCode || activeRun?.errorCode || null}
      agentText={currentHandoff?.visibleText || ""}
      agentUpdates={currentHandoff?.visibleTextUpdates || []}
      agentTextTruncated={currentHandoff?.textTruncated === true}
      agentWorking={currentHandoff?.mode === "managed-agent"
        && ["starting", "running", "cancelling"].includes(currentHandoff.status)}
      agentStartedAt={currentHandoff?.startedAt || null}
      agentLastActivityAt={currentHandoff?.lastActivityAt || null}
      agentReceivedBytes={currentHandoff?.receivedBytes || 0}
      agentUpdatedAt={currentHandoff?.updatedAt || null}
      handoffStatus={currentHandoff?.status || null}
      runKey={activeRun
        ? `${activeRun.requestId}:${activeRun.attemptId}`
        : runSession?.submissionPending
          ? `pending:${runSession.activeSourcePath || "unknown"}`
          : null}
      runCommentCount={activeRun?.commentCount ?? sidebarProps.pendingCommentCount}
      runSteps={progress.steps}
      deliveryMode={deliveryMode}
    />
  );
});
