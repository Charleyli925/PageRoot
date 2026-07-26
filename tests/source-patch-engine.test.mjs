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
import {
  buildSourceTextMap,
  textRangeToSourceEdit,
} from "../app/lib/source-text-map.js";

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

test("text patch handles entities, Chinese, emoji, combining characters, CRLF, outside protection, and inverse", () => {
  const html = `<!doctype html>\r\n<html>\r\n<head></head>\r\n<body>\r\n  <h2 id='title'>中😀e\u0301 &amp; 末</h2>\r\n  <section data-keep="yes">  untouched  </section>\r\n</body>\r\n</html>`;
  const index = buildSourceIndex(html);
  const heading = elementBy(index, (element) => element.tagName === "h2");
  const targetRef = createTargetRef(index, heading.nodeId, { level: "text" });
  const plan = planSourcePatch({
    type: "replace-text",
    targetRef,
    beforeText: "中😀e\u0301 & 末",
    nextText: "新😀e\u0301 < & 文本",
    expectedSourceSha256: index.sourceSha256,
  }, index);
  const result = applyPatchPlan(plan, html);

  assert.match(result.html, /<h2 id='title'>新😀e\u0301 &lt; &amp; 文本<\/h2>/u);
  assert.match(result.html, /\r\n  <section data-keep="yes">  untouched  <\/section>\r\n/u);
  assert.equal(result.scopeReport.outsideUnchanged, true);
  assert.equal(result.scopeReport.verdict, "allowed");
  assert.equal(result.parseIntegrity.ok, true);
  assert.equal(result.patches.length, 1);
  assert.equal(result.patches[0].before, "中😀e\u0301 &amp; 末");
  const undone = applyPatchPlan(result.inversePlan, result.html);
  assert.equal(undone.html, html);
  const redone = applyPatchPlan(undone.inversePlan, undone.html);
  assert.equal(redone.html, result.html);
  assert.equal(redone.sourceSha256, result.sourceSha256);
});

test("text patch fails closed for mixed content, stale hash, and stale before content", () => {
  const mixed = `<button id="b">保存 <strong>现在</strong></button>`;
  const mixedIndex = buildSourceIndex(mixed);
  const button = elementBy(mixedIndex, (element) => element.tagName === "button");
  const targetRef = createTargetRef(mixedIndex, button.nodeId);
  assertPatchError("MIXED_TEXT_CONTENT", () => planSourcePatch({
    type: "replace-text",
    targetRef,
    beforeText: "保存 现在",
    nextText: "完成",
  }, mixedIndex));

  const html = `<p id="p">before</p>`;
  const index = buildSourceIndex(html);
  const paragraph = elementBy(index, (element) => element.tagName === "p");
  const paragraphRef = createTargetRef(index, paragraph.nodeId, { level: "text" });
  assertPatchError("STALE_SOURCE_HASH", () => planSourcePatch({
    type: "replace-text",
    targetRef: paragraphRef,
    beforeText: "before",
    nextText: "after",
    expectedSourceSha256: "0".repeat(64),
  }, index));
  assertPatchError("STALE_BEFORE_CONTENT", () => planSourcePatch({
    type: "replace-text",
    targetRef: paragraphRef,
    beforeText: "already changed",
    nextText: "after",
  }, index));

  const plan = planSourcePatch({
    type: "replace-text",
    targetRef: paragraphRef,
    beforeText: "before",
    nextText: "after",
  }, index);
  const externallyChanged = `<p id="p">BEFORE</p>`;
  const externallyChangedIndex = buildSourceIndex(externallyChanged);
  const forgedForBeforeCheck = {
    ...plan,
    sourceSha256: sourceSha256(externallyChanged),
    targetRefs: [createTargetRef(
      externallyChangedIndex,
      elementBy(externallyChangedIndex, (element) => element.tagName === "p").nodeId,
      { level: "text" },
    )],
  };
  assertPatchError(
    "STALE_BEFORE_CONTENT",
    () => applyPatchPlan(forgedForBeforeCheck, externallyChanged),
  );
});

test("text range patch edits mixed inline text without flattening markup and inverts byte-exactly", () => {
  const html = `<section data-keep="字节不动"><p id="activity"><strong>顾宁</strong> 发布了研&amp;究简报 😀</p><aside>outside</aside></section>`;
  const index = buildSourceIndex(html);
  const paragraph = elementBy(
    index,
    (element) => element.stableAttributes.id === "activity",
  );
  const trailingText = index.byNodeId.get(paragraph.textNodeIds[0]);
  assert.equal(trailingText.type, "text");
  assert.equal(trailingText.value, " 发布了研&究简报 😀");
  const selectedText = "研&究简报";
  const startOffset = trailingText.value.indexOf(selectedText);
  const targetRef = createTargetRef(index, paragraph.nodeId, {
    level: "subregion",
    targetId: "activity-row",
  });
  const result = applyPatchPlan(planSourcePatch({
    type: "replace-text-range",
    targetRef,
    segments: [{
      textNodeId: trailingText.nodeId,
      startOffset,
      endOffset: startOffset + selectedText.length,
    }],
    beforeText: selectedText,
    nextText: "策略<简报 & 纪要",
    expectedSourceSha256: index.sourceSha256,
  }, index), html);

  assert.equal(
    result.html,
    `<section data-keep="字节不动"><p id="activity"><strong>顾宁</strong> 发布了策略&lt;简报 &amp; 纪要 😀</p><aside>outside</aside></section>`,
  );
  assert.match(result.html, /<strong>顾宁<\/strong>/u);
  assert.match(result.html, /<aside>outside<\/aside>/u);
  assert.equal(result.scopeReport.outsideUnchanged, true);
  assert.equal(result.parseIntegrity.ok, true);
  assert.equal(result.targetMappings[0].targetId, "activity-row");
  assert.equal(result.targetMappings[0].resolution, "exact");
  assert.equal(applyPatchPlan(result.inversePlan, result.html).html, html);
});

