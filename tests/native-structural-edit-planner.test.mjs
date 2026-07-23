import assert from "node:assert/strict";
import test from "node:test";

import { buildSourceIndex } from "../app/lib/source-index.js";
import {
  NATIVE_SOURCE_EDIT_KIND,
  planNativeStructuralEdit,
} from "../app/lib/native-structural-edit-planner.js";
import { buildSourceTextMap } from "../app/lib/source-text-map.js";

function sourceMapFor(html, id) {
  const index = buildSourceIndex(html);
  const element = index.elements.find(
    (candidate) => candidate.stableAttributes.id === id,
  );
  assert.ok(element);
  return buildSourceTextMap(index, element.nodeId, { allowEmpty: true });
}

test("multiline plain text becomes one source-owned text-flow command", () => {
  const sourceMap = sourceMapFor(`<p id="copy">甲乙</p>`, "copy");
  const plan = planNativeStructuralEdit(sourceMap, {
    kind: NATIVE_SOURCE_EDIT_KIND.INSERT_TEXT_FLOW,
    inputType: "insertFromPaste",
    text: "第一行\r\n第二行\r第三行",
    selection: {
      anchor: 1,
      focus: 1,
      affinity: "right",
    },
  });

  assert.equal(plan.nextText, "甲第一行\n第二行\n第三行乙");
  assert.deepEqual(plan.selection, {
    anchor: 12,
    focus: 12,
    affinity: "right",
  });
  assert.equal(plan.command.type, "replace-text-flow-range");
  assert.equal(plan.command.replacements[0].nextText, "第一行\n第二行\n第三行");
  assert.deepEqual(plan.command.replacements[0].deleteSegments, []);
});

test("Shift+Enter replaces an ordinary selected text range with one hard break", () => {
  const sourceMap = sourceMapFor(`<p id="copy">甲<strong>乙</strong>丙</p>`, "copy");
  const plan = planNativeStructuralEdit(sourceMap, {
    kind: NATIVE_SOURCE_EDIT_KIND.INSERT_TEXT_FLOW,
    inputType: "insertLineBreak",
    text: "\n",
    selection: {
      anchor: 2,
      focus: 1,
      affinity: "left",
    },
  });

  assert.equal(plan.previousText, "甲乙丙");
  assert.equal(plan.nextText, "甲\n丙");
  assert.deepEqual(plan.selection, {
    anchor: 2,
    focus: 2,
    affinity: "right",
  });
  assert.equal(plan.command.replacements[0].beforeText, "乙");
});

test("backspace and delete target exactly one authored hard break", () => {
  const sourceMap = sourceMapFor(`<p id="copy">甲<br class="keep">乙</p>`, "copy");
  const hardBreak = sourceMap.runs.find((run) => run.kind === "hard-break");
  assert.ok(hardBreak);
  const plan = planNativeStructuralEdit(sourceMap, {
    kind: NATIVE_SOURCE_EDIT_KIND.DELETE_HARD_BREAK,
    inputType: "deleteContentBackward",
    range: {
      startOffset: hardBreak.textStart,
      endOffset: hardBreak.textEnd,
    },
    selection: {
      anchor: hardBreak.textEnd,
      focus: hardBreak.textEnd,
      affinity: "left",
    },
  });

  assert.equal(plan.command.type, "delete-hard-break");
  assert.equal(plan.command.hardBreakNodeId, hardBreak.nodeId);
  assert.equal(plan.nextText, "甲乙");
  assert.deepEqual(plan.selection, {
    anchor: 1,
    focus: 1,
    affinity: "left",
  });
});
