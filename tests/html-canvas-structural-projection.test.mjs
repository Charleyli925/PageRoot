import assert from "node:assert/strict";
import test from "node:test";

import {
  decideStructuralProjection,
  executeVerifiedStructuralProjection,
  isVerifiedStructuralProjectionPlan,
  resolveDeleteSelectionLanding,
} from "../app/components/html-canvas-structural-projection.js";
import {
  applySemanticOperation,
  createSemanticDocumentState,
} from "../app/lib/semantic-operation-kernel.js";
import { buildSourceIndex } from "../app/lib/source-index.js";
import {
  createDeleteElementOperation,
  createDuplicateElementOperation,
  createInsertElementOperation,
  createMoveElementOperation,
} from "../app/lib/source-structure-edit.js";

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

function decideFromResult(beforeHtml, result, extra = {}) {
  const beforeIndex = buildSourceIndex(beforeHtml);
  return decideStructuralProjection({
    operationId: result.identityDelta.operationId,
    operationType: extra.operationType,
    mutationProperty: extra.mutationProperty ?? null,
    beforeSourceSha256: beforeIndex.sourceSha256,
    afterSourceSha256: result.sourceSha256,
    beforeIndex,
    afterIndex: buildSourceIndex(result.html),
    identityDelta: result.identityDelta,
    frameGeneration: 4,
    executionId: "exec_structure",
    ...extra,
  });
}

test("plans refuse a later HTML Hash or a different document identity", () => {
  const inserted = applySemanticOperation(
    createSemanticDocumentState(html),
    createInsertElementOperation(html, {
      baseRevision: 0,
      operationId: "op_insert_plan",
      parentElementId: ids.left,
      beforeElementId: ids.second,
      html: "<em>New</em>",
    }),
    { randomUUID: uuidFactory("20000000-0000-4000-8000-000000000001") },
  );
  const ok = decideFromResult(html, inserted, { operationType: "insertElement" });
  assert.equal(ok.kind, "in-place");
  assert.equal(ok.reason, "verified-insert");
  assert.equal(isVerifiedStructuralProjectionPlan(ok.plan), true);

  const otherIndex = buildSourceIndex(html);
  const crossHash = decideStructuralProjection({
    operationId: inserted.identityDelta.operationId,
    operationType: "insertElement",
    beforeSourceSha256: otherIndex.sourceSha256,
    afterSourceSha256: "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    beforeIndex: otherIndex,
    afterIndex: buildSourceIndex(inserted.html),
    identityDelta: inserted.identityDelta,
    frameGeneration: 4,
    executionId: "exec_structure",
  });
  assert.equal(crossHash.kind, "candidate");
  assert.equal(crossHash.reason, "source-identity-mismatch");
});

test("insert, delete and cross-parent move classify as proven in-place", () => {
  const duplicated = applySemanticOperation(
    createSemanticDocumentState(html),
    createDuplicateElementOperation(html, {
      baseRevision: 0,
      operationId: "op_duplicate_plan",
      elementId: ids.second,
    }),
    { randomUUID: uuidFactory("30000000-0000-4000-8000-000000000001") },
  );
  const insertDecision = decideFromResult(html, duplicated, { operationType: "insertElement" });
  assert.equal(insertDecision.kind, "in-place");
  assert.equal(insertDecision.plan.action, "insert");

  const deleted = applySemanticOperation(
    createSemanticDocumentState(html),
    createDeleteElementOperation(html, {
      baseRevision: 0,
      operationId: "op_delete_plan",
      elementId: ids.second,
    }),
  );
  const deleteDecision = decideFromResult(html, deleted, { operationType: "deleteElement" });
  assert.equal(deleteDecision.kind, "in-place");
  assert.equal(deleteDecision.plan.action, "delete");
  assert.equal(
    resolveDeleteSelectionLanding(buildSourceIndex(html), ids.second),
    ids.first,
  );

  const moved = applySemanticOperation(
    createSemanticDocumentState(html),
    createMoveElementOperation(html, {
      baseRevision: 0,
      operationId: "op_move_plan",
      elementId: ids.second,
      parentElementId: ids.right,
    }),
  );
  const moveDecision = decideFromResult(html, moved, { operationType: "moveElement" });
  assert.equal(moveDecision.kind, "in-place");
  assert.equal(moveDecision.reason, "verified-cross-parent-move");
  assert.equal(moveDecision.plan.sourceParentElementId, ids.left);
  assert.equal(moveDecision.plan.parentElementId, ids.right);
});

