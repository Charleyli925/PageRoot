import assert from "node:assert/strict";
import test from "node:test";

import {
  SEMANTIC_OPERATION_SCHEMA_VERSION,
  SemanticOperationError,
  applySemanticOperation,
  createSemanticDocumentState,
  createSemanticElementPrecondition,
} from "../app/lib/semantic-operation-kernel.js";
import {
  SourceIndexError,
  buildSourceIndex,
  isOwnedSourceIndex,
  resolveOwnedSourceIndex,
  sourceSha256,
} from "../app/lib/source-index.js";
import {
  SourcePatchError,
  applyPatchPlan,
  planInlineStylePatch,
} from "../app/lib/source-patch-engine.js";
import { createTargetRef } from "../app/lib/target-resolver.js";

function elementId(sequence) {
  return `pr1_000000000000400080000000${sequence.toString(16).padStart(8, "0")}`;
}

const IDS = {
  html: elementId(1),
  head: elementId(2),
  title: elementId(3),
  body: elementId(4),
  paragraph: elementId(5),
};

function managedHtml(body = "Hello") {
  return `<!doctype html><html data-pageroot-id="${IDS.html}"><head data-pageroot-id="${IDS.head}"><title data-pageroot-id="${IDS.title}">Demo</title></head><body data-pageroot-id="${IDS.body}"><p data-pageroot-id="${IDS.paragraph}">${body}</p></body></html>`;
}

function duplicateIdHtml() {
  return `<!doctype html><html data-pageroot-id="${IDS.html}"><head data-pageroot-id="${IDS.head}"><title data-pageroot-id="${IDS.title}">Demo</title></head><body data-pageroot-id="${IDS.body}"><p data-pageroot-id="${IDS.paragraph}">A</p><span data-pageroot-id="${IDS.paragraph}">B</span></body></html>`;
}

function stylePlan(html, index = buildSourceIndex(html)) {
  return planInlineStylePatch(index, {
    type: "set-inline-style",
    targetRef: createTargetRef(index, index.byPagerootId.get(IDS.paragraph), { level: "subregion" }),
    property: "color",
    value: "red",
    important: true,
    expectedSourceSha256: index.sourceSha256,
  });
}

function setTextOperation(state, operationId, text) {
  return {
    schemaVersion: SEMANTIC_OPERATION_SCHEMA_VERSION,
    operationId,
    baseRevision: state.revision,
    expectedSourceSha256: state.sourceSha256,
    type: "setText",
    target: createSemanticElementPrecondition(state.html, IDS.paragraph),
    text,
  };
}

test("owned source indexes are read-only and only reuse exact corresponding bytes", () => {
  const html = managedHtml();
  const index = buildSourceIndex(html);
  const other = buildSourceIndex(managedHtml("Other"));
  assert.equal(isOwnedSourceIndex(index), true);
  assert.equal(index.byPagerootId.size > 0, true);
  assert.equal(resolveOwnedSourceIndex(html, index), index);
  assert.throws(
    () => index.byPagerootId.set("forged", { pagerootId: "forged" }),
    /read-only/u,
  );
  assert.throws(
    () => index.elements.push({ pagerootId: "forged" }),
    TypeError,
  );
  assert.equal(index.byPagerootId.get(IDS.paragraph).pagerootId, IDS.paragraph);
  assert.equal(other.byPagerootId.get(IDS.paragraph).raw.includes("Other"), true);

  const forged = {
    source: html,
    sourceSha256: sourceSha256(html),
    byPagerootId: new Map(index.byPagerootId),
  };
  assert.equal(isOwnedSourceIndex(forged), false);
  assert.throws(
    () => resolveOwnedSourceIndex(html, forged),
    (error) => error instanceof SourceIndexError && error.code === "SOURCE_INDEX_NOT_OWNED",
  );
  assert.throws(
    () => resolveOwnedSourceIndex(html, other),
    (error) => error instanceof SourceIndexError && error.code === "SOURCE_INDEX_HTML_MISMATCH",
  );
});

test("applyPatchPlan rejects a mismatched or forged baseIndex and still checks stale hashes", () => {
  const html = managedHtml();
  const index = buildSourceIndex(html);
  const plan = stylePlan(html, index);
  const other = buildSourceIndex(managedHtml("Other"));
  assert.throws(
    () => applyPatchPlan(plan, html, {
      baseIndex: {
        source: html,
        sourceSha256: sourceSha256(html),
        byPagerootId: index.byPagerootId,
      },
    }),
    (error) => error instanceof SourcePatchError && error.code === "SOURCE_INDEX_NOT_OWNED",
  );
  assert.throws(
    () => applyPatchPlan(plan, html, { baseIndex: other }),
    (error) => error instanceof SourcePatchError && error.code === "SOURCE_INDEX_HTML_MISMATCH",
  );
  const reused = applyPatchPlan(plan, html, { baseIndex: index });
  assert.match(reused.html, /color: red/u);
  assert.equal(reused.sourceIndex.source, reused.html);
  const stalePlan = { ...plan, sourceSha256: sourceSha256(managedHtml("stale")) };
  assert.throws(
    () => applyPatchPlan(stalePlan, html, { baseIndex: index }),
    (error) => error instanceof SourcePatchError && error.code === "STALE_SOURCE_HASH",
  );
});

test("kernel reuse cannot bypass stale revision, duplicate IDs or in-place HTML swaps", () => {
  const html = managedHtml();
  const state = createSemanticDocumentState(html);
  const first = applySemanticOperation(state, setTextOperation(state, "op_reuse_text_01", "One"));
  const stale = setTextOperation(first.nextState, "op_reuse_text_02", "Two");
  stale.baseRevision = state.revision;
  assert.throws(
    () => applySemanticOperation(first.nextState, stale),
    (error) => error instanceof SemanticOperationError && error.code === "SEMANTIC_OPERATION_STALE_REVISION",
  );
  assert.equal(first.nextState.html, first.html);

  assert.throws(
    () => createSemanticDocumentState(duplicateIdHtml()),
    (error) => error instanceof SemanticOperationError && error.code === "SEMANTIC_IDENTITY_INCOMPLETE",
  );

  const swapped = { ...state };
  swapped.html = first.html;
  swapped.sourceSha256 = first.sourceSha256;
  const fromCopy = applySemanticOperation(swapped, setTextOperation(swapped, "op_reuse_copy_01", "Copy"));
  assert.match(fromCopy.html, />Copy</u);

  state.html = first.html;
  state.sourceSha256 = first.sourceSha256;
  assert.throws(
    () => applySemanticOperation(state, setTextOperation(state, "op_reuse_swap_01", "Swap")),
    (error) => error instanceof SemanticOperationError && error.code === "SOURCE_INDEX_HTML_MISMATCH",
  );
});

test("one operation cannot mutate the source index another operation is using", () => {
  const leftState = createSemanticDocumentState(managedHtml("Left"));
  const rightState = createSemanticDocumentState(managedHtml("Right"));
  const leftIndex = buildSourceIndex(leftState.html);
  const right = applySemanticOperation(
    rightState,
    setTextOperation(rightState, "op_reuse_right_01", "Righted"),
  );
  assert.throws(
    () => leftIndex.byPagerootId.delete(IDS.paragraph),
    /read-only/u,
  );
  const left = applySemanticOperation(
    leftState,
    setTextOperation(leftState, "op_reuse_left_01", "Lefted"),
  );
  assert.match(left.html, />Lefted</u);
  assert.match(right.html, />Righted</u);
  assert.notEqual(left.html, right.html);
});
