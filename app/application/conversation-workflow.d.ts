import type { BridgeClient } from "./bridge-client.js";
import type {
  ConversationContext,
  ConversationSession,
} from "./conversation-session.js";

export type ConversationTimerHost = {
  setTimeout: (handler: () => void, delayMs: number) => unknown;
  clearTimeout: (handle: unknown) => void;
};

export class ConversationWorkflow {
  constructor(options: {
    bridgeClient: BridgeClient;
    conversationSession: ConversationSession;
    draftDelayMs?: number;
    timerHost?: ConversationTimerHost;
  });
  readonly session: ConversationSession;
  open(context: ConversationContext | null): Promise<unknown>;
  close(context?: ConversationContext | null): boolean;
  listConversations(
    context: ConversationContext | null,
  ): Promise<unknown>;
  updateDraftText(text: string): void;
  updateDraftIntent(intent: string): void;
  updateDraftAgentSelection(
    selection: import("../domain/agent-provider-state.js").AgentSelection,
    modelDisplayName?: string | null,
  ): void;
  flushDraft(): Promise<void>;
}

export const DRAFT_AUTOSAVE_DELAY_MS: number;
