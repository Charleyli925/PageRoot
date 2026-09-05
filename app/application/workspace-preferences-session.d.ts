export type WorkspacePreferenceMotion = "system" | "reduced";
export type WorkspacePreferenceAgentId = "pageroot" | "qoder" | "codex";

export type WorkspacePreferences = Readonly<{
  rememberPanelWidths: boolean;
  sidebarWidth: number;
  inspectorWidth: number;
  motion: WorkspacePreferenceMotion;
  restoreTabsOnLaunch: boolean;
  defaultAgentProviderId: WorkspacePreferenceAgentId;
  disabledAgentProviderIds: readonly WorkspacePreferenceAgentId[];
}>;

export type WorkspacePreferencesSnapshot = Readonly<{
  loaded: boolean;
  saving: boolean;
  error: string | null;
  workspace: WorkspacePreferences;
}>;

export const DEFAULT_WORKSPACE_PREFERENCES: WorkspacePreferences;
export const WORKSPACE_PREFERENCE_LIMITS: Readonly<{
  sidebarWidth: Readonly<{ min: 200; max: 420 }>;
  inspectorWidth: Readonly<{ min: 280; max: 520 }>;
}>;
export function normalizeWorkspacePreferences(value: unknown): WorkspacePreferences;
export function normalizeWorkspacePatch(value: unknown): Readonly<Partial<WorkspacePreferences>>;

export class WorkspacePreferencesSession {
  constructor(options?: {
    port?: Readonly<{
      get(): Promise<unknown>;
      record(input: Readonly<{ workspace: Readonly<Record<string, unknown>> }>): Promise<unknown>;
    }> | null;
    clock?: Readonly<{ now(): number }>;
  });
  readonly snapshot: WorkspacePreferencesSnapshot;
  subscribe(listener: (snapshot: WorkspacePreferencesSnapshot) => void): () => void;
  load(): Promise<WorkspacePreferencesSnapshot>;
  update(patch: Readonly<Partial<WorkspacePreferences>>): Promise<boolean>;
  retry(): boolean;
  flush(input?: { deadlineAt?: number }): Promise<boolean>;
  dispose(): void;
}