test("legacy text range patch inserts once across multiple runs and rejects stale or tampered input", () => {
  const html = `<p id="activity"><strong>顾宁</strong> 发布了研究简报</p>`;
  const index = buildSourceIndex(html);
  const paragraph = elementBy(
    index,
    (element) => element.stableAttributes.id === "activity",
  );
  const strong = elementBy(index, (element) => element.tagName === "strong");
  const strongText = index.byNodeId.get(strong.textNodeIds[0]);
  const trailingText = index.byNodeId.get(paragraph.textNodeIds[0]);
  const targetRef = createTargetRef(index, paragraph.nodeId, { level: "subregion" });

  const legacyResult = applyPatchPlan(planSourcePatch({
    type: "replace-text-range",
    targetRef,
    segments: [
      { textNodeId: strongText.nodeId, startOffset: 0, endOffset: 2 },
      { textNodeId: trailingText.nodeId, startOffset: 0, endOffset: 2 },
    ],
    beforeText: "顾宁 发",
    nextText: "替换",
  }, index), html);
  assert.equal(
    legacyResult.html,
    `<p id="activity"><strong>替换</strong>布了研究简报</p>`,
  );
  assert.equal(
    legacyResult.html.match(/替换/gu)?.length,
    1,
    "legacy multi-segment replacement must insert nextText exactly once",
  );
  assert.equal(applyPatchPlan(legacyResult.inversePlan, legacyResult.html).html, html);

  assertPatchError("NON_CONTIGUOUS_TEXT_REPLACEMENT", () => planSourcePatch({
    type: "replace-text-range",
    targetRef,
    segments: [
      { textNodeId: strongText.nodeId, startOffset: 0, endOffset: 2 },
      { textNodeId: trailingText.nodeId, startOffset: 1, endOffset: 4 },
    ],
    nextText: "替换",
  }, index));
  assertPatchError("STALE_BEFORE_CONTENT", () => planSourcePatch({
    type: "replace-text-range",
    targetRef,
    segments: [{
      textNodeId: trailingText.nodeId,
      startOffset: 4,
      endOffset: 8,
    }],
    beforeText: "已经变化",
    nextText: "策略简报",
  }, index));

  const plan = planSourcePatch({
    type: "replace-text-range",
    targetRef,
    segments: [{
      textNodeId: trailingText.nodeId,
      startOffset: 4,
      endOffset: 8,
    }],
    beforeText: "研究简报",
    nextText: "策略简报",
  }, index);
  assertPatchError("PATCH_PLAN_TAMPERED", () => applyPatchPlan({
    ...plan,
    patches: plan.patches.map((patch) => ({ ...patch, after: "越界改写" })),
  }, html));
});

test("replacement command edits one continuous selection across styled text nodes without duplicate insertion", () => {
  const html = `<section data-keep="yes"><p>开甲<strong>乙&amp;丙</strong><em>丁😀</em>戊</p><aside>outside</aside></section>`;
  const index = buildSourceIndex(html);
  const paragraph = elementBy(index, (element) => element.tagName === "p");
  const strong = elementBy(index, (element) => element.tagName === "strong");
  const emphasis = elementBy(index, (element) => element.tagName === "em");
  const leadingText = index.byNodeId.get(paragraph.textNodeIds[0]);
  const strongText = index.byNodeId.get(strong.textNodeIds[0]);
  const emphasisText = index.byNodeId.get(emphasis.textNodeIds[0]);
  const targetRef = createTargetRef(index, paragraph.nodeId, {
    level: "subregion",
    targetId: "flow-root",
  });
  const result = applyPatchPlan(planSourcePatch({
    type: "replace-text-range",
    targetRef,
    expectedSourceSha256: index.sourceSha256,
    replacements: [{
      deleteSegments: [
        { textNodeId: leadingText.nodeId, startOffset: 1, endOffset: 2 },
        { textNodeId: strongText.nodeId, startOffset: 0, endOffset: strongText.value.length },
        { textNodeId: emphasisText.nodeId, startOffset: 0, endOffset: 1 },
      ],
      insertAt: {
        kind: "text",
        textNodeId: leadingText.nodeId,
        utf16Offset: 1,
        affinity: "right",
      },
      beforeText: "甲乙&丙丁",
      nextText: "新<&",
    }],
  }, index), html);

  assert.equal(
    result.html,
    `<section data-keep="yes"><p>开新&lt;&amp;<em>😀</em>戊</p><aside>outside</aside></section>`,
  );
  assert.equal(result.patches.length, 3);
  assert.equal(result.html.match(/新/gu)?.length, 1);
  assert.equal(result.scopeReport.outsideUnchanged, true);
  assert.equal(result.targetMappings[0].targetId, "flow-root");
  assert.equal(result.targetMappings[0].resolution, "exact");
  assert.equal(result.refreshedTargetRefs[0].sourceAnchor.sourceSha256, result.sourceSha256);
  assert.equal(applyPatchPlan(result.inversePlan, result.html).html, html);
});

