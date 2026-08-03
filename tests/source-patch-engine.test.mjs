import assert from "node:assert/strict";
import test from "node:test";

import {
  SourcePatchError,
  applyPatchPlan,
  buildSourceIndex,
  createInsertionPointTargetRef,
  createTargetRef,
  planSourcePatch,
  resolveTargetRef,
  sourceSha256,
  validatePatchScope,
} from "../app/lib/source-patch-core.js";
function elementBy(index, predicate) {
  const element = index.elements.find(predicate);
  assert.ok(element, "expected source element");
  return element;
}

function assertPatchError(code, callback) {
  assert.throws(
    callback,
    (error) => error instanceof SourcePatchError && error.code === code,
  );
}

function canonicalTestValue(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalTestValue).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(
      (key) => `${JSON.stringify(key)}:${canonicalTestValue(value[key])}`,
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

test("inline style patch preserves quote, attribute order, unrelated declarations, and !important", () => {
  const html = `<button data-x=1 class='cta' style='color : red !important;  padding:4px ; --Token: 10' aria-label="go">Go</button>`;
  const index = buildSourceIndex(html);
  const button = elementBy(index, (element) => element.tagName === "button");
  const targetRef = createTargetRef(index, button.nodeId);
  const updatePlan = planSourcePatch({
    type: "set-inline-style",
    targetRef,
    property: "color",
    value: "rgb(1, 2, 3)",
    beforeValue: "red",
    expectedSourceSha256: index.sourceSha256,
  }, index);
  const updated = applyPatchPlan(updatePlan, html);
  assert.equal(
    updated.html,
    `<button data-x=1 class='cta' style='color : rgb(1, 2, 3) !important;  padding:4px ; --Token: 10' aria-label="go">Go</button>`,
  );
  assert.equal(updated.patches[0].startOffset >= button.startTagRange.startOffset, true);
  assert.equal(updated.patches[0].endOffset <= button.startTagRange.endOffset, true);
  assert.equal(applyPatchPlan(updated.inversePlan, updated.html).html, html);

  const updatedIndex = updated.sourceIndex;
  const updatedButton = elementBy(updatedIndex, (element) => element.tagName === "button");
  const removeImportant = applyPatchPlan(planSourcePatch({
    type: "set-inline-style",
    targetRef: createTargetRef(updatedIndex, updatedButton.nodeId),
    property: "color",
    value: "blue",
    important: false,
  }, updatedIndex), updated.html);
  assert.match(removeImportant.html, /style='color : blue;  padding:4px ; --Token: 10'/u);

  const normalInline = `<button style="color: red">Go</button>`;
  const normalInlineIndex = buildSourceIndex(normalInline);
  const normalInlineButton = elementBy(
    normalInlineIndex,
    (element) => element.tagName === "button",
  );
  const promotedImportant = applyPatchPlan(planSourcePatch({
    type: "set-inline-style",
    targetRef: createTargetRef(normalInlineIndex, normalInlineButton.nodeId),
    property: "color",
    value: "blue",
    important: true,
  }, normalInlineIndex), normalInline);
  assert.equal(
    promotedImportant.html,
    `<button style="color: blue !important">Go</button>`,
  );
});

test("inline style patch adds and deletes declarations/attributes without rewriting the start tag", () => {
  const noStyle = `<div data-key="x" class='card'>Body</div>`;
  const noStyleIndex = buildSourceIndex(noStyle);
  const div = elementBy(noStyleIndex, (element) => element.tagName === "div");
  const added = applyPatchPlan(planSourcePatch({
    type: "set-inline-style",
    targetRef: createTargetRef(noStyleIndex, div.nodeId),
    property: "font-size",
    value: "12px",
  }, noStyleIndex), noStyle);
  assert.equal(
    added.html,
    `<div data-key="x" class='card' style='font-size: 12px'>Body</div>`,
  );
  assert.equal(applyPatchPlan(added.inversePlan, added.html).html, noStyle);

  const many = `<div id=x style="color:red; padding: 4px; margin:0">Body</div>`;
  const manyIndex = buildSourceIndex(many);
  const manyDiv = elementBy(manyIndex, (element) => element.tagName === "div");
  const removed = applyPatchPlan(planSourcePatch({
    type: "set-inline-style",
    targetRef: createTargetRef(manyIndex, manyDiv.nodeId),
    property: "padding",
    value: null,
  }, manyIndex), many);
  assert.equal(removed.html, `<div id=x style="color:red; margin:0">Body</div>`);
  assert.equal(applyPatchPlan(removed.inversePlan, removed.html).html, many);

  const only = `<div id=x style="color:red">Body</div>`;
  const onlyIndex = buildSourceIndex(only);
  const onlyDiv = elementBy(onlyIndex, (element) => element.tagName === "div");
  const attributeRemoved = applyPatchPlan(planSourcePatch({
    type: "set-inline-style",
    targetRef: createTargetRef(onlyIndex, onlyDiv.nodeId),
    property: "color",
    value: null,
  }, onlyIndex), only);
  assert.equal(attributeRemoved.html, `<div id=x >Body</div>`);
  assert.equal(applyPatchPlan(attributeRemoved.inversePlan, attributeRemoved.html).html, only);

  const unquoted = `<div style=color:red>Body</div>`;
  const unquotedIndex = buildSourceIndex(unquoted);
  const unquotedDiv = elementBy(unquotedIndex, (element) => element.tagName === "div");
  const unquotedAdded = applyPatchPlan(planSourcePatch({
    type: "set-inline-style",
    targetRef: createTargetRef(unquotedIndex, unquotedDiv.nodeId),
    property: "margin",
    value: "0 1px",
  }, unquotedIndex), unquoted);
  assert.equal(unquotedAdded.html, `<div style=color:red;margin:0&#32;1px>Body</div>`);
});

test("text range style wraps only selected characters across mixed inline content and preserves entities", () => {
  const html = `<p id="p">开头 &amp; <mark>局部意图</mark> 后文不动</p><aside>outside</aside>`;
  const index = buildSourceIndex(html);
  const paragraph = elementBy(index, (element) => element.tagName === "p");
  const mark = elementBy(index, (element) => element.tagName === "mark");
  const paragraphTexts = paragraph.textNodeIds.map((nodeId) => index.byNodeId.get(nodeId));
  const markText = index.byNodeId.get(mark.textNodeIds[0]);
  const targetRef = createTargetRef(index, paragraph.nodeId, { level: "subregion" });
  const plan = planSourcePatch({
    type: "set-text-range-style",
    targetRef,
    segments: [
      { textNodeId: paragraphTexts[0].nodeId, startOffset: 3, endOffset: 4 },
      { textNodeId: markText.nodeId, startOffset: 0, endOffset: 4 },
      { textNodeId: paragraphTexts[1].nodeId, startOffset: 1, endOffset: 3 },
    ],
    property: "font-weight",
    value: "700",
    expectedSourceSha256: index.sourceSha256,
  }, index);
  const result = applyPatchPlan(plan, html);

  assert.equal(
    result.html,
    `<p id="p">开头 <span style="all: unset; display: inline !important; font-weight: 700">&amp;</span> <mark><span style="all: unset; display: inline !important; font-weight: 700">局部意图</span></mark> <span style="all: unset; display: inline !important; font-weight: 700">后文</span>不动</p><aside>outside</aside>`,
  );
  assert.equal(result.scopeReport.outsideUnchanged, true);
  assert.equal(result.parseIntegrity.ok, true);
  assert.equal(result.patches.length, 6);
  assert.equal(
    result.patches
      .filter((patch) => patch.kind === "text-range-style-open")
      .every((patch) => patch.after.startsWith(
        `<span style="all: unset; display: inline !important; `,
      )),
    true,
  );
  assert.doesNotMatch(result.html, /display\s*:\s*contents|all\s*:\s*inherit/iu);
  assert.equal(applyPatchPlan(result.inversePlan, result.html).html, html);
});

test("text range style stays layout-transparent and reuses a whole selected wrapper", () => {
  const html = `<p class="button">打开原生对话框</p>`;
  const index = buildSourceIndex(html);
  const paragraph = elementBy(index, (element) => element.tagName === "p");
  const paragraphText = index.byNodeId.get(paragraph.textNodeIds[0]);
  const originalTarget = createTargetRef(index, paragraph.nodeId);
  const firstPlan = planSourcePatch({
    type: "set-text-range-style",
    targetRef: originalTarget,
    segments: [{ textNodeId: paragraphText.nodeId, startOffset: 2, endOffset: 4 }],
    property: "font-weight",
    value: "700",
  }, index);
  const first = applyPatchPlan(firstPlan, html);

  assert.match(
    first.html,
    /打开<span style="all: unset; display: inline !important; font-weight: 700">原生<\/span>对话框/u,
  );
  assert.equal(resolveTargetRef(first.sourceIndex, originalTarget).resolution, "rebound");
  const wrapper = elementBy(
    first.sourceIndex,
    (element) => element.tagName === "span" && element.textContent === "原生",
  );
  const wrapperText = first.sourceIndex.byNodeId.get(wrapper.textNodeIds[0]);
  const secondPlan = planSourcePatch({
    type: "set-text-range-style",
    targetRef: first.refreshedTargetRefs.find(
      (target) => target.targetId === originalTarget.targetId,
    ),
    segments: [{
      textNodeId: wrapperText.nodeId,
      startOffset: 0,
      endOffset: wrapperText.value.length,
    }],
    property: "font-style",
    value: "italic",
  }, first.sourceIndex);
  const second = applyPatchPlan(secondPlan, first.html);

  assert.equal(secondPlan.type, "set-text-range-style");
  assert.equal(
    secondPlan.metadata.writeScope,
    "existing-text-range-wrapper-inline-style",
  );
  assert.equal((second.html.match(/<span\b/gu) ?? []).length, 1);
  assert.match(second.html, /font-weight: 700; font-style: italic/u);
  assert.equal(
    elementBy(second.sourceIndex, (element) => element.tagName === "p").textContent,
    "打开原生对话框",
  );

  const secondThroughAncestor = planSourcePatch({
    type: "set-text-range-style",
    targetRef: first.refreshedTargetRefs.find(
      (target) => target.targetId === originalTarget.targetId,
    ),
    segments: [{
      textNodeId: wrapperText.nodeId,
      startOffset: 0,
      endOffset: wrapperText.value.length,
    }],
    property: "font-style",
    value: "italic",
  }, first.sourceIndex);
  const ancestorResult = applyPatchPlan(secondThroughAncestor, first.html);

  assert.equal(secondThroughAncestor.type, "set-text-range-style");
  assert.equal(secondThroughAncestor.metadata.writeScope, "existing-text-range-wrapper-inline-style");
  assert.equal((ancestorResult.html.match(/<span\b/gu) ?? []).length, 1);
  assert.match(ancestorResult.html, /font-weight: 700; font-style: italic/u);
});

test("text range style rejects invalid, unrelated, and tampered ranges", () => {
  const html = `<p id="p">hello <strong>world</strong></p><aside>outside</aside>`;
  const index = buildSourceIndex(html);
  const paragraph = elementBy(index, (element) => element.tagName === "p");
  const aside = elementBy(index, (element) => element.tagName === "aside");
  const paragraphText = index.byNodeId.get(paragraph.textNodeIds[0]);
  const asideText = index.byNodeId.get(aside.textNodeIds[0]);
  const targetRef = createTargetRef(index, paragraph.nodeId, { level: "subregion" });

  assertPatchError("INVALID_TEXT_RANGE", () => planSourcePatch({
    type: "set-text-range-style",
    targetRef,
    segments: [{ textNodeId: paragraphText.nodeId, startOffset: 2, endOffset: 2 }],
    property: "color",
    value: "#ff0000",
  }, index));
  assertPatchError("TEXT_RANGE_TARGET_MISMATCH", () => planSourcePatch({
    type: "set-text-range-style",
    targetRef,
    segments: [{ textNodeId: asideText.nodeId, startOffset: 0, endOffset: 3 }],
    property: "color",
    value: "#ff0000",
  }, index));
  assertPatchError("OVERLAPPING_TEXT_RANGES", () => planSourcePatch({
    type: "set-text-range-style",
    targetRef,
    segments: [
      { textNodeId: paragraphText.nodeId, startOffset: 0, endOffset: 2 },
      { textNodeId: paragraphText.nodeId, startOffset: 2, endOffset: 5 },
    ],
    property: "color",
    value: "#ff0000",
  }, index));

  const plan = planSourcePatch({
    type: "set-text-range-style",
    targetRef,
    segments: [{ textNodeId: paragraphText.nodeId, startOffset: 0, endOffset: 5 }],
    property: "color",
    value: "#ff0000",
  }, index);
  const tampered = {
    ...plan,
    patches: plan.patches.map((patch, patchIndex) => (
      patchIndex === 0 ? { ...patch, after: `<span style="color: blue">` } : patch
    )),
  };
  assertPatchError("PATCH_PLAN_TAMPERED", () => applyPatchPlan(tampered, html));
});

test("text range style rejects raw, restricted, and foreign-content descendants", () => {
  for (const [html, parentTag] of [
    [`<div id="target">A<xmp>B</xmp>C</div>`, "xmp"],
    [`<div id="target">A<textarea>B</textarea>C</div>`, "textarea"],
    [`<div id="target">A<select><option>B</option></select>C</div>`, "option"],
    [`<div id="target">A<svg><text>B</text></svg>C</div>`, "text"],
  ]) {
    const index = buildSourceIndex(html);
    const target = elementBy(index, (element) => element.stableAttributes.id === "target");
    const parent = elementBy(index, (element) => element.tagName === parentTag);
    const textNode = index.byNodeId.get(parent.textNodeIds[0]);
    assertPatchError("TEXT_RANGE_UNSAFE_CONTEXT", () => planSourcePatch({
      type: "set-text-range-style",
      targetRef: createTargetRef(index, target.nodeId, { level: "subregion" }),
      segments: [{ textNodeId: textNode.nodeId, startOffset: 0, endOffset: 1 }],
      property: "font-weight",
      value: "700",
    }, index));
  }
});

test("inline style patch rejects duplicate style attributes and duplicate property declarations", () => {
  for (const [html, code] of [
    [`<div style="color:red" style='padding:0'>x</div>`, "DUPLICATE_STYLE_ATTRIBUTE"],
    [`<div style="color:red; color:blue">x</div>`, "DUPLICATE_STYLE_PROPERTY"],
  ]) {
    const index = buildSourceIndex(html);
    const div = elementBy(index, (element) => element.tagName === "div");
    assertPatchError(code, () => planSourcePatch({
      type: "set-inline-style",
      targetRef: createTargetRef(index, div.nodeId),
      property: "color",
      value: "green",
    }, index));
  }
});

test("inline style patch rejects comment-obscured declarations and important tokens", () => {
  for (const html of [
    `<div style="color:red; /*note*/ color:blue">x</div>`,
    `<div style="color:red !/**/important">x</div>`,
  ]) {
    const index = buildSourceIndex(html);
    const div = elementBy(index, (element) => element.tagName === "div");
    assertPatchError("UNSAFE_STYLE_SYNTAX", () => planSourcePatch({
      type: "set-inline-style",
      targetRef: createTargetRef(index, div.nodeId),
      property: "color",
      value: "green",
    }, index));
  }
});

test("inline style patch rejects declaration injection and implicit priority changes on every write path", () => {
  for (const html of [
    `<div style="color:red; padding:4px">x</div>`,
    `<div class="plain">x</div>`,
    `<div style=color:red>x</div>`,
  ]) {
    const index = buildSourceIndex(html);
    const div = elementBy(index, (element) => element.tagName === "div");
    const targetRef = createTargetRef(index, div.nodeId);
    for (const value of ["blue; padding:0", "blue !important"]) {
      assertPatchError("UNSAFE_STYLE_VALUE", () => planSourcePatch({
        type: "set-inline-style",
        targetRef,
        property: "color",
        value,
      }, index));
    }
  }

  const safeHtml = `<div>x</div>`;
  const safeIndex = buildSourceIndex(safeHtml);
  const safeDiv = elementBy(safeIndex, (element) => element.tagName === "div");
  const safe = applyPatchPlan(planSourcePatch({
    type: "set-inline-style",
    targetRef: createTargetRef(safeIndex, safeDiv.nodeId),
    property: "background-image",
    value: `url("data:text/plain;a")`,
  }, safeIndex), safeHtml);
  assert.equal(
    safe.html,
    `<div style="background-image: url(&quot;data:text/plain;a&quot;)">x</div>`,
  );
});

test("inline style patch rejects escaped and non-canonical declaration property names", () => {
  for (const html of [
    `<div style="c\\olor:red; color:blue">x</div>`,
    `<div style="c\\6flor:red; color:blue">x</div>`,
    `<div style="*color:red; color:blue">x</div>`,
  ]) {
    const index = buildSourceIndex(html);
    const div = elementBy(index, (element) => element.tagName === "div");
    assertPatchError("UNSAFE_STYLE_SYNTAX", () => planSourcePatch({
      type: "set-inline-style",
      targetRef: createTargetRef(index, div.nodeId),
      property: "color",
      value: "green",
    }, index));
  }
});

test("sibling reorder moves exact source fragments with leading comments, preserves internals, rebinds, and inverts", () => {
  const html = `<div id="parent">\n  <!-- A -->\n  <section data-key="a" class='one'>\n    <h2>A</h2>\n  </section>\n  <!-- B -->\n  <section data-key="b"><p>B</p></section>\n  <section data-key="c" style="color:red"><p>C</p></section>\n</div>`;
  const index = buildSourceIndex(html);
  const sections = Object.fromEntries(index.elements
    .filter((element) => element.tagName === "section")
    .map((element) => [element.stableAttributes["data-key"], element]));
  const aRef = createTargetRef(index, sections.a.nodeId, { level: "module" });
  const plan = planSourcePatch({
    type: "reorder-sibling",
    targetRef: createTargetRef(index, sections.c.nodeId, { level: "module" }),
    beforeTargetRef: aRef,
    beforeOrder: [sections.a.nodeId, sections.b.nodeId, sections.c.nodeId],
    expectedSourceSha256: index.sourceSha256,
  }, index);
  const result = applyPatchPlan(plan, html);
  assert.equal(
    result.html,
    `<div id="parent">\n  <section data-key="c" style="color:red"><p>C</p></section>\n  <!-- A -->\n  <section data-key="a" class='one'>\n    <h2>A</h2>\n  </section>\n  <!-- B -->\n  <section data-key="b"><p>B</p></section>\n</div>`,
  );
  for (const section of Object.values(sections)) {
    assert.equal(result.html.includes(section.raw), true);
  }
  assert.equal(resolveTargetRef(result.sourceIndex, aRef).resolution, "rebound");
  assert.equal(result.scopeReport.outsideUnchanged, true);
  assert.equal(applyPatchPlan(result.inversePlan, result.html).html, html);
});

test("sibling reorder moves an unambiguously owned trailing comment and preserves inverse identity", () => {
  const html = `<div id="parent">\n<section data-key="a">A</section>\n<section data-key="b">B</section><!-- B tail -->\n</div>`;
  const index = buildSourceIndex(html);
  const sections = Object.fromEntries(index.elements
    .filter((element) => element.tagName === "section")
    .map((element) => [element.stableAttributes["data-key"], element]));
  const aRef = createTargetRef(index, sections.a.nodeId, {
    level: "module",
    targetId: "module-a",
  });
  const bRef = createTargetRef(index, sections.b.nodeId, {
    level: "module",
    targetId: "module-b",
  });
  const result = applyPatchPlan(planSourcePatch({
    type: "reorder-sibling",
    targetRef: bRef,
    beforeTargetRef: aRef,
  }, index), html);

  assert.equal(
    result.html,
    `<div id="parent">\n<section data-key="b">B</section><!-- B tail -->\n<section data-key="a">A</section>\n</div>`,
  );
  assert.equal(result.targetMappings[0].targetId, "module-b");
  assert.equal(result.targetMappings[0].resolution, "exact");
  assert.equal(result.targetMappings[1].targetId, "module-a");
  assert.equal(result.targetMappings[1].resolution, "exact");
  assert.equal(applyPatchPlan(result.inversePlan, result.html).html, html);
});

test("sibling reorder fails closed for non-whitespace siblings and ambiguous comment ownership", () => {
  for (const html of [
    `<div><section data-key="a">A</section>loose text<section data-key="b">B</section></div>`,
    `<div><section data-key="a">A</section> <!-- trailing? -->\n<section data-key="b">B</section></div>`,
    `<div><section data-key="a">A</section><section data-key="b">B</section>\n<!-- parent note --></div>`,
  ]) {
    const index = buildSourceIndex(html);
    const sections = index.elements.filter((element) => element.tagName === "section");
    assertPatchError("UNSAFE_REORDER_BOUNDARY", () => planSourcePatch({
      type: "reorder-sibling",
      targetRef: createTargetRef(index, sections[1].nodeId),
      beforeTargetRef: createTargetRef(index, sections[0].nodeId),
    }, index));
  }
});

test("apply authorizes patches against exact operation TargetRefs and rejects tampering", () => {
  const html = `<div><p id="a">one</p><p id="b">two</p></div>`;
  const index = buildSourceIndex(html);
  const paragraphs = Object.fromEntries(index.elements
    .filter((element) => element.tagName === "p")
    .map((element) => [element.stableAttributes.id, element]));
  const aRef = createTargetRef(index, paragraphs.a.nodeId, { level: "subregion" });
  const bRef = createTargetRef(index, paragraphs.b.nodeId, { level: "subregion" });
  const plan = planSourcePatch({
    type: "replace-editable-island",
    targetRef: bRef,
    beforeInnerHtml: "two",
    nextInnerHtml: "changed",
  }, index);

  assertPatchError("PATCH_TARGETS_REQUIRED", () => applyPatchPlan({
    ...plan,
    targetRefs: [],
  }, html));
  assertPatchError("PATCH_OUTSIDE_TARGET", () => applyPatchPlan({
    ...plan,
    targetRefs: [aRef],
  }, html));
  assertPatchError("PATCH_PLAN_TAMPERED", () => applyPatchPlan({
    ...plan,
    patches: plan.patches.map((patch) => ({ ...patch, after: "&lt;" })),
  }, html));

  const applied = applyPatchPlan(plan, html);
  assertPatchError("INVERSE_PLAN_UNTRUSTED", () => applyPatchPlan({
    ...applied.inversePlan,
    patches: applied.inversePlan.patches.map((patch) => ({
      ...patch,
      after: "forged",
    })),
  }, applied.html));
  assertPatchError("INVERSE_PLAN_UNTRUSTED", () => applyPatchPlan({
    ...applied.inversePlan,
    targetRefs: [createTargetRef(
      applied.sourceIndex,
      elementBy(applied.sourceIndex, (element) => element.stableAttributes.id === "a").nodeId,
      { level: "subregion" },
    )],
  }, applied.html));
  const originalInverseAfter = applied.inversePlan.patches[0].after;
  applied.inversePlan.patches[0].after = "forged";
  assertPatchError(
    "INVERSE_PLAN_TAMPERED",
    () => applyPatchPlan(applied.inversePlan, applied.html),
  );
  applied.inversePlan.patches[0].after = originalInverseAfter;
  assert.equal(applyPatchPlan(applied.inversePlan, applied.html).html, html);

  const withUnsafeTrackedRef = applyPatchPlan(plan, html, {
    trackedTargetRefs: [{
      targetId: "malformed-tracked-ref",
      label: "Malformed",
      level: "bogus",
      resolution: "exact",
    }],
  });
  assert.equal(withUnsafeTrackedRef.html, applied.html);
  assert.equal(
    withUnsafeTrackedRef.targetMappings.find(
      (mapping) => mapping.targetId === "malformed-tracked-ref",
    ).resolution,
    "orphaned",
  );
});

test("handcrafted self-authenticated inverse plans cannot bypass provenance validation", () => {
  const html = `<p>safe</p>`;
  const forgedOutput = `<p>evil</p>`;
  const index = buildSourceIndex(html);
  const paragraph = elementBy(index, (element) => element.tagName === "p");
  const targetRefs = [createTargetRef(index, paragraph.nodeId, { level: "subregion" })];
  const provenance = {
    baseSourceSha256: sourceSha256(forgedOutput),
    outputSourceSha256: index.sourceSha256,
    operationType: "replace-editable-island",
    appliedPatches: [{
      startOffset: 3,
      endOffset: 7,
      before: "evil",
      after: "safe",
      kind: "editable-island",
    }],
  };
  provenance.token = sourceSha256(canonicalTestValue({
    baseSourceSha256: provenance.baseSourceSha256,
    outputSourceSha256: provenance.outputSourceSha256,
    operationType: provenance.operationType,
    appliedPatches: provenance.appliedPatches,
    targetRefs,
  }));
  const forgedInverse = {
    version: 1,
    type: "inverse:replace-editable-island",
    sourceSha256: index.sourceSha256,
    patches: [{
      startOffset: 3,
      endOffset: 7,
      before: "safe",
      after: "evil",
      kind: "inverse:editable-island",
    }],
    targetRefs,
    metadata: {
      operationType: "replace-editable-island",
      inverseProvenance: provenance,
    },
  };

  assertPatchError(
    "INVERSE_PLAN_UNTRUSTED",
    () => applyPatchPlan(forgedInverse, html),
  );
});

test("source scope evidence rejects undeclared changes", () => {
  const html = `<div><p>ok</p></div>`;
  const startOffset = html.indexOf("ok");
  const declared = [{
    startOffset,
    endOffset: startOffset + 2,
    before: "ok",
    after: "fine",
    kind: "text",
  }];
  const validNext = `<div><p>fine</p></div>`;
  assert.equal(validatePatchScope(html, validNext, declared).outsideUnchanged, true);
  assert.equal(
    validatePatchScope(html, `${validNext}<script>outside()</script>`, declared).outsideUnchanged,
    false,
  );
});

test("target mappings preserve editable-island identity through apply, inverse, and reapplication", () => {
  const html = `<p>before</p>`;
  const index = buildSourceIndex(html);
  const paragraph = elementBy(index, (element) => element.tagName === "p");
  const targetRef = createTargetRef(index, paragraph.nodeId, {
    level: "subregion",
    targetId: "editable-island-target",
  });
  const plan = planSourcePatch({
    type: "replace-editable-island",
    targetRef,
    beforeInnerHtml: "before",
    nextInnerHtml: "after",
  }, index);
  const result = applyPatchPlan(plan, html);
  const mapping = result.targetMappings[0];

  assert.equal(mapping.targetId, "editable-island-target");
  assert.equal(mapping.resolution, "exact");
  assert.equal(mapping.afterTargetRef.targetId, "editable-island-target");
  assert.equal(mapping.afterTargetRef.sourceAnchor.sourceSha256, result.sourceSha256);
  assert.equal(
    resolveTargetRef(result.sourceIndex, mapping.afterTargetRef).resolution,
    "exact",
  );
  assert.deepEqual(result.inversePlan.targetRefs, result.refreshedTargetRefs);

  const restoredResult = applyPatchPlan(result.inversePlan, result.html);
  assert.equal(restoredResult.html, html);
  const reapplied = applyPatchPlan(restoredResult.inversePlan, restoredResult.html);
  assert.equal(reapplied.html, result.html);
  assert.equal(reapplied.targetMappings[0].targetId, "editable-island-target");
  assert.equal(reapplied.targetMappings[0].resolution, "exact");
});

test("tracked insertion points refresh deterministically through offset-shifting edits and inverse", () => {
  const html = `<div><p>A</p><section id="b">B</section></div>`;
  const index = buildSourceIndex(html);
  const paragraph = elementBy(index, (element) => element.tagName === "p");
  const parent = elementBy(index, (element) => element.tagName === "div");
  const section = elementBy(index, (element) => element.tagName === "section");
  const insertionRef = createInsertionPointTargetRef(index, {
    parentId: parent.nodeId,
    beforeSiblingId: section.nodeId,
    targetId: "insert-before-b",
  });
  const result = applyPatchPlan(planSourcePatch({
    type: "replace-editable-island",
    targetRef: createTargetRef(index, paragraph.nodeId, { level: "subregion" }),
    beforeInnerHtml: "A",
    nextInnerHtml: "LONGER",
  }, index), html, {
    trackedTargetRefs: [insertionRef],
  });
  const refreshed = result.refreshedTrackedTargetRefs[0];
  const nextSection = elementBy(
    result.sourceIndex,
    (element) => element.stableAttributes.id === "b",
  );

  assert.equal(refreshed.targetId, "insert-before-b");
  assert.equal(refreshed.resolution, "exact");
  assert.equal(refreshed.sourceAnchor.sourceSha256, result.sourceSha256);
  assert.equal(refreshed.sourceAnchor.startOffset, nextSection.range.startOffset);
  assert.notEqual(
    refreshed.sourceAnchor.startOffset,
    insertionRef.sourceAnchor.startOffset,
  );
  assert.equal(resolveTargetRef(result.sourceIndex, refreshed).resolution, "exact");

  const undone = applyPatchPlan(result.inversePlan, result.html);
  assert.equal(undone.html, html);
  const restored = undone.refreshedTrackedTargetRefs[0];
  assert.equal(restored.targetId, "insert-before-b");
  assert.equal(restored.resolution, "exact");
  assert.equal(restored.sourceAnchor.sourceSha256, index.sourceSha256);
  assert.equal(restored.sourceAnchor.startOffset, section.range.startOffset);
});

test("duplicate sibling reorder maps operation and tracked target identities deterministically", () => {
  const html = `<div><section>same</section><section>same</section><section>other</section></div>`;
  const index = buildSourceIndex(html);
  const sections = index.elements.filter((element) => element.tagName === "section");
  const firstRef = createTargetRef(index, sections[0].nodeId, {
    level: "module",
    targetId: "first",
  });
  const secondRef = createTargetRef(index, sections[1].nodeId, {
    level: "module",
    targetId: "second",
  });
  const thirdRef = createTargetRef(index, sections[2].nodeId, {
    level: "module",
    targetId: "third",
  });
  const result = applyPatchPlan(planSourcePatch({
    type: "reorder-sibling",
    targetRef: secondRef,
    beforeTargetRef: firstRef,
  }, index), html, {
    trackedTargetRefs: [thirdRef],
  });
  const mappings = Object.fromEntries(
    result.targetMappings.map((mapping) => [mapping.targetId, mapping]),
  );

  assert.equal(result.html, `<div><section>same</section><section>same</section><section>other</section></div>`);
  assert.equal(mappings.second.afterNodeId, result.sourceIndex.elements
    .filter((element) => element.tagName === "section")[0].nodeId);
  assert.equal(mappings.first.afterNodeId, result.sourceIndex.elements
    .filter((element) => element.tagName === "section")[1].nodeId);
  assert.equal(mappings.third.resolution, "exact");
  assert.equal(mappings.third.tracked, true);
  assert.equal(mappings.third.afterTargetRef.targetId, "third");
  assert.equal(applyPatchPlan(result.inversePlan, result.html).html, html);
});

test("tracked insertion points follow their before-sibling through reorder and inverse", () => {
  const html = `<div><section id="a">A</section><section id="b">B</section></div>`;
  const index = buildSourceIndex(html);
  const parent = elementBy(index, (element) => element.tagName === "div");
  const sections = Object.fromEntries(index.elements
    .filter((element) => element.tagName === "section")
    .map((element) => [element.stableAttributes.id, element]));
  const insertionRef = createInsertionPointTargetRef(index, {
    parentId: parent.nodeId,
    beforeSiblingId: sections.b.nodeId,
    targetId: "slot-before-b",
  });
  const result = applyPatchPlan(planSourcePatch({
    type: "reorder-sibling",
    targetRef: createTargetRef(index, sections.b.nodeId, { level: "module" }),
    beforeTargetRef: createTargetRef(index, sections.a.nodeId, { level: "module" }),
  }, index), html, {
    trackedTargetRefs: [insertionRef],
  });
  const nextB = elementBy(
    result.sourceIndex,
    (element) => element.stableAttributes.id === "b",
  );
  const movedInsertion = result.refreshedTrackedTargetRefs[0];

  assert.equal(
    result.html,
    `<div><section id="b">B</section><section id="a">A</section></div>`,
  );
  assert.equal(movedInsertion.targetId, "slot-before-b");
  assert.equal(movedInsertion.resolution, "exact");
  assert.equal(movedInsertion.sourceAnchor.sourceSha256, result.sourceSha256);
  assert.equal(movedInsertion.sourceAnchor.startOffset, nextB.range.startOffset);
  assert.equal(resolveTargetRef(result.sourceIndex, movedInsertion).resolution, "exact");

  const undone = applyPatchPlan(result.inversePlan, result.html);
  assert.equal(undone.html, html);
  const restored = undone.refreshedTrackedTargetRefs[0];
  assert.equal(restored.targetId, "slot-before-b");
  assert.equal(restored.resolution, "exact");
  assert.equal(restored.sourceAnchor.sourceSha256, index.sourceSha256);
  assert.equal(restored.sourceAnchor.startOffset, sections.b.range.startOffset);
});

test("native text formatting never invents a persistent layout wrapper", () => {
  const html = `<p id="b">打开<span style="font-weight: normal"><span style="font-weight: 700">原生</span></span><span style="all: inherit; display: contents !important; color: green">对话</span>框</p>`;
  const index = buildSourceIndex(html);
  const paragraph = elementBy(index, (element) => element.stableAttributes.id === "b");
  const nativeText = index.textNodes.find((textNode) => textNode.value === "原生");
  const targetRef = createTargetRef(index, paragraph.nodeId, {
    level: "subregion",
    targetId: "flex-text-flow",
  });

  const result = applyPatchPlan(planSourcePatch({
    type: "set-text-range-style",
    targetRef,
    segments: [{
      textNodeId: nativeText.nodeId,
      startOffset: 0,
      endOffset: nativeText.value.length,
    }],
    property: "font-size",
    value: "18px",
    expectedSourceSha256: index.sourceSha256,
  }, index), html);

  assert.doesNotMatch(result.html, /data-pageroot-text-flow-item/u);
  assert.match(
    result.html,
    /<p id="b">打开<span[^>]*><span[^>]*font-size: 18px[^>]*>原生<\/span><\/span><span[^>]*>对话<\/span>框<\/p>/u,
  );
  assert.equal(result.refreshedTargetRefs[0].resolution, "exact");
  assert.equal(applyPatchPlan(result.inversePlan, result.html).html, html);
});

test("whole-root native text replacement changes only the text bytes and undoes exactly", () => {
  const html = `<p id='b'  data-note="keep">文字</p>`;
  const index = buildSourceIndex(html);
  const paragraph = elementBy(index, (element) => element.stableAttributes.id === "b");
  const result = applyPatchPlan(planSourcePatch({
    type: "replace-editable-island",
    targetRef: createTargetRef(index, paragraph.nodeId, { level: "subregion" }),
    beforeInnerHtml: "文字",
    nextInnerHtml: "新版",
  }, index), html);

  assert.equal(result.html, `<p id='b'  data-note="keep">新版</p>`);
  assert.equal(result.patches.length, 1);
  assert.equal(applyPatchPlan(result.inversePlan, result.html).html, html);
});
