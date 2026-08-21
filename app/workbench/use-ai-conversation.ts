"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type { WorkspaceController } from "../application/workspace-controller.js";
import type { ConversationSessionSnapshot } from "../application/conversation-session.js";
import type { SidebarIntent } from "./ai-conversation-model.js";

// Owns the AI conversation sidebar's lifecycle and the props it renders.
//
// All React hooks live in this module, so mounting the sidebar adds a single
// hook call to the Workbench and nothing to its hook budget. The hook holds no
// durable state: it publishes intent to the WorkspaceController, which owns the
// session and the only Bridge path.
//
// A conversation belongs to one Document. Opening the sidebar loads that
// Document's conversation; leaving preview, hiding the sidebar, or switching
// Document flushes the draft and closes — so a draft is never lost at a
// boundary and one Document's messages never linger under another.

export type UseAiConversationOptions = {
  controllerRef: { current: WorkspaceController | null };
  conversation: ConversationSessionSnapshot | null;
  canvasMode: "edit" | "preview";
  projectId: string;
  documentId: string;
  sourcePath: string;
  pendingCommentCount: number;
};

export function useAiConversation({
  controllerRef,
  conversation,
  canvasMode,
  projectId,
  documentId,
  sourcePath,
  pendingCommentCount,
}: UseAiConversationOptions) {
  const [open, setOpen] = useState(false);
  const active = canvasMode === "preview" && Boolean(sourcePath);
  const visible = active && open;

  // Load when the sidebar becomes visible for a Document; flush + close on any
  // change to that identity or when it stops being visible.
  useEffect(() => {
    if (!visible) return undefined;
    const controller = controllerRef.current;
    if (!controller) return undefined;
    void controller.openConversation({ projectId, documentId, sourcePath });
    return () => {
      void controller.flushConversationDraft();
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

  const sidebarProps = useMemo(() => ({
    // Until the discussion turn exists (Phase 2), the sidebar reflects the
    // read-only discussion state; it restores history and persists the draft.
    state: "preview-discussion" as const,
    title: conversation?.title ?? "",
    messages: conversation?.messages ?? [],
    draftText: conversation?.draftText ?? "",
    intent: (conversation?.draftIntent ?? "discuss") as SidebarIntent,
    // No model catalog is wired yet; sending stays disabled with a reason until
    // the model catalog and discussion host land next.
    catalogStatus: "unavailable" as const,
    modelDisplayName: null,
    modelChoiceCount: 0,
    pendingCommentCount,
    loading: conversation?.status === "loading",
    onDraftChange,
    onIntentChange,
    onCollapse,
  }), [conversation, pendingCommentCount, onDraftChange, onIntentChange, onCollapse]);

  return { open, visible, toggle, sidebarProps };
}
