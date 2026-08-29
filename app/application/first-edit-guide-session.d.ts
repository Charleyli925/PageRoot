export const FIRST_REAL_HTML_EDIT_GUIDE_GENERATION: 2;
export const FIRST_EDIT_GUIDE_PRESENT_DWELL_MS: 800;

export type FirstEditGuideStatus = "pending" | "presented" | "dismissed";

export type FirstEditGuideSnapshot = Readonly<{
  loaded: boolean;
  available: boolean;
  status: FirstEditGuideStatus;
  generation: number;
  builtInWelcomeProjectId: string | null;
  visible: boolean;
}>;

export type FirstEditGuideEligibilityInput = Readonly<{
  desktop?: boolean;
  browserPreviewOnly?: boolean;
  canvasMode?: "edit" | "preview";
  canvasVerified?: boolean;
  viewMode?: "current" | "history";
  blockingOverlay?: boolean;
  interactionLocked?: boolean;
  runInProgress?: boolean;
  projectId?: string | null;
}>;

export type FirstEditGuidePreferences = Readonly<{
  schemaVersion?: number;
  firstRealHtmlEditGuide?: Readonly<{
    status?: FirstEditGuideStatus;
    generation?: number;
  }>;
  builtInWelcomeProjectId?: string | null;
  workspace?: Readonly<{
    rememberPanelWidths?: boolean;
    sidebarWidth?: number;
    inspectorWidth?: number;
    motion?: "system" | "reduced";
    restoreTabsOnLaunch?: boolean;
    defaultAgentProviderId?: "qoder" | "codex";
  }>;
}>;

export type FirstEditGuidePort = Readonly<{
  get(): Promise<FirstEditGuidePreferences | null | undefined>;
  record(input: {
    action: "presented" | "dismissed";
  } | {
    workspace: Readonly<Record<string, unknown>>;
  }): Promise<
    FirstEditGuidePreferences | null | undefined
  >;
}>;

export function isFirstEditGuideEligible(
  input: FirstEditGuideEligibilityInput | null | undefined,
  snapshot: FirstEditGuideSnapshot | null | undefined,
): boolean;

export class FirstEditGuideSession {
  constructor(options?: {
    port?: FirstEditGuidePort | null;
    scheduler?: {
      setTimeout(callback: () => void, delayMs: number): unknown;
      clearTimeout(handle: unknown): void;
    };
  });
  readonly snapshot: FirstEditGuideSnapshot;
  subscribe(listener: (snapshot: FirstEditGuideSnapshot) => void): () => void;
  load(): Promise<FirstEditGuideSnapshot>;
  evaluate(input: FirstEditGuideEligibilityInput): FirstEditGuideSnapshot;
  markPresented(): Promise<FirstEditGuideSnapshot>;
  dismiss(): Promise<FirstEditGuideSnapshot>;
  dispose(): void;
}
