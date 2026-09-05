import assert from "node:assert/strict";
import test from "node:test";

import { SourceHistorySession } from "../app/application/source-history-session.js";
import {
  disableEditPipelineCounters,
  enableEditPipelineCounters,
  readEditPipelineCounters,
  resetEditPipelineCounters,
} from "../app/lib/edit-pipeline-counters.js";
import {
  SEMANTIC_OPERATION_SCHEMA_VERSION,
  SemanticOperationError,
  applySemanticOperation,
  createSemanticDocumentState,
  createSemanticElementPrecondition,
} from "../app/lib/semantic-operation-kernel.js";
import { buildSourceIndex, sourceSha256 } from "../app/lib/source-index.js";
import {
  applyPatchPlan,
  planInlineStylePatch,
} from "../app/lib/source-patch-engine.js";
import {
  createTargetRef,
  planEditableIslandPatch,
} from "../app/lib/source-patch-core.js";
import {
  createDeleteElementOperation,
  createDuplicateElementOperation,
  createInsertElementOperation,
  createMoveElementOperation,
} from "../app/lib/source-structure-edit.js";

function elementId(sequence) {
  return `pr1_000000000000400080000000${sequence.toString(16).padStart(8, "0")}`;
}

const IDS = {
  html: elementId(1),
  head: elementId(2),
  title: elementId(3),
  body: elementId(4),
  main: elementId(5),
  paragraph: elementId(6),
  strong: elementId(7),
  section: elementId(8),
  first: elementId(9),
  second: elementId(10),
};

function attr(id) {
  return `data-pageroot-id="${id}"`;
}

function baselineHtml() {
  return `<!doctype html><html ${attr(IDS.html)}><head ${attr(IDS.head)}><title ${attr(IDS.title)}>Demo</title></head><body ${attr(IDS.body)}><main ${attr(IDS.main)}><p ${attr(IDS.paragraph)}>Hello <strong ${attr(IDS.strong)}>world</strong></p><section ${attr(IDS.section)}><span ${attr(IDS.first)}>A</span><span ${attr(IDS.second)}>B</span></section></main></body></html>`;
}

function manyElementHtml(count = 120) {
  const items = Array.from({ length: count }, (_, index) => {
    const id = elementId(20 + index);
    return `<article ${attr(id)}><p ${attr(elementId(20 + count + index))}>item ${index}</p></article>`;
  });
  return `<!doctype html><html ${attr(IDS.html)}><head ${attr(IDS.head)}><title ${attr(IDS.title)}>Many</title></head><body ${attr(IDS.body)}>${items.join("")}</body></html>`;
}

function largeByteHtml() {
  const padding = `<!-- ${"X".repeat(256 * 1024)} -->`;
  return `<!doctype html><html ${attr(IDS.html)}><head ${attr(IDS.head)}><title ${attr(IDS.title)}>Large</title></head><body ${attr(IDS.body)}>${padding}<p ${attr(IDS.paragraph)}>Hello</p></body></html>`;
}

function operation(documentState, operationId, type, fields = {}) {
  return {
    schemaVersion: SEMANTIC_OPERATION_SCHEMA_VERSION,
    operationId,
    baseRevision: documentState.revision,
    expectedSourceSha256: documentState.sourceSha256,
    type,
    ...fields,
  };
}

function target(documentState, id) {
  return createSemanticElementPrecondition(documentState.html, id);
}

function uuidFactory(...values) {
  let cursor = 0;
  return () => values[cursor++] ?? values.at(-1);
}

function identityFacts(html) {
  const index = buildSourceIndex(html);
  return {
    html,
    sourceSha256: index.sourceSha256,
    pagerootIds: [...index.byPagerootId.keys()].sort(),
    complete: index.pagerootIdentity?.complete === true,
  };
}

function countSnapshot() {
  const counts = readEditPipelineCounters();
  return {
    sourceIndexBuilds: counts.sourceIndexBuilds,
    fullDocumentIndexBuilds: counts.fullDocumentIndexBuilds,
    fragmentIndexBuilds: counts.fragmentIndexBuilds,
    unlabeledIndexBuilds: counts.unlabeledIndexBuilds,
    fullPatchApplies: counts.fullPatchApplies,
    insertionPointFullTreeScans: counts.insertionPointFullTreeScans,
  };
}

function withCounters(run) {
  enableEditPipelineCounters();
  resetEditPipelineCounters();
  try {
    return run();
  } finally {
    disableEditPipelineCounters();
  }
}

