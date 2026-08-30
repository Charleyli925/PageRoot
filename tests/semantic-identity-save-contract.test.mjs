import assert from "node:assert/strict";
import test from "node:test";

import {
  applySemanticOperation,
  createSemanticDocumentState,
  createSemanticElementPrecondition,
} from "../app/lib/semantic-operation-kernel.js";
import {
  createDuplicateElementOperation,
  createInsertElementOperation,
  createMoveElementOperation,
} from "../app/lib/source-structure-edit.js";
import { buildSourceIndex } from "../app/lib/source-index.js";
import {
  materializeIdentityPreservingSave,
} from "../bridge/project-file-repository/working-copy.mjs";

const ids = {
  html: "pr1_00000000000040008000000000000001",
  head: "pr1_00000000000040008000000000000002",
  title: "pr1_00000000000040008000000000000003",
  body: "pr1_00000000000040008000000000000004",
  left: "pr1_00000000000040008000000000000005",
  first: "pr1_00000000000040008000000000000006",
  strong: "pr1_00000000000040008000000000000007",
  plain: "pr1_00000000000040008000000000000008",
  second: "pr1_00000000000040008000000000000009",
  right: "pr1_0000000000004000800000000000000a",
};

const html = `<!doctype html><html data-pageroot-id="${ids.html}"><head data-pageroot-id="${ids.head}"><title data-pageroot-id="${ids.title}">Identity</title></head><body data-pageroot-id="${ids.body}"><section data-pageroot-id="${ids.left}"><p data-pageroot-id="${ids.first}">A <strong data-pageroot-id="${ids.strong}">one</strong></p><p data-pageroot-id="${ids.plain}">plain</p><p data-pageroot-id="${ids.second}">B</p></section><aside data-pageroot-id="${ids.right}"></aside></body></html>`;

function operation(type, fields, operationId = `sourceop_${type}_identity_001`) {
  const state = createSemanticDocumentState(html);
  return {
    schemaVersion: 1,
    operationId,
    baseRevision: state.revision,
    expectedSourceSha256: state.sourceSha256,
    type,
    ...fields,
  };
}

function target(elementId) {
  return createSemanticElementPrecondition(html, elementId);
}

function uuidFactory(...values) {
  let index = 0;
  return () => values[index++];
}

function saveEvidence(source, result, semanticOperation, kind = "structure") {
  const materialization = result.materialization.sourcePatchResult;
  return {
    operationId: semanticOperation.operationId,
    kind,
    editRevision: 1,
    createdAt: "2026-08-30T00:00:00.000Z",
    beforeSourceSha256: result.previousSourceSha256,
    afterSourceSha256: result.sourceSha256,
    forwardPatches: materialization.patches,
    reversePatches: materialization.inversePlan.patches,
    beforeTarget: null,
    afterTarget: null,
    semanticDirection: "forward",
    semanticOperation,
    identityDelta: result.identityDelta,
  };
}

function applyAndSave(semanticOperation, options = {}) {
  const result = applySemanticOperation(
    createSemanticDocumentState(html),
    semanticOperation,
    options,
  );
  const saved = materializeIdentityPreservingSave(html, result.html, {
    sourceHistoryOperations: [saveEvidence(html, result, semanticOperation)],
  });
  return { result, saved, index: buildSourceIndex(saved.html) };
}

test("semantic identityDelta authorizes delete and setText descendant retirement", () => {
  const deleting = operation("deleteElement", { target: target(ids.first) });
  const deleted = applyAndSave(deleting);
  assert.deepEqual(deleted.result.identityDelta.removedElementIds, [ids.first, ids.strong]);
  assert.equal(deleted.index.byPagerootId.has(ids.first), false);
  assert.equal(deleted.index.byPagerootId.has(ids.strong), false);

  const settingText = operation(
    "setText",
    { target: target(ids.first), text: "replacement" },
    "sourceop_setText_identity_002",
  );
  const text = applyAndSave(settingText);
  assert.deepEqual(text.result.identityDelta.removedElementIds, [ids.strong]);
  assert.equal(text.result.identityDelta.retainedTargetRootElementId, ids.first);
  assert.equal(text.index.byPagerootId.has(ids.strong), false);
});

test("replaceSubtree keeps its root ID across tag change and replaces descendant identities", () => {
  const replacing = operation("replaceSubtree", {
    target: target(ids.first),
    html: "<article><em>replacement</em></article>",
  });
  const replaced = applyAndSave(replacing, {
    randomUUID: uuidFactory("10000000-0000-4000-8000-000000000001"),
  });
  const replacement = replaced.index.byPagerootId.get(ids.first);
  assert.equal(replacement.tagName, "article");
  assert.equal(replaced.result.identityDelta.retainedTargetRootElementId, ids.first);
  assert.deepEqual(replaced.result.identityDelta.removedElementIds, [ids.strong]);
  assert.equal(replaced.result.identityDelta.addedElementIds.length, 1);
});

