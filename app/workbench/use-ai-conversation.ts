"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { WorkspaceController } from "../application/workspace-controller.js";
import type { ConversationSessionSnapshot } from "../application/conversation-session.js";
import type { DiscussionTurnSnapshot } from "../application/discussion-turn-session.js";
import type { QoderAvailabilitySnapshot } from "../domain/qoder-availability.js";
import type { ActiveRun } from "../domain/run-lifecycle.js";
import {
  conversationLoadedForView,
  conversationReadyForDocument,
  sidebarStateFromRun,
  type SidebarCatalogStatus,
  type SidebarIntent,
} from "./ai-conversation-model.js";

// Owns the AI conversation sidebar's lifecycle and the props it renders.
//
// All React hooks live in this module, so mounting the sidebar adds a single
// hook call to the Workbench and nothing to its hook budget. The hook holds no
// durable state: it publishes intent to the WorkspaceController, which owns the
// session and the only Bridge path.
//
// A conversation belongs to one Document. Opening the sidebar loads that
// Document's conversation; leaving preview, hiding the sidebar, or switching
// Document flushes the draft, drains any in-flight discussion turn and closes —
// so a draft is never lost at a boundary and one Document's messages never
// linger under another.
//
// The header's mode is derived from the run's durable status, never guessed
// locally: it must not say "discussion · read-only" while an execution turn is
// writing a Candidate.