test("full replacement in a flex text island preserves the insertion wrapper and removes only a disposable empty sibling", () => {
  const html = `<p id="cta" style="display:flex;gap:12px"><span data-run="first">打开</span><span>对话框</span></p><aside data-keep=' bytes '>原样保留</aside>`;
  const index = buildSourceIndex(html);
  const textIsland = elementBy(index, (element) => element.stableAttributes.id === "cta");
  const [firstRun, secondRun] = textIsland.childElementIds.map(
    (nodeId) => index.byNodeId.get(nodeId),
  );
  const firstText = index.byNodeId.get(firstRun.textNodeIds[0]);
  const secondText = index.byNodeId.get(secondRun.textNodeIds[0]);
  const plan = planSourcePatch({
    type: "replace-text-range",
    targetRef: createTargetRef(index, textIsland.nodeId, { level: "subregion" }),
    replacements: [{
      deleteSegments: [
        { textNodeId: firstText.nodeId, startOffset: 0, endOffset: firstText.value.length },
        { textNodeId: secondText.nodeId, startOffset: 0, endOffset: secondText.value.length },
      ],
      insertAt: {
        kind: "text",
        textNodeId: firstText.nodeId,
        utf16Offset: 0,
        affinity: "right",
      },
      beforeText: "打开对话框",
      nextText: "继续",
    }],
  }, index);
  const result = applyPatchPlan(plan, html);

  assert.equal(
    result.html,
    `<p id="cta" style="display:flex;gap:12px"><span data-run="first">继续</span></p><aside data-keep=' bytes '>原样保留</aside>`,
  );
  assert.equal(
    plan.patches.filter((patch) => patch.cleanup === "empty-transparent-wrapper").length,
    1,
  );
  assert.equal(result.scopeReport.outsideUnchanged, true);
  assert.equal(applyPatchPlan(result.inversePlan, result.html).html, html);
});

test("pure deletion removes the outermost disposable style wrapper and preserves entity bytes on inverse", () => {
  const html = `<p id="flow"><span class="keep"><em>甲</em></span><span style='color:red'><em>乙&amp;丙</em></span></p><aside data-x="1">outside &amp; bytes</aside>`;
  const index = buildSourceIndex(html);
  const paragraph = elementBy(index, (element) => element.stableAttributes.id === "flow");
  const removedSpan = elementBy(
    index,
    (element) => element.tagName === "span" && element.attributesByName.has("style"),
  );
  const emphasis = index.byNodeId.get(removedSpan.childElementIds[0]);
  const textNode = index.byNodeId.get(emphasis.textNodeIds[0]);
  assert.equal(textNode.value, "乙&丙");
  const plan = planSourcePatch({
    type: "replace-text-range",
    targetRef: createTargetRef(index, paragraph.nodeId, { level: "subregion" }),
    replacements: [{
      deleteSegments: [{
        textNodeId: textNode.nodeId,
        startOffset: 0,
        endOffset: textNode.value.length,
      }],
      insertAt: {
        kind: "text",
        textNodeId: textNode.nodeId,
        utf16Offset: 0,
        affinity: "right",
      },
      beforeText: "乙&丙",
      nextText: "",
    }],
  }, index);

  assert.equal(plan.patches.length, 1, "nested cleanup must produce one non-overlapping patch");
  assert.equal(plan.patches[0].before, `<span style='color:red'><em>乙&amp;丙</em></span>`);
  assert.equal(plan.patches[0].cleanup, "empty-transparent-wrapper");
  const result = applyPatchPlan(plan, html);
  assert.equal(
    result.html,
    `<p id="flow"><span class="keep"><em>甲</em></span></p><aside data-x="1">outside &amp; bytes</aside>`,
  );
  assert.equal(result.scopeReport.outsideUnchanged, true);
  assert.equal(applyPatchPlan(result.inversePlan, result.html).html, html);

  assertPatchError("PATCH_PLAN_TAMPERED", () => applyPatchPlan({
    ...plan,
    patches: plan.patches.map((patch) => ({ ...patch, after: "<em></em>" })),
  }, html));
});

