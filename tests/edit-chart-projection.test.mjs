import assert from "node:assert/strict";
import test from "node:test";

import { EDIT_CHART_LIMITS } from "../app/domain/edit-chart-spec.js";
import { prepareEditChartProjection } from "../app/lib/edit-chart-projection.js";
import { buildSourceIndex } from "../app/lib/source-index.js";

function categorySpec(overrides = {}) {
  return {
    version: "0.1",
    mode: "category",
    title: "渠道趋势",
    categories: ["Q1", "Q2", "Q3"],
    series: [
      { id: "gmv", name: "GMV", type: "bar", values: [10, 18, 25] },
      { id: "orders", name: "订单", type: "line", values: [8, 15, 23] },
    ],
    ...overrides,
  };
}

function chartMarkup(id, spec, overrides = {}) {
  const {
    width = 640,
    height = 320,
    hostBody = "",
    specBody = JSON.stringify(spec),
    specId = `${id}-spec`,
    extraHostAttributes = "",
  } = overrides;
  return `
    <div id="${id}"
      data-report-chart-slot="cartesian-v0.1"
      data-report-chart-spec-id="${specId}"
      data-report-chart-width="${width}"
      data-report-chart-height="${height}"
      role="img"
      aria-label="${id} 图表"
      style="display:block;width:100%;aspect-ratio:${width} / ${height};overflow:hidden"
      ${extraHostAttributes}>${hostBody}</div>
    <template id="${specId}" data-report-chart-spec="0.1">${specBody}</template>`;
}

function documentWith(body) {
  return `<!doctype html><html lang="zh-CN"><body>${body}</body></html>`;
}

test("prepares all supported fixed-slot chart families without changing source bytes", () => {
  const source = documentWith([
    chartMarkup("mixed", categorySpec()),
    chartMarkup("area", categorySpec({
      series: [
        { id: "a", name: "A", type: "line", values: [1, 2, 3], area: true, stack: "total" },
        { id: "b", name: "B", type: "line", values: [2, 3, 4], area: true, stack: "total" },
      ],
    })),
    chartMarkup("horizontal", categorySpec({
      orientation: "horizontal",
      series: [{ id: "bar", name: "横向柱", type: "bar", values: [5, 8, 13] }],
    })),
    chartMarkup("scatter", {
      version: "0.1",
      mode: "numeric",
      xAxisName: "价格",
      yAxisName: "销量",
      series: [{
        id: "products",
        name: "商品",
        type: "scatter",
        points: [[10, 30], [20, 18], [35, 42]],
      }],
    }),
  ].join(""));
  const sourceIndex = buildSourceIndex(source);
  const result = prepareEditChartProjection(sourceIndex);

  assert.equal(result.ok, true);
  assert.equal(result.declaredCount, 4);
  assert.equal(result.visuals.length, 4);
  assert.equal(result.budget.chartCount, 4);
  assert.ok(result.budget.totalSvgBytes > 0);
  assert.equal(sourceIndex.source, source);
  assert.deepEqual(result.visuals.map((visual) => visual.slot.viewBox), [
    "0 0 640 320",
    "0 0 640 320",
    "0 0 640 320",
    "0 0 640 320",
  ]);
});

test("ignores arbitrary authored ECharts scripts and undeclared legacy hosts", () => {
  const source = documentWith(`
    <div id="legacy-chart" style="width:100%;height:320px"></div>
    <script>
      const chart = echarts.init(document.getElementById("legacy-chart"));
      chart.setOption(${JSON.stringify(categorySpec())});
    </script>`);
  const result = prepareEditChartProjection(buildSourceIndex(source));

  assert.equal(result.ok, true);
  assert.equal(result.declaredCount, 0);
  assert.deepEqual(result.visuals, []);
});

test("silently skips malformed individual declarations while retaining valid siblings", () => {
  const source = documentWith([
    chartMarkup("valid", categorySpec()),
    chartMarkup("non-empty", categorySpec(), { hostBody: "authored content" }),
    chartMarkup("html-spec", categorySpec(), { specBody: "<b>not JSON text</b>" }),
    chartMarkup("wrong-ratio", categorySpec(), {
      extraHostAttributes: 'style="aspect-ratio:1 / 1"',
    }),
  ].join(""));
  const result = prepareEditChartProjection(buildSourceIndex(source));

  assert.equal(result.ok, true);
  assert.equal(result.declaredCount, 4);
  assert.deepEqual(result.visuals.map((visual) => visual.hostId), ["valid"]);
});

test("fails shared identities and document-wide host budgets closed", () => {
  const sharedSpec = JSON.stringify(categorySpec());
  const shared = documentWith(`
    ${chartMarkup("first", categorySpec(), { specId: "shared", specBody: sharedSpec })}
    <div id="second"
      data-report-chart-slot="cartesian-v0.1"
      data-report-chart-spec-id="shared"
      data-report-chart-width="640"
      data-report-chart-height="320"
      role="img"
      aria-label="第二张图"
      style="width:100%;aspect-ratio:2 / 1"></div>`);
  const sharedResult = prepareEditChartProjection(buildSourceIndex(shared));
  assert.equal(sharedResult.ok, true);
  assert.equal(sharedResult.declaredCount, 2);
  assert.equal(sharedResult.visuals.length, 0);

  const overBudget = documentWith(Array.from(
    { length: EDIT_CHART_LIMITS.chartsPerDocument + 1 },
    (_, index) => chartMarkup(`chart-${index}`, categorySpec()),
  ).join(""));
  const budgetResult = prepareEditChartProjection(buildSourceIndex(overBudget));
  assert.equal(budgetResult.ok, false);
  assert.equal(budgetResult.code, "edit-chart-projection-host-count-invalid");
});

test("preserves meaningful JSON spacing and accepts only whitespace in a source-empty host", () => {
  const spacedTitle = "搜索  市场";
  const source = documentWith(chartMarkup("spaced", categorySpec({
    title: spacedTitle,
  }), {
    hostBody: "\n      \n",
  }));
  const result = prepareEditChartProjection(buildSourceIndex(source));

  assert.equal(result.ok, true);
  assert.equal(result.visuals.length, 1);
  assert.match(result.visuals[0].specSource, /搜索  市场/u);
});
