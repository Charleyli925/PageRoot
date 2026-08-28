"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type { AiConversationControllerCapability } from "../application/workspace-controller-capabilities.js";
import type { ConversationSessionSnapshot } from "../application/conversation-session.js";
import type { QoderAvailabilitySnapshot } from "../domain/qoder-availability.js";
import type { ActiveRun } from "../domain/run-lifecycle.js";
import type { AgentSelection } from "../domain/agent-provider-state.js";
import type { RunHandoffState } from "../application/run-session.js";
import {
  conversationLoadedForView,
  sidebarStateFromRun,
  type SidebarCatalogStatus,
} from "./ai-conversation-model.js";

// Owns the AI conversation sidebar's lifecycle and the props it renders.
//
// All React hooks live in this module, so mounting the sidebar adds a single
// hook call to the Workbench and nothing to its hook budget. The hook holds no
// durable state: it publishes intent to the WorkspaceController, which owns the
// session and the only Bridge path. Historical messages remain readable, but
// this surface creates modification Requests only.
//
// A conversation belongs to one Document. Opening the sidebar loads that
// Document's conversation; leaving preview, hiding the sidebar, or switching
// Document closes it so one Document's messages never linger under another.

export type UseAiConversationOptions = {
  controllerRef: { current: AiConversationControllerCapability | null };
  conversation: ConversationSessionSnapshot | null;
  qoderAvailability: QoderAvailabilitySnapshot | null;
  agentDisplayName?: string | null;
  agentActionName?: string | null;
  agentSettingsName?: string | null;
  agentSettingsSupported?: boolean;
  agentPresentation?: Readonly<{
    providerId: string;
    displayName: string;
    agentName: string;
    logoSrc: string | null;
  }> | null;
  agentChoices?: readonly Readonly<{
    id: string;
    label: string;
    logoSrc?: string | null;
    selection: AgentSelection;
  }>[];
  selectedAgentChoiceId?: string | null;
  activeRun: ActiveRun | null;
  activeHandoff?: RunHandoffState | null;
  submissionPending?: boolean;
  reviewing?: boolean;
  canvasMode: "edit" | "preview";
  projectId: string;
  documentId: string;
  sourcePath: string;
  sourceFileName?: string | null;
  pendingCommentCount: number;
  /**
   * Hands this round of comments to the Agent or to the clipboard. Owned by the
   * workbench because a modification is a Request, not a conversation turn.
   */
  onDeliverModification?: (mode: "managed-agent" | "clipboard") => void;
  /**
   * Acts on the decision bar. Without this the bar renders buttons that do
   * nothing, which is why the conversation sidebar must remain the owner of the
   * visible decision actions.
   */
  onDecision?: (actionId: string) => void;
  /** Opens Settings' Agent section without sending or clearing the draft. */
  onOpenAgentSettings?: () => void;
};

