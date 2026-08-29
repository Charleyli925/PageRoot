"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { AgentSelection } from "../domain/agent-provider-state.js";
import type { DesktopUiPreferencesApi } from "../components/desktop-ui-preferences-api";
import {
  WorkspacePreferencesSession,
  type WorkspacePreferences,
  type WorkspacePreferencesSnapshot,
} from "../application/workspace-preferences-session.js";

type AgentCatalogSnapshot = Readonly<{
  providers: Readonly<Record<string, Readonly<{
    providerId: string;
    runtimeId: string;
    selection: AgentSelection;
  }>>>;
  selected: Readonly<{ providerId: string }> | null;
}>;

export function useWorkspacePreferences(
  api: DesktopUiPreferencesApi | undefined,
  {
    workspaceController = null,
    agentCatalogSnapshot = null,
  }: {
    workspaceController?: Readonly<{
      selectAgent(selection: AgentSelection): AgentSelection;
    }> | null;
    agentCatalogSnapshot?: AgentCatalogSnapshot | null;
  } = {},
): Readonly<{
  snapshot: WorkspacePreferencesSnapshot;
  panelWidths: Readonly<{ sidebarWidth: number; inspectorWidth: number }>;
  update(patch: Partial<WorkspacePreferences>): Promise<boolean>;
  commitPanelWidth(kind: "sidebar" | "inspector", width: number): void;
  retry(): boolean;
  flush(deadlineAt: number): Promise<boolean>;
}> {
  const session = useMemo(
    () => new WorkspacePreferencesSession({
      port: api
        ? {
          get: () => api.get(),
          record: (input) => api.record(input as Parameters<DesktopUiPreferencesApi["record"]>[0]),
        }
        : null,
    }),
    [api],
  );
  const [snapshot, setSnapshot] = useState<WorkspacePreferencesSnapshot>(session.snapshot);
  const [panelWidths, setPanelWidths] = useState({
    sidebarWidth: session.snapshot.workspace.sidebarWidth,
    inspectorWidth: session.snapshot.workspace.inspectorWidth,
  });
  const loadedSessionRef = useRef<WorkspacePreferencesSession | null>(null);
  const defaultAgentAppliedRef = useRef("");

  const handleSessionSnapshot = useCallback((nextSnapshot: WorkspacePreferencesSnapshot) => {
    setSnapshot(nextSnapshot);
    if (nextSnapshot.loaded && loadedSessionRef.current !== session) {
      loadedSessionRef.current = session;
      setPanelWidths({
        sidebarWidth: nextSnapshot.workspace.sidebarWidth,
        inspectorWidth: nextSnapshot.workspace.inspectorWidth,
      });
    }
  }, [session]);

  useEffect(() => {
    const unsubscribe = session.subscribe(handleSessionSnapshot);
    void session.load();
    return () => {
      unsubscribe();
      session.dispose();
    };
  }, [handleSessionSnapshot, session]);

  const update = useCallback((patch: Partial<WorkspacePreferences>) => {
    const nextPatch = { ...patch };
    const rememberPanelWidths = patch.rememberPanelWidths
      ?? snapshot.workspace.rememberPanelWidths;
    if (patch.rememberPanelWidths === true && !snapshot.workspace.rememberPanelWidths) {
      nextPatch.sidebarWidth ??= panelWidths.sidebarWidth;
      nextPatch.inspectorWidth ??= panelWidths.inspectorWidth;
    }
    if (typeof patch.sidebarWidth === "number") {
      setPanelWidths((current) => ({ ...current, sidebarWidth: patch.sidebarWidth! }));
    }
    if (typeof patch.inspectorWidth === "number") {
      setPanelWidths((current) => ({ ...current, inspectorWidth: patch.inspectorWidth! }));
    }
    if (!rememberPanelWidths) {
      delete nextPatch.sidebarWidth;
      delete nextPatch.inspectorWidth;
    }
    if (!Object.keys(nextPatch).length) return Promise.resolve(true);
    return session.update(nextPatch);
  }, [panelWidths.inspectorWidth, panelWidths.sidebarWidth, session, snapshot.workspace.rememberPanelWidths]);
  const commitPanelWidth = useCallback((kind: "sidebar" | "inspector", width: number) => {
    setPanelWidths((current) => ({
      ...current,
      [kind === "sidebar" ? "sidebarWidth" : "inspectorWidth"]: width,
    }));
    if (!snapshot.workspace.rememberPanelWidths) return;
    void session.update(
      kind === "sidebar" ? { sidebarWidth: width } : { inspectorWidth: width },
    );
  }, [session, snapshot.workspace.rememberPanelWidths]);
  useEffect(() => {
    if (!workspaceController || !snapshot.loaded || !agentCatalogSnapshot) return;
    const availableProviders = Object.values(agentCatalogSnapshot.providers);
    const preferred = availableProviders.find((provider) => (
      provider.providerId === snapshot.workspace.defaultAgentProviderId
    )) || availableProviders[0];
    if (!preferred) return;
    const preferredProviderId = preferred.providerId === "codex" ? "codex" : "qoder";
    const applyKey = `${snapshot.workspace.defaultAgentProviderId}:${preferred.providerId}:${preferred.runtimeId}`;
    if (defaultAgentAppliedRef.current === applyKey) return;
    defaultAgentAppliedRef.current = applyKey;
    if (preferredProviderId !== snapshot.workspace.defaultAgentProviderId) {
      void session.update({ defaultAgentProviderId: preferredProviderId });
    }
    if (agentCatalogSnapshot.selected?.providerId !== preferred.providerId) {
      workspaceController.selectAgent(preferred.selection);
    }
  }, [agentCatalogSnapshot, session, snapshot.loaded, snapshot.workspace.defaultAgentProviderId, workspaceController]);
  const retry = useCallback(() => session.retry(), [session]);
  const flush = useCallback(
    (deadlineAt: number) => session.flush({ deadlineAt }),
    [session],
  );
  return { snapshot, panelWidths, update, commitPanelWidth, retry, flush };
}
