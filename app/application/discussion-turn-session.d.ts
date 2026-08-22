export type DiscussionTurnContext = {
  projectId: string;
  documentId: string;
  sourcePath: string;
};

export type DiscussionTurnProjection = {
  driver: string;
  state: string;
  phase: string;
  conversationId: string | null;
  turnId: string;
  sourceSha256: string;
  startedAt: string;
  updatedAt: string;
  agentName: string | null;
  agentVersion: string | null;
  eventCount: number;
  replyText: string;
  replyTruncated: boolean;
  interrupted: boolean;
  interruptedReason?: string;
  errorCode?: string;
  errorMessage?: string;
};

export type DiscussionTurnSnapshot = {
  context: DiscussionTurnContext | null;
  status: string;
  turn: DiscussionTurnProjection | null;
  error: unknown;
  conversationId: string | null;
  turnId: string | null;
  sourceSha256: string | null;
  phase: string | null;
  replyText: string;
  replyTruncated: boolean;
  interrupted: boolean;
  interruptedReason: string | null;
  busy: boolean;
};

export class DiscussionTurnSession {
  readonly snapshot: DiscussionTurnSnapshot;
  setObserver(observer: ((snapshot: DiscussionTurnSnapshot) => void) | null): void;
  subscribe(listener: (snapshot: DiscussionTurnSnapshot) => void): () => void;
  isActive(context: DiscussionTurnContext | null): boolean;
  beginTurn(
    context: DiscussionTurnContext | null,
    options?: { conversationId?: string | null },
  ): DiscussionTurnSnapshot;
  publish(
    context: DiscussionTurnContext | null,
    turn: DiscussionTurnProjection | null,
  ): boolean;
  fail(context: DiscussionTurnContext | null, error: unknown): boolean;
  deactivate(): void;
}

export const DISCUSSION_LIVE_STATES: string[];