test("customized builtins, mixed content and body-as-parent keep distinct projection classes", () => {
  const card = "pr1_0000000000004000800000000000000f";
  const cardChild = "pr1_00000000000040008000000000000014";
  const builtinHtml = `<!doctype html><html data-pageroot-id="${ids.html}"><head data-pageroot-id="${ids.head}"></head><body data-pageroot-id="${ids.body}"><div is="review-card" data-pageroot-id="${card}"><span data-pageroot-id="${cardChild}">正文</span></div></body></html>`;
  const deletedBuiltin = applySemanticOperation(
    createSemanticDocumentState(builtinHtml),
    createDeleteElementOperation(builtinHtml, {
      baseRevision: 0,
      operationId: "op_delete_builtin",
      elementId: card,
    }),
  );
  assert.equal(
    decideFromResult(builtinHtml, deletedBuiltin, { operationType: "deleteElement" }).kind,
    "candidate",
  );

  const host = "pr1_00000000000040008000000000000010";
  const first = "pr1_00000000000040008000000000000011";
  const second = "pr1_00000000000040008000000000000012";
  const mixedHtml = `<!doctype html><html data-pageroot-id="${ids.html}"><head data-pageroot-id="${ids.head}"></head><body data-pageroot-id="${ids.body}"><div data-pageroot-id="${host}">前<span data-pageroot-id="${first}">中</span>后<span data-pageroot-id="${second}">末</span>尾</div></body></html>`;
  const duplicatedMixed = applySemanticOperation(
    createSemanticDocumentState(mixedHtml),
    createDuplicateElementOperation(mixedHtml, {
      baseRevision: 0,
      operationId: "op_duplicate_mixed",
      elementId: first,
    }),
    { randomUUID: uuidFactory("40000000-0000-4000-8000-000000000001") },
  );
  const mixedDecision = decideFromResult(mixedHtml, duplicatedMixed, { operationType: "insertElement" });
  assert.equal(mixedDecision.kind, "candidate");
  assert.equal(mixedDecision.reason, "insert-mixed-content");

  const deletedMixed = applySemanticOperation(
    createSemanticDocumentState(mixedHtml),
    createDeleteElementOperation(mixedHtml, {
      baseRevision: 0,
      operationId: "op_delete_mixed",
      elementId: first,
    }),
  );
  assert.equal(
    decideFromResult(mixedHtml, deletedMixed, { operationType: "deleteElement" }).kind,
    "in-place",
  );

  const paragraph = "pr1_00000000000040008000000000000013";
  const bodyHtml = `<!doctype html><html data-pageroot-id="${ids.html}"><head data-pageroot-id="${ids.head}"></head><body data-pageroot-id="${ids.body}"><p data-pageroot-id="${paragraph}">普通段落</p></body></html>`;
  const duplicatedBodyChild = applySemanticOperation(
    createSemanticDocumentState(bodyHtml),
    createDuplicateElementOperation(bodyHtml, {
      baseRevision: 0,
      operationId: "op_duplicate_body_child",
      elementId: paragraph,
    }),
    { randomUUID: uuidFactory("50000000-0000-4000-8000-000000000001") },
  );
  const bodyDecision = decideFromResult(bodyHtml, duplicatedBodyChild, { operationType: "insertElement" });
  const scriptId = "pr1_00000000000040008000000000000016";
  const bodyPrettyHtml = `<!doctype html><html data-pageroot-id="${ids.html}"><head data-pageroot-id="${ids.head}"></head>
<body data-pageroot-id="${ids.body}" style="padding:32px">
  <p data-pageroot-id="${paragraph}">普通段落</p>
  <div data-pageroot-id="${host}">前<span data-pageroot-id="${first}">中</span>后<span data-pageroot-id="${second}">末</span>尾</div>
  <script data-pageroot-id="${scriptId}">document.body.dataset.runtimeReady = "true";</script>
</body></html>`;
  const duplicatedPrettyBodyChild = applySemanticOperation(
    createSemanticDocumentState(bodyPrettyHtml),
    createDuplicateElementOperation(bodyPrettyHtml, {
      baseRevision: 0,
      operationId: "op_duplicate_pretty_body_child",
      elementId: paragraph,
    }),
    { randomUUID: uuidFactory("60000000-0000-4000-8000-000000000001") },
  );
  const prettyBodyDecision = decideFromResult(
    bodyPrettyHtml,
    duplicatedPrettyBodyChild,
    { operationType: "insertElement" },
  );
  assert.equal(prettyBodyDecision.kind, "in-place", prettyBodyDecision.reason);
  assert.equal(prettyBodyDecision.plan.parentElementId, ids.body);
});

