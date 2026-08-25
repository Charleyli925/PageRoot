export type SidebarState =
  | "preview-discussion"
  | "preparing-delivery"
  | "processing"
  | "validating"
  | "ready-to-open"
  | "review-view"
  | "promoting"
  | "no-change";

export type SidebarIntent = "discuss" | "modify" | "continue";

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

export type SidebarIntentOption = {
  value: SidebarIntent;
  label: string;
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
  intent?: SidebarIntent | string,
): SidebarModePresentation;

export function sidebarActorInitial(actor: string): string;

export function sidebarActorLabel(actor: string): string;

export function sidebarMessageStream(
  messages: readonly unknown[],
): SidebarMessage[];

export function sidebarIntentOptions(state: string): SidebarIntentOption[];

export function sidebarResolvedIntent(
  state: string,
  requestedIntent: string,
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
  deliveryMode?: "qoder-acp" | "managed-agent" | "clipboard";
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

export function sidebarDeliveryDisclosure(intent?: SidebarIntent | string): string | null;

export function sidebarSendState(options?: {
  state?: string;
  catalogStatus?: SidebarCatalogStatus;
  hasText?: boolean;
  queued?: boolean;
  intent?: SidebarIntent;
  discussionBusy?: boolean;
  pendingCommentCount?: number;
}): SidebarSendState;

export function sidebarCopyTaskState(options?: {
  state?: string;
  queued?: boolean;
  pendingCommentCount?: number;
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

export type SidebarLiveReply = {
  actor: "qoder";
  actorLabel: string;
  text: string;
  truncated: boolean;
  interrupted: boolean;
  streaming: boolean;
};

export function sidebarLiveReply(
  discussion?: {
    status?: string;
    turnId?: string | null;
    replyText?: string;
    replyTruncated?: boolean;
    interrupted?: boolean;
  } | null,
  messages?: readonly unknown[],
): SidebarLiveReply | null;

export type SidebarDiscussionNotice = {
  tone: "progress" | "attention";
  text: string;
};

export function sidebarDiscussionNotice(discussion?: {
  status?: string;
  interrupted?: boolean;
  interruptedReason?: string | null;
} | null): SidebarDiscussionNotice | null;

export function sidebarDraftNotice(state: string): string | null;

export const SIDEBAR_STATES: ReadonlySet<string>;
export const INTENT_DISCUSS: "discuss";
export const INTENT_MODIFY: "modify";
export const INTENT_CONTINUE: "continue";
export const FORBIDDEN_MESSAGE_KEYS: readonly string[];
