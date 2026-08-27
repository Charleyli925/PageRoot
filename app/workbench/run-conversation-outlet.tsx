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
    submissionPending: runSession?.submissionPending === true,
    reviewing,
  });
  const progress = deriveRunProgressPresentation(
    activeRun,
    currentHandoff?.status || "idle",
  );

  return (
    <AiConversationSidebar
      {...sidebarProps}
      state={state}
      runStatus={activeRun?.status ?? null}
      candidateVersionLabel={activeRun?.candidateVersionLabel ?? null}
      candidateStatus={activeRun?.candidateAssessment?.status ?? null}
      failureMessage={activeRun?.errorDetail || activeRun?.error || null}
      agentText={currentHandoff?.visibleText || ""}
      agentTextTruncated={currentHandoff?.textTruncated === true}
      agentStartedAt={currentHandoff?.startedAt || null}
      agentUpdatedAt={currentHandoff?.updatedAt || null}
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
