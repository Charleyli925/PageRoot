import test from "node:test";
import assert from "node:assert/strict";
import { inlineStyleOperation, siblingReorderOperation } from "../app/components/html-canvas-source-commands.js";
import { applySemanticOperation, createSemanticDocumentState } from "../app/lib/semantic-operation-kernel.js";
import { buildSourceIndex } from "../app/lib/source-index.js";
import { createTargetRef } from "../app/lib/target-resolver.js";
import { enableEditPipelineCounters, disableEditPipelineCounters, readEditPipelineCounters } from "../app/lib/edit-pipeline-counters.js";

const ids = Object.fromEntries(["html", "head", "body", "section", "a", "b", "c"].map(
  (name, index) => [name, `pr1_00000000000040008000${String(index + 1).padStart(12, "0")}`],
));
const a = `<p data-pageroot-id="${ids.a}" data-x=1 style='color : red !important;  padding:4px ; --Token: 10'>A &amp; B</p>`;
const b = `<p data-pageroot-id="${ids.b}">Second</p>`;
const c = `<p data-pageroot-id="${ids.c}">Third</p>`;
const prefix = `<!doctype html><html data-pageroot-id="${ids.html}"><head data-pageroot-id="${ids.head}"></head><body data-pageroot-id="${ids.body}"><section data-pageroot-id="${ids.section}">`;
const suffix = "</section></body></html>";
const html = `${prefix}${a}${b}${c}${suffix}`;

function setup(source = html) {
  const index = buildSourceIndex(source);
  return { index, state: createSemanticDocumentState(source, { sourceIndex: index }) };
}

test("element style preserves exact surrounding bytes, priority and tracked targets through one materialization", () => {
  const { index, state } = setup();
  const tracked = createTargetRef(index, index.byPagerootId.get(ids.a), { targetId: "comment_style" });
  enableEditPipelineCounters();
  try {
    const operation = inlineStyleOperation(index, {
      elementId: ids.a, baseRevision: 0, operationId: "op_canvas_style_001",
      property: "color", value: "blue", important: false,
    });
    const result = applySemanticOperation(state, operation, { trackedTargetRefs: [tracked] });
    assert.equal(result.html, html.replace("color : red !important", "color : blue"));
    assert.equal(result.materialization.planType, "set-inline-style");
    assert.deepEqual(result.allocatedElementIds, []);
    assert.equal(result.materialization.sourcePatchResult.refreshedTrackedTargetRefs[0].elementId, ids.a);
    assert.equal(readEditPipelineCounters().fullPatchApplies, 1);
    const undo = applySemanticOperation(result.nextState, result.inverseOperation);
    assert.equal(undo.html, html);
    assert.equal(applySemanticOperation(undo.nextState, undo.inverseOperation).html, result.html);
  } finally {
    disableEditPipelineCounters();
  }
});

test("direct style and reorder retain a module-level caller target through the same materialization", () => {
  for (const operationForIndex of [
    (index) => inlineStyleOperation(index, {
      elementId: ids.a,
      baseRevision: 0,
      operationId: "op_canvas_module_style",
      property: "color",
      value: "blue",
      important: false,
    }),
    (index) => siblingReorderOperation(index, {
      elementId: ids.a,
      toIndex: 1,
      baseRevision: 0,
      operationId: "op_canvas_module_reorder",
    }),
  ]) {
    const { index, state } = setup();
    const tracked = createTargetRef(index, index.byPagerootId.get(ids.a), {
      targetId: "target_canvas_module_caller",
      level: "module",
    });
    const result = applySemanticOperation(state, operationForIndex(index), {
      trackedTargetRefs: [tracked],
    });
    assert.notEqual(result.materialization.sourcePatchResult.refreshedTargetRefs[0].targetId, tracked.targetId);
    const refreshed = result.materialization.sourcePatchResult.refreshedTrackedTargetRefs.find(
      (candidate) => candidate.targetId === tracked.targetId,
    );
    assert.equal(refreshed?.targetId, tracked.targetId);
    assert.equal(refreshed?.level, "module");
    assert.notEqual(refreshed?.resolution, "orphaned");
    assert.equal(
      result.materialization.sourcePatchResult.targetMappings.some(
        (mapping) => mapping.targetId === tracked.targetId && mapping.tracked === true,
      ),
      true,
    );
  }
});

