import assert from "node:assert/strict";
import test from "node:test";

import {
  applySemanticOperation,
  createSemanticDocumentState,
  createSemanticElementPrecondition,
  deriveSemanticOperationIdentityDelta,
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

function sequentialUuidFactory() {
  let index = 0;
  return () => `70000000-0000-4000-8000-${String(++index).padStart(12, "0")}`;
}

function renderExactPatches(source, patches) {
  let output = source;
  for (const patch of [...patches].sort(
    (left, right) => right.startOffset - left.startOffset,
  )) {
    assert.equal(output.slice(patch.startOffset, patch.endOffset), patch.before);
    output = `${output.slice(0, patch.startOffset)}${patch.after}${
      output.slice(patch.endOffset)
    }`;
  }
  return output;
}

function exactInversePatches(patches) {
  let delta = 0;
  const inverse = [...patches]
    .sort((left, right) => left.startOffset - right.startOffset)
    .map((patch) => {
      const startOffset = patch.startOffset + delta;
      const result = {
        startOffset,
        endOffset: startOffset + patch.after.length,
        before: patch.after,
        after: patch.before,
        kind: `inverse:${patch.kind ?? "source"}`,
      };
      delta += patch.after.length - patch.before.length;
      return result;
    });
  const coalesced = [];
  for (const patch of inverse) {
    const previous = coalesced.at(-1);
    if (previous && previous.startOffset === patch.startOffset) {
      previous.endOffset = Math.max(previous.endOffset, patch.endOffset);
      previous.before += patch.before;
      previous.after += patch.after;
      if (previous.kind !== patch.kind) previous.kind = "inverse:source";
      continue;
    }
    coalesced.push({ ...patch });
  }
  return coalesced;
}

function unrelatedTitlePatch(source) {
  const before = "Identity";
  const startOffset = source.indexOf(before);
  assert.notEqual(startOffset, -1);
  return {
    startOffset,
    endOffset: startOffset + before.length,
    before,
    after: "Intruder",
    kind: "forged:unrelated-title",
  };
}

function evidenceWithExtraStructuralPatch(source, result, semanticOperation, {
  direction = "forward",
} = {}) {
  const valid = saveEvidence(source, result, semanticOperation);
  const beforeHtml = direction === "undo" ? result.html : source;
  const canonicalPatches = direction === "undo"
    ? valid.reversePatches
    : valid.forwardPatches;
  const forwardPatches = [...canonicalPatches, unrelatedTitlePatch(beforeHtml)]
    .sort((left, right) => left.startOffset - right.startOffset);
  const afterHtml = renderExactPatches(beforeHtml, forwardPatches);
  return {
    afterHtml,
    evidence: {
      ...valid,
      beforeSourceSha256: createSemanticDocumentState(beforeHtml).sourceSha256,
      afterSourceSha256: createSemanticDocumentState(afterHtml).sourceSha256,
      forwardPatches,
      reversePatches: exactInversePatches(forwardPatches),
      semanticDirection: direction,
      identityDelta: deriveSemanticOperationIdentityDelta(
        beforeHtml,
        afterHtml,
        semanticOperation,
        { direction },
      ),
    },
  };
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
    ["sourceop_backward_cross_parent_move_006b", ids.body, ids.left],
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
    createdPagerootIds: [lineBreakId],
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

test("large structural operations and identity deltas survive the autosave evidence codec", () => {
  const largeFragment = `<article>${"<i>x</i>".repeat(2_000)}${"x".repeat(96 * 1024)}</article>`;
  const inserting = createInsertElementOperation(html, {
    baseRevision: 0,
    operationId: "sourceop_large_identity_evidence_009",
    parentElementId: ids.left,
    beforeElementId: null,
    html: largeFragment,
  });
  const result = applySemanticOperation(
    createSemanticDocumentState(html),
    inserting,
    { randomUUID: sequentialUuidFactory() },
  );
  assert.ok(JSON.stringify(inserting).length > 64 * 1024);
  assert.ok(JSON.stringify(result.identityDelta).length > 64 * 1024);
  const saved = materializeIdentityPreservingSave(html, result.html, {
    sourceHistoryOperations: [saveEvidence(html, result, inserting)],
  });
  assert.equal(saved.html, result.html);
  assert.equal(saved.identity.complete, true);
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

test("Repository validates the complete semantic operation contract before authorizing identity changes", () => {
  const inserting = createInsertElementOperation(html, {
    baseRevision: 0,
    operationId: "sourceop_save_contract_shape_010",
    parentElementId: ids.left,
    beforeElementId: null,
    html: "<article>new</article>",
  });
  const result = applySemanticOperation(
    createSemanticDocumentState(html),
    inserting,
    { randomUUID: uuidFactory("60000000-0000-4000-8000-000000000001") },
  );
  const without = (value, key) => Object.fromEntries(
    Object.entries(value).filter(([member]) => member !== key),
  );
  const malformed = [
    [without(inserting, "schemaVersion"), "SEMANTIC_OPERATION_SCHEMA_UNSUPPORTED"],
    [without(inserting, "baseRevision"), "SEMANTIC_REVISION_INVALID"],
    [without(inserting, "html"), "SEMANTIC_OPERATION_MEMBER_REQUIRED"],
    [{ ...inserting, rendererAuthority: true }, "SEMANTIC_OPERATION_MEMBER_UNKNOWN"],
  ];
  for (const [semanticOperation, expectedCode] of malformed) {
    const evidence = saveEvidence(html, result, semanticOperation);
    assert.throws(
      () => materializeIdentityPreservingSave(html, result.html, {
        sourceHistoryOperations: [evidence],
      }),
      (error) => (
        error?.code === "SOURCE_ELEMENT_IDENTITY_LOST"
        && error?.details?.semanticIdentityError === expectedCode
      ),
    );
  }
});

test("setText additions require exact kernel-created identity evidence", () => {
  const lineBreakId = "pr1_60000000000040008000000000000002";
  const settingText = operation("setText", {
    target: target(ids.plain),
    text: "first\nsecond",
    contentHtml: `first<br data-pageroot-id="${lineBreakId}">second`,
    createdPagerootIds: [lineBreakId],
  }, "sourceop_text_identity_evidence_011");
  const result = applySemanticOperation(createSemanticDocumentState(html), settingText);
  const missingAllocation = {
    ...settingText,
  };
  delete missingAllocation.createdPagerootIds;
  for (const forgedOperation of [
    missingAllocation,
    {
      ...settingText,
      createdPagerootIds: ["pr1_60000000000040008000000000000003"],
    },
  ]) {
    assert.throws(
      () => materializeIdentityPreservingSave(html, result.html, {
        sourceHistoryOperations: [saveEvidence(html, result, forgedOperation)],
      }),
      (error) => (
        error?.code === "SOURCE_ELEMENT_IDENTITY_LOST"
        && error?.details?.semanticIdentityError === "SEMANTIC_IDENTITY_TEXT_ADDITION"
      ),
    );
  }
});

test("setText binds multiple line-break identities to kernel allocation order", () => {
  const firstBreakId = "pr1_91000000000040008000000000000001";
  const secondBreakId = "pr1_91000000000040008000000000000002";
  const ordered = operation("setText", {
    target: target(ids.plain),
    text: "first\nsecond\nthird",
    contentHtml: `first<br data-pageroot-id="${firstBreakId}">second<br data-pageroot-id="${secondBreakId}">third`,
    createdPagerootIds: [firstBreakId, secondBreakId],
  }, "sourceop_text_ordered_ids_029");
  const orderedResult = applySemanticOperation(createSemanticDocumentState(html), ordered);
  const orderedForward = saveEvidence(html, orderedResult, ordered, "text");
  assert.equal(materializeIdentityPreservingSave(html, orderedResult.html, {
    sourceHistoryOperations: [orderedForward],
  }).html, orderedResult.html);
  assert.equal(materializeIdentityPreservingSave(orderedResult.html, html, {
    sourceHistoryOperations: [{
      ...orderedForward,
      beforeSourceSha256: orderedResult.sourceSha256,
      afterSourceSha256: orderedResult.previousSourceSha256,
      forwardPatches: orderedForward.reversePatches,
      reversePatches: orderedForward.forwardPatches,
      semanticDirection: "undo",
      identityDelta: deriveSemanticOperationIdentityDelta(
        orderedResult.html,
        html,
        ordered,
        { direction: "undo" },
      ),
    }],
  }).html, html);
  assert.equal(materializeIdentityPreservingSave(html, orderedResult.html, {
    sourceHistoryOperations: [{
      ...orderedForward,
      semanticDirection: "redo",
      identityDelta: deriveSemanticOperationIdentityDelta(
        html,
        orderedResult.html,
        ordered,
        { direction: "redo" },
      ),
    }],
  }).html, orderedResult.html);

  const swapped = {
    ...ordered,
    operationId: "sourceop_text_swapped_ids_030",
    contentHtml: `first<br data-pageroot-id="${secondBreakId}">second<br data-pageroot-id="${firstBreakId}">third`,
  };
  const targetElement = buildSourceIndex(html).byPagerootId.get(ids.plain);
  const swappedPatch = {
    startOffset: targetElement.contentRange.startOffset,
    endOffset: targetElement.contentRange.endOffset,
    before: html.slice(
      targetElement.contentRange.startOffset,
      targetElement.contentRange.endOffset,
    ),
    after: swapped.contentHtml,
    kind: "editable-island",
  };
  const swappedHtml = renderExactPatches(html, [swappedPatch]);
  const swappedForward = {
    operationId: swapped.operationId,
    kind: "text",
    editRevision: 1,
    createdAt: "2026-08-30T00:00:00.000Z",
    beforeSourceSha256: createSemanticDocumentState(html).sourceSha256,
    afterSourceSha256: createSemanticDocumentState(swappedHtml).sourceSha256,
    forwardPatches: [swappedPatch],
    reversePatches: exactInversePatches([swappedPatch]),
    beforeTarget: null,
    afterTarget: null,
    semanticDirection: "forward",
    semanticOperation: swapped,
    identityDelta: deriveSemanticOperationIdentityDelta(html, swappedHtml, swapped),
  };
  const swappedDirections = [{
    currentHtml: html,
    nextHtml: swappedHtml,
    evidence: swappedForward,
  }, {
    currentHtml: html,
    nextHtml: swappedHtml,
    evidence: {
      ...swappedForward,
      semanticDirection: "redo",
      identityDelta: deriveSemanticOperationIdentityDelta(
        html,
        swappedHtml,
        swapped,
        { direction: "redo" },
      ),
    },
  }, {
    currentHtml: swappedHtml,
    nextHtml: html,
    evidence: {
      ...swappedForward,
      beforeSourceSha256: createSemanticDocumentState(swappedHtml).sourceSha256,
      afterSourceSha256: createSemanticDocumentState(html).sourceSha256,
      forwardPatches: swappedForward.reversePatches,
      reversePatches: swappedForward.forwardPatches,
      semanticDirection: "undo",
      identityDelta: deriveSemanticOperationIdentityDelta(
        swappedHtml,
        html,
        swapped,
        { direction: "undo" },
      ),
    },
  }];
  for (const { currentHtml, nextHtml, evidence } of swappedDirections) {
    assert.throws(
      () => materializeIdentityPreservingSave(currentHtml, nextHtml, {
        sourceHistoryOperations: [evidence],
      }),
      (error) => (
        error?.code === "SOURCE_ELEMENT_IDENTITY_LOST"
        && error?.details?.semanticIdentityError
          === "SEMANTIC_IDENTITY_TEXT_MATERIALIZATION_MISMATCH"
      ),
      evidence.semanticDirection,
    );
  }
});

test("insert and replace identity allocations are bound to exact operation HTML", () => {
  const inserting = createInsertElementOperation(html, {
    baseRevision: 0,
    operationId: "sourceop_insert_payload_binding_012",
    parentElementId: ids.left,
    beforeElementId: ids.second,
    html: "\n<article><em>inserted</em></article>\n",
  });
  const inserted = applySemanticOperation(
    createSemanticDocumentState(html),
    inserting,
    {
      randomUUID: uuidFactory(
        "70000000-0000-4000-8000-000000000001",
        "70000000-0000-4000-8000-000000000002",
      ),
    },
  );
  const replacing = operation("replaceSubtree", {
    target: target(ids.first),
    html: "\n<article><em>replacement</em></article>\n",
  }, "sourceop_replace_payload_binding_013");
  const replaced = applySemanticOperation(
    createSemanticDocumentState(html),
    replacing,
    { randomUUID: uuidFactory("80000000-0000-4000-8000-000000000001") },
  );
  for (const [result, validOperation, forgedHtml] of [
    [inserted, inserting, "<aside>unrelated insert</aside>"],
    [replaced, replacing, "<section>unrelated replacement</section>"],
  ]) {
    const saved = materializeIdentityPreservingSave(html, result.html, {
      sourceHistoryOperations: [saveEvidence(html, result, validOperation)],
    });
    assert.equal(saved.html, result.html);
    const evidence = saveEvidence(html, result, {
      ...validOperation,
      html: forgedHtml,
    });
    assert.throws(
      () => materializeIdentityPreservingSave(html, result.html, {
        sourceHistoryOperations: [evidence],
      }),
      (error) => (
        error?.code === "SOURCE_ELEMENT_IDENTITY_LOST"
        && error?.details?.semanticIdentityError === "SEMANTIC_IDENTITY_MATERIALIZATION_MISMATCH"
      ),
    );
  }
});

test("structural semantic evidence rejects any unrelated extra patch", () => {
  const cases = [];
  const deleting = operation("deleteElement", {
    target: target(ids.first),
  }, "sourceop_structure_extra_delete_016");
  cases.push([deleting, applySemanticOperation(createSemanticDocumentState(html), deleting)]);

  const inserting = createInsertElementOperation(html, {
    baseRevision: 0,
    operationId: "sourceop_structure_extra_insert_017",
    parentElementId: ids.left,
    beforeElementId: ids.second,
    html: "<article><em>new</em></article>",
  });
  cases.push([inserting, applySemanticOperation(
    createSemanticDocumentState(html),
    inserting,
    {
      randomUUID: uuidFactory(
        "a0000000-0000-4000-8000-000000000001",
        "a0000000-0000-4000-8000-000000000002",
      ),
    },
  )]);

  const replacing = operation("replaceSubtree", {
    target: target(ids.first),
    html: "<article><em>replacement</em></article>",
  }, "sourceop_structure_extra_replace_018");
  cases.push([replacing, applySemanticOperation(
    createSemanticDocumentState(html),
    replacing,
    { randomUUID: uuidFactory("a0000000-0000-4000-8000-000000000003") },
  )]);

  for (const [operationId, parentElementId, beforeElementId] of [
    ["sourceop_structure_extra_same_move_019", ids.left, ids.first],
    ["sourceop_structure_extra_cross_move_020", ids.right, null],
  ]) {
    const moving = createMoveElementOperation(html, {
      baseRevision: 0,
      operationId,
      elementId: ids.second,
      parentElementId,
      beforeElementId,
    });
    cases.push([moving, applySemanticOperation(createSemanticDocumentState(html), moving)]);
  }

  for (const [semanticOperation, result] of cases) {
    const forged = evidenceWithExtraStructuralPatch(html, result, semanticOperation);
    assert.throws(
      () => materializeIdentityPreservingSave(html, forged.afterHtml, {
        sourceHistoryOperations: [forged.evidence],
      }),
      (error) => (
        error?.code === "SOURCE_ELEMENT_IDENTITY_LOST"
        && error?.details?.semanticIdentityError
          === "SEMANTIC_IDENTITY_STRUCTURE_PATCH_MISMATCH"
      ),
      semanticOperation.type,
    );
  }
});

test("structural semantic patch binding selects exact undo and redo evidence", () => {
  const moving = createMoveElementOperation(html, {
    baseRevision: 0,
    operationId: "sourceop_structure_direction_021",
    elementId: ids.second,
    parentElementId: ids.body,
    beforeElementId: ids.left,
  });
  const result = applySemanticOperation(createSemanticDocumentState(html), moving);
  const forward = saveEvidence(html, result, moving);
  const undo = {
    ...forward,
    beforeSourceSha256: result.sourceSha256,
    afterSourceSha256: result.previousSourceSha256,
    forwardPatches: forward.reversePatches,
    reversePatches: forward.forwardPatches,
    semanticDirection: "undo",
    identityDelta: deriveSemanticOperationIdentityDelta(
      result.html,
      html,
      moving,
      { direction: "undo" },
    ),
  };
  assert.equal(materializeIdentityPreservingSave(result.html, html, {
    sourceHistoryOperations: [undo],
  }).html, html);
  assert.equal(materializeIdentityPreservingSave(html, result.html, {
    sourceHistoryOperations: [{
      ...forward,
      semanticDirection: "redo",
      identityDelta: deriveSemanticOperationIdentityDelta(
        html,
        result.html,
        moving,
        { direction: "redo" },
      ),
    }],
  }).html, result.html);
});

test("same-parent semantic replay preserves exact sibling source boundaries", () => {
  const implicit = `<!doctype html><html data-pageroot-id="${ids.html}"><head data-pageroot-id="${ids.head}"><title data-pageroot-id="${ids.title}">Implicit</title></head><body data-pageroot-id="${ids.body}"><ul data-pageroot-id="${ids.left}"><li data-pageroot-id="${ids.first}">A<li data-pageroot-id="${ids.second}">B</ul></body></html>`;
  const moving = createMoveElementOperation(implicit, {
    baseRevision: 0,
    operationId: "sourceop_implicit_sibling_move_022",
    elementId: ids.second,
    parentElementId: ids.left,
    beforeElementId: ids.first,
  });
  assert.throws(
    () => applySemanticOperation(createSemanticDocumentState(implicit), moving),
    (error) => [
      "UNSAFE_REORDER_BOUNDARY",
      "SEMANTIC_STRUCTURE_REORDER_SIBLING_BOUNDARY_INVALID",
    ].includes(error?.code),
  );
  const implicitIndex = buildSourceIndex(implicit);
  const parent = implicitIndex.byPagerootId.get(ids.left);
  const after = `${implicit.slice(0, parent.contentRange.startOffset)}${
    `<li data-pageroot-id="${ids.second}">B<li data-pageroot-id="${ids.first}">A`
  }${implicit.slice(parent.contentRange.endOffset)}`;
  const patch = {
    startOffset: parent.contentRange.startOffset,
    endOffset: parent.contentRange.endOffset,
    before: implicit.slice(parent.contentRange.startOffset, parent.contentRange.endOffset),
    after: `<li data-pageroot-id="${ids.second}">B<li data-pageroot-id="${ids.first}">A`,
    kind: "sibling-reorder",
  };
  assert.throws(
    () => materializeIdentityPreservingSave(implicit, after, {
      sourceHistoryOperations: [{
        operationId: moving.operationId,
        kind: "structure",
        editRevision: 1,
        createdAt: "2026-08-30T00:00:00.000Z",
        beforeSourceSha256: createSemanticDocumentState(implicit).sourceSha256,
        afterSourceSha256: createSemanticDocumentState(after).sourceSha256,
        forwardPatches: [patch],
        reversePatches: exactInversePatches([patch]),
        beforeTarget: null,
        afterTarget: null,
        semanticDirection: "forward",
        semanticOperation: moving,
        identityDelta: deriveSemanticOperationIdentityDelta(
          implicit,
          after,
          moving,
        ),
      }],
    }),
    (error) => (
      error?.code === "SOURCE_ELEMENT_IDENTITY_LOST"
      && error?.details?.semanticIdentityError
        === "SEMANTIC_IDENTITY_STRUCTURE_PATCH_MISMATCH"
      && error?.details?.semanticIdentityDetails?.structurePlanError
        === "SEMANTIC_STRUCTURE_REORDER_SIBLING_BOUNDARY_INVALID"
    ),
  );

  for (const [operationId, structuralSource] of [
    [
      "sourceop_void_sibling_move_023",
      `<!doctype html><html data-pageroot-id="${ids.html}"><head data-pageroot-id="${ids.head}"><title data-pageroot-id="${ids.title}">Void</title></head><body data-pageroot-id="${ids.body}"><div data-pageroot-id="${ids.left}"><br data-pageroot-id="${ids.first}"><hr data-pageroot-id="${ids.second}"></div></body></html>`,
    ],
    [
      "sourceop_self_closing_sibling_move_024",
      `<!doctype html><html data-pageroot-id="${ids.html}"><head data-pageroot-id="${ids.head}"><title data-pageroot-id="${ids.title}">SVG</title></head><body data-pageroot-id="${ids.body}"><svg data-pageroot-id="${ids.left}"><circle data-pageroot-id="${ids.first}"/><path data-pageroot-id="${ids.second}"/></svg></body></html>`,
    ],
  ]) {
    const operationValue = createMoveElementOperation(structuralSource, {
      baseRevision: 0,
      operationId,
      elementId: ids.second,
      parentElementId: ids.left,
      beforeElementId: ids.first,
    });
    const result = applySemanticOperation(
      createSemanticDocumentState(structuralSource),
      operationValue,
    );
    assert.equal(materializeIdentityPreservingSave(
      structuralSource,
      result.html,
      { sourceHistoryOperations: [saveEvidence(structuralSource, result, operationValue)] },
    ).html, result.html);
  }
});

test("setText and range-style identity additions are bound to exact semantic materialization", () => {
  const lineBreakId = "pr1_90000000000040008000000000000001";
  const settingText = operation("setText", {
    target: target(ids.plain),
    text: "first\nsecond",
    contentHtml: `first<br data-pageroot-id="${lineBreakId}">second`,
    createdPagerootIds: [lineBreakId],
  }, "sourceop_text_materialization_014");
  const textResult = applySemanticOperation(createSemanticDocumentState(html), settingText);
  const forgedTextEvidence = saveEvidence(html, textResult, {
    ...settingText,
    contentHtml: `forged<br data-pageroot-id="${lineBreakId}">content`,
  });
  assert.throws(
    () => materializeIdentityPreservingSave(html, textResult.html, {
      sourceHistoryOperations: [forgedTextEvidence],
    }),
    (error) => (
      error?.code === "SOURCE_ELEMENT_IDENTITY_LOST"
      && error?.details?.semanticIdentityError
        === "SEMANTIC_IDENTITY_TEXT_MATERIALIZATION_MISMATCH"
    ),
  );

  const wrapperId = "pr1_90000000000040008000000000000002";
  const styling = operation("setStyle", {
    target: target(ids.plain),
    property: "font-weight",
    value: "700",
    important: false,
    range: { startOffset: 0, endOffset: 3, quote: "pla" },
    createdPagerootIds: [wrapperId],
  }, "sourceop_range_materialization_015");
  const styleResult = applySemanticOperation(createSemanticDocumentState(html), styling);
  for (const forgedStyleOperation of [
    { ...styling, property: "color", value: "red" },
    {
      ...styling,
      range: { startOffset: 1, endOffset: 4, quote: "lai" },
    },
  ]) {
    assert.throws(
      () => materializeIdentityPreservingSave(html, styleResult.html, {
        sourceHistoryOperations: [saveEvidence(html, styleResult, forgedStyleOperation)],
      }),
      (error) => (
        error?.code === "SOURCE_ELEMENT_IDENTITY_LOST"
        && error?.details?.semanticIdentityError
          === "SEMANTIC_IDENTITY_RANGE_STYLE_MATERIALIZATION_MISMATCH"
      ),
    );
  }

  const targetElement = buildSourceIndex(html).byPagerootId.get(ids.plain);
  const linkId = "pr1_b0000000000040008000000000000001";
  const safeLink = `<a href="/safe" data-pageroot-id="${linkId}">plain</a>`;
  const linkSource = `${html.slice(0, targetElement.contentRange.startOffset)}${safeLink}${
    html.slice(targetElement.contentRange.endOffset)
  }`;
  const linkTarget = buildSourceIndex(linkSource).byPagerootId.get(ids.plain);
  const unsafeLink = `<a href="javascript:alert(1)" onclick="alert(2)" data-pageroot-id="${linkId}">plain</a>`;
  const unsafeLinkHtml = `${linkSource.slice(0, linkTarget.contentRange.startOffset)}${
    unsafeLink
  }${linkSource.slice(linkTarget.contentRange.endOffset)}`;
  const linkState = createSemanticDocumentState(linkSource);
  const unsafeTextOperation = {
    schemaVersion: 1,
    operationId: "sourceop_text_protected_attr_014",
    baseRevision: linkState.revision,
    expectedSourceSha256: linkState.sourceSha256,
    type: "setText",
    target: createSemanticElementPrecondition(linkSource, ids.plain),
    text: "plain",
    contentHtml: unsafeLink,
  };
  assert.throws(
    () => materializeIdentityPreservingSave(linkSource, unsafeLinkHtml, {
      sourceHistoryOperations: [{
        operationId: unsafeTextOperation.operationId,
        kind: "text",
        editRevision: 1,
        createdAt: "2026-08-30T00:00:00.000Z",
        beforeSourceSha256: linkState.sourceSha256,
        afterSourceSha256: createSemanticDocumentState(unsafeLinkHtml).sourceSha256,
        forwardPatches: [{
          startOffset: linkTarget.contentRange.startOffset,
          endOffset: linkTarget.contentRange.endOffset,
          before: safeLink,
          after: unsafeLink,
          kind: "editable-island",
        }],
        reversePatches: [{
          startOffset: linkTarget.contentRange.startOffset,
          endOffset: linkTarget.contentRange.startOffset + unsafeLink.length,
          before: unsafeLink,
          after: safeLink,
          kind: "inverse:editable-island",
        }],
        beforeTarget: null,
        afterTarget: null,
        semanticDirection: "forward",
        semanticOperation: unsafeTextOperation,
        identityDelta: deriveSemanticOperationIdentityDelta(
          linkSource,
          unsafeLinkHtml,
          unsafeTextOperation,
        ),
      }],
    }),
    (error) => (
      error?.code === "SOURCE_ELEMENT_IDENTITY_LOST"
      && error?.details?.semanticIdentityError
        === "SEMANTIC_IDENTITY_TEXT_MATERIALIZATION_MISMATCH"
    ),
  );

  const forgedTextWrapper = `<span data-pageroot-id="${lineBreakId}">forged</span>`;
  const forgedTextHtml = `${html.slice(0, targetElement.contentRange.startOffset)}${
    forgedTextWrapper
  }${html.slice(targetElement.contentRange.endOffset)}`;
  const forgedTextOperation = {
    ...settingText,
    text: "forged",
    contentHtml: forgedTextWrapper,
  };
  assert.throws(
    () => materializeIdentityPreservingSave(html, forgedTextHtml, {
      sourceHistoryOperations: [{
        ...saveEvidence(html, textResult, forgedTextOperation),
        operationId: "sourceop_text_forged_tree_014",
        afterSourceSha256: createSemanticDocumentState(forgedTextHtml).sourceSha256,
        forwardPatches: [{
          startOffset: targetElement.contentRange.startOffset,
          endOffset: targetElement.contentRange.endOffset,
          before: "plain",
          after: forgedTextWrapper,
          kind: "editable-island",
        }],
        reversePatches: [{
          startOffset: targetElement.contentRange.startOffset,
          endOffset: targetElement.contentRange.startOffset + forgedTextWrapper.length,
          before: forgedTextWrapper,
          after: "plain",
          kind: "inverse:editable-island",
        }],
        identityDelta: deriveSemanticOperationIdentityDelta(
          html,
          forgedTextHtml,
          forgedTextOperation,
        ),
      }],
    }),
    (error) => (
      error?.code === "SOURCE_ELEMENT_IDENTITY_LOST"
      && error?.details?.semanticIdentityError
        === "SEMANTIC_IDENTITY_TEXT_MATERIALIZATION_MISMATCH"
    ),
  );

  const forgedWrapper = `<mark data-pageroot-id="${wrapperId}">plain</mark>`;
  const forgedHtml = `${html.slice(0, targetElement.contentRange.startOffset)}${forgedWrapper}${
    html.slice(targetElement.contentRange.endOffset)
  }`;
  const forgedState = createSemanticDocumentState(forgedHtml);
  const forgedEvidence = {
    operationId: "sourceop_range_forged_tree_015",
    kind: "style",
    editRevision: 1,
    createdAt: "2026-08-30T00:00:00.000Z",
    beforeSourceSha256: createSemanticDocumentState(html).sourceSha256,
    afterSourceSha256: forgedState.sourceSha256,
    forwardPatches: [{
      startOffset: targetElement.contentRange.startOffset,
      endOffset: targetElement.contentRange.endOffset,
      before: "plain",
      after: forgedWrapper,
      kind: "text-range-style-open",
    }],
    reversePatches: [{
      startOffset: targetElement.contentRange.startOffset,
      endOffset: targetElement.contentRange.startOffset + forgedWrapper.length,
      before: forgedWrapper,
      after: "plain",
      kind: "inverse:text-range-style-open",
    }],
    beforeTarget: null,
    afterTarget: null,
    semanticDirection: "forward",
    semanticOperation: styling,
    identityDelta: deriveSemanticOperationIdentityDelta(html, forgedHtml, styling),
  };
  assert.equal(
    `${html.slice(0, targetElement.contentRange.startOffset)}${forgedWrapper}${
      html.slice(targetElement.contentRange.endOffset)
    }`,
    forgedHtml,
  );
  assert.equal(
    `${forgedHtml.slice(0, targetElement.contentRange.startOffset)}plain${
      forgedHtml.slice(targetElement.contentRange.startOffset + forgedWrapper.length)
    }`,
    html,
  );
  assert.throws(
    () => materializeIdentityPreservingSave(html, forgedHtml, {
      sourceHistoryOperations: [forgedEvidence],
    }),
    (error) => (
      error?.code === "SOURCE_ELEMENT_IDENTITY_LOST"
      && error?.details?.semanticIdentityError
        === "SEMANTIC_IDENTITY_RANGE_STYLE_MATERIALIZATION_MISMATCH"
    ),
  );

  const unsafeStyleOperation = {
    ...styling,
    operationId: "sourceop_range_css_injection_015",
    property: "color",
    value: "red; position: fixed",
  };
  const unsafeOpening = `<span style="all: unset; display: inline !important; color: red; position: fixed" data-pageroot-id="${wrapperId}">`;
  const unsafeClosing = "</span>";
  const unsafeStyledContent = `${unsafeOpening}pla${unsafeClosing}in`;
  const unsafeStyledHtml = `${html.slice(0, targetElement.contentRange.startOffset)}${
    unsafeStyledContent
  }${html.slice(targetElement.contentRange.endOffset)}`;
  assert.throws(
    () => materializeIdentityPreservingSave(html, unsafeStyledHtml, {
      sourceHistoryOperations: [{
        operationId: unsafeStyleOperation.operationId,
        kind: "style",
        editRevision: 1,
        createdAt: "2026-08-30T00:00:00.000Z",
        beforeSourceSha256: createSemanticDocumentState(html).sourceSha256,
        afterSourceSha256: createSemanticDocumentState(unsafeStyledHtml).sourceSha256,
        forwardPatches: [{
          startOffset: targetElement.contentRange.startOffset,
          endOffset: targetElement.contentRange.startOffset,
          before: "",
          after: unsafeOpening,
          kind: "text-range-style-open",
        }, {
          startOffset: targetElement.contentRange.startOffset + 3,
          endOffset: targetElement.contentRange.startOffset + 3,
          before: "",
          after: unsafeClosing,
          kind: "text-range-style-close",
        }],
        reversePatches: [{
          startOffset: targetElement.contentRange.startOffset,
          endOffset: targetElement.contentRange.startOffset + unsafeOpening.length,
          before: unsafeOpening,
          after: "",
          kind: "inverse:text-range-style-open",
        }, {
          startOffset: targetElement.contentRange.startOffset + unsafeOpening.length + 3,
          endOffset: targetElement.contentRange.startOffset
            + unsafeOpening.length + 3 + unsafeClosing.length,
          before: unsafeClosing,
          after: "",
          kind: "inverse:text-range-style-close",
        }],
        beforeTarget: null,
        afterTarget: null,
        semanticDirection: "forward",
        semanticOperation: unsafeStyleOperation,
        identityDelta: deriveSemanticOperationIdentityDelta(
          html,
          unsafeStyledHtml,
          unsafeStyleOperation,
        ),
      }],
    }),
    (error) => (
      error?.code === "SOURCE_ELEMENT_IDENTITY_LOST"
      && error?.details?.semanticIdentityError
        === "SEMANTIC_IDENTITY_RANGE_STYLE_MATERIALIZATION_MISMATCH"
    ),
  );
});

test("plain setText is bound to the exact escaped kernel patch plan", () => {
  const settingText = operation("setText", {
    target: target(ids.first),
    text: "replacement <safe> & exact",
  }, "sourceop_plain_text_materialization_025");
  const result = applySemanticOperation(createSemanticDocumentState(html), settingText);
  const valid = saveEvidence(html, result, settingText, "text");
  assert.equal(
    valid.forwardPatches[0].after,
    "replacement &lt;safe&gt; &amp; exact",
  );
  assert.equal(materializeIdentityPreservingSave(html, result.html, {
    sourceHistoryOperations: [valid],
  }).html, result.html);
  assert.equal(materializeIdentityPreservingSave(result.html, html, {
    sourceHistoryOperations: [{
      ...valid,
      beforeSourceSha256: result.sourceSha256,
      afterSourceSha256: result.previousSourceSha256,
      forwardPatches: valid.reversePatches,
      reversePatches: valid.forwardPatches,
      semanticDirection: "undo",
      identityDelta: deriveSemanticOperationIdentityDelta(
        result.html,
        html,
        settingText,
        { direction: "undo" },
      ),
    }],
  }).html, html);
  assert.equal(materializeIdentityPreservingSave(html, result.html, {
    sourceHistoryOperations: [{
      ...valid,
      semanticDirection: "redo",
      identityDelta: deriveSemanticOperationIdentityDelta(
        html,
        result.html,
        settingText,
        { direction: "redo" },
      ),
    }],
  }).html, result.html);

  const extraPatches = [...valid.forwardPatches, unrelatedTitlePatch(html)]
    .sort((left, right) => left.startOffset - right.startOffset);
  const extraHtml = renderExactPatches(html, extraPatches);
  assert.throws(
    () => materializeIdentityPreservingSave(html, extraHtml, {
      sourceHistoryOperations: [{
        ...valid,
        afterSourceSha256: createSemanticDocumentState(extraHtml).sourceSha256,
        forwardPatches: extraPatches,
        reversePatches: exactInversePatches(extraPatches),
        identityDelta: deriveSemanticOperationIdentityDelta(html, extraHtml, settingText),
      }],
    }),
    (error) => (
      error?.code === "SOURCE_ELEMENT_IDENTITY_LOST"
      && error?.details?.semanticIdentityError
        === "SEMANTIC_IDENTITY_TEXT_MATERIALIZATION_MISMATCH"
    ),
  );

  const targetElement = buildSourceIndex(html).byPagerootId.get(ids.first);
  const unrelatedTextPatch = {
    startOffset: targetElement.contentRange.startOffset,
    endOffset: targetElement.contentRange.endOffset,
    before: html.slice(
      targetElement.contentRange.startOffset,
      targetElement.contentRange.endOffset,
    ),
    after: "unrelated",
    kind: "semantic:set-text",
  };
  const unrelatedHtml = renderExactPatches(html, [unrelatedTextPatch]);
  assert.throws(
    () => materializeIdentityPreservingSave(html, unrelatedHtml, {
      sourceHistoryOperations: [{
        ...valid,
        afterSourceSha256: createSemanticDocumentState(unrelatedHtml).sourceSha256,
        forwardPatches: [unrelatedTextPatch],
        reversePatches: exactInversePatches([unrelatedTextPatch]),
        identityDelta: deriveSemanticOperationIdentityDelta(html, unrelatedHtml, settingText),
      }],
    }),
    (error) => (
      error?.code === "SOURCE_ELEMENT_IDENTITY_LOST"
      && error?.details?.semanticIdentityError
        === "SEMANTIC_IDENTITY_TEXT_MATERIALIZATION_MISMATCH"
    ),
  );

  const entityPatch = {
    ...valid.forwardPatches[0],
    after: "replacement &#60;safe&#62; &amp; exact",
  };
  const entityHtml = renderExactPatches(html, [entityPatch]);
  assert.throws(
    () => materializeIdentityPreservingSave(html, entityHtml, {
      sourceHistoryOperations: [{
        ...valid,
        afterSourceSha256: createSemanticDocumentState(entityHtml).sourceSha256,
        forwardPatches: [entityPatch],
        reversePatches: exactInversePatches([entityPatch]),
        identityDelta: deriveSemanticOperationIdentityDelta(html, entityHtml, settingText),
      }],
    }),
    (error) => (
      error?.code === "SOURCE_ELEMENT_IDENTITY_LOST"
      && error?.details?.semanticIdentityError
        === "SEMANTIC_IDENTITY_TEXT_MATERIALIZATION_MISMATCH"
    ),
  );

  const clearing = operation("setText", {
    target: target(ids.first),
    text: "",
  }, "sourceop_plain_text_empty_026");
  const cleared = applySemanticOperation(createSemanticDocumentState(html), clearing);
  assert.equal(materializeIdentityPreservingSave(html, cleared.html, {
    sourceHistoryOperations: [saveEvidence(html, cleared, clearing, "text")],
  }).html, cleared.html);
});

test("plain setText target capability is identical in the kernel and Repository", () => {
  const capabilityHtml = `<!doctype html><html data-pageroot-id="${ids.html}"><head data-pageroot-id="${ids.head}"><title data-pageroot-id="${ids.title}">Capability</title></head><body data-pageroot-id="${ids.body}"><script data-pageroot-id="${ids.strong}">window.value = 1;</script><br data-pageroot-id="${ids.second}"></body></html>`;
  const state = createSemanticDocumentState(capabilityHtml);
  for (const [elementId, operationId] of [
    [ids.strong, "sourceop_plain_text_script_027"],
    [ids.second, "sourceop_plain_text_void_028"],
  ]) {
    const semanticOperation = {
      schemaVersion: 1,
      operationId,
      baseRevision: state.revision,
      expectedSourceSha256: state.sourceSha256,
      type: "setText",
      target: createSemanticElementPrecondition(capabilityHtml, elementId),
      text: "forged",
    };
    assert.throws(
      () => applySemanticOperation(state, semanticOperation),
      (error) => error?.code === "SEMANTIC_TEXT_TARGET_UNSUPPORTED",
    );

    const element = buildSourceIndex(capabilityHtml).byPagerootId.get(elementId);
    const forgedPatch = {
      startOffset: element.contentRange.startOffset,
      endOffset: element.contentRange.endOffset,
      before: capabilityHtml.slice(
        element.contentRange.startOffset,
        element.contentRange.endOffset,
      ),
      after: "forged",
      kind: "semantic:set-text",
    };
    const forgedHtml = renderExactPatches(capabilityHtml, [forgedPatch]);
    assert.throws(
      () => materializeIdentityPreservingSave(capabilityHtml, forgedHtml, {
        sourceHistoryOperations: [{
          operationId,
          kind: "text",
          editRevision: 1,
          createdAt: "2026-08-30T00:00:00.000Z",
          beforeSourceSha256: state.sourceSha256,
          afterSourceSha256: createSemanticDocumentState(forgedHtml).sourceSha256,
          forwardPatches: [forgedPatch],
          reversePatches: exactInversePatches([forgedPatch]),
          beforeTarget: null,
          afterTarget: null,
          semanticDirection: "forward",
          semanticOperation,
          identityDelta: deriveSemanticOperationIdentityDelta(
            capabilityHtml,
            forgedHtml,
            semanticOperation,
          ),
        }],
      }),
      (error) => (
        error?.code === "SOURCE_ELEMENT_IDENTITY_LOST"
        && error?.details?.semanticIdentityError
          === "SEMANTIC_TEXT_TARGET_UNSUPPORTED"
      ),
    );
  }
});

test("Repository replays every identity-preserving semantic patch plan exactly", () => {
  const cases = [
    operation("replaceTextRange", {
      target: target(ids.plain),
      range: { startOffset: 0, endOffset: 3, quote: "pla" },
      text: "X&",
    }, "sourceop_exact_range_replay_029"),
    operation("setAttribute", {
      target: target(ids.left),
      name: "aria-label",
      value: "A & B",
    }, "sourceop_exact_attribute_replay_030"),
    operation("setStyle", {
      target: target(ids.left),
      property: "color",
      value: "red",
      important: true,
    }, "sourceop_exact_style_replay_031"),
    operation("setStyle", {
      target: target(ids.plain),
      property: "font-weight",
      value: "700",
      important: false,
      range: { startOffset: 0, endOffset: 5, quote: "plain" },
    }, "sourceop_exact_coalesced_target_style_032"),
    operation("setStyle", {
      target: target(ids.first),
      property: "font-style",
      value: "italic",
      important: false,
      range: { startOffset: 2, endOffset: 5, quote: "one" },
    }, "sourceop_exact_coalesced_wrapper_style_033"),
  ];

  for (const semanticOperation of cases) {
    const result = applySemanticOperation(
      createSemanticDocumentState(html),
      semanticOperation,
    );
    const valid = saveEvidence(html, result, semanticOperation, "text");
    assert.equal(materializeIdentityPreservingSave(html, result.html, {
      sourceHistoryOperations: [valid],
    }).html, result.html);
    assert.equal(materializeIdentityPreservingSave(result.html, html, {
      sourceHistoryOperations: [{
        ...valid,
        operationId: `${semanticOperation.operationId}_undo`,
        beforeSourceSha256: result.sourceSha256,
        afterSourceSha256: result.previousSourceSha256,
        forwardPatches: valid.reversePatches,
        reversePatches: valid.forwardPatches,
        semanticDirection: "undo",
        identityDelta: deriveSemanticOperationIdentityDelta(
          result.html,
          html,
          semanticOperation,
          { direction: "undo" },
        ),
      }],
    }).html, html);
    assert.equal(materializeIdentityPreservingSave(html, result.html, {
      sourceHistoryOperations: [{
        ...valid,
        operationId: `${semanticOperation.operationId}_redo`,
        semanticDirection: "redo",
        identityDelta: deriveSemanticOperationIdentityDelta(
          html,
          result.html,
          semanticOperation,
          { direction: "redo" },
        ),
      }],
    }).html, result.html);

    const forwardPatches = [...valid.forwardPatches, unrelatedTitlePatch(html)]
      .sort((left, right) => left.startOffset - right.startOffset);
    const forgedHtml = renderExactPatches(html, forwardPatches);
    assert.throws(
      () => materializeIdentityPreservingSave(html, forgedHtml, {
        sourceHistoryOperations: [{
          ...valid,
          afterSourceSha256: createSemanticDocumentState(forgedHtml).sourceSha256,
          forwardPatches,
          reversePatches: exactInversePatches(forwardPatches),
          identityDelta: deriveSemanticOperationIdentityDelta(
            html,
            forgedHtml,
            semanticOperation,
          ),
        }],
      }),
      (error) => (
        error?.code === "SOURCE_ELEMENT_IDENTITY_LOST"
        && error?.details?.semanticIdentityError
          === "SEMANTIC_IDENTITY_OPERATION_MATERIALIZATION_MISMATCH"
      ),
      semanticOperation.type,
    );

    const unrelatedOnlyPatch = unrelatedTitlePatch(html);
    const unrelatedOnlyHtml = renderExactPatches(html, [unrelatedOnlyPatch]);
    assert.throws(
      () => materializeIdentityPreservingSave(html, unrelatedOnlyHtml, {
        sourceHistoryOperations: [{
          ...valid,
          afterSourceSha256: createSemanticDocumentState(unrelatedOnlyHtml).sourceSha256,
          forwardPatches: [unrelatedOnlyPatch],
          reversePatches: exactInversePatches([unrelatedOnlyPatch]),
          identityDelta: deriveSemanticOperationIdentityDelta(
            html,
            unrelatedOnlyHtml,
            semanticOperation,
          ),
        }],
      }),
      (error) => (
        error?.code === "SOURCE_ELEMENT_IDENTITY_LOST"
        && error?.details?.semanticIdentityError
          === "SEMANTIC_IDENTITY_OPERATION_MATERIALIZATION_MISMATCH"
      ),
      `${semanticOperation.type} unrelated-only`,
    );
  }

  const partialRangeWithoutWrapperIds = operation("setStyle", {
    target: target(ids.plain),
    property: "text-decoration",
    value: "underline",
    important: false,
    range: { startOffset: 0, endOffset: 3, quote: "pla" },
  }, "sourceop_missing_range_wrapper_ids_034");
  const unrelatedPatch = unrelatedTitlePatch(html);
  const unrelatedHtml = renderExactPatches(html, [unrelatedPatch]);
  assert.throws(
    () => materializeIdentityPreservingSave(html, unrelatedHtml, {
      sourceHistoryOperations: [{
        operationId: partialRangeWithoutWrapperIds.operationId,
        kind: "text",
        editRevision: 1,
        createdAt: "2026-08-30T00:00:00.000Z",
        beforeSourceSha256: createSemanticDocumentState(html).sourceSha256,
        afterSourceSha256: createSemanticDocumentState(unrelatedHtml).sourceSha256,
        forwardPatches: [unrelatedPatch],
        reversePatches: exactInversePatches([unrelatedPatch]),
        beforeTarget: null,
        afterTarget: null,
        semanticDirection: "forward",
        semanticOperation: partialRangeWithoutWrapperIds,
        identityDelta: deriveSemanticOperationIdentityDelta(
          html,
          unrelatedHtml,
          partialRangeWithoutWrapperIds,
        ),
      }],
    }),
    (error) => (
      error?.code === "SOURCE_ELEMENT_IDENTITY_LOST"
      && error?.details?.semanticIdentityError
        === "SEMANTIC_IDENTITY_RANGE_STYLE_MATERIALIZATION_MISMATCH"
    ),
  );
});

test("Repository exact replay preserves authored attribute and inline-style forms", () => {
  const variants = [
    {
      source: html.replace(
        `<section data-pageroot-id="${ids.left}">`,
        `<section data-pageroot-id="${ids.left}" aria-label='old'>`,
      ),
      type: "setAttribute",
      fields: { name: "aria-label", value: "new & exact" },
    },
    {
      source: html.replace(
        `<section data-pageroot-id="${ids.left}">`,
        `<section data-pageroot-id="${ids.left}" aria-label='old'>`,
      ),
      type: "setAttribute",
      fields: { name: "aria-label", value: null },
    },
    {
      source: html.replace(
        `<section data-pageroot-id="${ids.left}">`,
        `<section data-pageroot-id="${ids.left}" style='color: blue !important; padding: 1px'>`,
      ),
      type: "setStyle",
      fields: { property: "color", value: "red", important: false },
    },
    {
      source: html.replace(
        `<section data-pageroot-id="${ids.left}">`,
        `<section data-pageroot-id="${ids.left}" style='padding: 1px'>`,
      ),
      type: "setStyle",
      fields: { property: "color", value: "rgb(1, 2, 3)", important: true },
    },
    {
      source: html.replace(
        `<section data-pageroot-id="${ids.left}">`,
        `<section style=color:blue data-pageroot-id="${ids.left}">`,
      ),
      type: "setStyle",
      fields: { property: "color", value: "red", important: true },
    },
  ];

  for (const [index, variant] of variants.entries()) {
    const state = createSemanticDocumentState(variant.source);
    const semanticOperation = {
      schemaVersion: 1,
      operationId: `sourceop_authored_form_${String(index).padStart(3, "0")}`,
      baseRevision: state.revision,
      expectedSourceSha256: state.sourceSha256,
      type: variant.type,
      target: createSemanticElementPrecondition(variant.source, ids.left),
      ...variant.fields,
    };
    const result = applySemanticOperation(state, semanticOperation);
    const valid = saveEvidence(variant.source, result, semanticOperation, "text");
    const saved = materializeIdentityPreservingSave(variant.source, result.html, {
      sourceHistoryOperations: [valid],
    });
    assert.equal(saved.html, result.html);

    const extraPatch = unrelatedTitlePatch(variant.source);
    const forwardPatches = [...valid.forwardPatches, extraPatch]
      .sort((left, right) => left.startOffset - right.startOffset);
    const forgedHtml = renderExactPatches(variant.source, forwardPatches);
    assert.throws(
      () => materializeIdentityPreservingSave(variant.source, forgedHtml, {
        sourceHistoryOperations: [{
          ...valid,
          afterSourceSha256: createSemanticDocumentState(forgedHtml).sourceSha256,
          forwardPatches,
          reversePatches: exactInversePatches(forwardPatches),
          identityDelta: deriveSemanticOperationIdentityDelta(
            variant.source,
            forgedHtml,
            semanticOperation,
          ),
        }],
      }),
      (error) => (
        error?.code === "SOURCE_ELEMENT_IDENTITY_LOST"
        && error?.details?.semanticIdentityError
          === "SEMANTIC_IDENTITY_OPERATION_MATERIALIZATION_MISMATCH"
      ),
    );
  }
});

test("Repository range replay shares Canvas text-host capability", () => {
  const unsupported = [
    operation("replaceTextRange", {
      target: target(ids.title),
      range: { startOffset: 0, endOffset: 8, quote: "Identity" },
      text: "Blocked",
    }, "sourceop_unsupported_title_range_035"),
    operation("setStyle", {
      target: target(ids.title),
      property: "color",
      value: "red",
      important: false,
      range: { startOffset: 0, endOffset: 8, quote: "Identity" },
    }, "sourceop_unsupported_title_style_036"),
  ];

  for (const semanticOperation of unsupported) {
    assert.throws(
      () => applySemanticOperation(createSemanticDocumentState(html), semanticOperation),
      (error) => error?.code === "TEXT_RANGE_STYLE_UNSUPPORTED",
    );
    const title = buildSourceIndex(html).byPagerootId.get(ids.title);
    const patch = semanticOperation.type === "replaceTextRange"
      ? {
          startOffset: html.indexOf("Identity"),
          endOffset: html.indexOf("Identity") + "Identity".length,
          before: "Identity",
          after: "Blocked",
          kind: "semantic:replace-text-range",
        }
      : {
          startOffset: title.closingDelimiterOffset,
          endOffset: title.closingDelimiterOffset,
          before: "",
          after: ' style="color: red"',
          kind: "style-attribute-add",
        };
    const forgedHtml = renderExactPatches(html, [patch]);
    assert.throws(
      () => materializeIdentityPreservingSave(html, forgedHtml, {
        sourceHistoryOperations: [{
          operationId: semanticOperation.operationId,
          kind: "text",
          editRevision: 1,
          createdAt: "2026-08-30T00:00:00.000Z",
          beforeSourceSha256: createSemanticDocumentState(html).sourceSha256,
          afterSourceSha256: createSemanticDocumentState(forgedHtml).sourceSha256,
          forwardPatches: [patch],
          reversePatches: exactInversePatches([patch]),
          beforeTarget: null,
          afterTarget: null,
          semanticDirection: "forward",
          semanticOperation,
          identityDelta: deriveSemanticOperationIdentityDelta(
            html,
            forgedHtml,
            semanticOperation,
          ),
        }],
      }),
      (error) => (
        error?.code === "SOURCE_ELEMENT_IDENTITY_LOST"
        && error?.details?.semanticIdentityError
          === "SEMANTIC_IDENTITY_OPERATION_MATERIALIZATION_MISMATCH"
      ),
    );
  }
});

test("Repository exact replay matches self-closing SVG attribute boundaries", () => {
  const svgId = "pr1_b0000000000040008000000000000001";
  const circleId = "pr1_b0000000000040008000000000000002";
  const svgHtml = html.replace(
    `<aside data-pageroot-id="${ids.right}"></aside>`,
    `<aside data-pageroot-id="${ids.right}"><svg data-pageroot-id="${svgId}"><circle data-pageroot-id="${circleId}" style=color:blue data-kind=dot/></svg></aside>`,
  );
  for (const [index, fields] of [
    ["setStyle", { property: "color", value: "red", important: true }],
    ["setAttribute", { name: "data-kind", value: "point" }],
  ].entries()) {
    const [type, operationFields] = fields;
    const state = createSemanticDocumentState(svgHtml);
    const semanticOperation = {
      schemaVersion: 1,
      operationId: `sourceop_svg_self_closing_${index}`,
      baseRevision: state.revision,
      expectedSourceSha256: state.sourceSha256,
      type,
      target: createSemanticElementPrecondition(svgHtml, circleId),
      ...operationFields,
    };
    const result = applySemanticOperation(state, semanticOperation);
    assert.equal(materializeIdentityPreservingSave(svgHtml, result.html, {
      sourceHistoryOperations: [saveEvidence(svgHtml, result, semanticOperation, "text")],
    }).html, result.html);
  }
});

test("range-style materialization selects the original forward proof for undo and redo", () => {
  const wrapperId = "pr1_a0000000000040008000000000000001";
  const styling = operation("setStyle", {
    target: target(ids.plain),
    property: "font-style",
    value: "italic",
    important: false,
    range: { startOffset: 0, endOffset: 3, quote: "pla" },
    createdPagerootIds: [wrapperId],
  }, "sourceop_range_direction_016");
  const result = applySemanticOperation(createSemanticDocumentState(html), styling);
  const materialization = result.materialization.sourcePatchResult;
  const undoEvidence = {
    ...saveEvidence(html, result, styling),
    operationId: "sourceop_range_undo_016",
    beforeSourceSha256: result.sourceSha256,
    afterSourceSha256: result.previousSourceSha256,
    forwardPatches: materialization.inversePlan.patches,
    reversePatches: materialization.patches,
    semanticDirection: "undo",
    identityDelta: deriveSemanticOperationIdentityDelta(
      result.html,
      html,
      styling,
      { direction: "undo" },
    ),
  };
  assert.equal(materializeIdentityPreservingSave(result.html, html, {
    sourceHistoryOperations: [undoEvidence],
  }).html, html);

  const redoEvidence = {
    ...saveEvidence(html, result, styling),
    operationId: "sourceop_range_redo_016",
    semanticDirection: "redo",
    identityDelta: deriveSemanticOperationIdentityDelta(
      html,
      result.html,
      styling,
      { direction: "redo" },
    ),
  };
  assert.equal(materializeIdentityPreservingSave(html, result.html, {
    sourceHistoryOperations: [redoEvidence],
  }).html, result.html);
});