test("cross-inline cleanup coalesces inverse fragments at one output offset", () => {
  const html = `<h1 id="title">真实 <strong>DOM</strong> 光标要像 <em>Word</em> 一样自然&nbsp;🙂</h1>`;
  const index = buildSourceIndex(html);
  const heading = elementBy(index, (element) => element.stableAttributes.id === "title");
  const textByValue = (value) => {
    const textNode = index.textNodes.find((node) => node.value === value);
    assert.ok(textNode, `expected text node ${value}`);
    return textNode;
  };
  const leading = textByValue("真实 ");
  const strongText = textByValue("DOM");
  const middle = textByValue(" 光标要像 ");
  const emphasisText = textByValue("Word");
  const result = applyPatchPlan(planSourcePatch({
    type: "replace-text-range",
    targetRef: createTargetRef(index, heading.nodeId, { level: "subregion" }),
    replacements: [{
      deleteSegments: [
        { textNodeId: leading.nodeId, startOffset: 2, endOffset: 3 },
        { textNodeId: strongText.nodeId, startOffset: 0, endOffset: 3 },
        { textNodeId: middle.nodeId, startOffset: 0, endOffset: 6 },
        { textNodeId: emphasisText.nodeId, startOffset: 0, endOffset: 3 },
      ],
      insertAt: {
        kind: "text",
        textNodeId: leading.nodeId,
        utf16Offset: 2,
        affinity: "right",
      },
      beforeText: " DOM 光标要像 Wor",
      nextText: "跨行内替换",
    }],
  }, index), html);

  assert.equal(
    result.html,
    `<h1 id="title">真实跨行内替换<em>d</em> 一样自然&nbsp;🙂</h1>`,
  );
  assert.ok(result.inversePlan.patches.some((patch) => (
    patch.startOffset === patch.endOffset
    && patch.after === "<strong>DOM</strong> 光标要像 "
  )));
  const undone = applyPatchPlan(result.inversePlan, result.html);
  assert.equal(undone.html, html);
  const redone = applyPatchPlan(undone.inversePlan, undone.html);
  assert.equal(redone.html, result.html);
  assert.equal(redone.sourceSha256, result.sourceSha256);
});

test("exact leading-wrapper boundary replacement matches native DOM and round-trips bytes", () => {
  const html = `<h1 id="title">真实 <strong>DOM</strong> 光标要像 <em>Word</em> 一样自然&nbsp;🙂</h1>`;
  const index = buildSourceIndex(html);
  const heading = elementBy(index, (element) => element.stableAttributes.id === "title");
  const map = buildSourceTextMap(index, heading.nodeId);
  const mapped = textRangeToSourceEdit(map, 3, 9, "left");
  const result = applyPatchPlan(planSourcePatch({
    type: "replace-text-range",
    targetRef: createTargetRef(index, heading.nodeId, { level: "subregion" }),
    replacements: [{
      ...mapped,
      beforeText: "DOM 光标",
      nextText: "Electron原位",
    }],
  }, index), html);

  assert.equal(
    result.html,
    `<h1 id="title">真实 Electron原位要像 <em>Word</em> 一样自然&nbsp;🙂</h1>`,
  );
  assert.equal(result.scopeReport.outsideUnchanged, true);
  const undone = applyPatchPlan(result.inversePlan, result.html);
  assert.equal(undone.html, html);
  const redone = applyPatchPlan(undone.inversePlan, undone.html);
  assert.equal(redone.html, result.html);
  assert.equal(redone.sourceSha256, result.sourceSha256);
});

test("empty-wrapper cleanup removes only style wrappers and preserves semantic or identified elements", () => {
  const html = `<p id="flow"><span data-empty></span><span data-partial>甲乙</span><span style="font-weight:700">丙</span><span data-comment>丁<!--keep--></span><span data-atom>戊<img src=x></span><span data-structure>己<button></button></span><a id="bookmark" href="/x">庚</a><time datetime="2026-07-21">辛</time></p>`;
  const index = buildSourceIndex(html);
  const paragraph = elementBy(index, (element) => element.stableAttributes.id === "flow");
  const spanByAttribute = (name) => elementBy(
    index,
    (element) => element.tagName === "span" && element.attributesByName.has(name),
  );
  const partialText = index.byNodeId.get(spanByAttribute("data-partial").textNodeIds[0]);
  const removeText = index.byNodeId.get(spanByAttribute("style").textNodeIds[0]);
  const commentText = index.byNodeId.get(spanByAttribute("data-comment").textNodeIds[0]);
  const atomText = index.byNodeId.get(spanByAttribute("data-atom").textNodeIds[0]);
  const structureText = index.byNodeId.get(spanByAttribute("data-structure").textNodeIds[0]);
  const link = elementBy(index, (element) => element.tagName === "a");
  const time = elementBy(index, (element) => element.tagName === "time");
  const linkText = index.byNodeId.get(link.textNodeIds[0]);
  const timeText = index.byNodeId.get(time.textNodeIds[0]);
  const replacementFor = (textNode, nextText, endOffset = textNode.value.length) => ({
    deleteSegments: [{ textNodeId: textNode.nodeId, startOffset: 0, endOffset }],
    insertAt: {
      kind: "text",
      textNodeId: textNode.nodeId,
      utf16Offset: 0,
      affinity: "right",
    },
    nextText,
  });
  const result = applyPatchPlan(planSourcePatch({
    type: "replace-text-range",
    targetRef: createTargetRef(index, paragraph.nodeId, { level: "subregion" }),
    replacements: [
      replacementFor(partialText, "X", 1),
      replacementFor(removeText, ""),
      replacementFor(commentText, ""),
      replacementFor(atomText, ""),
      replacementFor(structureText, ""),
      replacementFor(linkText, ""),
      replacementFor(timeText, ""),
    ],
  }, index), html);

  assert.equal(
    result.html,
    `<p id="flow"><span data-empty></span><span data-partial>X乙</span><span data-comment><!--keep--></span><span data-atom><img src=x></span><span data-structure><button></button></span><a id="bookmark" href="/x"></a><time datetime="2026-07-21"></time></p>`,
  );
  assert.equal(applyPatchPlan(result.inversePlan, result.html).html, html);
});

