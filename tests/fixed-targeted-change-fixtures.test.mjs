import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  SOURCE_NODE_ATTRIBUTE,
  SourcePatchError,
  applyPatchPlan,
  buildSourceIndex,
  createTargetRef,
  instrumentPreviewHtml,
  planSourcePatch,
  resolveTargetRef,
} from "../app/lib/source-patch-core.js";

const fixtureRoot = fileURLToPath(
  new URL("./fixtures/targeted-change/", import.meta.url),
);

async function fixture(name) {
  return readFile(join(fixtureRoot, name), "utf8");
}

function matchesSimpleSelector(index, element, selector) {
  const parts = selector.split(">").map((part) => part.trim());
  const token = parts.at(-1);
  const tagMatch = token.match(/^[a-z][a-z0-9-]*/iu)?.[0]?.toLowerCase();
  const idMatch = token.match(/#([a-z0-9_-]+)/iu)?.[1];
  const attributeMatch = token.match(
    /\[([a-z0-9_-]+)=["']?([^"'\]]+)["']?\]/iu,
  );
  if (tagMatch && element.tagName !== tagMatch) return false;
  if (idMatch && element.stableAttributes.id !== idMatch) return false;
  if (
    attributeMatch
    && element.stableAttributes[attributeMatch[1].toLowerCase()]
      !== attributeMatch[2]
  ) {
    return false;
  }
  if (parts.length === 1) return true;
  const parent = index.byNodeId.get(element.parentId);
  return Boolean(parent && matchesSimpleSelector(index, parent, parts[0]));
}

test("the checked-in targeted-change manifest is an executable release gate", async () => {
  const manifest = JSON.parse(await fixture("expected-targets.json"));
  assert.equal(manifest.schemaVersion, "1.0.0");
  assert.equal(manifest.offsetUnit, "utf-16-code-unit");

  for (const sample of manifest.samples) {
    const html = await fixture(sample.path);
    const index = buildSourceIndex(html);
    assert.equal(index.integrity.ok, true, sample.path);
    assert.equal(instrumentPreviewHtml(index).html.includes(SOURCE_NODE_ATTRIBUTE), true);
    assert.equal(html.includes(SOURCE_NODE_ATTRIBUTE), false);

    if (sample.lineEnding === "crlf") {
      assert.match(html, /\r\n/u);
      assert.equal(/(^|[^\r])\n/u.test(html), false);
    }

    for (const expected of sample.targets) {
      const candidates = index.elements.filter(
        (element) =>
          matchesSimpleSelector(index, element, expected.selector)
          && element.textContent.includes(expected.textQuote),
      );
      if (expected.expectedResolution === "ambiguous") {
        const resolution = resolveTargetRef(index, {
          targetId: `fixture:${sample.path}:${expected.label}`,
          label: expected.label,
          level: "module",
          selector: expected.selector,
          textQuote: expected.textQuote,
          resolution: "ambiguous",
        });
        assert.equal(resolution.resolution, "ambiguous", expected.label);
        assert.equal(resolution.candidates.length, candidates.length);
        continue;
      }

      assert.equal(candidates.length, 1, expected.label);
      const targetRef = createTargetRef(index, candidates[0].nodeId, {
        targetId: `fixture:${sample.path}:${expected.label}`,
      });
      assert.equal(
        resolveTargetRef(index, targetRef).resolution,
        expected.expectedResolution,
        expected.label,
      );
    }
  }
});

test("fixed Unicode/style/reorder fixtures enforce exact source patches and failure closure", async () => {
  const unicodeHtml = await fixture("source-index-unicode-lf.html");
  const unicodeIndex = buildSourceIndex(unicodeHtml);
  const heading = unicodeIndex.elements.find(
    (element) => element.tagName === "h1",
  );
  const textResult = applyPatchPlan(planSourcePatch({
    type: "replace-editable-island",
    targetRef: createTargetRef(unicodeIndex, heading.nodeId, { level: "subregion" }),
    beforeInnerHtml: "中文标题😀",
    nextInnerHtml: "中文标题😀已验证",
  }, unicodeIndex), unicodeHtml);
  assert.equal(textResult.scopeReport.outsideUnchanged, true);
  assert.equal(applyPatchPlan(textResult.inversePlan, textResult.html).html, unicodeHtml);

  const styleHtml = await fixture("styles-and-scope.html");
  const styleIndex = buildSourceIndex(styleHtml);
  const headingWithInlineStyle = styleIndex.elements.find(
    (element) =>
      element.tagName === "h2"
      && element.parentId
      && styleIndex.byNodeId.get(element.parentId)?.stableAttributes.id === "allowed",
  );
  const styleResult = applyPatchPlan(planSourcePatch({
    type: "set-inline-style",
    targetRef: createTargetRef(styleIndex, headingWithInlineStyle.nodeId),
    property: "color",
    value: "rgb(1, 2, 3)",
    beforeValue: "red",
  }, styleIndex), styleHtml);
  assert.equal(styleResult.scopeReport.outsideUnchanged, true);
  assert.match(styleResult.html, /style='color: rgb\(1, 2, 3\); padding: 4px !important'/u);
  assert.equal(applyPatchPlan(styleResult.inversePlan, styleResult.html).html, styleHtml);

  const structureHtml = await fixture("structure-and-reorder.html");
  const structureIndex = buildSourceIndex(structureHtml);
  const articles = structureIndex.elements.filter(
    (element) => element.tagName === "article",
  );
  assert.throws(
    () => planSourcePatch({
      type: "reorder-sibling",
      targetRef: createTargetRef(structureIndex, articles[1].nodeId),
      beforeTargetRef: createTargetRef(structureIndex, articles[0].nodeId),
    }, structureIndex),
    (error) =>
      error instanceof SourcePatchError
      && error.code === "UNSAFE_REORDER_BOUNDARY",
  );

  const alphaSource = structureHtml.slice(
    articles[0].range.startOffset,
    articles[0].range.endOffset,
  );
  const betaSource = structureHtml.slice(
    articles[1].range.startOffset,
    articles[1].range.endOffset,
  );
  const externallyReordered = structureHtml
    .replace(alphaSource, "__ALPHA_PLACEHOLDER__")
    .replace(betaSource, alphaSource)
    .replace("__ALPHA_PLACEHOLDER__", betaSource);
  const betaRef = createTargetRef(structureIndex, articles[1].nodeId, {
    targetId: "fixture-beta",
  });
  assert.equal(
    resolveTargetRef(buildSourceIndex(externallyReordered), betaRef).resolution,
    "rebound",
  );
});

test("fixed scope fixture keeps out-of-target bytes when the allowed island is patched", async () => {
  const baseHtml = await fixture("styles-and-scope.html");
  const index = buildSourceIndex(baseHtml);
  const allowed = index.elements.find(
    (element) =>
      element.tagName === "p"
      && element.textContent.includes("允许修改的正文"),
  );
  const result = applyPatchPlan(planSourcePatch({
    type: "replace-editable-island",
    targetRef: createTargetRef(index, allowed.nodeId, { level: "subregion" }),
    beforeInnerHtml: "允许修改的正文",
    nextInnerHtml: "允许修改的正文（已验证）",
  }, index), baseHtml);
  assert.equal(result.scopeReport.outsideUnchanged, true);
  assert.match(result.html, /允许修改的正文（已验证）/u);
  assert.match(result.html, /范围外必须逐字符保持/u);
  assert.match(result.html, /--brand-primary: #2563eb/u);
  assert.match(result.html, /untouched: true/u);
  assert.doesNotMatch(result.html, /data-rogue/u);
});

test("the committed desktop QA fixture reproduces text, style, reorder, and full inverse recovery", async () => {
  const original = await readFile(
    fileURLToPath(new URL("./fixtures/desktop-qa.html", import.meta.url)),
    "utf8",
  );
  const firstIndex = buildSourceIndex(original);
  const heading = firstIndex.elements.find(
    (element) => element.tagName === "h1",
  );
  const textResult = applyPatchPlan(planSourcePatch({
    type: "replace-editable-island",
    targetRef: createTargetRef(firstIndex, heading.nodeId, { level: "subregion" }),
    beforeInnerHtml: "桌面自动写回验收",
    nextInnerHtml: "Desktop Source Patch Verified",
  }, firstIndex), original);

  const secondIndex = textResult.sourceIndex;
  const firstMetric = secondIndex.elements.find(
    (element) =>
      element.tagName === "section"
      && element.textContent.includes("当前状态"),
  );
  const styleResult = applyPatchPlan(planSourcePatch({
    type: "set-inline-style",
    targetRef: createTargetRef(secondIndex, firstMetric.nodeId),
    property: "font-style",
    value: "italic",
    important: true,
  }, secondIndex), textResult.html);
  assert.match(styleResult.html, /style="font-style: italic !important"/u);

  const thirdIndex = styleResult.sourceIndex;
  const metrics = thirdIndex.elements.filter(
    (element) =>
      element.tagName === "section"
      && element.attributesByName.has("class"),
  );
  assert.equal(metrics.length, 3);
  const firstReorder = applyPatchPlan(planSourcePatch({
    type: "reorder-sibling",
    targetRef: createTargetRef(thirdIndex, metrics[2].nodeId),
    beforeTargetRef: createTargetRef(thirdIndex, metrics[1].nodeId),
  }, thirdIndex), styleResult.html);
  const fourthIndex = firstReorder.sourceIndex;
  const continuousMetric = fourthIndex.elements.find(
    (element) =>
      element.tagName === "section"
      && element.textContent.includes("连续排序"),
  );
  const currentMetric = fourthIndex.elements.find(
    (element) =>
      element.tagName === "section"
      && element.textContent.includes("当前状态"),
  );
  const reorderResult = applyPatchPlan(planSourcePatch({
    type: "reorder-sibling",
    targetRef: createTargetRef(fourthIndex, continuousMetric.nodeId),
    beforeTargetRef: createTargetRef(fourthIndex, currentMetric.nodeId),
  }, fourthIndex), firstReorder.html);
  assert.ok(
    reorderResult.html.indexOf("连续排序")
      < reorderResult.html.indexOf("当前状态"),
  );
  assert.equal(reorderResult.scopeReport.outsideUnchanged, true);

  const undoSecondReorder = applyPatchPlan(
    reorderResult.inversePlan,
    reorderResult.html,
  );
  const undoFirstReorder = applyPatchPlan(
    firstReorder.inversePlan,
    undoSecondReorder.html,
  );
  const undoStyle = applyPatchPlan(styleResult.inversePlan, undoFirstReorder.html);
  const undoText = applyPatchPlan(textResult.inversePlan, undoStyle.html);
  assert.equal(undoText.html, original);
});
