import { createSourceOperationId } from "../domain/source-history.js";
import { sourceSha256 } from "../lib/source-index.js";

export const SOURCE_HISTORY_MEMORY_LIMIT = 20;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;

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

function sameDocument(left, right) {
  if (!left || !right) return false;
  if (left.projectId && left.documentId && right.projectId && right.documentId) {
    return left.projectId === right.projectId
      && left.documentId === right.documentId
      && left.sourcePath === right.sourcePath;
  }
  return left.sourcePath === right.sourcePath;
}

function applyExactPatches(source, patches) {
  let html = String(source);
  const ordered = [...patches].sort(
    (left, right) => right.startOffset - left.startOffset
      || right.endOffset - left.endOffset,
  );
  for (const patch of ordered) {
    const actual = html.slice(patch.startOffset, patch.endOffset);
    if (actual !== patch.before) {
      throw new Error("撤销记录与当前 HTML 不再一致。");
    }
    html = `${html.slice(0, patch.startOffset)}${patch.after}${html.slice(patch.endOffset)}`;
  }
  return html;
}

function memorySnapshot(context, entries, cursor, currentSourceSha256) {
  return {
    scope: "open-document-memory",
    schemaVersion: 1,
    projectId: String(context?.projectId || ""),
    documentId: String(context?.documentId || ""),
    sourcePath: String(context?.sourcePath || ""),
    baseSourceSha256: entries[0]?.beforeSourceSha256 || currentSourceSha256,
    cursor,
    revision: entries.length,
    entries: structuredClone(entries),
    appliedActions: [],
    updatedAt: new Date().toISOString(),
  };
}

function memorySnapshotMatches(value, context, sourceSha256Value) {
  const entries = Array.isArray(value?.entries) ? value.entries : [];
  let chainSha256 = String(value?.baseSourceSha256 || "");
  const chainIsValid = SHA256.test(chainSha256) && entries.every((entry) => {
    if (
      !entry
      || typeof entry !== "object"
      || entry.beforeSourceSha256 !== chainSha256
      || !SHA256.test(String(entry.afterSourceSha256 || ""))
      || !Array.isArray(entry.forwardPatches)
      || !Array.isArray(entry.reversePatches)
    ) return false;
    chainSha256 = entry.afterSourceSha256;
    return true;
  });
  return Boolean(
    value?.scope === "open-document-memory"
    && sameDocument(value, context)
    && chainIsValid
    && Number.isSafeInteger(value.cursor)
    && value.cursor >= 0
    && value.cursor <= entries.length
    && entries.length <= SOURCE_HISTORY_MEMORY_LIMIT
    && String(
      value.cursor === 0
        ? value.baseSourceSha256
        : entries[value.cursor - 1]?.afterSourceSha256,
    ) === sourceSha256Value,
  );
}

export class SourceHistorySession {
  #context = null;
  #entries = [];
  #cursor = 0;
  #currentSourceSha256 = "";
  #pending = [];