test("pure insertion supports paragraph start, styled-child boundary, paragraph end, and byte-exact inverse", () => {
  const html = `<p id="flow"><strong>甲</strong><em>乙</em></p>`;
  const index = buildSourceIndex(html);
  const paragraph = elementBy(index, (element) => element.stableAttributes.id === "flow");
  const [strong, emphasis] = paragraph.childElementIds.map((nodeId) => index.byNodeId.get(nodeId));
  const targetRef = createTargetRef(index, paragraph.nodeId, { level: "subregion" });
  const result = applyPatchPlan(planSourcePatch({
    type: "replace-text-range",
    targetRef,
    replacements: [
      {
        deleteSegments: [],
        insertAt: {
          kind: "child-boundary",
          parentNodeId: paragraph.nodeId,
          beforeNodeId: strong.nodeId,
          affinity: "right",
        },
        nextText: "首",
      },
      {
        deleteSegments: [],
        insertAt: {
          kind: "child-boundary",
          parentNodeId: paragraph.nodeId,
          beforeNodeId: emphasis.nodeId,
          affinity: "right",
        },
        nextText: "中",
      },
      {
        deleteSegments: [],
        insertAt: {
          kind: "child-boundary",
          parentNodeId: paragraph.nodeId,
          beforeNodeId: null,
          affinity: "left",
        },
        nextText: "尾",
      },
    ],
  }, index), html);

  assert.equal(result.html, `<p id="flow">首<strong>甲</strong>中<em>乙</em>尾</p>`);
  assert.equal(result.patches.length, 3);
  assert.equal(applyPatchPlan(result.inversePlan, result.html).html, html);
});

test("text anchors preserve entity and UTF-16 boundaries and reject a surrogate interior", () => {
  const html = `<p id="flow">甲&amp;&#x1F600;乙</p>`;
  const index = buildSourceIndex(html);
  const paragraph = elementBy(index, (element) => element.stableAttributes.id === "flow");
  const textNode = index.byNodeId.get(paragraph.textNodeIds[0]);
  const targetRef = createTargetRef(index, paragraph.nodeId, { level: "subregion" });
  assert.equal(textNode.value, "甲&😀乙");

  const result = applyPatchPlan(planSourcePatch({
    type: "replace-text-range",
    targetRef,
    replacements: [{
      deleteSegments: [],
      insertAt: {
        kind: "text",
        textNodeId: textNode.nodeId,
        utf16Offset: 2,
        affinity: "right",
      },
      nextText: "<&",
    }],
  }, index), html);
  assert.equal(result.html, `<p id="flow">甲&amp;&lt;&amp;&#x1F600;乙</p>`);
  assert.equal(applyPatchPlan(result.inversePlan, result.html).html, html);

  assertPatchError("UNSAFE_TEXT_RANGE_BOUNDARY", () => planSourcePatch({
    type: "replace-text-range",
    targetRef,
    replacements: [{
      deleteSegments: [],
      insertAt: {
        kind: "text",
        textNodeId: textNode.nodeId,
        utf16Offset: 3,
        affinity: "right",
      },
      nextText: "x",
    }],
  }, index));
});

test("one command applies multiple non-contiguous replacements and its inverse restores every byte", () => {
  const html = `<div data-keep='1'><p id="flow">甲乙<strong>丙丁</strong>戊己</p><aside>same</aside></div>`;
  const index = buildSourceIndex(html);
  const paragraph = elementBy(index, (element) => element.stableAttributes.id === "flow");
  const [leadingText, trailingText] = paragraph.textNodeIds.map(
    (nodeId) => index.byNodeId.get(nodeId),
  );
  const targetRef = createTargetRef(index, paragraph.nodeId, { level: "subregion" });
  const result = applyPatchPlan(planSourcePatch({
    type: "replace-text-range",
    targetRef,
    expectedSourceSha256: index.sourceSha256,
    beforeText: "乙己",
    replacements: [
      {
        deleteSegments: [{
          textNodeId: leadingText.nodeId,
          startOffset: 1,
          endOffset: 2,
        }],
        insertAt: {
          kind: "text",
          textNodeId: leadingText.nodeId,
          utf16Offset: 1,
          affinity: "right",
        },
        beforeText: "乙",
        nextText: "二",
      },
      {
        deleteSegments: [{
          textNodeId: trailingText.nodeId,
          startOffset: 1,
          endOffset: 2,
        }],
        insertAt: {
          kind: "text",
          textNodeId: trailingText.nodeId,
          utf16Offset: 1,
          affinity: "left",
        },
        beforeText: "己",
        nextText: "六",
      },
    ],
  }, index), html);

  assert.equal(
    result.html,
    `<div data-keep='1'><p id="flow">甲二<strong>丙丁</strong>戊六</p><aside>same</aside></div>`,
  );
  assert.equal(result.patches.length, 2);
  assert.equal(applyPatchPlan(result.inversePlan, result.html).html, html);
});

