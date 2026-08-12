import assert from "node:assert/strict";
import test from "node:test";

import {
  EDIT_CHART_LIMITS,
  EDIT_CHART_SOURCE_CONTRACT,
  parseEditChartSpec,
  toEditChartEChartsOption,
  validateEditChartDocumentBudget,
  validateEditChartSlot,
  validateEditChartSpec,
} from "../app/domain/edit-chart-spec.js";

function categorySpec(overrides = {}) {
  return {
    version: "0.1",
    mode: "category",
    title: "季度趋势",
    xAxisName: "季度",
    yAxisName: "金额",
    categories: ["Q1", "Q2", "Q3"],
    series: [
      {
        id: "revenue",
        name: "收入",
        type: "bar",
        values: [10, 20, 30],
        color: "#5070dd",
      },
      {
        id: "profit",
        name: "利润",
        type: "line",
        values: [2, 5, 9],
        area: true,
        smooth: true,
      },
    ],
    ...overrides,
  };
}

function slot(overrides = {}) {
  return {
    tagName: "div",
    hostId: "quarterly-chart",
    chartKind: "cartesian-v0.1",
    specId: "quarterly-chart-spec",
    width: "640",
    height: "320",
    role: "img",
    ariaLabel: "季度收入与利润趋势图",
    isSourceEmpty: true,
    hasShadowRoot: false,
    aspectRatio: "2 / 1",
    ...overrides,
  };
}

test("freezes the versioned source contract and normalizes bounded category specs", () => {
  assert.equal(EDIT_CHART_SOURCE_CONTRACT.chartKind, "cartesian-v0.1");
  assert.equal(EDIT_CHART_SOURCE_CONTRACT.attributes.chartKind, "data-report-chart-slot");
  assert.equal(Object.isFrozen(EDIT_CHART_SOURCE_CONTRACT), true);

  const result = parseEditChartSpec(JSON.stringify(categorySpec()));
  assert.equal(result.ok, true);
  assert.equal(Object.isFrozen(result.spec), true);
  assert.equal(Object.isFrozen(result.spec.series), true);
  assert.equal(result.spec.series[0].color, "#5070DD");
  assert.equal(result.spec.legend, true);
  assert.equal(result.sourceBytes, new TextEncoder().encode(JSON.stringify(categorySpec())).byteLength);
});

test("maps category, stacked area and horizontal charts to a closed ECharts option", () => {
  const option = toEditChartEChartsOption(categorySpec({
    orientation: "horizontal",
    series: [
      {
        id: "online",
        name: "线上",
        type: "bar",
        values: [10, 12, 14],
        stack: "total",
      },
      {
        id: "offline",
        name: "线下",
        type: "line",
        values: [3, null, 5],
        stack: "total",
        area: true,
        symbol: "circle",
      },
    ],
  }));

  assert.equal(option.animation, false);
  assert.equal(option.legend.selectedMode, false);
  assert.equal(option.grid.outerBoundsMode, "same");
  assert.equal(option.xAxis.type, "value");
  assert.equal(option.yAxis.type, "category");
  assert.deepEqual(option.series.map((item) => item.type), ["bar", "line"]);
  assert.equal(option.series[1].areaStyle.opacity, 0.16);
  assert.equal(option.series[1].silent, true);
  assert.equal("tooltip" in option, false);
  assert.equal("toolbox" in option, false);
  assert.equal("dataset" in option, false);
});

test("accepts numeric scatter specs without exposing raw ECharts options", () => {
  const result = validateEditChartSpec({
    version: "0.1",
    mode: "numeric",
    title: "量价分布",
    xAxisName: "价格",
    yAxisName: "销量",
    series: [{
      id: "products",
      name: "商品",
      type: "scatter",
      points: [[10, 30], [20, 18], [35, 42]],
      symbolSize: 12,
      color: "#0ca8df",
    }],
  });
  assert.equal(result.ok, true);
  const option = toEditChartEChartsOption(result.spec);
  assert.equal(option.xAxis.type, "value");
  assert.equal(option.yAxis.type, "value");
  assert.deepEqual(option.series[0].data, [[10, 30], [20, 18], [35, 42]]);
  assert.equal(option.series[0].symbolSize, 12);
});