function applyIslandText(state, operationId, elementId, text, nextInnerHtml) {
  const index = buildSourceIndex(state.html);
  const element = index.byPagerootId.get(elementId);
  const forwardPlan = planEditableIslandPatch(index, {
    type: "replace-editable-island",
    targetRef: createTargetRef(index, element, { level: "subregion" }),
    beforeInnerHtml: state.html.slice(
      element.contentRange.startOffset,
      element.contentRange.endOffset,
    ),
    nextInnerHtml,
    expectedSourceSha256: state.sourceSha256,
  });
  return applySemanticOperation(state, operation(state, operationId, "setText", {
    target: target(state, elementId),
    text,
    contentHtml: forwardPlan.metadata.nextInnerHtml,
    ...(forwardPlan.metadata.createdPagerootIds?.length
      ? { createdPagerootIds: forwardPlan.metadata.createdPagerootIds }
      : {}),
  }));
}

function canvasDualSetStyle(documentState) {
  const index = buildSourceIndex(documentState.html);
  const styleOperation = operation(documentState, "op_canvas_style_01", "setStyle", {
    target: target(documentState, IDS.section),
    property: "color",
    value: "red",
    important: true,
  });
  const mappedResult = applyPatchPlan(
    planInlineStylePatch(index, {
      type: "set-inline-style",
      targetRef: createTargetRef(index, index.byPagerootId.get(IDS.section), { level: "subregion" }),
      property: "color",
      value: "red",
      important: true,
      expectedSourceSha256: documentState.sourceSha256,
    }),
    documentState.html,
  );
  const semanticResult = applySemanticOperation(documentState, styleOperation);
  assert.equal(mappedResult.html, semanticResult.html);
  assert.equal(mappedResult.sourceSha256, semanticResult.sourceSha256);
  return semanticResult;
}

test("kernel text, space, blank-line, style and structure actions keep identity and history", () => {
  const html = baselineHtml();
  const baseline = createSemanticDocumentState(html);
  const before = identityFacts(baseline.html);

  const colored = applySemanticOperation(baseline, operation(
    baseline,
    "op_color_000001",
    "setStyle",
    {
      target: target(baseline, IDS.strong),
      property: "color",
      value: "blue",
      important: false,
    },
  ));
  const typed = applySemanticOperation(colored.nextState, operation(
    colored.nextState,
    "op_type_0000001",
    "setText",
    { target: target(colored.nextState, IDS.first), text: "AA" },
  ));
  const spaced = applySemanticOperation(typed.nextState, operation(
    typed.nextState,
    "op_space_000001",
    "setText",
    { target: target(typed.nextState, IDS.first), text: "AA " },
  ));
  const blankLines = applyIslandText(
    spaced.nextState,
    "op_enter_000001",
    IDS.second,
    "B\n\n",
    "B<br><br>",
  );
  const deletedBlank = applyIslandText(
    blankLines.nextState,
    "op_del_blank_01",
    IDS.second,
    "B\n",
    "B<br>",
  );
  const afterSave = createSemanticDocumentState(deletedBlank.html, {
    revision: deletedBlank.nextRevision,
    lineage: deletedBlank.nextState.lineage,
  });
  const continued = applyIslandText(
    afterSave,
    "op_continue_001",
    IDS.second,
    "B\nmore",
    "B<br>more",
  );
  const inserted = applySemanticOperation(
    continued.nextState,
    createInsertElementOperation(continued.html, {
      baseRevision: continued.nextRevision,
      operationId: "op_insert_00001",
      parentElementId: IDS.section,
      beforeElementId: IDS.second,
      html: "<em>New</em>",
    }),
    { randomUUID: uuidFactory("10000000-0000-4000-8000-000000000001") },
  );
  const duplicated = applySemanticOperation(
    inserted.nextState,
    createDuplicateElementOperation(inserted.html, {
      baseRevision: inserted.nextRevision,
      operationId: "op_dup_0000001",
      elementId: IDS.first,
    }),
    { randomUUID: uuidFactory("10000000-0000-4000-8000-000000000002") },
  );
  const moved = applySemanticOperation(
    duplicated.nextState,
    createMoveElementOperation(duplicated.html, {
      baseRevision: duplicated.nextRevision,
      operationId: "op_move_0000001",
      elementId: IDS.second,
      parentElementId: IDS.main,
    }),
  );
  const deleted = applySemanticOperation(
    moved.nextState,
    createDeleteElementOperation(moved.html, {
      baseRevision: moved.nextRevision,
      operationId: "op_delete_00001",
      elementId: IDS.first,
    }),
  );

  const context = {
    epoch: 1,
    projectId: "project_edit_pipeline",
    documentId: "document_edit_pipeline",
    sourcePath: "/tmp/edit-pipeline.html",
  };
  const materialization = deleted.materialization.sourcePatchResult;
  const session = new SourceHistorySession();
  session.activate(context, sourceSha256(moved.html), null);
  session.record(context, {
    kind: "structure",
    property: "delete",
    beforeSourceSha256: deleted.previousSourceSha256,
    afterSourceSha256: deleted.sourceSha256,
    forwardPatches: materialization.patches,
    reversePatches: materialization.inversePlan.patches,
    beforeTarget: { id: "target_delete", elementId: IDS.first },
    afterTarget: { id: "target_delete", elementId: IDS.first },
    semanticOperation: createDeleteElementOperation(moved.html, {
      baseRevision: moved.nextRevision,
      operationId: "op_delete_00001",
      elementId: IDS.first,
    }),
    identityDelta: deleted.identityDelta,
  }, 1);
  assert.deepEqual(
    session.acknowledge(context, session.pendingOperations, deleted.sourceSha256),
    { status: "accepted-head" },
  );
  const undone = session.apply(context, "undo", deleted.html, 2);
  assert.equal(undone.html, moved.html);
  assert.equal(undone.sourceSha256, moved.sourceSha256);
  assert.deepEqual(
    session.acknowledge(context, session.pendingOperations, moved.sourceSha256),
    { status: "accepted-head" },
  );
  const redone = session.apply(context, "redo", moved.html, 3);
  assert.equal(redone.html, deleted.html);
  assert.equal(redone.sourceSha256, deleted.sourceSha256);

  const after = identityFacts(deleted.html);
  assert.equal(after.complete, true);
  assert.equal(after.sourceSha256, deleted.sourceSha256);
  assert.ok(after.pagerootIds.includes(IDS.paragraph));
  assert.equal(after.pagerootIds.includes(IDS.first), false);
  assert.match(deleted.html, /B<br data-pageroot-id="[^"]+">more/u);
  assert.match(deleted.html, /color: blue/u);
  assert.equal(before.html, html);

  const stale = operation(deleted.nextState, "op_stale_000001", "setText", {
    target: target(deleted.nextState, IDS.paragraph),
    text: "late",
  });
  stale.expectedSourceSha256 = baseline.sourceSha256;
  assert.throws(
    () => applySemanticOperation(deleted.nextState, stale),
    (error) => error instanceof SemanticOperationError && error.code === "SEMANTIC_OPERATION_STALE_HASH",
  );
  assert.equal(identityFacts(deleted.html).sourceSha256, deleted.sourceSha256);
});