test("replacement command fails closed for stale, overlap, hard-break, atom, foreign anchor, and tampering", () => {
  const html = `<p id="flow">甲<br>乙<img src="x">丙丁</p><aside id="outside">外</aside>`;
  const index = buildSourceIndex(html);
  const paragraph = elementBy(index, (element) => element.stableAttributes.id === "flow");
  const outside = elementBy(index, (element) => element.stableAttributes.id === "outside");
  const [firstText, secondText, thirdText] = paragraph.textNodeIds.map(
    (nodeId) => index.byNodeId.get(nodeId),
  );
  const outsideText = index.byNodeId.get(outside.textNodeIds[0]);
  const targetRef = createTargetRef(index, paragraph.nodeId, { level: "subregion" });
  const replacement = {
    deleteSegments: [{ textNodeId: thirdText.nodeId, startOffset: 0, endOffset: 1 }],
    insertAt: {
      kind: "text",
      textNodeId: thirdText.nodeId,
      utf16Offset: 0,
      affinity: "right",
    },
    beforeText: "丙",
    nextText: "C",
  };

  assertPatchError("STALE_SOURCE_HASH", () => planSourcePatch({
    type: "replace-text-range",
    targetRef,
    expectedSourceSha256: "0".repeat(64),
    replacements: [replacement],
  }, index));
  assertPatchError("STALE_BEFORE_CONTENT", () => planSourcePatch({
    type: "replace-text-range",
    targetRef,
    replacements: [{ ...replacement, beforeText: "changed" }],
  }, index));
  assertPatchError("OVERLAPPING_TEXT_REPLACEMENTS", () => planSourcePatch({
    type: "replace-text-range",
    targetRef,
    replacements: [
      replacement,
      {
        ...replacement,
        deleteSegments: [{ textNodeId: thirdText.nodeId, startOffset: 0, endOffset: 2 }],
        beforeText: "丙丁",
        nextText: "D",
      },
    ],
  }, index));
  assertPatchError("TEXT_RANGE_STRUCTURAL_BOUNDARY", () => planSourcePatch({
    type: "replace-text-range",
    targetRef,
    replacements: [{
      deleteSegments: [
        { textNodeId: firstText.nodeId, startOffset: 0, endOffset: 1 },
        { textNodeId: secondText.nodeId, startOffset: 0, endOffset: 1 },
      ],
      insertAt: {
        kind: "text",
        textNodeId: firstText.nodeId,
        utf16Offset: 0,
        affinity: "right",
      },
      nextText: "x",
    }],
  }, index));
  assertPatchError("TEXT_RANGE_STRUCTURAL_BOUNDARY", () => planSourcePatch({
    type: "replace-text-range",
    targetRef,
    replacements: [{
      deleteSegments: [
        { textNodeId: secondText.nodeId, startOffset: 0, endOffset: 1 },
        { textNodeId: thirdText.nodeId, startOffset: 0, endOffset: 1 },
      ],
      insertAt: {
        kind: "text",
        textNodeId: secondText.nodeId,
        utf16Offset: 0,
        affinity: "right",
      },
      nextText: "x",
    }],
  }, index));
  assertPatchError("TEXT_RANGE_TARGET_MISMATCH", () => planSourcePatch({
    type: "replace-text-range",
    targetRef,
    replacements: [{
      deleteSegments: [],
      insertAt: {
        kind: "text",
        textNodeId: outsideText.nodeId,
        utf16Offset: 0,
        affinity: "right",
      },
      nextText: "x",
    }],
  }, index));

  const plan = planSourcePatch({
    type: "replace-text-range",
    targetRef,
    replacements: [replacement],
  }, index);
  assertPatchError("PATCH_PLAN_TAMPERED", () => applyPatchPlan({
    ...plan,
    patches: plan.patches.map((patch) => ({ ...patch, after: "tampered" })),
  }, html));
});

