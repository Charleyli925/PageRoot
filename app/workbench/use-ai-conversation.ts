"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type { WorkspaceController } from "../application/workspace-controller.js";
import type { ConversationSessionSnapshot } from "../application/conversation-session.js";
import type { DiscussionTurnSnapshot } from "../application/discussion-turn-session.js";
import type { QoderAvailabilitySnapshot } from "../domain/qoder-availability.js";
import type { ActiveRun } from "../domain/run-lifecycle.js";
import {
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
}: UseAiConversationOptions) {
  const [open, setOpen] = useState(false);
  const active = canvasMode === "preview" && Boolean(sourcePath);
  const visible = active && open;

  // Load when the sidebar becomes visible for a Document; flush + drain + close
  // on any change to that identity or when it stops being visible.
  useEffect(() => {
    if (!visible) return undefined;
    const controller = controllerRef.current;
    if (!controller) return undefined;
    void controller.openConversation({ projectId, documentId, sourcePath });
    return () => {
      void controller.flushConversationDraft();
      // A read-only discussion turn is cancelled at this boundary rather than
      // left running against a Document the user is no longer looking at.
      void controller.drainDiscussionTurn();
      controller.closeDiscussionTurn();
      controller.closeConversation();
    };
  }, [visible, projectId, documentId, sourcePath, controllerRef]);

  const toggle = useCallback(() => setOpen((value) => !value), []);

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
    if (intent !== "discuss") return;
    const question = draftText.trim();
    if (!question) return;
    void controllerRef.current?.startDiscussionTurn(
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
  }, [
    controllerRef,
    draftText,
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
    pendingCommentCount,
    loading: conversation?.status === "loading",
    discussion: discussionTurn,
    onDraftChange,
    onIntentChange,
    onSend,
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
    onCollapse,
  ]);

  return { open, visible, toggle, sidebarProps };
}