test("unchanged element style preserves bytes without allocating identity", () => {
  const { index, state } = setup();
  const result = applySemanticOperation(state, inlineStyleOperation(index, {
    elementId: ids.a, baseRevision: 0, operationId: "op_canvas_style_same",
    property: "color", value: "red", important: true,
  }));
  assert.equal(result.html, html);
  assert.equal(result.changed, false);
  assert.deepEqual(result.allocatedElementIds, []);
});

test("sibling positions use the list without the moving element, including the final position", () => {
  for (const [elementId, toIndex, expected] of [
    [ids.a, 1, `${b}${a}${c}`],
    [ids.a, 2, `${b}${c}${a}`],
    [ids.c, 0, `${c}${a}${b}`],
  ]) {
    const { index, state } = setup();
    const result = applySemanticOperation(state, siblingReorderOperation(index, {
      elementId, toIndex, baseRevision: 0, operationId: "op_canvas_reorder_001",
    }));
    assert.equal(result.html, `${prefix}${expected}${suffix}`);
    assert.equal(result.materialization.planType, "reorder-sibling");
    assert.deepEqual(result.allocatedElementIds, []);
    const undo = applySemanticOperation(result.nextState, result.inverseOperation);
    assert.equal(undo.html, html);
    assert.equal(applySemanticOperation(undo.nextState, undo.inverseOperation).html, result.html);
  }
});

test("direct sibling reorder retains comment ownership and rejects mixed text boundaries", () => {
  const source = `${prefix}${a}<!-- belongs to A -->\n${b}${c}${suffix}`;
  const { index, state } = setup(source);
  const result = applySemanticOperation(state, siblingReorderOperation(index, {
    elementId: ids.a, toIndex: 2, baseRevision: 0, operationId: "op_canvas_comment_move",
  }));
  assert.equal(result.html, `${prefix}${b}${c}${a}<!-- belongs to A -->\n${suffix}`);
  const unsafe = setup(`${prefix}${a}meaningful text${b}${c}${suffix}`);
  assert.throws(() => applySemanticOperation(unsafe.state, siblingReorderOperation(unsafe.index, {
    elementId: ids.a, toIndex: 1, baseRevision: 0, operationId: "op_canvas_unsafe_move",
  })), /non-whitespace text/);
});

test("direct commands retain stale source, target identity and sibling bounds rejection", () => {
  const { index, state } = setup();
  const operation = inlineStyleOperation(index, {
    elementId: ids.a, baseRevision: 0, operationId: "op_canvas_guards_001",
    property: "color", value: "blue", important: false,
  });
  for (const changed of [
    { ...operation, baseRevision: 1 },
    { ...operation, expectedSourceSha256: `sha256:${"0".repeat(64)}` },
    { ...operation, target: { ...operation.target, tagName: "div" } },
    { ...operation, target: { ...operation.target, expectedOuterHtmlSha256: `sha256:${"0".repeat(64)}` } },
    { ...operation, important: undefined },
  ]) assert.throws(() => applySemanticOperation(state, changed));
  for (const elementId of ["", "invalid", "pr1_ffffffffffff4fff8fffffffffffffff"]) {
    assert.throws(() => inlineStyleOperation(index, { ...operation, elementId }));
    assert.throws(() => siblingReorderOperation(index, { elementId, toIndex: 0, baseRevision: 0 }));
  }
  for (const toIndex of [-1, 3, 0.5, NaN]) {
    assert.throws(() => siblingReorderOperation(index, { elementId: ids.a, toIndex, baseRevision: 0 }));
  }
  assert.throws(() => siblingReorderOperation(index, { elementId: ids.body, toIndex: 0, baseRevision: 0 }));
  assert.throws(() => createSemanticDocumentState(html.replace(`data-pageroot-id="${ids.b}"`, `data-pageroot-id="${ids.a}"`)));
});