test("plain text flow inserts generated hard breaks, escapes markup, and round-trips bytes", () => {
  const html = `<section data-keep="yes"><p id="flow">甲&amp;乙</p><aside>outside</aside></section>`;
  const index = buildSourceIndex(html);
  const paragraph = elementBy(index, (element) => element.stableAttributes.id === "flow");
  const map = buildSourceTextMap(index, paragraph.nodeId);
  const targetRef = createTargetRef(index, paragraph.nodeId, { level: "subregion" });
  const edit = textRangeToSourceEdit(map, 2, 2, "right");
  const plan = planSourcePatch({
    type: "replace-text-flow-range",
    targetRef,
    replacements: [{
      deleteSegments: edit.deleteSegments,
      insertAt: edit.insertAt,
      beforeText: "",
      nextText: `<img src=x>\n第二行 & 保留`,
    }],
    beforeText: "",
    expectedSourceSha256: index.sourceSha256,
  }, index);
  const result = applyPatchPlan(plan, html);

  assert.equal(
    result.html,
    `<section data-keep="yes"><p id="flow">甲&amp;&lt;img src=x><br>第二行 &amp; 保留乙</p><aside>outside</aside></section>`,
  );
  assert.equal(result.patches.length, 1);
  assert.equal(result.patches[0].kind, "text-flow");
  assert.equal(result.scopeReport.outsideUnchanged, true);
  const undone = applyPatchPlan(result.inversePlan, result.html);
  assert.equal(undone.html, html);
  assert.equal(applyPatchPlan(undone.inversePlan, undone.html).html, result.html);

  assertPatchError("TEXT_FLOW_BREAK_REQUIRED", () => planSourcePatch({
    type: "replace-text-flow-range",
    targetRef,
    replacements: [{
      deleteSegments: [],
      insertAt: edit.insertAt,
      nextText: "single line",
    }],
  }, index));
  assertPatchError("TEXT_FLOW_NOT_NORMALIZED", () => planSourcePatch({
    type: "replace-text-flow-range",
    targetRef,
    replacements: [{
      deleteSegments: [],
      insertAt: edit.insertAt,
      nextText: "first\r\nsecond",
    }],
  }, index));
  assertPatchError("PATCH_PLAN_TAMPERED", () => applyPatchPlan({
    ...plan,
    patches: plan.patches.map((patch) => ({ ...patch, after: "<script>x</script>" })),
  }, html));
});

test("one authored hard break can be deleted and restored without rewriting neighbours", () => {
  const html = `<div data-keep='1'><p id="flow">第一行<br class='authored'>第二行</p><aside>same</aside></div>`;
  const index = buildSourceIndex(html);
  const paragraph = elementBy(index, (element) => element.stableAttributes.id === "flow");
  const hardBreak = elementBy(index, (element) => (
    element.tagName === "br" && element.parentId === paragraph.nodeId
  ));
  const targetRef = createTargetRef(index, paragraph.nodeId, { level: "subregion" });
  const plan = planSourcePatch({
    type: "delete-hard-break",
    targetRef,
    hardBreakNodeId: hardBreak.nodeId,
    expectedSourceSha256: index.sourceSha256,
  }, index);
  const result = applyPatchPlan(plan, html);

  assert.equal(
    result.html,
    `<div data-keep='1'><p id="flow">第一行第二行</p><aside>same</aside></div>`,
  );
  assert.deepEqual(result.patches.map(({ before, after, kind }) => ({
    before,
    after,
    kind,
  })), [{
    before: `<br class='authored'>`,
    after: "",
    kind: "hard-break",
  }]);
  const undone = applyPatchPlan(result.inversePlan, result.html);
  assert.equal(undone.html, html);
  assert.equal(applyPatchPlan(undone.inversePlan, undone.html).html, result.html);

  assertPatchError("HARD_BREAK_TARGET_INVALID", () => planSourcePatch({
    type: "delete-hard-break",
    targetRef,
    hardBreakNodeId: paragraph.nodeId,
  }, index));
});

test("simple paragraph and list-item splits preserve text bytes and omit cloned identity or behavior attributes", () => {
  const fixtures = [
    {
      html: `<main><p id='copy' class="lead" style='color:red' data-item-id='one' data-section="hero" onclick='go()'>甲&amp;乙丙</p><aside>same</aside></main>`,
      tagName: "p",
      splitOffset: 2,
      expectedFirst: "甲&",
      expectedSecond: "乙丙",
    },
    {
      html: `<ol><li id="item" class='row' value="7">第一项第二项</li></ol>`,
      tagName: "li",
      splitOffset: 3,
      expectedFirst: "第一项",
      expectedSecond: "第二项",
    },
  ];

  for (const fixture of fixtures) {
    const index = buildSourceIndex(fixture.html);
    const block = elementBy(index, (element) => (
      element.tagName === fixture.tagName
      && element.attributesByName.has("id")
    ));
    const targetRef = createTargetRef(index, block.nodeId, { level: "subregion" });
    const plan = planSourcePatch({
      type: "split-text-block",
      targetRef,
      splitOffset: fixture.splitOffset,
      expectedSourceSha256: index.sourceSha256,
    }, index);
    const result = applyPatchPlan(plan, fixture.html);
    const blocks = result.sourceIndex.elements.filter(
      (element) => element.tagName === fixture.tagName,
    );

    assert.equal(blocks.length, 2);
    assert.equal(blocks[0].textContent, fixture.expectedFirst);
    assert.equal(blocks[1].textContent, fixture.expectedSecond);
    assert.equal(blocks[1].attributesByName.has("id"), false);
    assert.equal(blocks[1].attributesByName.has("name"), false);
    assert.equal(blocks[1].attributesByName.has("value"), false);
    assert.equal(blocks[1].attributes.some(({ name }) => name.startsWith("on")), false);
    assert.equal(blocks[1].attributesByName.has("class"), true);
    assert.equal(
      blocks[1].startTagRange.startOffset,
      plan.metadata.createdBlockStartOffset,
    );
    assert.equal(result.scopeReport.outsideUnchanged, true);
    if (fixture.tagName === "p") {
      assert.equal(blocks[1].attributesByName.has("data-item-id"), false);
      assert.equal(blocks[1].attributesByName.has("data-section"), true);
      assert.match(result.html, /<aside>same<\/aside>/u);
    }

    const undone = applyPatchPlan(result.inversePlan, result.html);
    assert.equal(undone.html, fixture.html);
    assert.equal(applyPatchPlan(undone.inversePlan, undone.html).html, result.html);
    assertPatchError("PATCH_PLAN_TAMPERED", () => applyPatchPlan({
      ...plan,
      patches: plan.patches.map((patch) => ({
        ...patch,
        after: patch.after.replace(fixture.tagName, "section"),
      })),
    }, fixture.html));
  }
});