export function useAiConversation({
  controllerRef,
  conversation,
  qoderAvailability,
  agentDisplayName = null,
  agentActionName = "Agent",
  agentSettingsName = "Agent",
  agentSettingsSupported = true,
  agentPresentation = null,
  agentChoices = [],
  selectedAgentChoiceId = null,
  activeRun,
  activeHandoff = null,
  submissionPending = false,
  reviewing = false,
  canvasMode,
  projectId,
  documentId,
  sourcePath,
  sourceFileName = null,
  pendingCommentCount,
  onDeliverModification,
  onDecision,
  onOpenAgentSettings,
}: UseAiConversationOptions) {
  const [open, setOpen] = useState(false);
  // Review is the same workbench with a different Canvas, so the thread that led
  // to the candidate stays on screen instead of vanishing and reappearing. It is
  // read-only there: see sidebarSendState(reviewing).
  const active = (canvasMode === "preview" || reviewing) && Boolean(sourcePath);
  const visible = active && open;

  // Load when the sidebar becomes visible for a Document and close it on any
  // identity change or when it stops being visible.
  //
  useEffect(() => {
    if (!visible) return undefined;
    const controller = controllerRef.current;
    if (!controller) return undefined;
    let cancelled = false;
    void (async () => {
      await controller.openConversation({ projectId, documentId, sourcePath });
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
      controller.closeConversation();
    };
  }, [visible, projectId, documentId, sourcePath, controllerRef]);

  const toggle = useCallback(() => setOpen((value) => !value), []);
  // Submitting a round makes this the surface that reports it, so the workbench
  // keeps the conversation thread visible beside the page.
  //
  const reveal = useCallback(() => {
    setOpen(true);
  }, []);

  const onSend = useCallback(() => {
    onDeliverModification?.("managed-agent");
  }, [onDeliverModification]);

  const state = useMemo(
    () => sidebarStateFromRun({ activeRun, submissionPending, reviewing }),
    [activeRun, submissionPending, reviewing],
  );

  const onCopyTask = useCallback(() => {
    onDeliverModification?.("clipboard");
  }, [onDeliverModification]);

  const onSelectAgentChoice = useCallback((choiceId: string) => {
    const choice = agentChoices.find((candidate) => candidate.id === choiceId);
    if (!choice) return;
    controllerRef.current?.selectAgent(choice.selection);
  }, [agentChoices, controllerRef]);

  const sidebarProps = useMemo(() => ({
    state,
    title: conversation?.title ?? "",
    messages: conversation?.messages ?? [],
    // The selected Agent's availability is the model catalog's readiness: one owner supplies
    // both, so the Composer can never claim ready while the Agent is not.
    catalogStatus: (qoderAvailability?.status ?? "unavailable") as SidebarCatalogStatus,
    agentDisplayName,
    agentActionName,
    agentSettingsName,
    agentSettingsSupported,
    agentPresentation,
    agentChoiceCount: agentChoices.length,
    agentChoices: agentChoices.map(({ id, label, logoSrc }) => ({ id, label, logoSrc })),
    selectedAgentChoiceId,
    onSelectAgentChoice,
    // The decision bar needs to name the version it is deciding about, and the
    // assessment decides whether adopting without looking is offered at all.
    candidateVersionLabel: activeRun?.candidateVersionLabel ?? null,
    candidateStatus: activeRun?.candidateAssessment?.status ?? null,
    failureMessage: activeRun?.error ?? null,
    pendingCommentCount,
    agentText: activeHandoff?.visibleText || "",
    agentUpdates: activeHandoff?.visibleTextUpdates || [],
    agentTextTruncated: activeHandoff?.textTruncated === true,
    agentWorking: activeHandoff?.mode === "managed-agent"
      && ["starting", "running"].includes(activeHandoff.status),
    agentStartedAt: activeHandoff?.startedAt || null,
    agentUpdatedAt: activeHandoff?.updatedAt || null,
    runKey: activeRun
      ? `${activeRun.requestId}:${activeRun.attemptId}`
      : submissionPending ? `pending:${projectId}:${documentId}` : null,
    runCommentCount: activeRun?.commentCount ?? pendingCommentCount,
    sourceFileName,
    handoffStatus: activeHandoff?.status || null,
    // An explicit allowlist of settled loads (see conversationLoadedForView):
    // the empty-state copy must never appear before the load settles, because
    // the session drops draft writes until it has published a conversation.
    loading: !conversationLoadedForView(conversation),
    onSend,
    onCopyTask,
    onAction: onDecision,
    onOpenAgentSettings,
  }), [
    state,
    conversation,
    qoderAvailability,
    agentDisplayName,
    agentActionName,
    agentSettingsName,
    agentSettingsSupported,
    agentPresentation,
    agentChoices,
    selectedAgentChoiceId,
    activeHandoff,
    activeRun,
    projectId,
    documentId,
    sourceFileName,
    submissionPending,
    pendingCommentCount,
    onSend,
    onCopyTask,
    onDecision,
    onOpenAgentSettings,
    onSelectAgentChoice,
  ]);

  return { open, visible, toggle, reveal, sidebarProps };
}
