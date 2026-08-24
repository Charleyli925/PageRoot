"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { WorkspaceController } from "../application/workspace-controller.js";
import type { ConversationSessionSnapshot } from "../application/conversation-session.js";
import type { DiscussionTurnSnapshot } from "../application/discussion-turn-session.js";
import type { QoderAvailabilitySnapshot } from "../domain/qoder-availability.js";
import type { ActiveRun } from "../domain/run-lifecycle.js";
import {
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
  onDeliverModification?: (mode: "qoder-acp" | "clipboard") => void;
  /**
   * Acts on the decision bar. Without this the bar renders buttons that do
   * nothing, which is why the process drawer could not be removed before now.
   */
  onDecision?: (actionId: string) => void;
};

export function useAiConversation({
  controllerRef,
  conversation,
  discussionTurn,
  qoderAvailability,
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
}: UseAiConversationOptions) {
  const [open, setOpen] = useState(false);
  // Review is the same workbench with a different Canvas, so the thread that led
  // to the candidate stays on screen instead of vanishing and reappearing. It is
  // read-only there: see sidebarSendState(reviewing).
  const active = (canvasMode === "preview" || reviewing) && Boolean(sourcePath);
  const visible = active && open;

  const [requestedIntent, setRequestedIntent] = useState<SidebarIntent | null>(
    null,
  );
  // Load when the sidebar becomes visible for a Document; flush + drain + close
  // on any change to that identity or when it stops being visible.
  //
  // Opening the sidebar also has to ask whether Qoder is usable. Nothing else on
  // this surface triggers that check — the delivery dialog and the About card own
  // the other two entry points — so without this the Composer would sit at
  // "正在读取模型…" forever and the send button would never enable. Opening the
  // AI sidebar is the user's explicit request to use the Agent, which is the
  // moment PRD §10.3 allows the use-time check to run and show progress.
  useEffect(() => {
    if (!visible) return undefined;
    const controller = controllerRef.current;
    if (!controller) return undefined;
    void (async () => {
      await controller.openConversation({ projectId, documentId, sourcePath });
      if (requestedIntent) {
        controller.updateConversationDraftIntent(requestedIntent);
        setRequestedIntent(null);
      }
    })();
    void controller.checkQoderUsability();
    return () => {
      void controller.flushConversationDraft();
      // A read-only discussion turn is cancelled at this boundary rather than
      // left running against a Document the user is no longer looking at.
      void controller.drainDiscussionTurn();
      controller.closeDiscussionTurn();
      controller.closeConversation();
    };
  }, [visible, projectId, documentId, sourcePath, controllerRef, requestedIntent]);

  const toggle = useCallback(() => setOpen((value) => !value), []);
  // Submitting a round makes this the surface that reports it, so the workbench
  // opens the thread instead of raising the process drawer over the page.
  //
  // An intent asked for here has to survive openConversation: that load brings the
  // stored draft back and would otherwise overwrite it, which is why the intent is
  // both applied now (for a conversation already loaded for this Document) and
  // re-asserted after any load that may still run.
  const reveal = useCallback((intent?: SidebarIntent) => {
    if (intent) {
      controllerRef.current?.updateConversationDraftIntent(intent);
      // Only a conversation loaded for this Document keeps the direct write above:
      // nothing ahead of it restores a stored draft. The open flag alone must not
      // decide this — a Document switch closes the conversation while leaving the
      // sidebar open, and the load on reopen would quietly drop the write. Recording
      // the request there just restarts the load effect, which holds no discussion
      // to cancel; an already-loaded sidebar never records one, so an Agent still
      // answering is never interrupted.
      if (!conversationReadyForDocument(conversation, projectId, documentId)) {
        setRequestedIntent(intent);
      }
    }
    setOpen(true);
  }, [controllerRef, conversation, projectId, documentId]);

  const onDraftChange = useCallback((text: string) => {
    controllerRef.current?.updateConversationDraftText(text);
  }, [controllerRef]);

  const onIntentChange = useCallback((intent: SidebarIntent) => {
    controllerRef.current?.updateConversationDraftIntent(intent);
  }, [controllerRef]);

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
      onDeliverModification?.("qoder-acp");
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
    modelDisplayName: null,
    modelChoiceCount: 0,
    // The decision bar needs to name the version it is deciding about, and the
    // assessment decides whether adopting without looking is offered at all.
    candidateVersionLabel: activeRun?.candidateVersionLabel ?? null,
    candidateStatus: activeRun?.candidateAssessment?.status ?? null,
    failureMessage: activeRun?.error ?? null,
    pendingCommentCount,
    loading: conversation?.status === "loading",
    discussion: discussionTurn,
    onDraftChange,
    onIntentChange,
    onSend,
    onCopyTask,
    onAction: onDecision,
    onCollapse,
  }), [
    state,
    conversation,
    draftText,
    qoderAvailability,
    discussionTurn,
    pendingCommentCount,
    onDraftChange,
    onIntentChange,
    onSend,
    onCopyTask,
    onDecision,
    onCollapse,
  ]);

  return { open, visible, toggle, reveal, sidebarProps };
}
