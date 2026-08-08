import assert from "node:assert/strict";
import test from "node:test";

import {
  applyPatchPlan,
  buildSourceIndex,
  createTargetRef,
  planEditableIslandPatch,
  planSourcePatch,
} from "../app/lib/source-patch-core.js";
import {
  EditableIslandError,
  editableIslandForTarget,
  normalizeEditableIslandHtml,
  normalizeEditableTextFragmentHtml,
} from "../app/lib/editable-island.js";

function targetFor(html, tagName = "p") {
  const index = buildSourceIndex(html);
  const element = index.elements.find((candidate) => candidate.tagName === tagName);
  assert.ok(element);
  return {
    index,
    element,
    targetRef: createTargetRef(index, element, { level: "subregion" }),
  };
}

function assertIslandError(code, callback) {
  assert.throws(
    callback,
    (error) => error instanceof EditableIslandError && error.code === code,
  );
}

test("editable island normalizes only the edited content range and inverts byte-exactly", () => {
  const html = [
    "<!doctype html>\r\n",
    "<main data-source='untouched'>\r\n",
    "  <p id='hero'>甲 <strong class='accent'>乙</strong><!--keep--></p>\r\n",
    "  <aside data-keep=\"yes\">  outside &amp; exact  </aside>\r\n",
    "</main>\r\n",
  ].join("");
  const { index, element, targetRef } = targetFor(html);
  const before = index.source.slice(
    element.contentRange.startOffset,
    element.contentRange.endOffset,
  );
  const nextFromInstrumentedDom = [
    "甲字 ",
    "<strong class=\"accent\" data-html-ai-source-node-id=\"stale\">乙字</strong>",
    "<br data-pageroot-runtime=\"ignored\">末尾",
    "<!--keep-->",
  ].join("");
  const plan = planEditableIslandPatch(index, {
    targetRef,
    beforeInnerHtml: before,
    nextInnerHtml: nextFromInstrumentedDom,
    expectedSourceSha256: index.sourceSha256,
  });
  const result = applyPatchPlan(plan, html);

  assert.equal(
    result.html,
    [
      "<!doctype html>\r\n",
      "<main data-source='untouched'>\r\n",
      "  <p id='hero'>甲字 <strong class=\"accent\">乙字</strong><br>末尾<!--keep--></p>\r\n",
      "  <aside data-keep=\"yes\">  outside &amp; exact  </aside>\r\n",
      "</main>\r\n",
    ].join(""),
  );
  assert.equal(result.patches.length, 1);
  assert.equal(result.patches[0].kind, "editable-island");
  assert.equal(result.patches[0].startOffset, element.contentRange.startOffset);
  assert.equal(result.patches[0].endOffset, element.contentRange.endOffset);
  assert.equal(result.scopeReport.outsideUnchanged, true);
  assert.equal(result.parseIntegrity.ok, true);
  assert.equal(applyPatchPlan(result.inversePlan, result.html).html, html);
});

test("editable island admits mixed inline markup, empty text and hard breaks", () => {
  const html = "<button><span>开始</span><strong>试览</strong></button>";
  const { index, targetRef } = targetFor(html, "button");
  const island = editableIslandForTarget(index, targetRef);
  assert.equal(island.innerHtml, "<span>开始</span><strong>试览</strong>");

  const result = applyPatchPlan(planSourcePatch({
    type: "replace-editable-island",
    targetRef,
    beforeInnerHtml: island.innerHtml,
    nextInnerHtml: "<span>开始</span><strong>试览新增</strong><br>下一行",
  }, index), html);
  assert.equal(
    result.html,
    "<button><span>开始</span><strong>试览新增</strong><br>下一行</button>",
  );

  const emptyIndex = result.sourceIndex;
  const emptyRef = result.refreshedTargetRefs[0];
  const emptied = applyPatchPlan(planSourcePatch({
    type: "replace-editable-island",
    targetRef: emptyRef,
    beforeInnerHtml: "<span>开始</span><strong>试览新增</strong><br>下一行",
    nextInnerHtml: "",
  }, emptyIndex), result.html);
  assert.equal(emptied.html, "<button></button>");
});

