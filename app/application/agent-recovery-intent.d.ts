export type AgentRecoverySurface = "sidebar" | "settings" | "send";
export type AgentRecoveryField = "apiKey" | "login" | "model" | "install";

export type AgentRecoveryIntent = Readonly<{
  originSurface: AgentRecoverySurface;
  projectId: string | null;
  documentId: string | null;
  requestId: string | null;
  attemptId: string | null;
  providerId: "pageroot" | "qoder" | "codex" | null;
  targetField: AgentRecoveryField | null;
  errorKind: string | null;
  draftIdentity: string | null;
  configurationGeneration: number | null;
}>;

export type SidebarRecoveryBar = Readonly<{
  kind: "repair" | "restored" | "restored-elsewhere";
  title: string;
  detail: string;
  primary: Readonly<{ id: string; label: string }>;
  secondary: Readonly<{ id: string; label: string }> | null;
}>;

export function createAgentRecoveryIntent(input?: {
  originSurface?: AgentRecoverySurface;
  projectId?: string | null;
  documentId?: string | null;
  requestId?: string | null;
  attemptId?: string | null;
  providerId?: string | null;
  targetField?: AgentRecoveryField | null;
  errorKind?: string | null;
  draftIdentity?: string | null;
  configurationGeneration?: number | null;
}): AgentRecoveryIntent;

export function recoveryIntentMatchesDocument(
  intent: AgentRecoveryIntent | null | undefined,
  ids?: { projectId?: string | null; documentId?: string | null },
): boolean;

export function sidebarRecoveryBar(options?: {
  intent?: AgentRecoveryIntent | null;
  catalogStatus?: string;
  credentialKind?: "api-token" | null;
  currentProjectId?: string | null;
  currentDocumentId?: string | null;
}): SidebarRecoveryBar | null;