test("block splitting refuses complex children, boundary carets, and unsupported roots", () => {
  for (const [html, id, splitOffset, code] of [
    [`<p id="copy">甲<strong>乙</strong></p>`, "copy", 1, "BLOCK_SPLIT_COMPLEX_CONTENT"],
    [`<p id="copy">甲乙</p>`, "copy", 0, "BLOCK_SPLIT_BOUNDARY_UNSUPPORTED"],
    [`<h2 id="copy">甲乙</h2>`, "copy", 1, "BLOCK_SPLIT_UNSUPPORTED"],
  ]) {
    const index = buildSourceIndex(html);
    const block = elementBy(index, (element) => element.stableAttributes.id === id);
    const targetRef = createTargetRef(index, block.nodeId, { level: "subregion" });
    assertPatchError(code, () => planSourcePatch({
      type: "split-text-block",
      targetRef,
      splitOffset,
      expectedSourceSha256: index.sourceSha256,
    }, index));
  }
});

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
  const aRef = createTargetRef(index, paragraphs.a.nodeId, { level: "text" });
  const bRef = createTargetRef(index, paragraphs.b.nodeId, { level: "text" });
  const plan = planSourcePatch({
    type: "replace-text",
    targetRef: bRef,
    beforeText: "two",
    nextText: "changed",
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
      { level: "text" },
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
  const targetRefs = [createTargetRef(index, paragraph.nodeId, { level: "text" })];
  const provenance = {
    baseSourceSha256: sourceSha256(forgedOutput),
    outputSourceSha256: index.sourceSha256,
    operationType: "replace-text",
    appliedPatches: [{
      startOffset: 3,
      endOffset: 7,
      before: "evil",
      after: "safe",
      kind: "text",
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
    type: "inverse:replace-text",
    sourceSha256: index.sourceSha256,
    patches: [{
      startOffset: 3,
      endOffset: 7,
      before: "safe",
      after: "evil",
      kind: "inverse:text",
    }],
    targetRefs,
    metadata: {
      operationType: "replace-text",
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

test("target mappings preserve text identity through apply, inverse, and reapplication", () => {
  const html = `<p>before</p>`;
  const index = buildSourceIndex(html);
  const paragraph = elementBy(index, (element) => element.tagName === "p");
  const targetRef = createTargetRef(index, paragraph.nodeId, {
    level: "text",
    targetId: "plain-text-target",
  });
  const plan = planSourcePatch({
    type: "replace-text",
    targetRef,
    beforeText: "before",
    nextText: "after",
  }, index);
  const result = applyPatchPlan(plan, html);
  const mapping = result.targetMappings[0];

  assert.equal(mapping.targetId, "plain-text-target");
  assert.equal(mapping.resolution, "exact");
  assert.equal(mapping.afterTargetRef.targetId, "plain-text-target");
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
  assert.equal(reapplied.targetMappings[0].targetId, "plain-text-target");
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
    type: "replace-text",
    targetRef: createTargetRef(index, paragraph.nodeId, { level: "text" }),
    beforeText: "A",
    nextText: "LONGER",
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
  const textNode = index.textNodes.find((node) => node.value === "文字");
  const result = applyPatchPlan(planSourcePatch({
    type: "replace-text-range",
    targetRef: createTargetRef(index, paragraph.nodeId, { level: "subregion" }),
    replacements: [{
      deleteSegments: [{
        textNodeId: textNode.nodeId,
        startOffset: 0,
        endOffset: textNode.value.length,
      }],
      insertAt: {
        kind: "text",
        textNodeId: textNode.nodeId,
        utf16Offset: 0,
        affinity: "right",
      },
      beforeText: "文字",
      nextText: "新版",
    }],
  }, index), html);

  assert.equal(result.html, `<p id='b'  data-note="keep">新版</p>`);
  assert.equal(result.patches.length, 1);
  assert.equal(applyPatchPlan(result.inversePlan, result.html).html, html);
});
