import assert from "node:assert/strict";
import test from "node:test";

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