test("editable island edits a nested-list heading while preserving the child list as an atom", () => {
  const html = [
    "<main><ol><li>",
    "发现阶段",
    "<ul data-keep='yes'><li>访谈 12 位内容创作者</li><li>审计现有流程</li></ul>",
    "</li></ol><p>外部字节保持不变</p></main>",
  ].join("");
  const { index, targetRef } = targetFor(html, "li");
  const island = editableIslandForTarget(index, targetRef);
  assert.match(island.innerHtml, /^发现阶段<ul/u);

  const result = applyPatchPlan(planSourcePatch({
    type: "replace-editable-island",
    targetRef,
    beforeInnerHtml: island.innerHtml,
    nextInnerHtml: [
      "发现与验证阶段",
      '<ul data-keep="yes" contenteditable="false">',
      "<li>访谈 12 位内容创作者</li><li>审计现有流程</li></ul>",
    ].join(""),
  }, index), html);

  assert.equal(
    result.html,
    [
      "<main><ol><li>",
      "发现与验证阶段",
      '<ul data-keep="yes"><li>访谈 12 位内容创作者</li><li>审计现有流程</li></ul>',
      "</li></ol><p>外部字节保持不变</p></main>",
    ].join(""),
  );
  assert.equal(result.scopeReport.outsideUnchanged, true);
});

test("editable island keeps wbr atoms while allowing adjacent words to change", () => {
  const baseline = "软换行机会：Hypertext<wbr>Markup<wbr>Language";
  assert.equal(
    normalizeEditableIslandHtml(
      "软换行机会：Hypertextual<wbr>Markup<wbr>Language",
      { baselineInnerHtml: baseline },
    ),
    "软换行机会：Hypertextual<wbr>Markup<wbr>Language",
  );
  assertIslandError(
    "EDITABLE_ISLAND_ATOM_CHANGED",
    () => normalizeEditableIslandHtml(
      "软换行机会：HypertextMarkup<wbr>Language",
      { baselineInnerHtml: baseline },
    ),
  );
});

test("editable island rejects block structure, new protected semantics and atom loss", () => {
  assertIslandError(
    "EDITABLE_ISLAND_STRUCTURE_UNSUPPORTED",
    () => normalizeEditableIslandHtml("<div>block</div>"),
  );
  assertIslandError(
    "EDITABLE_ISLAND_PROTECTED_ATTRIBUTE_ADDED",
    () => normalizeEditableIslandHtml(
      "<a href=\"https://example.com\">new link</a>",
      { baselineInnerHtml: "plain" },
    ),
  );
  assertIslandError(
    "EDITABLE_ISLAND_ATOM_CHANGED",
    () => normalizeEditableIslandHtml(
      "before after",
      { baselineInnerHtml: "before <img src=\"kept.png\"> after" },
    ),
  );
});

test("direct text fragments normalize entities but reject every authored element", () => {
  assert.equal(
    normalizeEditableTextFragmentHtml("新版&lt;文字&gt; &amp; emoji 😀", {
      baselineInnerHtml: "旧版&amp;文字",
    }),
    "新版&lt;文字&gt; &amp; emoji 😀",
  );
  assertIslandError(
    "EDITABLE_TEXT_FRAGMENT_STRUCTURE_UNSUPPORTED",
    () => normalizeEditableTextFragmentHtml("<br>", {
      baselineInnerHtml: "旧版文字",
    }),
  );
  assertIslandError(
    "EDITABLE_TEXT_FRAGMENT_STRUCTURE_UNSUPPORTED",
    () => normalizeEditableTextFragmentHtml("<strong>新版</strong>", {
      baselineInnerHtml: "旧版文字",
    }),
  );
});

test("text may be deleted from an attributed inline wrapper without creating a new atom", () => {
  assert.equal(
    normalizeEditableIslandHtml(
      '<span aria-hidden="true"></span>',
      {
        baselineInnerHtml: '<span aria-hidden="true">↓</span>',
      },
    ),
    '<span aria-hidden="true"></span>',
  );
  assert.throws(() => normalizeEditableIslandHtml(
    "",
    {
      baselineInnerHtml: '<span aria-hidden="true"></span>',
    },
  ), (error) => error.code === "EDITABLE_ISLAND_ATOM_CHANGED");
});

test("editable island authorization rejects a patch that is smaller than the exact island", () => {
  const html = "<p>abcdef</p>";
  const { index, targetRef } = targetFor(html);
  const plan = planEditableIslandPatch(index, {
    targetRef,
    beforeInnerHtml: "abcdef",
    nextInnerHtml: "abcXYZ",
  });
  const forged = {
    ...plan,
    patches: [{
      ...plan.patches[0],
      startOffset: plan.patches[0].startOffset + 3,
      before: "def",
      after: "XYZ",
    }],
  };
  assert.throws(
    () => applyPatchPlan(forged, html),
    (error) => error?.code === "PATCH_OUTSIDE_TARGET",
  );
});
