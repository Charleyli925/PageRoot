export type ConversationContext = {
  projectId: string;
  documentId: string;
  sourcePath: string;
};

export type ConversationDraftProjection = {
  schemaVersion?: string;
  conversationId?: string;
  revision?: number;
  updatedAt?: string;
  text: string;
  intent: string;
  modelId?: string | null;
  providerSelection?: import("../domain/agent-provider-state.js").AgentSelection | null;
  modelDisplayName?: string | null;
  deliveryMode?: string;
};

export type ConversationProjection = {
  conversationId: string;
  projectId: string;
  documentId: string;
  title: string;
  status: string;
  revision: number;
  lastSequence: number;
  activeContextId: string | null;
  contexts: unknown[];
  turns: unknown[];
  messages: unknown[];
};

export type ConversationSessionStatus =
  | "idle"
  | "loading"
  | "ready"
  | "failed";

export type ConversationSessionSnapshot = Readonly<{
  context: ConversationContext | null;
  conversation: ConversationProjection | null;
  draft: ConversationDraftProjection | null;
  status: ConversationSessionStatus;
  error: unknown;
  atMessageLimit: boolean;
  messages: readonly unknown[];
  conversationId: string | null;
  title: string;
  draftText: string;
  draftIntent: string;
  draftProviderSelection: import("../domain/agent-provider-state.js").AgentSelection | null;
  draftModelDisplayName: string | null;
}>;

export class ConversationSession {
  setObserver(
    observer: ((snapshot: ConversationSessionSnapshot) => void) | null,
  ): void;
  subscribe(
    listener: (snapshot: ConversationSessionSnapshot) => void,
  ): () => void;
  readonly snapshot: ConversationSessionSnapshot;
  isActive(context: ConversationContext | null): boolean;
  beginLoad(context: ConversationContext | null): ConversationSessionSnapshot;
  publish(
    context: ConversationContext,
    value: {
      conversation?: ConversationProjection | null;
      draft?: ConversationDraftProjection | null;
      atMessageLimit?: boolean;
    },
  ): boolean;
  fail(context: ConversationContext, error: unknown): boolean;
  setDraftText(text: string): boolean;
  setDraftIntent(intent: string): boolean;
  setDraftAgentSelection(
    selection: import("../domain/agent-provider-state.js").AgentSelection,
    modelDisplayName?: string | null,
  ): boolean;
  acknowledgeDraft(
    context: ConversationContext,
    draft: ConversationDraftProjection,
  ): boolean;
  deactivate(): void;
}
