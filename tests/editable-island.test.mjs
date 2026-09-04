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
  editableIslandDraftHtml,
  editableIslandForTarget,
  materializeEditableIslandHtml,
  normalizeEditableIslandHtml,
  normalizeEditableTextFragmentHtml,
} from "../app/lib/editable-island.js";
import { materializeSourceElementIdentity } from "../bridge/project-file-repository/working-copy.mjs";

function identify(html) {
  return materializeSourceElementIdentity(html).html;
}

function stripIdentity(html) {
  return String(html).replace(/\s*data-pageroot-id="[^"]*"/gu, "");
}

function targetFor(rawHtml, tagName = "p") {
  const html = identify(rawHtml);
  const index = buildSourceIndex(html);
  const element = index.elements.find((candidate) => candidate.tagName === tagName);
  assert.ok(element);
  return {
    html,
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
  const { html, index, element, targetRef } = targetFor([
    "<!doctype html>\r\n",
    "<main data-source='untouched'>\r\n",
    "  <p id='hero'>甲 <strong class='accent'>乙</strong><!--keep--></p>\r\n",
    "  <aside data-keep=\"yes\">  outside &amp; exact  </aside>\r\n",
    "</main>\r\n",
  ].join(""));
  const before = index.source.slice(
    element.contentRange.startOffset,
    element.contentRange.endOffset,
  );
  const nextFromInstrumentedDom = before
    .replace("甲 ", "甲字 ")
    .replace(">乙<", ">乙字<")
    .replace(
      "<strong class='accent'",
      "<strong class=\"accent\" data-html-ai-source-node-id=\"stale\"",
    )
    .replace("<!--keep-->", "<br data-pageroot-runtime=\"ignored\">末尾<!--keep-->");
  const plan = planEditableIslandPatch(index, {
    targetRef,
    beforeInnerHtml: before,
    nextInnerHtml: nextFromInstrumentedDom,
    expectedSourceSha256: index.sourceSha256,
  });
  const result = applyPatchPlan(plan, html);

  assert.equal(
    stripIdentity(result.html),
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
  const { html, index, targetRef } = targetFor(
    "<button><span>开始</span><strong>试览</strong></button>",
    "button",
  );
  const island = editableIslandForTarget(index, targetRef);
  assert.equal(stripIdentity(island.innerHtml), "<span>开始</span><strong>试览</strong>");

  const result = applyPatchPlan(planSourcePatch({
    type: "replace-editable-island",
    targetRef,
    beforeInnerHtml: island.innerHtml,
    nextInnerHtml: `${island.innerHtml.replace("试览<", "试览新增<")}<br>下一行`,
  }, index), html);
  assert.equal(
    stripIdentity(result.html),
    "<button><span>开始</span><strong>试览新增</strong><br>下一行</button>",
  );

  const emptyIndex = result.sourceIndex;
  const emptyRef = result.refreshedTargetRefs[0];
  const emptiedIsland = editableIslandForTarget(emptyIndex, emptyRef);
  assertIslandError(
    "EDITABLE_ISLAND_PERSISTENT_ID_CHANGED",
    () => planSourcePatch({
      type: "replace-editable-island",
      targetRef: emptyRef,
      beforeInnerHtml: emptiedIsland.innerHtml,
      nextInnerHtml: "",
    }, emptyIndex),
  );
});

test("managed native line breaks receive one fresh persistent identity", () => {
  const htmlId = "pr1_10000000000040008000000000000001";
  const headId = "pr1_10000000000040008000000000000002";
  const bodyId = "pr1_10000000000040008000000000000003";
  const paragraphId = "pr1_10000000000040008000000000000004";
  const html = `<html data-pageroot-id="${htmlId}"><head data-pageroot-id="${headId}"></head><body data-pageroot-id="${bodyId}"><p data-pageroot-id="${paragraphId}">first</p></body></html>`;
  const { index, targetRef } = targetFor(html);
  const plan = planEditableIslandPatch(index, {
    targetRef,
    beforeInnerHtml: "first",
    nextInnerHtml: "first<br>second",
    expectedSourceSha256: index.sourceSha256,
  });
  const createdPagerootIds = plan.metadata.createdPagerootIds;
  assert.equal(createdPagerootIds.length, 1);
  assert.match(createdPagerootIds[0], /^pr1_[0-9a-f]{12}4[0-9a-f]{3}[89ab][0-9a-f]{15}$/u);
  assert.match(
    plan.metadata.nextInnerHtml,
    new RegExp(`<br data-pageroot-id="${createdPagerootIds[0]}">`, "u"),
  );
  const result = applyPatchPlan(plan, html);
  assert.equal(result.sourceIndex.pagerootIdentity.complete, true);
  assert.equal(result.sourceIndex.byPagerootId.has(createdPagerootIds[0]), true);
  assert.equal(editableIslandDraftHtml(plan.metadata.nextInnerHtml, {
    baselineInnerHtml: "first",
  }), "first<br>second");

  assertIslandError(
    "EDITABLE_ISLAND_IDENTITY_ADDED",
    () => planEditableIslandPatch(index, {
      targetRef,
      beforeInnerHtml: "first",
      nextInnerHtml: `first<br data-pageroot-id="pr1_20000000000040008000000000000001">second`,
      expectedSourceSha256: index.sourceSha256,
    }),
  );
});

test("editable island replays multiple line-break identities in DOM order", () => {
  const firstBreakId = "pr1_92000000000040008000000000000001";
  const secondBreakId = "pr1_92000000000040008000000000000002";
  const allocated = materializeEditableIslandHtml("first<br>second<br>third", {
    baselineInnerHtml: "first",
    randomUUID: (() => {
      const values = [
        "92000000-0000-4000-8000-000000000001",
        "92000000-0000-4000-8000-000000000002",
      ];
      return () => values.shift();
    })(),
  });
  assert.deepEqual(allocated.createdPagerootIds, [firstBreakId, secondBreakId]);
  assert.equal(
    allocated.html,
    `first<br data-pageroot-id="${firstBreakId}">second<br data-pageroot-id="${secondBreakId}">third`,
  );
  assert.deepEqual(materializeEditableIslandHtml(allocated.html, {
    baselineInnerHtml: "first",
    replayPagerootIds: [firstBreakId, secondBreakId],
  }), allocated);
  assertIslandError(
    "EDITABLE_ISLAND_IDENTITY_EVIDENCE_MISMATCH",
    () => materializeEditableIslandHtml(allocated.html, {
      baselineInnerHtml: "first",
      replayPagerootIds: [secondBreakId, firstBreakId],
    }),
  );
});

test("editable island preserves persistent IDs while allowing identified new inline structure", () => {
  const strongId = "pr1_11111111111141118111111111111111";
  const breakId = "pr1_22222222222242229222222222222222";
  const baseline = `<strong data-pageroot-id="${strongId}">原文</strong><em data-pageroot-id="pr1_3333333333334333a333333333333333"></em>`;
  assert.equal(
    normalizeEditableIslandHtml(
      `<strong data-pageroot-id="${strongId}">新文</strong><br data-pageroot-id="${breakId}"><em data-pageroot-id="pr1_3333333333334333a333333333333333"></em>`,
      { baselineInnerHtml: baseline },
    ),
    `<strong data-pageroot-id="${strongId}">新文</strong><br data-pageroot-id="${breakId}"><em data-pageroot-id="pr1_3333333333334333a333333333333333"></em>`,
  );
  assertIslandError(
    "EDITABLE_ISLAND_PERSISTENT_ID_CHANGED",
    () => normalizeEditableIslandHtml(
      `<strong data-pageroot-id="pr1_4444444444444444b444444444444444">新文</strong>`,
      { baselineInnerHtml: `<strong data-pageroot-id="${strongId}">原文</strong>` },
    ),
  );
});

test("editable island edits a nested-list heading while preserving the child list as an atom", () => {
  const { html, index, targetRef } = targetFor([
    "<main><ol><li>",
    "发现阶段",
    "<ul data-keep='yes'><li>访谈 12 位内容创作者</li><li>审计现有流程</li></ul>",
    "</li></ol><p>外部字节保持不变</p></main>",
  ].join(""), "li");
  const island = editableIslandForTarget(index, targetRef);
  assert.match(island.innerHtml, /^发现阶段<ul/u);

  const result = applyPatchPlan(planSourcePatch({
    type: "replace-editable-island",
    targetRef,
    beforeInnerHtml: island.innerHtml,
    nextInnerHtml: island.innerHtml.replace("发现阶段", "发现与验证阶段"),
  }, index), html);

  assert.equal(
    stripIdentity(result.html),
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
  const { html, index, targetRef } = targetFor("<p>abcdef</p>");
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