test("insert, duplicate, same-parent move and cross-parent move save from semantic evidence", () => {
  const inserting = createInsertElementOperation(html, {
    baseRevision: 0,
    operationId: "sourceop_insert_identity_003",
    parentElementId: ids.left,
    beforeElementId: ids.second,
    html: "<article><em>new</em></article>",
  });
  const inserted = applyAndSave(inserting, {
    randomUUID: uuidFactory(
      "20000000-0000-4000-8000-000000000001",
      "20000000-0000-4000-8000-000000000002",
    ),
  });
  assert.equal(inserted.result.identityDelta.addedElementIds.length, 2);
  assert.equal(inserted.result.identityDelta.parentElementId, ids.left);
  assert.equal(inserted.result.identityDelta.beforeElementId, ids.second);

  const duplicating = createDuplicateElementOperation(html, {
    baseRevision: 0,
    operationId: "sourceop_duplicate_identity_004",
    elementId: ids.first,
  });
  const duplicated = applyAndSave(duplicating, {
    randomUUID: uuidFactory(
      "30000000-0000-4000-8000-000000000001",
      "30000000-0000-4000-8000-000000000002",
    ),
  });
  assert.equal(duplicated.result.identityDelta.addedElementIds.length, 2);
  assert.equal(duplicated.index.byPagerootId.has(ids.first), true);

  for (const [operationId, parentElementId, beforeElementId] of [
    ["sourceop_same_parent_move_005", ids.left, ids.first],
    ["sourceop_cross_parent_move_006", ids.right, null],
  ]) {
    const moving = createMoveElementOperation(html, {
      baseRevision: 0,
      operationId,
      elementId: ids.second,
      parentElementId,
      beforeElementId,
    });
    const moved = applyAndSave(moving);
    assert.deepEqual(moved.result.identityDelta.movedElementIds, [ids.second]);
    assert.equal(moved.index.byPagerootId.get(ids.second).pagerootId, ids.second);
  }
});

test("system-created line breaks and range-style wrappers have explicit added-ID deltas", () => {
  const lineBreakId = "pr1_40000000000040008000000000000001";
  const lineBreak = operation("setText", {
    target: target(ids.plain),
    text: "first\nsecond",
    contentHtml: `first<br data-pageroot-id="${lineBreakId}">second`,
  }, "sourceop_line_break_identity_007");
  const lineBreakSaved = applyAndSave(lineBreak);
  assert.deepEqual(lineBreakSaved.result.identityDelta.addedElementIds, [lineBreakId]);

  const wrapperId = "pr1_50000000000040008000000000000001";
  const rangeStyle = operation("setStyle", {
    target: target(ids.plain),
    property: "font-weight",
    value: "700",
    important: false,
    range: { startOffset: 0, endOffset: 3, quote: "pla" },
    createdPagerootIds: [wrapperId],
  }, "sourceop_range_style_identity_008");
  const styled = applyAndSave(rangeStyle);
  assert.deepEqual(styled.result.identityDelta.addedElementIds, [wrapperId]);
});

test("Repository rejects forged deltas and unproved identity topology changes", () => {
  const deleting = operation("deleteElement", { target: target(ids.first) });
  const result = applySemanticOperation(createSemanticDocumentState(html), deleting);
  const forged = saveEvidence(html, result, deleting);
  forged.identityDelta = {
    ...result.identityDelta,
    removedElementIds: [],
  };
  assert.throws(
    () => materializeIdentityPreservingSave(html, result.html, {
      sourceHistoryOperations: [forged],
    }),
    (error) => error?.code === "SOURCE_ELEMENT_IDENTITY_LOST",
  );

  const movedWithoutEvidence = html.replace(
    `<p data-pageroot-id="${ids.second}">B</p>`,
    "",
  ).replace(
    `</aside>`,
    `<p data-pageroot-id="${ids.second}">B</p></aside>`,
  );
  assert.throws(
    () => materializeIdentityPreservingSave(html, movedWithoutEvidence),
    (error) => error?.code === "SOURCE_ELEMENT_IDENTITY_LOST",
  );

  const contentOnly = html.replace(">plain</p>", ' class="changed">changed</p>');
  assert.equal(materializeIdentityPreservingSave(html, contentOnly).html, contentOnly);
});
