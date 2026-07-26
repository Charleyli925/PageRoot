import type { BridgeClient, BridgeJson } from "./bridge-client.js";
import type { AuthoritativeDraft } from "../domain/draft-aggregate.js";

export type DraftContext = {
  epoch: number;
  projectId: string;
  documentId: string;
  sourcePath: string;
};

export type DraftSnapshot<TComment = unknown, TEvent = unknown> =
  DraftContext & {
    operationId: string;
    basedOnVersionId: string | null;
    expectedDraftRevision: number;
    comments: TComment[];
    changeEvents: TEvent[];
    deletedCommentIds: string[];
  };

export type DraftSessionEvent<TComment = unknown, TEvent = unknown> =
  | {
      type: "acknowledged" | "retired";
      write: DraftSnapshot<TComment, TEvent>;
      authoritative: AuthoritativeDraft;
      rebaseCount: number;
      replayed: boolean;
    }
  | {
      type: "failed" | "retired-failure";
      write: DraftSnapshot<TComment, TEvent>;
      error: unknown;
    };

export class DraftSession<TComment = unknown, TEvent = unknown> {
  constructor(options: {
    bridgeClient: BridgeClient;
    encodeComment?: (value: TComment) => BridgeJson;
    encodeChangeEvent?: (value: TEvent) => BridgeJson;
    maxRebases?: number;
  });
  setObserver(
    observer: ((event: DraftSessionEvent<TComment, TEvent>) => void) | null,
  ): void;
  activate(
    context: DraftContext,
    authoritativeRevision?: number,
    authoritativeDraft?: unknown,
  ): boolean;
  replaceAuthority(
    context: DraftContext,
    authoritativeRevision?: number,
    authoritativeDraft?: unknown,
  ): boolean;
  deactivate(): void;
  isActive(context: DraftContext): boolean;
  readonly revision: number;
  readonly context: DraftContext | null;
  readonly lastError: unknown;
  createSnapshot(options: {
    context?: DraftContext;
    basedOnVersionId?: string | null;
    comments?: TComment[];
    changeEvents?: TEvent[];
    deletedCommentIds?: Iterable<string>;
    operationId?: string;
  }): DraftSnapshot<TComment, TEvent> | null;
  queue(snapshot: DraftSnapshot<TComment, TEvent>): boolean;
  inspect(): {
    active: boolean;
    revision: number;
    pending: boolean;
    writing: boolean;
    error: unknown;
  };
  drain(snapshot?: DraftSnapshot<TComment, TEvent>): Promise<boolean>;
}
