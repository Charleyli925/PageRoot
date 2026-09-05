import assert from "node:assert/strict";
import test from "node:test";

import {
  disableEditPipelineCounters,
  enableEditPipelineCounters,
  readEditPipelineCounters,
  recordEditPipelineCount,
  resetEditPipelineCounters,
} from "../app/lib/edit-pipeline-counters.js";
import { buildSourceIndex } from "../app/lib/source-index.js";
import { applyPatchPlan, planInlineStylePatch } from "../app/lib/source-patch-engine.js";
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

function managedHtml() {
  return `<!doctype html><html data-pageroot-id="${IDS.html}"><head data-pageroot-id="${IDS.head}"><title data-pageroot-id="${IDS.title}">Demo</title></head><body data-pageroot-id="${IDS.body}"><p data-pageroot-id="${IDS.paragraph}">Hello</p></body></html>`;
}

test("edit-pipeline counters stay silent until a test enables them", () => {
  disableEditPipelineCounters();
  buildSourceIndex(managedHtml());
  const silent = readEditPipelineCounters();
  assert.equal(silent.sourceIndexBuilds, 0);
  assert.equal(silent.fullPatchApplies, 0);
  assert.deepEqual(silent.events, []);

  enableEditPipelineCounters();
  resetEditPipelineCounters();
  const html = managedHtml();
  const index = buildSourceIndex(html);
  const plan = planInlineStylePatch(index, {
    type: "set-inline-style",
    targetRef: createTargetRef(index, index.byPagerootId.get(IDS.paragraph), { level: "subregion" }),
    property: "color",
    value: "red",
    expectedSourceSha256: index.sourceSha256,
  });
  applyPatchPlan(plan, html);
  const active = readEditPipelineCounters();
  assert.equal(active.fullPatchApplies, 1);
  assert.ok(active.sourceIndexBuilds >= 3);
  for (const event of active.events) {
    assert.equal(Object.hasOwn(event, "html"), false);
    assert.equal(Object.hasOwn(event, "source"), false);
  }

  const mutated = readEditPipelineCounters();
  mutated.sourceIndexBuilds = 999;
  mutated.events.push({ kind: "fullPatchApply", scope: "unlabeled", caller: "forged" });
  assert.equal(readEditPipelineCounters().sourceIndexBuilds, active.sourceIndexBuilds);
  assert.equal(readEditPipelineCounters().events.length, active.events.length);

  disableEditPipelineCounters();
  buildSourceIndex(html);
  assert.equal(readEditPipelineCounters().sourceIndexBuilds, 0);
});

test("unknown counter kinds and source payloads are ignored", () => {
  enableEditPipelineCounters();
  resetEditPipelineCounters();
  recordEditPipelineCount("not-a-kind", { html: "<p>secret</p>", caller: "forged" });
  recordEditPipelineCount("insertionPointFullTreeScan", {
    caller: "layoutInsertionPoints",
    html: "<p>secret</p>",
  });
  recordEditPipelineCount("sourceIndexBuild", {
    scope: "full-document",
    caller: "unit",
    html: "<p>secret</p>",
    codeUnitLength: 12,
  });
  const counts = readEditPipelineCounters();
  assert.equal(counts.sourceIndexBuilds, 1);
  assert.equal(counts.fullDocumentIndexBuilds, 1);
  assert.equal(counts.insertionPointFullTreeScans, 1);
  assert.deepEqual(counts.events[0], {
    kind: "insertionPointFullTreeScan",
    scope: "unlabeled",
    caller: "layoutInsertionPoints",
  });
  assert.deepEqual(counts.events[1], {
    kind: "sourceIndexBuild",
    scope: "full-document",
    caller: "unit",
    codeUnitLength: 12,
  });
  disableEditPipelineCounters();
});
