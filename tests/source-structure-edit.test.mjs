import test from "node:test";
import assert from "node:assert/strict";

import {
  applySemanticOperation,
  createSemanticDocumentState,
} from "../app/lib/semantic-operation-kernel.js";
import { SourceHistorySession } from "../app/application/source-history-session.js";
import {
  createDeleteElementOperation,
  createDuplicateElementOperation,
  createInsertElementOperation,
  createMoveElementOperation,
  identityFreeSourceElementHtml,
} from "../app/lib/source-structure-edit.js";
import { buildSourceIndex, sourceSha256 } from "../app/lib/source-index.js";
import {
  applyPatchPlan,
  planSemanticOperationPatch,
} from "../app/lib/source-patch-engine.js";
import { createTargetRef } from "../app/lib/target-resolver.js";

const ids = {
  html: "pr1_00000000000040008000000000000001",
  head: "pr1_00000000000040008000000000000002",
  title: "pr1_00000000000040008000000000000003",
  body: "pr1_00000000000040008000000000000004",
  left: "pr1_00000000000040008000000000000005",
  first: "pr1_00000000000040008000000000000006",
  strong: "pr1_00000000000040008000000000000007",
  second: "pr1_00000000000040008000000000000008",
  right: "pr1_00000000000040008000000000000009",
};

const html = `<!doctype html><html data-pageroot-id="${ids.html}"><head data-pageroot-id="${ids.head}"><title data-pageroot-id="${ids.title}">Structure</title></head><body data-pageroot-id="${ids.body}"><section data-pageroot-id="${ids.left}"><p data-pageroot-id="${ids.first}">A <strong data-pageroot-id="${ids.strong}">one</strong></p><p data-pageroot-id="${ids.second}">B</p></section><aside data-pageroot-id="${ids.right}"></aside></body></html>`;

function uuidFactory(...values) {
  let cursor = 0;
  return () => values[cursor++];
}

test("duplicate removes inherited identities and allocates fresh IDs for the full subtree", () => {
  const baseline = createSemanticDocumentState(html);
  const rawCopy = identityFreeSourceElementHtml(html, ids.first);
  assert.doesNotMatch(rawCopy, /data-pageroot-id/u);
  const result = applySemanticOperation(
    baseline,
    createDuplicateElementOperation(html, {
      baseRevision: 0,
      operationId: "op_duplicate_001",
      elementId: ids.first,
    }),
    {
      randomUUID: uuidFactory(
        "10000000-0000-4000-8000-000000000001",
        "10000000-0000-4000-8000-000000000002",
      ),
    },
  );
  const index = buildSourceIndex(result.html);
  assert.equal(result.allocatedElementIds.length, 2);
  assert.equal(index.pagerootIdentity.complete, true);
  assert.equal(index.byPagerootId.get(ids.first)?.textContent, "A one");
  assert.equal(index.byPagerootId.get(result.insertedRootElementId)?.textContent, "A one");
  assert.notEqual(result.insertedRootElementId, ids.first);
});

test("insert, delete and cross-parent move keep source identity authoritative", () => {
  const baseline = createSemanticDocumentState(html);
  const inserted = applySemanticOperation(
    baseline,
    createInsertElementOperation(html, {
      baseRevision: 0,
      operationId: "op_insert_struct",
      parentElementId: ids.left,
      beforeElementId: ids.second,
      html: "<article><em>New</em></article>",
    }),
    {
      randomUUID: uuidFactory(
        "20000000-0000-4000-8000-000000000001",
        "20000000-0000-4000-8000-000000000002",
      ),
    },
  );
  assert.ok(inserted.html.indexOf("<article") < inserted.html.indexOf(`data-pageroot-id="${ids.second}"`));

  const deleted = applySemanticOperation(
    baseline,
    createDeleteElementOperation(html, {
      baseRevision: 0,
      operationId: "op_delete_struct",
      elementId: ids.first,
    }),
  );
  assert.equal(buildSourceIndex(deleted.html).byPagerootId.has(ids.first), false);

  const moved = applySemanticOperation(
    baseline,
    createMoveElementOperation(html, {
      baseRevision: 0,
      operationId: "op_move_cross_parent",
      elementId: ids.second,
      parentElementId: ids.right,
    }),
  );
  const movedIndex = buildSourceIndex(moved.html);
  const target = movedIndex.byPagerootId.get(ids.second);
  const parent = movedIndex.byNodeId.get(target.parentId);
  assert.equal(parent.pagerootId, ids.right);
  assert.equal(target.pagerootId, ids.second);
});

