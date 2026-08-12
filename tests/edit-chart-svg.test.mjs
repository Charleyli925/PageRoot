import assert from "node:assert/strict";
import test from "node:test";

import {
  EDIT_CHART_RENDERER_VERSION,
  renderEditChartSvg,
  validateEditChartSvg,
} from "../app/lib/edit-chart-svg.js";

function slot(overrides = {}) {
  return {
    tagName: "div",
    hostId: "chart-one",
    chartKind: "cartesian-v0.1",
    specId: "chart-one-spec",
    width: "640",
    height: "320",
    role: "img",
    ariaLabel: "渠道趋势图",
    isSourceEmpty: true,
    hasShadowRoot: false,
    aspectRatio: "640 / 320",
    ...overrides,
  };
}

function spec(overrides = {}) {
  return {
    version: "0.1",
    mode: "category",
    title: "渠道趋势",
    categories: ["一月", "二月", "三月"],
    series: [
      { id: "search", name: "搜索", type: "bar", values: [12, 18, 25] },
      { id: "recommend", name: "推荐", type: "line", values: [8, 15, 23] },
    ],
    ...overrides,
  };
}

test("renders a bounded fixed-viewBox SVG with the pinned ECharts renderer", () => {
  const result = renderEditChartSvg({ slot: slot(), spec: spec() });
  assert.equal(result.ok, true);
  assert.equal(EDIT_CHART_RENDERER_VERSION, "6.1.0");
  assert.equal(result.rendererVersion, "6.1.0");
  assert.equal(result.viewBox, "0 0 640 320");
  assert.ok(result.bytes > 0);
  assert.match(result.svg, /^<svg width="640" height="320"/u);
  assert.match(result.svg, /viewBox="0 0 640 320"/u);
  assert.doesNotMatch(result.svg, /<(?:script|foreignObject|iframe|object|embed|image)\b/iu);
  assert.doesNotMatch(result.svg, /\son[a-z]+\s*=/iu);
});

test("renders stacked area and numeric scatter through the same closed renderer", () => {
  const area = renderEditChartSvg({
    slot: slot(),
    spec: spec({
      series: [
        { id: "a", name: "A", type: "line", values: [1, 2, 3], stack: "total", area: true },
        { id: "b", name: "B", type: "line", values: [2, 3, 4], stack: "total", area: true },
      ],
    }),
  });
  const scatter = renderEditChartSvg({
    slot: slot({ hostId: "scatter", specId: "scatter-spec" }),
    spec: {
      version: "0.1",
      mode: "numeric",
      title: "量价分布",
      series: [{
        id: "products",
        name: "商品",
        type: "scatter",
        points: [[10, 20], [20, 15], [30, 45]],
        symbolSize: 14,
      }],
    },
  });

  assert.equal(area.ok, true);
  assert.equal(scatter.ok, true);
  assert.match(area.svg, /<path\b/u);
  assert.match(scatter.svg, /ecmeta_ssr_type="chart"/u);
});

test("fails closed on malformed, external or dimension-drifting SVG", () => {
  const root = '<svg width="640" height="320" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 320"><rect width="1" height="1"></rect></svg>';
  assert.equal(validateEditChartSvg(root, { width: 640, height: 320 }).ok, true);
  assert.equal(validateEditChartSvg(
    root.replace("<rect", '<image href="https://example.com/a.png"></image><rect'),
    { width: 640, height: 320 },
  ).ok, false);
  assert.equal(validateEditChartSvg(
    root.replace("<rect", '<rect onload="alert(1)"'),
    { width: 640, height: 320 },
  ).code, "edit-chart-svg-capability-forbidden");
  assert.equal(validateEditChartSvg(
    root.replace("<rect", "<path href=/relative></path><rect"),
    { width: 640, height: 320 },
  ).code, "edit-chart-svg-capability-forbidden");
  assert.equal(validateEditChartSvg(
    root.replace("0 0 640 320", "0 0 320 320"),
    { width: 640, height: 320 },
  ).code, "edit-chart-svg-viewbox-invalid");
});

test("rejects invalid slots and specs before invoking ECharts", () => {
  assert.equal(renderEditChartSvg({
    slot: slot({ aspectRatio: "auto" }),
    spec: spec(),
  }).code, "edit-chart-slot-aspect-ratio-invalid");
  assert.equal(renderEditChartSvg({
    slot: slot(),
    spec: spec({ tooltip: { show: true } }),
  }).code, "edit-chart-spec-shape-invalid");
  const inherited = Object.create({ slot: slot() });
  inherited.spec = spec();
  assert.equal(renderEditChartSvg(inherited).code, "edit-chart-render-request-invalid");
  const accessor = { slot: slot(), spec: spec() };
  Object.defineProperty(accessor, "spec", { enumerable: true, get: () => spec() });
  assert.equal(renderEditChartSvg(accessor).code, "edit-chart-render-request-invalid");
});
