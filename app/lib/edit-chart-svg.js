import * as echarts from "echarts/core";
import { BarChart, LineChart, ScatterChart } from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  TitleComponent,
} from "echarts/components";
import { SVGRenderer } from "echarts/renderers";

import {
  EDIT_CHART_LIMITS,
  toEditChartEChartsOption,
  validateEditChartSlot,
  validateEditChartSpec,
} from "../domain/edit-chart-spec.js";

// Registration is process-local library setup, not document state. Individual
// SSR chart instances are still disposed synchronously after each render.
echarts.use([
  BarChart,
  LineChart,
  ScatterChart,
  GridComponent,
  LegendComponent,
  TitleComponent,
  SVGRenderer,
]);

export const EDIT_CHART_RENDERER_VERSION = echarts.version;

const ALLOWED_SVG_ELEMENTS = new Set([
  "circle",
  "clippath",
  "defs",
  "ellipse",
  "g",
  "line",
  "lineargradient",
  "path",
  "polygon",
  "polyline",
  "radialgradient",
  "rect",
  "stop",
  "style",
  "svg",
  "text",
  "tspan",
]);

function fail(code) {
  return Object.freeze({ ok: false, code });
}

function isRenderRequest(value) {
  if (
    value === null
    || typeof value !== "object"
    || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
    || Object.getOwnPropertySymbols(value).length > 0
  ) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return Object.keys(descriptors).length === 2
    && ["slot", "spec"].every((key) => (
      Object.hasOwn(descriptors, key)
      && descriptors[key].enumerable === true
      && Object.hasOwn(descriptors[key], "value")
    ));
}

function cssReferencesAreLocal(source) {
  for (const match of source.matchAll(/url\s*\(([^)]*)\)/giu)) {
    const reference = match[1].trim().replace(/^(["'])(.*)\1$/u, "$2").trim();
    if (!reference.startsWith("#")) return false;
  }
  return true;
}

export function validateEditChartSvg(source, dimensions) {
  // This verifier accepts only output from the fixed mapper and pinned
  // renderer. It is not a sanitizer for authored or arbitrary SVG input.
  if (typeof source !== "string") return fail("edit-chart-svg-source-invalid");
  if (source.length > EDIT_CHART_LIMITS.svgBytes) return fail("edit-chart-svg-too-large");
  const bytes = new TextEncoder().encode(source).byteLength;
  if (bytes > EDIT_CHART_LIMITS.svgBytes) return fail("edit-chart-svg-too-large");
  const width = dimensions?.width;
  const height = dimensions?.height;
  if (
    !Number.isInteger(width)
    || !Number.isInteger(height)
    || width < EDIT_CHART_LIMITS.width.min
    || width > EDIT_CHART_LIMITS.width.max
    || height < EDIT_CHART_LIMITS.height.min
    || height > EDIT_CHART_LIMITS.height.max
  ) return fail("edit-chart-svg-dimensions-invalid");
  if (
    !source.startsWith("<svg ")
    || !source.endsWith("</svg>")
    || (source.match(/<svg\b/giu) || []).length !== 1
    || (source.match(/<\/svg\s*>/giu) || []).length !== 1
  ) return fail("edit-chart-svg-root-invalid");
  const root = source.match(/^<svg\b[^>]*>/iu)?.[0] || "";
  if (
    !new RegExp(`\\bwidth=["']${width}["']`, "u").test(root)
    || !new RegExp(`\\bheight=["']${height}["']`, "u").test(root)
    || !new RegExp(`\\bviewBox=["']0 0 ${width} ${height}["']`, "u").test(root)
    || !/\bxmlns=["']http:\/\/www\.w3\.org\/2000\/svg["']/u.test(root)
  ) return fail("edit-chart-svg-viewbox-invalid");
  if (
    /<!DOCTYPE|<!ENTITY|<\?xml|<!--/iu.test(source)
    || /\son[a-z][a-z0-9:_-]*\s*=/iu.test(source)
    || /\s(?:href|xlink:href)\s*=\s*(["'])(?!#)[^"']*\1/iu.test(source)
    || /\s(?:href|xlink:href)\s*=\s*(?!["'])[^\s>]+/iu.test(source)
    || /@import|expression\s*\(|(?:javascript|data|blob|file):/iu.test(source)
    || !cssReferencesAreLocal(source)
  ) return fail("edit-chart-svg-capability-forbidden");
  for (const match of source.matchAll(/<(?!\/|!)([A-Za-z][A-Za-z0-9:-]*)\b/gu)) {
    if (!ALLOWED_SVG_ELEMENTS.has(match[1].toLowerCase())) {
      return fail("edit-chart-svg-element-forbidden");
    }
  }
  return Object.freeze({
    ok: true,
    bytes,
    viewBox: `0 0 ${width} ${height}`,
  });
}

export function renderEditChartSvg(candidate) {
  if (!isRenderRequest(candidate)) return fail("edit-chart-render-request-invalid");
  const slotValidation = validateEditChartSlot(candidate.slot);
  if (!slotValidation.ok) return fail(slotValidation.code);
  const specValidation = validateEditChartSpec(candidate.spec);
  if (!specValidation.ok) return fail(specValidation.code);
  const { slot } = slotValidation;
  let chart;
  try {
    chart = echarts.init(null, null, {
      renderer: "svg",
      ssr: true,
      width: slot.width,
      height: slot.height,
    });
    chart.setOption(toEditChartEChartsOption(specValidation.spec), {
      notMerge: true,
      lazyUpdate: false,
      silent: true,
    });
    const svg = chart.renderToSVGString();
    const svgValidation = validateEditChartSvg(svg, slot);
    if (!svgValidation.ok) return svgValidation;
    return Object.freeze({
      ok: true,
      svg,
      bytes: svgValidation.bytes,
      viewBox: svgValidation.viewBox,
      rendererVersion: EDIT_CHART_RENDERER_VERSION,
      slot,
    });
  } catch {
    return fail("edit-chart-render-failed");
  } finally {
    chart?.dispose();
  }
}
