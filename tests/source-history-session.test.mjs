import assert from "node:assert/strict";
import test from "node:test";

import { SourceHistorySession } from "../app/application/source-history-session.js";

const beforeSha = `sha256:${"1".repeat(64)}`;
const afterSha = `sha256:${"2".repeat(64)}`;
const context = {
  epoch: 1,
  projectId: "project_history",
  documentId: "doc_history",
  sourcePath: "/tmp/history.html",
};
const empty = {
  schemaVersion: "1.0.0",
  projectId: context.projectId,
  documentId: context.documentId,
  baseSourceSha256: beforeSha,
  cursor: 0,
  revision: 0,
  entries: [],
  appliedActions: [],
  updatedAt: "2026-07-31T00:00:00.000Z",
};
const transaction = {
  kind: "text",
  beforeSourceSha256: beforeSha,
  afterSourceSha256: afterSha,
  forwardPatches: [{
    startOffset: 0,
    endOffset: 1,
    before: "a",
    after: "b",
    kind: "text",
  }],
  reversePatches: [{
    startOffset: 0,
    endOffset: 1,
    before: "b",
    after: "a",
    kind: "inverse:text",
  }],
  beforeTarget: { id: "target" },
  afterTarget: { id: "target" },
  beforeSelection: { anchor: 0, focus: 1, affinity: "right" },
  afterSelection: { anchor: 1, focus: 1, affinity: "right" },
};

test("SourceHistorySession preserves a pre-registration edit through authority binding", () => {
  const session = new SourceHistorySession();
  session.record(
    { ...context, projectId: "", documentId: "" },
    transaction,
    1,
    "2026-07-31T00:00:00.000Z",
  );
  assert.equal(session.pendingOperations.length, 1);
  assert.equal(session.capabilities.canUndo, true);

  session.activate(context, beforeSha, empty, { preservePending: true });
  assert.equal(session.pendingOperations.length, 1);
  assert.equal(session.isActive(context), true);
  assert.equal(session.createAction(context, "undo"), null);
});

test("SourceHistorySession acknowledges only sent operations and then enables action routing", () => {
  const session = new SourceHistorySession();
  session.activate(context, beforeSha, empty);
  const operation = session.record(
    context,
    transaction,
    1,
    "2026-07-31T00:00:00.000Z",
  );
  assert.deepEqual(operation.beforeSelection, transaction.beforeSelection);
  assert.deepEqual(operation.afterSelection, transaction.afterSelection);
  const persisted = {
    ...empty,
    cursor: 1,
    revision: 1,
    entries: [operation],
    updatedAt: "2026-07-31T00:00:01.000Z",
  };
  assert.equal(
    session.acknowledge(context, [operation], persisted, afterSha),
    true,
  );
  assert.equal(session.pendingOperations.length, 0);
  assert.equal(session.isActive({ ...context, epoch: context.epoch + 1 }), false);
  const action = session.createAction(context, "undo");
  assert.equal(action.direction, "undo");
  assert.equal(action.expectedHistoryCursor, 1);
  assert.equal(action.expectedHistoryRevision, 1);
  assert.equal(action.expectedSourceSha256, afterSha);
});