test("tables, custom elements and mixed identity stay on Candidate", () => {
  const tableId = "pr1_0000000000004000800000000000000a";
  const bodyId = "pr1_0000000000004000800000000000000b";
  const rowId = "pr1_0000000000004000800000000000000c";
  const cellId = "pr1_0000000000004000800000000000000d";
  const tableHtml = `<!doctype html><html data-pageroot-id="${ids.html}"><head data-pageroot-id="${ids.head}"></head><body data-pageroot-id="${ids.body}"><table data-pageroot-id="${tableId}"><tbody data-pageroot-id="${bodyId}"><tr data-pageroot-id="${rowId}"><td data-pageroot-id="${cellId}">cell</td></tr></tbody></table></body></html>`;
  const deletedRow = applySemanticOperation(
    createSemanticDocumentState(tableHtml),
    createDeleteElementOperation(tableHtml, {
      baseRevision: 0,
      operationId: "op_delete_table",
      elementId: rowId,
    }),
  );
  const tableDecision = decideFromResult(tableHtml, deletedRow, { operationType: "deleteElement" });
  assert.equal(tableDecision.kind, "candidate");

  const widget = "pr1_0000000000004000800000000000000e";
  const customHtml = `<!doctype html><html data-pageroot-id="${ids.html}"><head data-pageroot-id="${ids.head}"></head><body data-pageroot-id="${ids.body}"><x-card data-pageroot-id="${widget}">Hi</x-card></body></html>`;
  const deletedCustom = applySemanticOperation(
    createSemanticDocumentState(customHtml),
    createDeleteElementOperation(customHtml, {
      baseRevision: 0,
      operationId: "op_delete_custom",
      elementId: widget,
    }),
  );
  assert.equal(
    decideFromResult(customHtml, deletedCustom, { operationType: "deleteElement" }).kind,
    "candidate",
  );

  const mixed = decideStructuralProjection({
    operationId: "op_mixed",
    operationType: "restoreExactSource",
    beforeSourceSha256: buildSourceIndex(html).sourceSha256,
    afterSourceSha256: buildSourceIndex(html).sourceSha256,
    beforeIndex: buildSourceIndex(html),
    afterIndex: buildSourceIndex(html),
    identityDelta: {
      operationId: "op_mixed",
      addedElementIds: [ids.second],
      removedElementIds: [ids.first],
      movedElementIds: [],
      tagChangedElementIds: [],
    },
    frameGeneration: 1,
    executionId: null,
  });
  assert.equal(mixed.kind, "candidate");
  assert.equal(mixed.reason, "unsupported-identity-transition");
});

test("a caller-forged plan cannot execute even with safe:true", () => {
  const result = executeVerifiedStructuralProjection({
    plan: {
      safe: true,
      action: "insert",
      operationId: "forged",
      beforeSourceSha256: "a",
      afterSourceSha256: "b",
      frameGeneration: 1,
      executionId: null,
      identityDelta: { addedElementIds: [] },
      addedRootElementId: ids.first,
      parentElementId: ids.body,
    },
    nextHtml: html,
    afterIndex: buildSourceIndex(html),
    live: {
      documentNode: {},
      frameGeneration: 1,
      executionId: null,
      authority: null,
      markerAttribute: "data-edit-runtime-source",
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "plan-not-verified");
});

test("disabled in-place and program identity changes stay on Candidate", () => {
  const deleted = applySemanticOperation(
    createSemanticDocumentState(html),
    createDeleteElementOperation(html, {
      baseRevision: 0,
      operationId: "op_delete_disabled",
      elementId: ids.second,
    }),
  );
  assert.equal(
    decideFromResult(html, deleted, { operationType: "deleteElement", enabled: false }).reason,
    "structural-in-place-disabled",
  );
  assert.equal(
    decideFromResult(html, deleted, {
      operationType: "deleteElement",
      programIdentityChanged: true,
    }).reason,
    "program-identity-changed",
  );
});
