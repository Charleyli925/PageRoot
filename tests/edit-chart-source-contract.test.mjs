import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  EDIT_CHART_LIMITS,
  EDIT_CHART_SOURCE_CONTRACT,
} from "../app/domain/edit-chart-spec.js";
import { buildSourceIndex } from "../app/lib/source-index.js";
import { createTargetRef, resolveTargetRef } from "../app/lib/target-resolver.js";

function sourceHtml(values) {
  const spec = JSON.stringify({
    version: "0.1",
    mode: "category",
    categories: ["Q1", "Q2", "Q3"],
    series: [{ id: "revenue", name: "收入", type: "bar", values }],
  });
  return `<!doctype html><html><body>
    <div id="quarterly-chart"
      data-report-chart-slot="cartesian-v0.1"
      data-report-chart-spec-id="quarterly-chart-spec"
      data-report-chart-width="640"
      data-report-chart-height="320"
      role="img"
      aria-label="季度收入趋势图"
      style="width:100%;aspect-ratio:2 / 1"></div>
    <template id="quarterly-chart-spec" data-report-chart-spec="0.1">${spec}</template>
  </body></html>`;
}

function chartHost(index) {
  return index.elements.find((element) => element.stableAttributes.id === "quarterly-chart");
}

test("keeps Chart Spec outside the empty source-backed comment host", () => {
  const index = buildSourceIndex(sourceHtml([10, 20, 30]));
  const host = chartHost(index);
  const template = index.elements.find((element) => (
    element.tagName === "template"
    && element.stableAttributes.id === "quarterly-chart-spec"
  ));

  assert.ok(host);
  assert.ok(template);
  assert.equal(host.tagName, "div");
  assert.equal(host.textContent, "");
  assert.equal(host.childIds.length, 0);
  assert.equal(host.stableAttributes["data-report-chart-slot"], "cartesian-v0.1");
  assert.match(template.textContent, /"values":\[10,20,30\]/u);
});

test("changing only Chart Spec data preserves the host TargetRef", () => {
  const beforeIndex = buildSourceIndex(sourceHtml([10, 20, 30]));
  const host = chartHost(beforeIndex);
  const targetRef = createTargetRef(beforeIndex, host, { level: "subregion" });
  const afterIndex = buildSourceIndex(sourceHtml([12, 24, 36]));
  const resolution = resolveTargetRef(afterIndex, targetRef);

  assert.notEqual(resolution.resolution, "orphaned");
  assert.notEqual(resolution.resolution, "ambiguous");
  assert.equal(resolution.target.stableAttributes.id, "quarterly-chart");
  assert.equal(resolution.target.textContent, "");
});

test("the conditional AI protocol stays aligned with the frozen Chart Spec contract", async () => {
  const protocol = await readFile(
    new URL("../scripts/edit-chart-spec-protocol-v0.1.md", import.meta.url),
    "utf8",
  );
  assert.ok(protocol.includes(
    `data-report-chart-slot="${EDIT_CHART_SOURCE_CONTRACT.chartKind}"`,
  ));
  assert.ok(protocol.includes(
    `data-report-chart-spec="${EDIT_CHART_SOURCE_CONTRACT.specVersion}"`,
  ));
  assert.ok(protocol.includes(
    `SSR 宽度为 ${EDIT_CHART_LIMITS.width.min}–${EDIT_CHART_LIMITS.width.max}`,
  ));
  assert.ok(protocol.includes(
    `高度为 ${EDIT_CHART_LIMITS.height.min}–${EDIT_CHART_LIMITS.height.max}`,
  ));
  assert.ok(protocol.includes(`每份文档最多 ${EDIT_CHART_LIMITS.chartsPerDocument} 个图表`));
  assert.ok(protocol.includes("本轮与图表无关：不修改任何图表宿主或 Spec"));
  assert.ok(protocol.includes("未受影响的宿主和已有 Spec 保持原文"));
  assert.ok(protocol.includes("原 Preview 的文案、数据、颜色、尺寸、CSS、脚本、option、交互和布局"));
});
