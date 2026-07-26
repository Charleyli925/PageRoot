import {
  createDraftOperationId,
  normalizeAuthoritativeDraft,
  operationWasApplied,
  rebaseDraftMutation,
} from "../domain/draft-aggregate.js";
import { isBridgeRequestError } from "./bridge-client.js";

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizedRevision(value) {
  const revision = Number(value);
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : 0;
}

function sameContext(left, right) {
  return Boolean(
    left
    && right
    && left.epoch === right.epoch
    && left.projectId === right.projectId
    && left.documentId === right.documentId
    && left.sourcePath === right.sourcePath,
  );
}

function copyContext(context) {
  if (
    !context
    || !Number.isSafeInteger(Number(context.epoch))
    || !String(context.projectId || "")
    || !String(context.documentId || "")
    || !String(context.sourcePath || "")
  ) {
    return null;
  }
  return Object.freeze({
    epoch: Number(context.epoch),
    projectId: String(context.projectId),
    documentId: String(context.documentId),
    sourcePath: String(context.sourcePath),
  });
}

function authoritativeFromWorkspace(workspace) {
  const runtime = isRecord(workspace?.runtimeState)
    ? workspace.runtimeState
    : {};
  return isRecord(runtime.draft)
    ? runtime.draft
    : workspace?.activeDraft;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => [key, stableValue(value[key])]),
  );
}

function draftFingerprint({
  comments = [],
  changeEvents = [],
  deletedCommentIds = [],
}) {
  return JSON.stringify(stableValue({
    comments,
    changeEvents,
    deletedCommentIds: [...new Set(
      deletedCommentIds.map(String).filter(Boolean),
    )].sort(),
  }));
}

export class DraftSession {
  #bridgeClient;

  #encodeComment;

  #encodeChangeEvent;

  #maxRebases;

  #observer = null;

  #activeContext = null;

  #revision = 0;

  #pending = null;

  #drainPromise = null;

  #lastError = null;

  #generation = 0;

  #acknowledgedFingerprint = null;

  #acknowledgedDraft = null;

  constructor({
    bridgeClient,
    encodeComment = (value) => value,
    encodeChangeEvent = (value) => value,
    maxRebases = 3,
  }) {
    if (!bridgeClient || typeof bridgeClient.saveDraft !== "function") {
      throw new TypeError("DraftSession requires a Bridge client.");
    }
    this.#bridgeClient = bridgeClient;
    this.#encodeComment = encodeComment;
    this.#encodeChangeEvent = encodeChangeEvent;
    this.#maxRebases = Math.max(0, Number(maxRebases) || 0);
  }

  setObserver(observer) {
    this.#observer = typeof observer === "function" ? observer : null;
  }

