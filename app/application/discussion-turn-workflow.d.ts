import type { BridgeClient } from "./bridge-client.js";
import type {
  DiscussionTurnContext,
  DiscussionTurnSession,
  DiscussionTurnSnapshot,
} from "./discussion-turn-session.js";

export type DiscussionTurnTicket = {
  preflightId: string;
  trustPolicyAccepted: string;
  driver?: string;
};

export type DiscussionTurnScheduler = {
  setInterval: (handler: () => void, delayMs: number) => unknown;
  clearInterval: (handle: unknown) => void;
};

export class DiscussionTurnWorkflow {
  constructor(options: {
    bridgeClient: BridgeClient;
    discussionTurnSession: DiscussionTurnSession;
    requestTicket: () => Promise<DiscussionTurnTicket | null>;
    onSettled?: ((context: DiscussionTurnContext) => void) | null;
    scheduler?: DiscussionTurnScheduler;
    pollIntervalMs?: number;
  });
  readonly session: DiscussionTurnSession;
  readonly polling: boolean;
  start(
    context: DiscussionTurnContext | null,
    options?: {
      question?: string;
      conversationId?: string | null;
      expectedSourceSha256?: string | null;
    },
  ): Promise<unknown>;
  pollNow(options?: { generation?: number }): Promise<DiscussionTurnSnapshot | null>;
  cancel(): Promise<DiscussionTurnSnapshot | null>;
  drain(): Promise<void>;
  close(): void;
  dispose(): void;
}

export const DISCUSSION_POLL_INTERVAL_MS: number;