test("rejects scripts, URLs, raw ECharts capabilities, accessors and inherited objects", () => {
  assert.equal(parseEditChartSpec("window.alert(1)").code, "edit-chart-spec-json-invalid");
  assert.equal(parseEditChartSpec(null).code, "edit-chart-spec-source-invalid");
  assert.equal(parseEditChartSpec(`{"padding":"${"x".repeat(EDIT_CHART_LIMITS.sourceBytes)}"}`).code,
    "edit-chart-spec-source-too-large");

  for (const extra of [
    { tooltip: { formatter: "<img onerror=alert(1)>" } },
    { toolbox: { feature: { saveAsImage: {} } } },
    { dataset: { source: "https://example.com/data.json" } },
    { backgroundColor: { image: "data:image/png;base64,AA" } },
  ]) {
    assert.equal(validateEditChartSpec({ ...categorySpec(), ...extra }).ok, false);
  }
  assert.equal(validateEditChartSpec(categorySpec({ title: "https://example.com" })).ok, false);
  assert.equal(validateEditChartSpec(categorySpec({
    series: [{
      id: "unsafe",
      name: "任意代码",
      type: "custom",
      values: [1, 2, 3],
    }],
  })).ok, false);

  const inherited = Object.create({ tooltip: true });
  Object.assign(inherited, categorySpec());
  assert.equal(validateEditChartSpec(inherited).ok, false);
  const accessor = categorySpec();
  Object.defineProperty(accessor, "title", { enumerable: true, get: () => "getter" });
  assert.equal(validateEditChartSpec(accessor).ok, false);
  let nestedGetterCalls = 0;
  const getterValues = [1, 2, 3];
  Object.defineProperty(getterValues, "1", {
    enumerable: true,
    get: () => {
      nestedGetterCalls += 1;
      return 2;
    },
  });
  assert.equal(validateEditChartSpec(categorySpec({
    series: [{ id: "getter", name: "Getter", type: "line", values: getterValues }],
  })).ok, false);
  assert.equal(nestedGetterCalls, 0);
  const decoratedCategories = ["Q1", "Q2", "Q3"];
  decoratedCategories.extra = "not JSON";
  assert.equal(validateEditChartSpec(categorySpec({ categories: decoratedCategories })).ok, false);
});

test("enforces series identities, point budgets and mode-specific fields", () => {
  assert.equal(validateEditChartSpec(categorySpec({
    series: [
      { id: "same", name: "A", type: "bar", values: [1, 2, 3] },
      { id: "same", name: "B", type: "line", values: [1, 2, 3] },
    ],
  })).code, "edit-chart-spec-series-id-duplicate");
  assert.equal(validateEditChartSpec(categorySpec({
    categories: Array.from({ length: EDIT_CHART_LIMITS.categories + 1 }, (_, index) => String(index)),
  })).ok, false);
  assert.equal(validateEditChartSpec({
    version: "0.1",
    mode: "numeric",
    categories: ["not allowed"],
    series: [{ id: "s", name: "S", type: "scatter", points: [[1, 2]] }],
  }).code, "edit-chart-spec-mode-fields-invalid");
  assert.equal(validateEditChartSpec({
    version: "0.1",
    mode: "numeric",
    series: [{
      id: "oversized",
      name: "Oversized",
      type: "scatter",
      points: Array.from({ length: EDIT_CHART_LIMITS.totalPoints + 1 }, () => [1, 2]),
    }],
  }).ok, false);
  assert.equal(validateEditChartSpec(categorySpec({
    series: [{
      id: "bad-color",
      name: "颜色",
      type: "bar",
      values: [1, 2, 3],
      color: "url(javascript:alert(1))",
    }],
  })).ok, false);
});

