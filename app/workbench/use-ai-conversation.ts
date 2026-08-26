"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { WorkspaceController } from "../application/workspace-controller.js";
import type { ConversationSessionSnapshot } from "../application/conversation-session.js";
import type { QoderAvailabilitySnapshot } from "../domain/qoder-availability.js";
import type { ActiveRun } from "../domain/run-lifecycle.js";
import type { AgentSelection } from "../domain/agent-provider-state.js";
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
  controllerRef: { current: WorkspaceController | null };
  conversation: ConversationSessionSnapshot | null;
  qoderAvailability: QoderAvailabilitySnapshot | null;
  agentModelDisplayName?: string | null;
  agentActionName?: string | null;
  agentSettingsName?: string | null;
  agentSettingsSupported?: boolean;
  agentLocalReadDisclosure?: string | null;
  agentChoices?: readonly Readonly<{
    id: string;
    label: string;
    detail?: string | null;
    selection: AgentSelection;
  }>[];
  selectedAgentChoiceId?: string | null;
  activeRun: ActiveRun | null;
  submissionPending?: boolean;
  reviewing?: boolean;
  canvasMode: "edit" | "preview";
  projectId: string;
  documentId: string;
  sourcePath: string;
  pendingCommentCount: number;
  /**
   * Hands this round of comments to the Agent or to the clipboard. Owned by the
   * workbench because a modification is a Request, not a conversation turn.
   */
  onDeliverModification?: (mode: "managed-agent" | "clipboard") => void;
  /**
   * Acts on the decision bar. Without this the bar renders buttons that do
   * nothing, which is why the process drawer could not be removed before now.
   */
  onDecision?: (actionId: string) => void;
  /** Opens About's Qoder settings without sending or clearing the draft. */
  onOpenAgentSettings?: () => void;
};

export function useAiConversation({
  controllerRef,
  conversation,
  qoderAvailability,
  agentModelDisplayName = null,
  agentActionName = "Qoder",
  agentSettingsName = "Qoder CLI",
  agentSettingsSupported = true,
  agentLocalReadDisclosure = null,
  agentChoices = [],
  selectedAgentChoiceId = null,
  activeRun,
  submissionPending = false,
  reviewing = false,
  canvasMode,
  projectId,
  documentId,
  sourcePath,
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
  const agentAvailabilityRef = useRef(qoderAvailability);
  const agentChecksInFlightRef = useRef(new Map<string, Promise<unknown>>());
  const agentCheckStartedAtRef = useRef(new Map<string, number>());
  useEffect(() => {
    agentAvailabilityRef.current = qoderAvailability;
  }, [qoderAvailability]);

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

  // Opening the sidebar and switching the in-place Agent chooser both run the
  // selected Provider's real preflight. In-flight checks are keyed by Provider
  // selection so a slow Qoder check cannot suppress a newly selected Codex
  // check (or vice versa). Returning from an external login retries the same
  // selected Provider without adding a separate connection surface.
  useEffect(() => {
    if (!visible || !selectedAgentChoiceId) return undefined;
    const controller = controllerRef.current;
    if (!controller) return undefined;
    const requestAgentCheck = (force = false) => {
      const status = agentAvailabilityRef.current?.status;
      if (!force && (status === "ready" || status === "checking")) return;
      const now = Date.now();
      const lastStartedAt = agentCheckStartedAtRef.current.get(selectedAgentChoiceId) ?? 0;
      if (
        agentChecksInFlightRef.current.has(selectedAgentChoiceId)
        || now - lastStartedAt < 1_500
      ) return;
      agentCheckStartedAtRef.current.set(selectedAgentChoiceId, now);
      const checking = Promise.resolve(controller.checkAgentUsability())
        .catch(() => undefined);
      agentChecksInFlightRef.current.set(selectedAgentChoiceId, checking);
      void checking.finally(() => {
        if (agentChecksInFlightRef.current.get(selectedAgentChoiceId) === checking) {
          agentChecksInFlightRef.current.delete(selectedAgentChoiceId);
        }
      });
    };
    requestAgentCheck(true);
    const handleReturnToApp = () => {
      if (document.visibilityState === "visible") requestAgentCheck();
    };
    window.addEventListener("focus", handleReturnToApp);
    document.addEventListener("visibilitychange", handleReturnToApp);
    return () => {
      window.removeEventListener("focus", handleReturnToApp);
      document.removeEventListener("visibilitychange", handleReturnToApp);
    };
  }, [visible, selectedAgentChoiceId, controllerRef]);

  const toggle = useCallback(() => setOpen((value) => !value), []);
  // Submitting a round makes this the surface that reports it, so the workbench
  // opens the thread instead of raising the process drawer over the page.
  //
  const reveal = useCallback(() => {
    setOpen(true);
  }, []);

  const onCollapse = useCallback(() => setOpen(false), []);

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

  const onSelectModelChoice = useCallback((choiceId: string) => {
    const choice = agentChoices.find((candidate) => candidate.id === choiceId);
    if (!choice) return;
    controllerRef.current?.selectAgent(choice.selection);
  }, [agentChoices, controllerRef]);

  const sidebarProps = useMemo(() => ({
    state,
    title: conversation?.title ?? "",
    messages: conversation?.messages ?? [],
    // Qoder's availability is the model catalog's readiness: one owner supplies
    // both, so the Composer can never claim ready while the Agent is not.
    catalogStatus: (qoderAvailability?.status ?? "unavailable") as SidebarCatalogStatus,
    modelDisplayName: agentModelDisplayName,
    agentActionName,
    agentSettingsName,
    agentSettingsSupported,
    agentLocalReadDisclosure,
    modelChoiceCount: agentChoices.length,
    modelChoices: agentChoices.map(({ id, label, detail }) => ({ id, label, detail })),
    selectedModelChoiceId: selectedAgentChoiceId,
    onSelectModelChoice,
    // The decision bar needs to name the version it is deciding about, and the
    // assessment decides whether adopting without looking is offered at all.
    candidateVersionLabel: activeRun?.candidateVersionLabel ?? null,
    candidateStatus: activeRun?.candidateAssessment?.status ?? null,
    failureMessage: activeRun?.error ?? null,
    pendingCommentCount,
    // An explicit allowlist of settled loads (see conversationLoadedForView):
    // the empty-state copy must never appear before the load settles, because
    // the session drops draft writes until it has published a conversation.
    loading: !conversationLoadedForView(conversation),
    onSend,
    onCopyTask,
    onAction: onDecision,
    onCollapse,
    onOpenAgentSettings,
  }), [
    state,
    conversation,
    qoderAvailability,
    agentModelDisplayName,
    agentActionName,
    agentSettingsName,
    agentSettingsSupported,
    agentLocalReadDisclosure,
    agentChoices,
    selectedAgentChoiceId,
    pendingCommentCount,
    onSend,
    onCopyTask,
    onDecision,
    onCollapse,
    onOpenAgentSettings,
    onSelectModelChoice,
  ]);

  return { open, visible, toggle, reveal, sidebarProps };
}