  #emit(event) {
    try {
      this.#observer?.(event);
    } catch {
      // UI observers cannot change the persistence outcome.
    }
  }

  activate(context, authoritativeRevision = 0, authoritativeDraft) {
    const nextContext = copyContext(context);
    if (!nextContext) {
      this.deactivate();
      return false;
    }
    if (!sameContext(this.#activeContext, nextContext)) {
      this.#generation += 1;
      this.#pending = null;
      this.#lastError = null;
      this.#activeContext = nextContext;
      this.#revision = normalizedRevision(authoritativeRevision);
      this.#acknowledgedDraft = authoritativeDraft
        ? normalizeAuthoritativeDraft(authoritativeDraft)
        : null;
      this.#acknowledgedFingerprint = this.#acknowledgedDraft
        ? draftFingerprint(this.#acknowledgedDraft)
        : null;
      return true;
    }
    this.#revision = Math.max(
      this.#revision,
      normalizedRevision(authoritativeRevision),
    );
    if (authoritativeDraft) {
      this.#acknowledgedDraft = normalizeAuthoritativeDraft(
        authoritativeDraft,
      );
      this.#acknowledgedFingerprint = draftFingerprint(
        this.#acknowledgedDraft,
      );
    }
    return true;
  }

  replaceAuthority(context, authoritativeRevision = 0, authoritativeDraft) {
    const nextContext = copyContext(context);
    if (!nextContext) {
      this.deactivate();
      return false;
    }
    this.#generation += 1;
    this.#pending = null;
    this.#lastError = null;
    this.#activeContext = nextContext;
    this.#revision = normalizedRevision(authoritativeRevision);
    this.#acknowledgedDraft = authoritativeDraft
      ? normalizeAuthoritativeDraft(authoritativeDraft)
      : null;
    this.#acknowledgedFingerprint = this.#acknowledgedDraft
      ? draftFingerprint(this.#acknowledgedDraft)
      : null;
    return true;
  }

  deactivate() {
    this.#generation += 1;
    this.#activeContext = null;
    this.#revision = 0;
    this.#pending = null;
    this.#lastError = null;
    this.#acknowledgedFingerprint = null;
    this.#acknowledgedDraft = null;
  }

  isActive(context) {
    return sameContext(this.#activeContext, context);
  }

  get revision() {
    return this.#revision;
  }

  get context() {
    return this.#activeContext
      ? Object.freeze({ ...this.#activeContext })
      : null;
  }

  get lastError() {
    return this.#lastError;
  }

  createSnapshot({
    context = this.#activeContext,
    basedOnVersionId = null,
    comments = [],
    changeEvents = [],
    deletedCommentIds = [],
    operationId,
  }) {
    if (!sameContext(this.#activeContext, context)) return null;
    return {
      ...this.#activeContext,
      operationId: String(operationId || createDraftOperationId()),
      basedOnVersionId: basedOnVersionId
        ? String(basedOnVersionId)
        : null,
      expectedDraftRevision: this.#revision,
      comments: [...comments],
      changeEvents: [...changeEvents],
      deletedCommentIds: [...new Set(
        [...deletedCommentIds].map(String).filter(Boolean),
      )],
    };
  }

  queue(snapshot) {
    if (!sameContext(this.#activeContext, snapshot)) return false;
    const encoded = {
      comments: snapshot.comments.map(this.#encodeComment),
      changeEvents: snapshot.changeEvents.map(this.#encodeChangeEvent),
      deletedCommentIds: snapshot.deletedCommentIds,
    };
    // Tombstones are durable authority metadata, while comments and edit
    // events are replacement aggregate fields. Projecting only the tombstones
    // keeps an acknowledged deletion dominant without hiding a later removal
    // such as undoing an already acknowledged direct edit.
    const fingerprint = draftFingerprint(
      this.#acknowledgedDraft
        ? rebaseDraftMutation(encoded, {
            draftRevision: this.#acknowledgedDraft.draftRevision,
            deletedCommentIds: this.#acknowledgedDraft.deletedCommentIds,
          })
        : encoded,
    );
    if (
      !this.#pending
      && !this.#lastError
      && fingerprint === this.#acknowledgedFingerprint
    ) {
      return true;
    }
    this.#pending = snapshot;
    this.#lastError = null;
    return true;
  }

  inspect() {
    return Object.freeze({
      active: Boolean(this.#activeContext),
      revision: this.#revision,
      pending: Boolean(this.#pending),
      writing: Boolean(this.#drainPromise),
      error: this.#lastError,
    });
  }

  async #loadAuthority(write) {
    const workspace = await this.#bridgeClient.workspace(write.sourcePath);
    return authoritativeFromWorkspace(workspace);
  }

  async #persist(initialWrite) {
    let write = initialWrite;
    let rebaseCount = 0;
    while (true) {
      try {
        const payload = await this.#bridgeClient.saveDraft({
          operationId: write.operationId,
          projectId: write.projectId,
          documentId: write.documentId,
          sourcePath: write.sourcePath,
          expectedDraftRevision: write.expectedDraftRevision,
          basedOnVersionId: write.basedOnVersionId,
          comments: write.comments.map(this.#encodeComment),
          changeEvents: write.changeEvents.map(this.#encodeChangeEvent),
          deletedCommentIds: write.deletedCommentIds,
        });
        if (payload?.ok === false) {
          throw new Error("本轮评论暂时无法记录。");
        }
        const authoritative = normalizeAuthoritativeDraft(
          isRecord(payload?.activeDraft) ? payload.activeDraft : {},
        );
        if (authoritative.draftRevision <= write.expectedDraftRevision) {
          throw new Error("草稿保存返回了不完整或过期的 revision。");
        }
        return {
          write,
          authoritative,
          rebaseCount,
          replayed: payload?.replayed === true,
        };
      } catch (cause) {
        const revisionConflict =
          isBridgeRequestError(cause)
          && cause.code === "DRAFT_REVISION_CONFLICT";
        const unknownOutcome =
          isBridgeRequestError(cause)
          && cause.outcome === "unknown";
        if (!revisionConflict && !unknownOutcome) throw cause;

        let authoritativeValue = revisionConflict
          ? cause.details.activeDraft
          : null;
        if (!isRecord(authoritativeValue)) {
          authoritativeValue = await this.#loadAuthority(write);
        }
        const authoritative = normalizeAuthoritativeDraft(authoritativeValue);
        if (operationWasApplied(authoritative, write.operationId)) {
          if (authoritative.draftRevision <= write.expectedDraftRevision) {
            throw cause;
          }
          return {
            write,
            authoritative,
            rebaseCount,
            replayed: true,
          };
        }
        if (
          authoritative.draftRevision < write.expectedDraftRevision
          || rebaseCount >= this.#maxRebases
        ) {
          throw cause;
        }
        write = rebaseDraftMutation(write, authoritative);
        rebaseCount += 1;
      }
    }
  }

  async #run(generation) {
    while (this.#pending && generation === this.#generation) {
      const write = this.#pending;
      this.#pending = null;
      try {
        const result = await this.#persist(write);
        if (
          generation !== this.#generation
          || !sameContext(this.#activeContext, write)
        ) {
          this.#emit({ type: "retired", ...result });
          return false;
        }
        this.#revision = Math.max(
          this.#revision,
          result.authoritative.draftRevision,
        );
        this.#acknowledgedFingerprint = draftFingerprint(
          result.authoritative,
        );
        this.#acknowledgedDraft = result.authoritative;
        if (this.#pending && sameContext(this.#pending, write)) {
          this.#pending = rebaseDraftMutation(
            this.#pending,
            result.authoritative,
          );
          const pendingFingerprint = draftFingerprint({
            comments: this.#pending.comments.map(this.#encodeComment),
            changeEvents: this.#pending.changeEvents.map(
              this.#encodeChangeEvent,
            ),
            deletedCommentIds: this.#pending.deletedCommentIds,
          });
          if (pendingFingerprint === this.#acknowledgedFingerprint) {
            this.#pending = null;
          }
        }
        this.#lastError = null;
        this.#emit({ type: "acknowledged", ...result });
      } catch (error) {
        if (
          generation === this.#generation
          && sameContext(this.#activeContext, write)
        ) {
          // A newer aggregate may have been queued while this write was in
          // flight. It already contains the latest comments and tombstones, so
          // an older failure must not replace it.
          if (!this.#pending || !sameContext(this.#pending, write)) {
            this.#pending = write;
          }
          this.#lastError = error;
          this.#emit({ type: "failed", write, error });
        } else {
          this.#emit({ type: "retired-failure", write, error });
        }
        return false;
      }
    }
    return generation === this.#generation;
  }

  async drain(snapshot) {
    if (snapshot && !this.queue(snapshot)) return false;
    if (this.#drainPromise) {
      const previous = await this.#drainPromise;
      if (!previous) return false;
      if (!this.#pending) return true;
    }
    if (!this.#pending) return true;
    const generation = this.#generation;
    const promise = this.#run(generation);
    this.#drainPromise = promise;
    try {
      return await promise;
    } finally {
      if (this.#drainPromise === promise) this.#drainPromise = null;
    }
  }
}