test("validates fixed slot geometry without accepting a live layout measurement", () => {
  const result = validateEditChartSlot(slot());
  assert.equal(result.ok, true);
  assert.equal(result.slot.width, 640);
  assert.equal(result.slot.height, 320);
  assert.equal(result.slot.viewBox, "0 0 640 320");
  assert.equal("rect" in result.slot, false);

  assert.equal(validateEditChartSlot(slot({ aspectRatio: "auto" })).code,
    "edit-chart-slot-aspect-ratio-invalid");
  assert.equal(validateEditChartSlot(slot({ aspectRatio: "16 / 9" })).code,
    "edit-chart-slot-aspect-ratio-invalid");
  assert.equal(validateEditChartSlot(slot({ aspectRatio: "1".repeat(40) })).code,
    "edit-chart-slot-aspect-ratio-invalid");
  assert.equal(validateEditChartSlot(slot({ isSourceEmpty: false })).code,
    "edit-chart-slot-not-empty");
  assert.equal(validateEditChartSlot(slot({ hasShadowRoot: true })).code,
    "edit-chart-slot-shadow-conflict");
  assert.equal(validateEditChartSlot({ ...slot(), rectWidth: 0 }).code,
    "edit-chart-slot-shape-invalid");
});

test("enforces document-wide preflight and rendered SVG budgets", () => {
  const parsed = parseEditChartSpec(JSON.stringify(categorySpec()));
  assert.equal(parsed.ok, true);
  const preflight = validateEditChartDocumentBudget([
    { sourceBytes: parsed.sourceBytes, spec: parsed.spec },
    { sourceBytes: parsed.sourceBytes, spec: parsed.spec },
  ]);
  assert.equal(preflight.ok, true);
  assert.deepEqual(preflight.budget, {
    chartCount: 2,
    totalSpecBytes: parsed.sourceBytes * 2,
    totalPoints: 12,
    totalSvgBytes: null,
  });
  const rendered = validateEditChartDocumentBudget([
    { sourceBytes: parsed.sourceBytes, spec: parsed.spec, svgBytes: 8_000 },
    { sourceBytes: parsed.sourceBytes, spec: parsed.spec, svgBytes: 9_000 },
  ]);
  assert.equal(rendered.ok, true);
  assert.equal(rendered.budget.totalSvgBytes, 17_000);
  assert.equal(validateEditChartDocumentBudget([]).code, "edit-chart-document-count-invalid");
  assert.equal(validateEditChartDocumentBudget(Array.from(
    { length: EDIT_CHART_LIMITS.chartsPerDocument + 1 },
    () => ({ sourceBytes: parsed.sourceBytes, spec: parsed.spec }),
  )).code, "edit-chart-document-count-invalid");
  assert.equal(validateEditChartDocumentBudget([
    { sourceBytes: parsed.sourceBytes, spec: parsed.spec },
    { sourceBytes: parsed.sourceBytes, spec: parsed.spec, svgBytes: 9_000 },
  ]).code, "edit-chart-document-render-state-mixed");

  const dense = validateEditChartSpec(categorySpec({
    categories: Array.from({ length: 120 }, (_, index) => `C${index}`),
    series: Array.from({ length: 12 }, (_, index) => ({
      id: `series-${index}`,
      name: `Series ${index}`,
      type: "line",
      values: Array.from({ length: 120 }, (_, value) => value),
    })),
  }));
  assert.equal(dense.ok, true);
  assert.equal(validateEditChartDocumentBudget(Array.from(
    { length: 9 },
    () => ({ sourceBytes: EDIT_CHART_LIMITS.sourceBytes, spec: dense.spec }),
  )).code, "edit-chart-document-spec-bytes-too-large");
  assert.equal(validateEditChartDocumentBudget(Array.from(
    { length: 9 },
    () => ({ sourceBytes: 2, spec: dense.spec }),
  )).code, "edit-chart-document-points-too-many");
  assert.equal(validateEditChartDocumentBudget(Array.from(
    { length: 9 },
    () => ({ sourceBytes: 2, spec: parsed.spec, svgBytes: EDIT_CHART_LIMITS.svgBytes }),
  )).code, "edit-chart-document-svg-bytes-too-large");
});