test("structure operation builders reject root deletion and invalid insertion ownership", () => {
  assert.throws(() => createDeleteElementOperation(html, {
    baseRevision: 0,
    elementId: ids.body,
  }), /cannot be deleted/u);
  assert.throws(() => createInsertElementOperation(html, {
    baseRevision: 0,
    parentElementId: ids.left,
    beforeElementId: ids.right,
    html: "<p>Wrong parent</p>",
  }), /direct child/u);
});

test("accepted structure patches undo and redo inside the bounded open-document history", () => {
  const context = {
    epoch: 1,
    projectId: "project_structure",
    documentId: "document_structure",
    sourcePath: "/tmp/structure.html",
  };
  const baseline = createSemanticDocumentState(html);
  const operation = createDuplicateElementOperation(html, {
    baseRevision: 0,
    operationId: "op_history_struct",
    elementId: ids.first,
  });
  const applied = applySemanticOperation(baseline, operation, {
    randomUUID: uuidFactory(
      "30000000-0000-4000-8000-000000000001",
      "30000000-0000-4000-8000-000000000002",
    ),
  });
  const materialization = applied.materialization.sourcePatchResult;
  const session = new SourceHistorySession();
  session.activate(context, sourceSha256(html), null);
  session.record(context, {
    kind: "structure",
    property: "duplicate",
    beforeSourceSha256: applied.previousSourceSha256,
    afterSourceSha256: applied.sourceSha256,
    forwardPatches: materialization.patches,
    reversePatches: materialization.inversePlan.patches,
    beforeTarget: { id: "target_structure", elementId: ids.first },
    afterTarget: { id: "target_structure", elementId: ids.first },
    semanticOperation: operation,
  }, 1);
  const pending = session.pendingOperations;
  assert.equal(session.acknowledge(context, pending, null, applied.sourceSha256), true);

  const undone = session.apply(context, "undo", applied.html, 2);
  assert.equal(undone.html, html);
  assert.equal(session.acknowledge(context, session.pendingOperations, null, sourceSha256(html)), true);
  const redone = session.apply(context, "redo", html, 3);
  assert.equal(redone.html, applied.html);
});

test("structure edits keep surviving comment IDs exact and orphan deleted targets", () => {
  const baseline = createSemanticDocumentState(html);
  const duplicate = applySemanticOperation(
    baseline,
    createDuplicateElementOperation(html, {
      baseRevision: 0,
      operationId: "op_comment_duplicate",
      elementId: ids.first,
    }),
    {
      randomUUID: uuidFactory(
        "40000000-0000-4000-8000-000000000001",
        "40000000-0000-4000-8000-000000000002",
      ),
    },
  );
  const semanticCommand = duplicate.materialization.sourcePatchResult
    .inversePlan.metadata.semanticCommand;
  const duplicatePlan = planSemanticOperationPatch(html, semanticCommand);
  const trackedComment = createTargetRef(html, buildSourceIndex(html).byPagerootId.get(ids.first), {
    targetId: "comment_target_first",
  });
  const mappedDuplicate = applyPatchPlan(duplicatePlan, html, {
    trackedTargetRefs: [trackedComment],
  });
  const survivingComment = mappedDuplicate.refreshedTrackedTargetRefs[0];
  assert.equal(survivingComment.elementId, ids.first);
  assert.equal(survivingComment.resolution, "exact");

  const deleted = applySemanticOperation(
    baseline,
    createDeleteElementOperation(html, {
      baseRevision: 0,
      operationId: "op_comment_delete",
      elementId: ids.first,
    }),
  );
  const deletedTarget = deleted.materialization.sourcePatchResult.refreshedTargetRefs[0];
  assert.equal(deletedTarget.elementId, ids.first);
  assert.equal(deletedTarget.resolution, "orphaned");
});
