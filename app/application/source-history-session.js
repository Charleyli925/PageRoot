import {
  createEmptySourceHistory,
  createSourceActionId,
  createSourceOperationId,
  normalizeSourceHistory,
  sourceHistoryCapabilities,
} from "../domain/source-history.js";

const PENDING_STALE_MS = 3_000;

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

export class SourceHistorySession {
  #context = null;
  #history = null;
  #pending = [];
  #clock;

  constructor({ clock } = {}) {
    this.#clock = clock && typeof clock.now === "function"
      ? clock
      : { now: () => Date.now() };
  }

  activate(context, sourceSha256, historyValue, { preservePending = false } = {}) {
    const retainedPending = preservePending
      && this.#context?.epoch === context.epoch
      && this.#context?.sourcePath === context.sourcePath
      && this.#pending[0]?.beforeSourceSha256 === sourceSha256
      ? this.#pending
      : [];
    this.#context = { ...context };
    this.#history = normalizeSourceHistory(historyValue, {
      projectId: context.projectId,
      documentId: context.documentId,
      sourceSha256,
    });
    this.#pending = retainedPending;
    return this.snapshot;
  }

  deactivate() {
    this.#context = null;
    this.#history = null;
    this.#pending = [];
  }

  isActive(context) {
    return sameContext(this.#context, context);
  }

  record(context, transaction, editRevision, createdAt = new Date().toISOString()) {
    if (!this.isActive(context)) {
      this.#context = { ...context };
      this.#history = context.projectId && context.documentId
        ? createEmptySourceHistory({
            projectId: context.projectId,
            documentId: context.documentId,
            sourceSha256: transaction.beforeSourceSha256,
          })
        : null;
      this.#pending = [];
    }
    const operation = {
      operationId: createSourceOperationId(),
      kind: transaction.kind,
      ...(transaction.property ? { property: transaction.property } : {}),
      editRevision,
      createdAt,
      pendingSince: this.#clock.now(),
      beforeSourceSha256: transaction.beforeSourceSha256,
      afterSourceSha256: transaction.afterSourceSha256,
      forwardPatches: transaction.forwardPatches,
      reversePatches: transaction.reversePatches,
      beforeTarget: transaction.beforeTarget,
      afterTarget: transaction.afterTarget,
      ...(transaction.beforeSelection
        ? { beforeSelection: transaction.beforeSelection }
        : {}),
      ...(transaction.afterSelection
        ? { afterSelection: transaction.afterSelection }
        : {}),
    };
    const expectedSourceSha256 = this.#pending.at(-1)?.afterSourceSha256
      || (this.#history
        ? sourceHistoryCapabilities(this.#history).sourceSha256
        : transaction.beforeSourceSha256);
    if (operation.beforeSourceSha256 !== expectedSourceSha256) {
      throw new Error("源码历史与当前画布补丁链不一致。");
    }
    this.#pending.push(operation);
    return operation;
  }

  restorePending(context, operations) {
    if (!this.isActive(context) || !Array.isArray(operations)) return false;
    const now = this.#clock.now();
    this.#pending = operations.map((operation) => ({
      ...operation,
      pendingSince: now,
    }));
    return true;
  }

  acknowledge(context, sentOperations, historyValue, sourceSha256) {
    if (!this.isActive(context)) return false;
    const sentIds = new Set(
      Array.isArray(sentOperations)
        ? sentOperations.map((operation) => operation.operationId)
        : [],
    );
    this.#pending = this.#pending.filter(
      (operation) => !sentIds.has(operation.operationId),
    );
    this.#history = normalizeSourceHistory(historyValue, {
      projectId: context.projectId,
      documentId: context.documentId,
      sourceSha256,
    });
    return true;
  }

  replaceAuthority(context, historyValue, sourceSha256) {
    if (!this.isActive(context)) return false;
    this.#history = normalizeSourceHistory(historyValue, {
      projectId: context.projectId,
      documentId: context.documentId,
      sourceSha256,
    });
    return true;
  }

  createAction(context, direction) {
    this.#discardStalePending();
    if (!this.isActive(context) || !this.#history) return null;
    const capabilities = sourceHistoryCapabilities(this.#history);
    if (
      this.#pending.length > 0
      || (direction === "undo" ? !capabilities.canUndo : !capabilities.canRedo)
    ) return null;
    return {
      actionId: createSourceActionId(),
      direction,
      expectedHistoryRevision: capabilities.revision,
      expectedHistoryCursor: capabilities.cursor,
      expectedSourceSha256: capabilities.sourceSha256,
    };
  }

  get pendingOperations() {
    this.#discardStalePending();
    return this.#pending.map((operation) => {
      const publicOperation = { ...operation };
      delete publicOperation.pendingSince;
      return publicOperation;
    });
  }

  get snapshot() {
    return this.#history ? structuredClone(this.#history) : null;
  }

  get capabilities() {
    this.#discardStalePending();
    if (!this.#history) {
      return {
        canUndo: this.#pending.length > 0,
        canRedo: false,
        cursor: 0,
        depth: 0,
        revision: 0,
        sourceSha256: "",
      };
    }
    const capabilities = sourceHistoryCapabilities(this.#history);
    return {
      ...capabilities,
      canUndo: this.#pending.length > 0 || capabilities.canUndo,
      canRedo: this.#pending.length === 0 && capabilities.canRedo,
    };
  }

  #discardStalePending() {
    if (this.#pending.length === 0) return;
    const oldest = Math.min(
      ...this.#pending.map((operation) => Number(operation.pendingSince) || 0),
    );
    if (!Number.isFinite(oldest) || oldest <= 0) return;
    if (this.#clock.now() - oldest <= PENDING_STALE_MS) return;
    this.#pending = [];
  }
}
