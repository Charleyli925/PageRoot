type UiPreferencesSnapshot = {
  firstRealHtmlEditGuide?: {
    status?: "pending" | "presented" | "dismissed";
    generation?: number;
  };
  builtInWelcomeProjectId?: string | null;
};

/** The renderer receives only the application-owned get/record port. */
export type DesktopUiPreferencesApi = {
  get(): Promise<UiPreferencesSnapshot | null | undefined>;
  record(input: {
    action: "presented" | "dismissed";
  }): Promise<UiPreferencesSnapshot | null | undefined>;
};

declare global {
  interface Window {
    htmlAIUiPreferences?: DesktopUiPreferencesApi;
  }
}