export type UseAiConversationOptions = {
  controllerRef: { current: WorkspaceController | null };
  conversation: ConversationSessionSnapshot | null;
  discussionTurn: DiscussionTurnSnapshot | null;
  qoderAvailability: QoderAvailabilitySnapshot | null;
  agentModelDisplayName?: string | null;
  activeRun: ActiveRun | null;
  submissionPending?: boolean;
  reviewing?: boolean;
  canvasMode: "edit" | "preview";
  projectId: string;
  documentId: string;
  sourcePath: string;
  sourceSha256: string | null;
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

type DeferredIntent = {
  intent: SidebarIntent;
  projectId: string;
  documentId: string;
  sourcePath: string;
};

function deferredIntentMatches(
  pending: DeferredIntent | null,
  identity: Omit<DeferredIntent, "intent">,
) {
  return pending?.projectId === identity.projectId
    && pending.documentId === identity.documentId
    && pending.sourcePath === identity.sourcePath;
}

export function useAiConversation({
  controllerRef,
  conversation,
  discussionTurn,
  qoderAvailability,
  agentModelDisplayName = null,
  activeRun,
  submissionPending = false,
  reviewing = false,
  canvasMode,
  projectId,
  documentId,
  sourcePath,
  sourceSha256,
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
  const qoderAvailabilityRef = useRef(qoderAvailability);
  const qoderCheckInFlightRef = useRef<Promise<unknown> | null>(null);
  const qoderCheckStartedAtRef = useRef(0);
  useEffect(() => {
    qoderAvailabilityRef.current = qoderAvailability;
  }, [qoderAvailability]);

  // A reveal intent that arrives before the conversation is loaded for this
  // Document — on a first open, or when the sidebar reopens after a Document
  // switch closed the conversation — is held here and re-applied once the load
  // that would otherwise restore the stored draft has settled.
  //
  // It is a ref, not state: state here would retrigger the load effect after
  // the re-assert, and the cleanup of that restart closes the conversation it
  // just opened. The Composer then reads the default intent through a brief
  // reload window, which on a slow host drops the "copy to another Agent"
  // button long enough for a click to time out. A ref keeps the load to one.
  const requestedIntentRef = useRef<DeferredIntent | null>(null);
  // Load when the sidebar becomes visible for a Document; flush + drain + close
  // on any change to that identity or when it stops being visible.
  //
  // Opening the sidebar also has to ask whether Qoder is usable. Returning from
  // an external login while the sidebar remains visible must do the same check
  // without a user-facing "检测" button.
  useEffect(() => {
    if (!visible) return undefined;
    const controller = controllerRef.current;
    if (!controller) return undefined;
    const identity = { projectId, documentId, sourcePath };
    let cancelled = false;
    const requestQoderCheck = (force = false) => {
      const status = qoderAvailabilityRef.current?.status;
      if (!force && (status === "ready" || status === "checking")) return;
      const now = Date.now();
      if (
        qoderCheckInFlightRef.current
        || now - qoderCheckStartedAtRef.current < 1_500
      ) return;
      qoderCheckStartedAtRef.current = now;
      const checking = Promise.resolve(controller.checkQoderUsability())
        .catch(() => undefined);
      qoderCheckInFlightRef.current = checking;
      void checking.finally(() => {
        if (qoderCheckInFlightRef.current === checking) {
          qoderCheckInFlightRef.current = null;
        }
      });
    };
    void (async () => {
      await controller.openConversation({ projectId, documentId, sourcePath });
      if (cancelled) return;
      const pending = requestedIntentRef.current;
      if (pending && deferredIntentMatches(pending, identity)) {
        requestedIntentRef.current = null;
        controller.updateConversationDraftIntent(pending.intent);
      }
    })();
    requestQoderCheck(true);
    const handleReturnToApp = () => {
      if (document.visibilityState === "visible") requestQoderCheck();
    };
    window.addEventListener("focus", handleReturnToApp);
    document.addEventListener("visibilitychange", handleReturnToApp);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", handleReturnToApp);
      document.removeEventListener("visibilitychange", handleReturnToApp);
      // A choice made during this Document's load must not survive its drain and
      // later overwrite another Document (or unexpectedly reappear on return).
      if (deferredIntentMatches(requestedIntentRef.current, identity)) {
        requestedIntentRef.current = null;
      }
      void controller.flushConversationDraft();
      // A read-only discussion turn is cancelled at this boundary rather than
      // left running against a Document the user is no longer looking at.
      void controller.drainDiscussionTurn();
      controller.closeDiscussionTurn();
      controller.closeConversation();
    };
  }, [visible, projectId, documentId, sourcePath, controllerRef]);

  const toggle = useCallback(() => setOpen((value) => !value), []);
  // Submitting a round makes this the surface that reports it, so the workbench
  // opens the thread instead of raising the process drawer over the page.
  //
  // An intent asked for here has to survive openConversation: that load brings the
  // stored draft back and would otherwise overwrite it. Where the conversation is
  // already loaded for this Document nothing ahead of it restores a draft, so the
  // write stands; every other state hands the intent to the effect's re-assert,
  // which runs after the one load the sidebar actually performs.
  const reveal = useCallback((intent?: SidebarIntent) => {
    setOpen(true);
    if (!intent) return;
    if (conversationReadyForDocument(conversation, projectId, documentId)) {
      controllerRef.current?.updateConversationDraftIntent(intent);
      return;
    }
    // The conversation is not loaded for this Document yet — a direct write would
    // be dropped by the load that follows. Hold it for the effect to re-apply.
    requestedIntentRef.current = { intent, projectId, documentId, sourcePath };
  }, [controllerRef, conversation, projectId, documentId, sourcePath]);

  const onDraftChange = useCallback((text: string) => {
    controllerRef.current?.updateConversationDraftText(text);
  }, [controllerRef]);

  const onIntentChange = useCallback((intent: SidebarIntent) => {
    if (conversationReadyForDocument(conversation, projectId, documentId)) {
      controllerRef.current?.updateConversationDraftIntent(intent);
      return;
    }
    // The intent controls are visible while the first conversation load settles.
    // Preserve a quick user choice and apply it after that load restores the
    // persisted draft, for the same reason reveal(intent) defers its write.
    requestedIntentRef.current = { intent, projectId, documentId, sourcePath };
  }, [controllerRef, conversation, projectId, documentId, sourcePath]);

  const onCollapse = useCallback(() => setOpen(false), []);

  const draftText = conversation?.draftText ?? "";
  const conversationId = conversation?.conversationId ?? null;

  // Sending a discussion is the only send this Composer performs. Modifying is a
  // Request frozen from the edit surface's comments, so the send state points the
  // user there instead of quietly dropping this text into a different flow.
  const onSend = useCallback((intent: SidebarIntent) => {
    // A modification is a Request built from the comments already on the page, so
    // it goes to the run pipeline rather than the discussion Bridge. The Composer
    // has no text box in that intent, so nothing typed can be lost here.
    if (intent === "modify") {
      onDeliverModification?.("managed-agent");
      return;
    }
    if (intent !== "discuss") return;
    const question = draftText.trim();
    if (!question) return;
    void (async () => {
      const started = await controllerRef.current?.startDiscussionTurn(
        { projectId, documentId, sourcePath },
        {
          question,
          conversationId,
          // The page the user is looking at is the discussion context. Passing its
          // Hash lets the Bridge refuse a stale round instead of discussing bytes
          // that have already moved on.
          expectedSourceSha256: sourceSha256,
        },
      );
      // The question is now stored by the Bridge, so the box empties. Leaving the
      // sent text behind invites an accidental second identical round. A refused
      // start keeps the text so the user does not have to retype it.
      if (started) controllerRef.current?.updateConversationDraftText("");
    })();
  }, [
    controllerRef,
    draftText,
    onDeliverModification,
    conversationId,
    projectId,
    documentId,
    sourcePath,
    sourceSha256,
  ]);

  const state = useMemo(
    () => sidebarStateFromRun({ activeRun, submissionPending, reviewing }),
    [activeRun, submissionPending, reviewing],
  );

  const onCopyTask = useCallback(() => {
    onDeliverModification?.("clipboard");
  }, [onDeliverModification]);

  const sidebarProps = useMemo(() => ({
    state,
    title: conversation?.title ?? "",
    messages: conversation?.messages ?? [],
    draftText,
    intent: (conversation?.draftIntent ?? "discuss") as SidebarIntent,
    // Qoder's availability is the model catalog's readiness: one owner supplies
    // both, so the Composer can never claim ready while the Agent is not.
    catalogStatus: (qoderAvailability?.status ?? "unavailable") as SidebarCatalogStatus,
    modelDisplayName: agentModelDisplayName,
    modelChoiceCount: 0,
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
    discussion: discussionTurn,
    onDraftChange,
    onIntentChange,
    onSend,
    onCopyTask,
    onAction: onDecision,
    onCollapse,
    onOpenAgentSettings,
  }), [
    state,
    conversation,
    draftText,
    qoderAvailability,
    agentModelDisplayName,
    discussionTurn,
    pendingCommentCount,
    onDraftChange,
    onIntentChange,
    onSend,
    onCopyTask,
    onDecision,
    onCollapse,
    onOpenAgentSettings,
  ]);

  return { open, visible, toggle, reveal, sidebarProps };
}
