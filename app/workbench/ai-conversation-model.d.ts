export type SidebarState =
  | "preview-ready"
  | "preparing-delivery"
  | "processing"
  | "validating"
  | "ready-to-open"
  | "review-view"
  | "promoting"
  | "no-change";

export type SidebarIntent = "modify" | "continue";

export type SidebarModePresentation = {
  label: string;
  detail: string;
};

export type SidebarMessage = {
  messageId: string;
  actor: string;
  actorLabel: string;
  kind: string;
  status: string;
  text: string;
  truncated: boolean;
  sequence: number;
  createdAt: string;
  modelDisplayName: string | null;
};

export type SidebarAction = {
  id: string;
  label: string;
  tone: "primary" | "quiet";
};

export type SidebarActionBar = {
  kind: "decision" | "progress" | "blocked";
  title: string;
  detail: string;
  actions: SidebarAction[];
};

export type SidebarSendState = {
  kind: "send" | "open-agent-settings" | "status";
  canSend: boolean;
  label: string;
  reason: string | null;
};

export type SidebarCopyTaskState = {
  canCopy: boolean;
  reason: string | null;
};

export type SidebarCatalogStatus =
  | "checking"
  | "ready"
  | "auth-required"
  | "not-installed"
  | "unavailable";

export function sidebarModePresentation(
  state: string,
): SidebarModePresentation;

export function sidebarActorInitial(actor: string): string;

export function sidebarActorLabel(actor: string): string;

export function sidebarMessageStream(
  messages: readonly unknown[],
): SidebarMessage[];

export function sidebarResolvedIntent(
  state: string,
): SidebarIntent;

export function conversationReadyForDocument(
  conversation: {
    status?: string;
    context?: {
      projectId?: string;
      documentId?: string;
    } | null;
  } | null,
  projectId: string,
  documentId: string,
): boolean;

export function conversationLoadedForView(conversation: {
  status?: string;
  context?: {
    projectId?: string;
    documentId?: string;
  } | null;
} | null): boolean;

export function sidebarActionBar(options?: {
  state?: string;
  candidateVersionLabel?: string | null;
  candidateStatus?: string | null;
  failureMessage?: string | null;
  deliveryMode?: "managed-agent" | "clipboard";
}): SidebarActionBar | null;

export type SidebarRunProgressStep = {
  key: string;
  label: string;
  detail: string | null;
  state: string;
};

export type SidebarRunProgress = {
  steps: readonly SidebarRunProgressStep[];
  headline: string | null;
  /** What the Agent is saying while it works; null when it has said nothing. */
  narration: string | null;
  /** The same words split into the paragraphs the Agent actually wrote. */
  narrationBlocks: readonly string[] | null;
  /** The stage actually running, for callers that need to name it. */
  liveLabel: string | null;
  tone: "attention" | "quiet";
};

export function sidebarRunProgress(options?: {
  state?: string;
  steps?: readonly unknown[];
  agentText?: string;
}): SidebarRunProgress | null;

export function sidebarDeliveryDisclosure(
  intent?: SidebarIntent | string,
  options?: { agentName?: string; localReadDisclosure?: string | null },
): string | null;

export function sidebarSendState(options?: {
  state?: string;
  catalogStatus?: SidebarCatalogStatus;
  queued?: boolean;
  intent?: SidebarIntent;
  pendingCommentCount?: number;
  agentName?: string;
  agentSettingsName?: string;
  agentSettingsSupported?: boolean;
}): SidebarSendState;

export function sidebarCopyTaskState(options?: {
  state?: string;
  queued?: boolean;
  pendingCommentCount?: number;
  agentName?: string;
}): SidebarCopyTaskState;

export function sidebarStateFromRun(options?: {
  activeRun?: { status?: string } | null;
  submissionPending?: boolean;
  reviewing?: boolean;
}): string;

export type SidebarModelLine = {
  kind: "checking" | "name";
  text: string;
  choosable: boolean;
};

export function sidebarModelLine(options?: {
  catalogStatus?: SidebarCatalogStatus;
  modelDisplayName?: string | null;
  modelChoiceCount?: number;
}): SidebarModelLine | null;

export const SIDEBAR_STATES: ReadonlySet<string>;
export const INTENT_MODIFY: "modify";
export const INTENT_CONTINUE: "continue";
export const FORBIDDEN_MESSAGE_KEYS: readonly string[];