  activate(context, sourceSha256Value, historyValue, { preservePending = false } = {}) {
    const nextSourceSha256 = String(sourceSha256Value || "");
    if (
      preservePending
      && sameDocument(this.#context, context)
      && this.#currentSourceSha256 === nextSourceSha256
    ) {
      this.#context = { ...context };
      return this.snapshot;
    }
    if (memorySnapshotMatches(historyValue, context, nextSourceSha256)) {
      this.#context = { ...context };
      this.#entries = structuredClone(historyValue.entries);
      this.#cursor = historyValue.cursor;
      this.#currentSourceSha256 = nextSourceSha256;
      this.#pending = [];
      return this.snapshot;
    }
    this.#context = { ...context };
    this.#entries = [];
    this.#cursor = 0;
    this.#currentSourceSha256 = nextSourceSha256;
    this.#pending = [];
    return this.snapshot;
  }

  deactivate() {
    this.#context = null;
    this.#entries = [];
    this.#cursor = 0;
    this.#currentSourceSha256 = "";
    this.#pending = [];
  }

  isActive(context) {
    return sameContext(this.#context, context);
  }

  record(context, transaction, editRevision, createdAt = new Date().toISOString()) {
    if (!this.isActive(context)) {
      this.activate(context, transaction.beforeSourceSha256, null);
    }
    if (transaction.beforeSourceSha256 !== this.#currentSourceSha256) {
      throw new Error("源码历史与当前画布补丁链不一致。");
    }
    const operation = {
      operationId: transaction.semanticOperation?.operationId
        || createSourceOperationId(),
      kind: transaction.kind,
      ...(transaction.property ? { property: transaction.property } : {}),
      editRevision,
      createdAt,
      beforeSourceSha256: transaction.beforeSourceSha256,
      afterSourceSha256: transaction.afterSourceSha256,
      forwardPatches: structuredClone(transaction.forwardPatches),
      reversePatches: structuredClone(transaction.reversePatches),
      beforeTarget: structuredClone(transaction.beforeTarget),
      afterTarget: structuredClone(transaction.afterTarget),
      ...(transaction.semanticOperation
        ? { semanticOperation: structuredClone(transaction.semanticOperation) }
        : {}),
      ...(transaction.beforeSelection
        ? { beforeSelection: structuredClone(transaction.beforeSelection) }
        : {}),
      ...(transaction.afterSelection
        ? { afterSelection: structuredClone(transaction.afterSelection) }
        : {}),
    };
    this.#entries = this.#entries.slice(0, this.#cursor);
    this.#entries.push(operation);
    if (this.#entries.length > SOURCE_HISTORY_MEMORY_LIMIT) {
      this.#entries.splice(0, this.#entries.length - SOURCE_HISTORY_MEMORY_LIMIT);
    }
    this.#cursor = this.#entries.length;
    this.#currentSourceSha256 = operation.afterSourceSha256;
    this.#pending.push(operation);
    return structuredClone(operation);
  }

  restorePendingEvidence(context, operations) {
    if (!this.isActive(context) || !Array.isArray(operations)) return false;
    this.#pending = structuredClone(operations);
    return true;
  }

  acknowledge(context, sentOperations, _historyValue, sourceSha256Value) {
    if (!this.isActive(context)) return false;
    const sentIds = new Set(
      Array.isArray(sentOperations)
        ? sentOperations.map((operation) => operation.operationId)
        : [],
    );
    this.#pending = this.#pending.filter(
      (operation) => !sentIds.has(operation.operationId),
    );
    return String(sourceSha256Value || "") === this.#currentSourceSha256;
  }

  apply(context, direction, sourceHtml, editRevision, createdAt = new Date().toISOString()) {
    if (!this.isActive(context) || this.#pending.length > 0) return null;
    const undo = direction === "undo";
    if (
      (!undo && direction !== "redo")
      || (undo ? this.#cursor === 0 : this.#cursor >= this.#entries.length)
    ) return null;
    const entryIndex = undo ? this.#cursor - 1 : this.#cursor;
    const entry = this.#entries[entryIndex];
    const expectedBeforeSha256 = undo
      ? entry.afterSourceSha256
      : entry.beforeSourceSha256;
    const expectedAfterSha256 = undo
      ? entry.beforeSourceSha256
      : entry.afterSourceSha256;
    if (
      this.#currentSourceSha256 !== expectedBeforeSha256
      || sourceSha256(String(sourceHtml)) !== expectedBeforeSha256
    ) {
      throw new Error("撤销记录与当前 HTML Hash 不一致。");
    }
    const patches = undo ? entry.reversePatches : entry.forwardPatches;
    const html = applyExactPatches(sourceHtml, patches);
    if (sourceSha256(html) !== expectedAfterSha256) {
      throw new Error("撤销记录没有生成预期 HTML Hash。");
    }
    this.#cursor = undo ? this.#cursor - 1 : this.#cursor + 1;
    this.#currentSourceSha256 = expectedAfterSha256;
    const beforeSelection = undo ? entry.afterSelection : entry.beforeSelection;
    const afterSelection = undo ? entry.beforeSelection : entry.afterSelection;
    const evidence = {
      operationId: createSourceOperationId(),
      kind: entry.kind,
      ...(entry.property ? { property: entry.property } : {}),
      editRevision,
      createdAt,
      beforeSourceSha256: expectedBeforeSha256,
      afterSourceSha256: expectedAfterSha256,
      forwardPatches: structuredClone(patches),
      reversePatches: structuredClone(
        undo ? entry.forwardPatches : entry.reversePatches,
      ),
      beforeTarget: structuredClone(undo ? entry.afterTarget : entry.beforeTarget),
      afterTarget: structuredClone(undo ? entry.beforeTarget : entry.afterTarget),
      ...(beforeSelection ? { beforeSelection: structuredClone(beforeSelection) } : {}),
      ...(afterSelection ? { afterSelection: structuredClone(afterSelection) } : {}),
    };
    this.#pending.push(evidence);
    return {
      html,
      sourceSha256: expectedAfterSha256,
      target: structuredClone(undo ? entry.beforeTarget : entry.afterTarget),
      targetTransition: {
        fromTarget: structuredClone(undo ? entry.afterTarget : entry.beforeTarget),
        toTarget: structuredClone(undo ? entry.beforeTarget : entry.afterTarget),
      },
      ...(afterSelection ? { selection: structuredClone(afterSelection) } : {}),
    };
  }

  get pendingOperations() {
    return structuredClone(this.#pending);
  }

  get snapshot() {
    return this.#context
      ? memorySnapshot(
        this.#context,
        this.#entries,
        this.#cursor,
        this.#currentSourceSha256,
      )
      : null;
  }

  get capabilities() {
    return {
      canUndo: this.#pending.length === 0 && this.#cursor > 0,
      canRedo: this.#pending.length === 0 && this.#cursor < this.#entries.length,
      cursor: this.#cursor,
      depth: this.#entries.length,
      revision: this.#entries.length,
      sourceSha256: this.#currentSourceSha256,
    };
  }
}
