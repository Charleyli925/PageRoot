export type SidebarState =
  | "preview-discussion"
  | "preparing-delivery"
  | "processing"
  | "validating"
  | "ready-to-open"
  | "review-view"
  | "promoting";

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
  canSend: boolean;
  label: string;
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

export function sidebarActorLabel(actor: string): string;

export function sidebarMessageStream(
  messages: readonly unknown[],
): SidebarMessage[];

export function sidebarIntentOptions(state: string): SidebarIntentOption[];

export function sidebarResolvedIntent(
  state: string,
  requestedIntent: string,
): SidebarIntent;

export function sidebarActionBar(options?: {
  state?: string;
  candidateVersionLabel?: string | null;
  candidateStatus?: string | null;
  failureMessage?: string | null;
}): SidebarActionBar | null;

export function sidebarSendState(options?: {
  state?: string;
  catalogStatus?: SidebarCatalogStatus;
  hasText?: boolean;
  queued?: boolean;
}): SidebarSendState;

export function sidebarDraftNotice(state: string): string | null;

export const SIDEBAR_STATES: ReadonlySet<string>;
export const INTENT_DISCUSS: "discuss";
export const INTENT_MODIFY: "modify";
export const INTENT_CONTINUE: "continue";
export const FORBIDDEN_MESSAGE_KEYS: readonly string[];