test("same samples freeze kernel and dual-path computation counts", () => {
  const kernelCounts = withCounters(() => {
    const baseline = createSemanticDocumentState(baselineHtml());
    applySemanticOperation(baseline, operation(
      baseline,
      "op_count_text_01",
      "setText",
      { target: target(baseline, IDS.paragraph), text: "Counted" },
    ));
    return countSnapshot();
  });
  const dualPathCounts = withCounters(() => {
    canvasDualSetStyle(createSemanticDocumentState(baselineHtml()));
    return countSnapshot();
  });
  const manyHtml = manyElementHtml();
  const manyElementCount = buildSourceIndex(manyHtml).elements.length;
  const manyElementCounts = withCounters(() => {
    const state = createSemanticDocumentState(manyHtml);
    applySemanticOperation(state, operation(
      state,
      "op_count_many_01",
      "setText",
      { target: target(state, elementId(20)), text: "item 0 edited" },
    ));
    return countSnapshot();
  });
  const largeHtml = largeByteHtml();
  const largeByteCounts = withCounters(() => {
    const state = createSemanticDocumentState(largeHtml);
    applySemanticOperation(state, operation(
      state,
      "op_count_large_01",
      "setText",
      { target: target(state, IDS.paragraph), text: "Hello large" },
    ));
    return countSnapshot();
  });

  assert.deepEqual(kernelCounts, {
    sourceIndexBuilds: 3,
    fullDocumentIndexBuilds: 3,
    fragmentIndexBuilds: 0,
    unlabeledIndexBuilds: 0,
    fullPatchApplies: 1,
    insertionPointFullTreeScans: 0,
  });
  assert.deepEqual(dualPathCounts, {
    sourceIndexBuilds: 6,
    fullDocumentIndexBuilds: 5,
    fragmentIndexBuilds: 0,
    unlabeledIndexBuilds: 1,
    fullPatchApplies: 2,
    insertionPointFullTreeScans: 0,
  });
  assert.ok(manyElementCount >= 240);
  assert.deepEqual(manyElementCounts, kernelCounts);
  assert.ok(largeHtml.length >= 256 * 1024);
  assert.deepEqual(largeByteCounts, kernelCounts);
});
