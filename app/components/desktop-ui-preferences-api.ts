export type WorkspacePreferences = {
  rememberPanelWidths: boolean;
  sidebarWidth: number;
  inspectorWidth: number;
  motion: "system" | "reduced";
  restoreTabsOnLaunch: boolean;
  defaultAgentProviderId: "pageroot" | "qoder" | "codex";
  disabledAgentProviderIds: ReadonlyArray<"pageroot" | "qoder" | "codex">;
};

export type UiPreferencesSnapshot = {
  schemaVersion?: number;
  firstRealHtmlEditGuide?: {
    status?: "pending" | "presented" | "dismissed";
    generation?: number;
  };
  builtInWelcomeProjectId?: string | null;
  workspace?: Partial<WorkspacePreferences>;
};

export type UiWorkspacePreferencePatch = Partial<WorkspacePreferences>;

/** The renderer receives only the application-owned get/record port. */
export type DesktopUiPreferencesApi = {
  get(): Promise<UiPreferencesSnapshot | null | undefined>;
  record(input: {
    action: "presented" | "dismissed";
  } | {
    workspace: UiWorkspacePreferencePatch;
  }): Promise<UiPreferencesSnapshot | null | undefined>;
};

declare global {
  interface Window {
    htmlAIUiPreferences?: DesktopUiPreferencesApi;
  }
}
