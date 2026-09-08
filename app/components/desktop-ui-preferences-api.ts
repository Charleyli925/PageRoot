export type WorkspacePreferences = {
  rememberPanelWidths: boolean;
  sidebarWidth: number;
  inspectorWidth: number;
  motion: "system" | "reduced";
  restoreTabsOnLaunch: boolean;
  defaultAgentProviderId: "pageroot" | "qoder" | "codex";
  documentAgentSelections: Readonly<Record<string, "pageroot" | "qoder" | "codex">>;
  agentConfigurations: Readonly<Record<string, Readonly<{ modelId: string | null; reasoning: string | null }>>>;
  disabledAgentProviderIds: ReadonlyArray<"pageroot" | "qoder" | "codex">;
};

export type UiPreferencesSnapshot = {
  schemaVersion?: number;
  workspace?: Partial<WorkspacePreferences>;
};

export type UiWorkspacePreferencePatch = Partial<WorkspacePreferences>;

/** The renderer receives only the application-owned get/record port. */
export type DesktopUiPreferencesApi = {
  get(): Promise<UiPreferencesSnapshot | null | undefined>;
  record(input: {
    workspace: UiWorkspacePreferencePatch;
  }): Promise<UiPreferencesSnapshot | null | undefined>;
};

declare global {
  interface Window {
    htmlAIUiPreferences?: DesktopUiPreferencesApi;
  }
}
