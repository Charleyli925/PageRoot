"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { WorkspaceController } from "../application/workspace-controller.js";
import type { AgentCatalogSnapshot } from "../application/agent-provider-catalog.js";
import type { ConversationSessionSnapshot } from "../application/conversation-session.js";
import type { DiscussionTurnSnapshot } from "../application/discussion-turn-session.js";
import type { QoderAvailabilitySnapshot } from "../domain/qoder-availability.js";
import type { ActiveRun } from "../domain/run-lifecycle.js";
import {
  conversationLoadedForView,
  conversationReadyForDocument,
  sidebarAgentPurpose,
  sidebarProviderChoiceState,
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
  agentCatalog?: AgentCatalogSnapshot | null;
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

function persistedSelectionMatchesLiveCatalog(
  selection: AgentCatalogSnapshot["selected"],
  provider: AgentCatalogSnapshot["providers"][string] | null | undefined,
) {
  if (!selection || !provider || provider.runtimeId !== selection.runtimeId) return false;
  const liveModelIds = new Set((provider.models || []).map((model) => String(model.id || "")));
  for (const modelId of [selection.requestedModelId, selection.resolvedModelId]) {
    if (modelId && !liveModelIds.has(modelId)) return false;
  }
  if (selection.reasoning.resolution === "provider-default") return true;
  return selection.reasoning.resolution === "exact"
    && Boolean(selection.reasoning.requested)
    && (provider.reasoningEfforts || []).some(
      (effort) => String(effort.id || "") === selection.reasoning.requested,
    );
}

async function restoreConversationAgentSelection({
  controller,
  catalog,
  persistedSelection,
  purpose,
  isCurrent = () => true,
  checkUsability = (nextPurpose) => controller.checkAgentUsability({ purpose: nextPurpose }),
}: {
  controller: WorkspaceController;
  catalog: AgentCatalogSnapshot | null | undefined;
  persistedSelection: AgentCatalogSnapshot["selected"];
  purpose: "discussion" | "execution";
  isCurrent?: () => boolean;
  checkUsability?: (purpose: "discussion" | "execution") => Promise<{ status: string }>;
}) {
  const persistedProvider = persistedSelection
    ? catalog?.providers?.[persistedSelection.providerId]
    : null;
  if (persistedSelection && (!persistedProvider
    || persistedProvider.runtimeId !== persistedSelection.runtimeId)) {
    controller.restoreAgentSelection(persistedSelection);
    return;
  }
  const persistedProviderCompatible = Boolean(
    persistedSelection
    && persistedProvider
    && persistedProvider.runtimeId === persistedSelection.runtimeId
    && persistedProvider.capabilities?.[purpose] === true,
  );
  const baseProvider = persistedProviderCompatible
    ? persistedProvider!
    : Object.values(catalog?.providers || {})
      .find((provider) => provider.capabilities?.[purpose] === true);
  if (!baseProvider || !isCurrent()) return;

  // Query live choices from the Provider default before trusting a possibly
  // stale model or reasoning value restored from disk.
  const baseSelection = baseProvider.selection;
  controller.selectAgent(baseSelection);
  const defaultCheck = await checkUsability(purpose);
  if (!isCurrent()) return;
  if (defaultCheck.status !== "succeeded") {
    // The live catalog could not be established, but the durable draft still
    // owns its explicit choice. Keep that authority selected so a later retry
    // checks the same model/reasoning instead of silently running the default.
    if (persistedSelection) controller.selectAgent(persistedSelection);
    return;
  }

  const liveCatalog = controller.getSnapshot().run?.agentCatalog;
  const liveProvider = persistedSelection
    ? liveCatalog?.providers?.[persistedSelection.providerId]
    : null;
  if (persistedSelection && persistedSelectionMatchesLiveCatalog(persistedSelection, liveProvider)) {
    if (JSON.stringify(persistedSelection) === JSON.stringify(baseSelection)) return;
    controller.selectAgent(persistedSelection);
    // A transient failure of a still-listed choice must leave that explicit
    // selection active and unavailable; silently running the default would
    // contradict the conversation draft's authority.
    await checkUsability(purpose);
    return;
  }

  if (!persistedSelection) return;
  // Keep a disappeared explicit choice active and fail its preflight. The live
  // catalog remains projected from the safe default probe, so the user can see
  // replacements, but no Turn or Request can silently use one before reselecting.
  controller.selectAgent(persistedSelection);
  await checkUsability(purpose);
}

export function useAiConversation({
  controllerRef,
  conversation,
  discussionTurn,
  qoderAvailability,
  agentCatalog = null,
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
  const agentAvailabilityRef = useRef(qoderAvailability);
  const agentCheckInFlightRef = useRef<Promise<unknown> | null>(null);
  const agentCheckStartedAtRef = useRef(0);
  const agentCheckTailRef = useRef<Promise<void>>(Promise.resolve());
  const selectionRestoreGenerationRef = useRef(0);
  const queueAgentCheck = useCallback((
    controller: WorkspaceController,
    purpose: "discussion" | "execution",
  ) => {
    const checking = agentCheckTailRef.current.then(
      () => controller.checkAgentUsability({ purpose }),
      () => controller.checkAgentUsability({ purpose }),
    );
    agentCheckTailRef.current = checking.then(() => undefined, () => undefined);
    return checking;
  }, []);
  useEffect(() => {
    agentAvailabilityRef.current = qoderAvailability;
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
  const activeIntent = (conversation?.draftIntent ?? "discuss") as SidebarIntent;
  const activePurpose = sidebarAgentPurpose(activeIntent);
  const activePurposeRef = useRef(activePurpose);
  useEffect(() => {
    activePurposeRef.current = activePurpose;
  }, [activePurpose]);
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
    selectionRestoreGenerationRef.current += 1;
    let cancelled = false;
    const requestAgentCheck = (force = false) => {
      const status = agentAvailabilityRef.current?.status;
      if (!force && (status === "ready" || status === "checking")) return;
      const now = Date.now();
      if (
        agentCheckInFlightRef.current
        || now - agentCheckStartedAtRef.current < 1_500
      ) return;
      agentCheckStartedAtRef.current = now;
      const checking = queueAgentCheck(controller, activePurposeRef.current)
        .catch(() => undefined);
      agentCheckInFlightRef.current = checking;
      void checking.finally(() => {
        if (agentCheckInFlightRef.current === checking) {
          agentCheckInFlightRef.current = null;
        }
      });
    };
    void (async () => {
      await controller.openConversation({ projectId, documentId, sourcePath });
      const catalogOutcome = await controller.refreshAgentCatalog();
      if (cancelled) return;
      const pending = requestedIntentRef.current;
      const refreshedCatalog = catalogOutcome.status === "succeeded"
        ? (catalogOutcome.value as { catalog?: AgentCatalogSnapshot })?.catalog
        : null;
      if (pending && deferredIntentMatches(pending, identity)) {
        requestedIntentRef.current = null;
        controller.updateConversationDraftIntent(pending.intent);
      }
      const currentConversation = controller.getSnapshot().conversation;
      if (!currentConversation
        || !conversationReadyForDocument(currentConversation, projectId, documentId)) return;
      const restoreGeneration = selectionRestoreGenerationRef.current;
      await restoreConversationAgentSelection({
        controller,
        catalog: refreshedCatalog,
        persistedSelection: currentConversation.draftProviderSelection,
        purpose: sidebarAgentPurpose(currentConversation.draftIntent),
        checkUsability: (purpose) => queueAgentCheck(controller, purpose),
        isCurrent: () => (
          !cancelled
          && selectionRestoreGenerationRef.current === restoreGeneration
          && controllerRef.current === controller
          && conversationReadyForDocument(
            controller.getSnapshot().conversation,
            projectId,
            documentId,
          )
        ),
      });
    })();
    const handleReturnToApp = () => {
      if (document.visibilityState === "visible") requestAgentCheck();
    };
    window.addEventListener("focus", handleReturnToApp);
    document.addEventListener("visibilitychange", handleReturnToApp);
    return () => {
      cancelled = true;
      selectionRestoreGenerationRef.current += 1;
      window.removeEventListener("focus", handleReturnToApp);
      document.removeEventListener("visibilitychange", handleReturnToApp);
      // A choice made during this Document's load must not survive its drain and
      // later overwrite another Document (or unexpectedly reappear on return).
      if (deferredIntentMatches(requestedIntentRef.current, identity)) {
        requestedIntentRef.current = null;
      }
      void controller.flushConversationDraft().finally(() => {
        controller.closeConversation(identity);
      });
      // A read-only discussion turn is cancelled at this boundary rather than
      // left running against a Document the user is no longer looking at.
      void controller.drainDiscussionTurn();
      controller.closeDiscussionTurn();
    };
  }, [visible, projectId, documentId, sourcePath, controllerRef, queueAgentCheck]);

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
      selectionRestoreGenerationRef.current += 1;
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
      selectionRestoreGenerationRef.current += 1;
      controllerRef.current?.updateConversationDraftIntent(intent);
    } else {
      // The intent controls are visible while the first conversation load settles.
      // Preserve a quick user choice and apply it after that load restores the
      // persisted draft, for the same reason reveal(intent) defers its write.
      requestedIntentRef.current = { intent, projectId, documentId, sourcePath };
    }
    const controller = controllerRef.current;
    if (controller) void queueAgentCheck(controller, sidebarAgentPurpose(intent));
  }, [controllerRef, conversation, projectId, documentId, sourcePath, queueAgentCheck]);

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

  const providerChoices = useMemo(() => Object.values(agentCatalog?.providers || {})
    .filter((provider) => provider.capabilities?.[activePurpose] === true)
    .map((provider) => ({
      id: provider.providerId,
      label: provider.presentation.displayName,
      runtimeId: provider.runtimeId,
    })), [activePurpose, agentCatalog]);
  const selectedProvider = agentCatalog?.selected?.providerId || null;
  const providerChoiceState = useMemo(
    () => sidebarProviderChoiceState(providerChoices, selectedProvider),
    [providerChoices, selectedProvider],
  );
  const activeProvider = providerChoiceState.selectedProvider
    ? agentCatalog?.providers?.[providerChoiceState.selectedProvider]
    : null;
  const discussionProvider = discussionTurn?.selection?.providerId
    ? agentCatalog?.providers?.[discussionTurn.selection.providerId]
    : null;
  const runProviderId = activeRun?.agentDelivery?.selection?.providerId || null;
  const runProvider = runProviderId ? agentCatalog?.providers?.[runProviderId] : null;
  const runAgentName = String(
    runProvider?.presentation.agentName
      || runProviderId
      || activeProvider?.presentation.agentName
      || "Agent",
  );
  const discussionAgentName = String(
    discussionProvider?.presentation.agentName
      || activeProvider?.presentation.agentName
      || "Agent",
  );
  const modelChoices = useMemo(() => (activeProvider?.models || []).map((model) => ({
    id: String(model.id || ""),
    label: String(model.displayName || model.id || ""),
  })).filter((model) => model.id && model.label), [activeProvider]);
  const reasoningChoices = useMemo(() => (activeProvider?.reasoningEfforts || []).map((effort) => ({
    id: String(effort.id || ""),
    label: String(effort.displayName || effort.id || ""),
  })).filter((effort) => effort.id && effort.label), [activeProvider]);
  const onProviderChange = useCallback((providerId: string) => {
    const provider = agentCatalog?.providers?.[providerId];
    if (!provider) return;
    selectionRestoreGenerationRef.current += 1;
    const selected = controllerRef.current?.selectAgent(provider.selection);
    if (selected) {
      const rawDisplayName = (provider.models || []).find((model) => (
        model.id === selected.resolvedModelId || model.id === selected.requestedModelId
      ))?.displayName || null;
      const displayName = rawDisplayName ? String(rawDisplayName) : null;
      controllerRef.current?.updateConversationDraftAgentSelection(selected, displayName);
    }
    const controller = controllerRef.current;
    if (controller) void queueAgentCheck(controller, activePurpose);
  }, [activePurpose, agentCatalog, controllerRef, queueAgentCheck]);
  const onModelChange = useCallback((modelId: string) => {
    const currentSelection = agentCatalog?.selected;
    if (!currentSelection) return;
    selectionRestoreGenerationRef.current += 1;
    const nextSelection = controllerRef.current?.selectAgent({
      ...currentSelection,
      requestedModelId: modelId || null,
      resolvedModelId: modelId || null,
    });
    const displayName = modelChoices.find((model) => model.id === modelId)?.label || null;
    if (nextSelection) {
      controllerRef.current?.updateConversationDraftAgentSelection(nextSelection, displayName);
    }
    const controller = controllerRef.current;
    if (controller) void queueAgentCheck(controller, activePurpose);
  }, [activePurpose, agentCatalog, controllerRef, modelChoices, queueAgentCheck]);
  const onReasoningChange = useCallback((reasoning: string) => {
    const selected = agentCatalog?.selected;
    if (!selected) return;
    selectionRestoreGenerationRef.current += 1;
    const next = controllerRef.current?.selectAgent({
      ...selected,
      reasoning: reasoning
        ? { requested: reasoning, applied: reasoning, resolution: "exact" }
        : { requested: null, applied: null, resolution: "provider-default" },
    });
    if (next) {
      controllerRef.current?.updateConversationDraftAgentSelection(
        next,
        conversation?.draftModelDisplayName ?? null,
      );
    }
    const controller = controllerRef.current;
    if (controller) void queueAgentCheck(controller, activePurpose);
  }, [
    activePurpose,
    agentCatalog,
    controllerRef,
    conversation?.draftModelDisplayName,
    queueAgentCheck,
  ]);
  const onAgentAction = useCallback(() => {
    const kind = activeProvider?.presentation?.authAction
      && typeof activeProvider.presentation.authAction === "object"
      ? String((activeProvider.presentation.authAction as { kind?: unknown }).kind || "")
      : "";
    if (kind === "open-url" || kind === "show-device-code") {
      void (async () => {
        const controller = controllerRef.current;
        if (!controller) return;
        selectionRestoreGenerationRef.current += 1;
        const origin = {
          projectId,
          documentId,
          sourcePath,
          conversationId: conversation?.conversationId || null,
          generation: selectionRestoreGenerationRef.current,
        };
        const result = await controller.authenticateAgent();
        const currentConversation = controller.getSnapshot().conversation;
        if (
          result?.status !== "succeeded"
          || controllerRef.current !== controller
          || selectionRestoreGenerationRef.current !== origin.generation
          || currentConversation?.conversationId !== origin.conversationId
          || !conversationReadyForDocument(
            currentConversation,
            origin.projectId,
            origin.documentId,
          )
          || currentConversation.context?.sourcePath !== origin.sourcePath
        ) return;
        await restoreConversationAgentSelection({
          controller,
          catalog: controller.getSnapshot().run?.agentCatalog,
          persistedSelection: currentConversation.draftProviderSelection,
          purpose: activePurpose,
          checkUsability: (purpose) => queueAgentCheck(controller, purpose),
          isCurrent: () => (
            controllerRef.current === controller
            && selectionRestoreGenerationRef.current === origin.generation
            && conversationReadyForDocument(
              controller.getSnapshot().conversation,
              origin.projectId,
              origin.documentId,
            )
          ),
        });
      })();
      return;
    }
    if (kind === "retry") {
      const controller = controllerRef.current;
      if (controller) void queueAgentCheck(controller, activePurpose);
      return;
    }
    onOpenAgentSettings?.();
  }, [
    activeProvider,
    activePurpose,
    controllerRef,
    conversation,
    documentId,
    onOpenAgentSettings,
    projectId,
    queueAgentCheck,
    sourcePath,
  ]);

  const sidebarProps = useMemo(() => ({
    state,
    title: conversation?.title ?? "",
    messages: conversation?.messages ?? [],
    draftText,
    intent: (conversation?.draftIntent ?? "discuss") as SidebarIntent,
    // Qoder's availability is the model catalog's readiness: one owner supplies
    // both, so the Composer can never claim ready while the Agent is not.
    catalogStatus: (qoderAvailability?.status ?? "unavailable") as SidebarCatalogStatus,
    modelDisplayName: activeProvider ? agentModelDisplayName : null,
    modelChoiceCount: modelChoices.length,
    providerChoices,
    selectedProvider: providerChoiceState.selectedProvider,
    modelChoices,
    selectedModel: activeProvider
      ? agentCatalog?.selected?.resolvedModelId || agentCatalog?.selected?.requestedModelId || null
      : null,
    reasoningChoices,
    selectedReasoning: activeProvider
      ? agentCatalog?.selected?.reasoning.applied
        || agentCatalog?.selected?.reasoning.requested
        || null
      : null,
    agentName: String(activeProvider?.presentation.agentName || "Agent"),
    runAgentName,
    discussionAgentName,
    authActionLabel: activeProvider?.presentation.authAction
      && typeof activeProvider.presentation.authAction === "object"
      ? String((activeProvider.presentation.authAction as { label?: unknown }).label || "")
      : null,
    executionAvailable: activeProvider?.capabilities?.execution === true,
    onProviderChange,
    onModelChange,
    onReasoningChange,
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
    onOpenAgentSettings: onAgentAction,
  }), [
    state,
    conversation,
    draftText,
    qoderAvailability,
    agentModelDisplayName,
    agentCatalog,
    providerChoices,
    providerChoiceState,
    modelChoices,
    reasoningChoices,
    discussionTurn,
    discussionAgentName,
    runAgentName,
    pendingCommentCount,
    onDraftChange,
    onIntentChange,
    onSend,
    onCopyTask,
    onDecision,
    onCollapse,
    onAgentAction,
    onProviderChange,
    onModelChange,
    onReasoningChange,
  ]);

  return { open, visible, toggle, reveal, sidebarProps };
}
