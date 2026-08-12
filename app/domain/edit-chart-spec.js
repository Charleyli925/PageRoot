// This module is deliberately DOM-free. It owns the authored JSON grammar,
// fixed slot facts and closed option mapping, but no iframe or chart lifetime.
export const EDIT_CHART_SOURCE_CONTRACT = Object.freeze({
  chartKind: "cartesian-v0.1",
  specVersion: "0.1",
  hostTagName: "div",
  attributes: Object.freeze({
    chartKind: "data-report-chart-slot",
    specId: "data-report-chart-spec-id",
    width: "data-report-chart-width",
    height: "data-report-chart-height",
    specVersion: "data-report-chart-spec",
  }),
});

export const EDIT_CHART_LIMITS = Object.freeze({
  sourceBytes: 128 * 1024,
  svgBytes: 512 * 1024,
  chartsPerDocument: 24,
  totalSpecBytes: 1024 * 1024,
  totalPointsPerDocument: 12_000,
  totalSvgBytes: 4 * 1024 * 1024,
  width: Object.freeze({ min: 320, max: 1_600 }),
  height: Object.freeze({ min: 180, max: 1_200 }),
  categories: 120,
  series: 12,
  totalPoints: 2_048,
  textCodePoints: 120,
  categoryCodePoints: 80,
  numericMagnitude: 1_000_000_000_000,
});

const ROOT_KEYS = new Set([
  "version",
  "mode",
  "title",
  "legend",
  "orientation",
  "xAxisName",
  "yAxisName",
  "categories",
  "series",
]);
const CATEGORY_SERIES_KEYS = new Set([
  "id",
  "name",
  "type",
  "values",
  "color",
  "stack",
  "area",
  "smooth",
  "symbol",
]);
const SCATTER_SERIES_KEYS = new Set([
  "id",
  "name",
  "type",
  "points",
  "color",
  "symbolSize",
]);
const SLOT_KEYS = new Set([
  "tagName",
  "hostId",
  "chartKind",
  "specId",
  "width",
  "height",
  "role",
  "ariaLabel",
  "isSourceEmpty",
  "hasShadowRoot",
  "aspectRatio",
]);
const DOCUMENT_ITEM_KEYS = new Set(["sourceBytes", "spec", "svgBytes"]);
const IDENTIFIER_PATTERN = /^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/u;
const SERIES_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u;
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/u;
const EXTERNAL_SCHEME_PATTERN = /(?:https?|data|blob|javascript|file):|(?:^|\s)\/\//iu;
const CONTROL_OR_MARKUP_PATTERN = /[\u0000-\u001f\u007f<>]/u;
const PALETTE = Object.freeze([
  "#5070DD",
  "#B6D634",
  "#505372",
  "#FF994D",
  "#0CA8DF",
  "#E56A6F",
  "#8D70D6",
  "#68B88E",
  "#D8B365",
  "#6B8ECA",
  "#C96C9B",
  "#7A8B55",
]);

function pass(property, value) {
  return Object.freeze({ ok: true, [property]: value });
}

function fail(code) {
  return Object.freeze({ ok: false, code });
}

function isExactRecord(value, allowedKeys) {
  if (
    value === null
    || typeof value !== "object"
    || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
    || Object.getOwnPropertySymbols(value).length > 0
  ) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return Object.entries(descriptors).every(([key, descriptor]) => (
    allowedKeys.has(key)
    && descriptor.enumerable === true
    && Object.hasOwn(descriptor, "value")
  ));
}

function isDataArray(value, { min = 0, max = Number.MAX_SAFE_INTEGER, exact } = {}) {
  if (
    !Array.isArray(value)
    || Object.getPrototypeOf(value) !== Array.prototype
    || Object.getOwnPropertySymbols(value).length > 0
    || value.length < min
    || value.length > max
    || (exact !== undefined && value.length !== exact)
  ) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.keys(descriptors).length !== value.length + 1) return false;
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (
      !descriptor
      || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, "value")
    ) return false;
  }
  return true;
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function boundedText(value, maxCodePoints = EDIT_CHART_LIMITS.textCodePoints) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (
    normalized.length === 0
    || normalized.length > maxCodePoints * 2
    || [...normalized].length > maxCodePoints
    || CONTROL_OR_MARKUP_PATTERN.test(normalized)
    || EXTERNAL_SCHEME_PATTERN.test(normalized)
  ) return null;
  return normalized;
}

function identifier(value, pattern = SERIES_ID_PATTERN) {
  return typeof value === "string" && pattern.test(value) ? value : null;
}

function finiteNumber(value) {
  return typeof value === "number"
    && Number.isFinite(value)
    && Math.abs(value) <= EDIT_CHART_LIMITS.numericMagnitude
      ? (Object.is(value, -0) ? 0 : value)
      : null;
}

function normalizedColor(value) {
  return typeof value === "string" && HEX_COLOR_PATTERN.test(value)
    ? value.toUpperCase()
    : null;
}

function normalizeOptionalText(record, key, maxCodePoints) {
  if (!hasOwn(record, key)) return { ok: true, value: undefined };
  const value = boundedText(record[key], maxCodePoints);
  return value === null ? { ok: false } : { ok: true, value };
}

function normalizeCategorySeries(series, categoryCount) {
  if (!isExactRecord(series, CATEGORY_SERIES_KEYS)) return null;
  const id = identifier(series.id);
  const name = boundedText(series.name, EDIT_CHART_LIMITS.categoryCodePoints);
  if (!id || !name || !["bar", "line"].includes(series.type)) return null;
  if (!isDataArray(series.values, { exact: categoryCount })) return null;
  const values = [];
  for (const value of series.values) {
    if (value === null) {
      values.push(null);
      continue;
    }
    const normalized = finiteNumber(value);
    if (normalized === null) return null;
    values.push(normalized);
  }
  const normalized = { id, name, type: series.type, values: Object.freeze(values) };
  if (hasOwn(series, "color")) {
    const color = normalizedColor(series.color);
    if (!color) return null;
    normalized.color = color;
  }
  if (hasOwn(series, "stack")) {
    const stack = identifier(series.stack);
    if (!stack) return null;
    normalized.stack = stack;
  }
  for (const key of ["area", "smooth"]) {
    if (hasOwn(series, key)) {
      if (series.type !== "line" || typeof series[key] !== "boolean") return null;
      normalized[key] = series[key];
    }
  }
  if (hasOwn(series, "symbol")) {
    if (series.type !== "line" || !["none", "circle"].includes(series.symbol)) return null;
    normalized.symbol = series.symbol;
  }
  return Object.freeze(normalized);
}

function normalizeScatterSeries(series) {
  if (!isExactRecord(series, SCATTER_SERIES_KEYS)) return null;
  const id = identifier(series.id);
  const name = boundedText(series.name, EDIT_CHART_LIMITS.categoryCodePoints);
  if (!id || !name || series.type !== "scatter") return null;
  if (!isDataArray(series.points, { min: 1, max: EDIT_CHART_LIMITS.totalPoints })) {
    return null;
  }
  const points = [];
  for (const point of series.points) {
    if (!isDataArray(point, { exact: 2 })) return null;
    const x = finiteNumber(point[0]);
    const y = finiteNumber(point[1]);
    if (x === null || y === null) return null;
    points.push(Object.freeze([x, y]));
  }
  const normalized = { id, name, type: "scatter", points: Object.freeze(points) };
  if (hasOwn(series, "color")) {
    const color = normalizedColor(series.color);
    if (!color) return null;
    normalized.color = color;
  }
  if (hasOwn(series, "symbolSize")) {
    if (!Number.isInteger(series.symbolSize) || series.symbolSize < 2 || series.symbolSize > 40) {
      return null;
    }
    normalized.symbolSize = series.symbolSize;
  }
  return Object.freeze(normalized);
}

export function parseEditChartSpec(source) {
  if (typeof source !== "string") return fail("edit-chart-spec-source-invalid");
  const sourceBytes = new TextEncoder().encode(source).byteLength;
  if (sourceBytes > EDIT_CHART_LIMITS.sourceBytes) {
    return fail("edit-chart-spec-source-too-large");
  }
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch {
    return fail("edit-chart-spec-json-invalid");
  }
  const validation = validateEditChartSpec(parsed);
  return validation.ok
    ? Object.freeze({ ...validation, sourceBytes })
    : validation;
}

export function validateEditChartSpec(candidate) {
  if (!isExactRecord(candidate, ROOT_KEYS)) return fail("edit-chart-spec-shape-invalid");
  if (candidate.version !== EDIT_CHART_SOURCE_CONTRACT.specVersion) {
    return fail("edit-chart-spec-version-unsupported");
  }
  if (!hasOwn(candidate, "series") || !["category", "numeric"].includes(candidate.mode)) {
    return fail("edit-chart-spec-mode-invalid");
  }
  if (!isDataArray(candidate.series, { min: 1, max: EDIT_CHART_LIMITS.series })) {
    return fail("edit-chart-spec-series-invalid");
  }

  const title = normalizeOptionalText(candidate, "title");
  const xAxisName = normalizeOptionalText(candidate, "xAxisName");
  const yAxisName = normalizeOptionalText(candidate, "yAxisName");
  if (!title.ok || !xAxisName.ok || !yAxisName.ok) {
    return fail("edit-chart-spec-text-invalid");
  }
  if (hasOwn(candidate, "legend") && typeof candidate.legend !== "boolean") {
    return fail("edit-chart-spec-legend-invalid");
  }

  let categories;
  let orientation;
  const series = [];
  if (candidate.mode === "category") {
    if (!isDataArray(candidate.categories, {
      min: 1,
      max: EDIT_CHART_LIMITS.categories,
    })) return fail("edit-chart-spec-categories-invalid");
    categories = [];
    for (const category of candidate.categories) {
      const value = boundedText(category, EDIT_CHART_LIMITS.categoryCodePoints);
      if (value === null) return fail("edit-chart-spec-category-invalid");
      categories.push(value);
    }
    orientation = hasOwn(candidate, "orientation") ? candidate.orientation : "vertical";
    if (!["vertical", "horizontal"].includes(orientation)) {
      return fail("edit-chart-spec-orientation-invalid");
    }
    for (const item of candidate.series) {
      const normalized = normalizeCategorySeries(item, categories.length);
      if (!normalized) return fail("edit-chart-spec-series-invalid");
      series.push(normalized);
    }
  } else {
    if (hasOwn(candidate, "categories") || hasOwn(candidate, "orientation")) {
      return fail("edit-chart-spec-mode-fields-invalid");
    }
    for (const item of candidate.series) {
      const normalized = normalizeScatterSeries(item);
      if (!normalized) return fail("edit-chart-spec-series-invalid");
      series.push(normalized);
    }
  }

  if (new Set(series.map((item) => item.id)).size !== series.length) {
    return fail("edit-chart-spec-series-id-duplicate");
  }
  const totalPoints = pointCount({ series });
  if (totalPoints > EDIT_CHART_LIMITS.totalPoints) {
    return fail("edit-chart-spec-points-too-many");
  }

  const spec = {
    version: EDIT_CHART_SOURCE_CONTRACT.specVersion,
    mode: candidate.mode,
    legend: hasOwn(candidate, "legend") ? candidate.legend : series.length > 1,
    series: Object.freeze(series),
  };
  if (title.value !== undefined) spec.title = title.value;
  if (xAxisName.value !== undefined) spec.xAxisName = xAxisName.value;
  if (yAxisName.value !== undefined) spec.yAxisName = yAxisName.value;
  if (categories) spec.categories = Object.freeze(categories);
  if (orientation) spec.orientation = orientation;
  return pass("spec", Object.freeze(spec));
}

function parseDimension(value, { min, max }) {
  const numeric = typeof value === "string" && /^[1-9][0-9]{2,3}$/u.test(value)
    ? Number(value)
    : value;
  return Number.isInteger(numeric) && numeric >= min && numeric <= max ? numeric : null;
}

function parseAspectRatio(value) {
  if (typeof value !== "string" || value.length > 32) return null;
  const match = value.match(/^\s*([0-9]+(?:\.[0-9]+)?)\s*\/\s*([0-9]+(?:\.[0-9]+)?)\s*$/u);
  if (!match) return null;
  const numerator = Number(match[1]);
  const denominator = Number(match[2]);
  return Number.isFinite(numerator) && Number.isFinite(denominator)
    && numerator > 0 && denominator > 0
      ? numerator / denominator
      : null;
}

export function validateEditChartSlot(candidate) {
  if (!isExactRecord(candidate, SLOT_KEYS)) return fail("edit-chart-slot-shape-invalid");
  if (
    candidate.tagName !== EDIT_CHART_SOURCE_CONTRACT.hostTagName
    || candidate.chartKind !== EDIT_CHART_SOURCE_CONTRACT.chartKind
  ) return fail("edit-chart-slot-kind-invalid");
  const hostId = identifier(candidate.hostId, IDENTIFIER_PATTERN);
  const specId = identifier(candidate.specId, IDENTIFIER_PATTERN);
  if (!hostId || !specId || hostId === specId) return fail("edit-chart-slot-id-invalid");
  const width = parseDimension(candidate.width, EDIT_CHART_LIMITS.width);
  const height = parseDimension(candidate.height, EDIT_CHART_LIMITS.height);
  if (width === null || height === null) return fail("edit-chart-slot-size-invalid");
  if (candidate.role !== "img") return fail("edit-chart-slot-role-invalid");
  const ariaLabel = boundedText(candidate.ariaLabel);
  if (!ariaLabel) return fail("edit-chart-slot-label-invalid");
  if (candidate.isSourceEmpty !== true) return fail("edit-chart-slot-not-empty");
  if (candidate.hasShadowRoot !== false) return fail("edit-chart-slot-shadow-conflict");
  const aspectRatio = parseAspectRatio(candidate.aspectRatio);
  const fixedRatio = width / height;
  if (
    aspectRatio === null
    || Math.abs(aspectRatio - fixedRatio) / fixedRatio > 0.001
  ) return fail("edit-chart-slot-aspect-ratio-invalid");
  return pass("slot", Object.freeze({
    tagName: EDIT_CHART_SOURCE_CONTRACT.hostTagName,
    hostId,
    chartKind: EDIT_CHART_SOURCE_CONTRACT.chartKind,
    specId,
    width,
    height,
    role: "img",
    ariaLabel,
    aspectRatio: fixedRatio,
    viewBox: `0 0 ${width} ${height}`,
  }));
}

function pointCount(spec) {
  return spec.series.reduce((total, item) => (
    total + (item.values?.length ?? item.points?.length ?? 0)
  ), 0);
}

export function validateEditChartDocumentBudget(candidate) {
  if (!isDataArray(candidate, { min: 1, max: EDIT_CHART_LIMITS.chartsPerDocument })) {
    return fail("edit-chart-document-count-invalid");
  }
  let totalSpecBytes = 0;
  let totalPoints = 0;
  let totalSvgBytes = 0;
  // The same owner is used before SSR (no svgBytes on any item) and after SSR
  // (svgBytes on every item); mixed phases are rejected instead of guessed.
  let renderedItems = 0;
  for (const item of candidate) {
    if (!isExactRecord(item, DOCUMENT_ITEM_KEYS)) {
      return fail("edit-chart-document-item-invalid");
    }
    if (
      !Number.isInteger(item.sourceBytes)
      || item.sourceBytes < 2
      || item.sourceBytes > EDIT_CHART_LIMITS.sourceBytes
    ) return fail("edit-chart-document-source-bytes-invalid");
    const specValidation = validateEditChartSpec(item.spec);
    if (!specValidation.ok) return specValidation;
    totalSpecBytes += item.sourceBytes;
    totalPoints += pointCount(specValidation.spec);
    if (totalSpecBytes > EDIT_CHART_LIMITS.totalSpecBytes) {
      return fail("edit-chart-document-spec-bytes-too-large");
    }
    if (totalPoints > EDIT_CHART_LIMITS.totalPointsPerDocument) {
      return fail("edit-chart-document-points-too-many");
    }
    if (hasOwn(item, "svgBytes")) {
      if (
        !Number.isInteger(item.svgBytes)
        || item.svgBytes <= 0
        || item.svgBytes > EDIT_CHART_LIMITS.svgBytes
      ) return fail("edit-chart-document-svg-bytes-invalid");
      totalSvgBytes += item.svgBytes;
      renderedItems += 1;
      if (totalSvgBytes > EDIT_CHART_LIMITS.totalSvgBytes) {
        return fail("edit-chart-document-svg-bytes-too-large");
      }
    }
  }
  if (renderedItems !== 0 && renderedItems !== candidate.length) {
    return fail("edit-chart-document-render-state-mixed");
  }
  return Object.freeze({
    ok: true,
    budget: Object.freeze({
      chartCount: candidate.length,
      totalSpecBytes,
      totalPoints,
      totalSvgBytes: renderedItems === candidate.length ? totalSvgBytes : null,
    }),
  });
}

function commonAxis(name) {
  const axis = {
    nameLocation: "middle",
    nameGap: 30,
    axisLine: { lineStyle: { color: "#B8BBC6" } },
    axisTick: { show: false },
    axisLabel: { color: "#626579", hideOverlap: true },
    splitLine: { lineStyle: { color: "#E7E8EE" } },
    nameTextStyle: { color: "#626579" },
  };
  if (name) axis.name = name;
  return axis;
}

function categorySeriesOption(series) {
  const option = {
    id: series.id,
    name: series.name,
    type: series.type,
    data: [...series.values],
    silent: true,
    emphasis: { disabled: true },
  };
  if (series.stack) option.stack = series.stack;
  if (series.color) {
    option.itemStyle = { color: series.color };
    if (series.type === "line") option.lineStyle = { color: series.color };
  }
  if (series.type === "line") {
    option.smooth = series.smooth === true;
    option.showSymbol = series.symbol === "circle";
    option.symbol = series.symbol ?? "none";
    if (series.area === true) option.areaStyle = { opacity: 0.16 };
  }
  return option;
}

function optionForValidatedSpec(spec) {
  // No authored option object reaches ECharts. Every capability below is
  // constructed by PageRoot from the normalized, closed spec.
  const top = spec.title ? (spec.legend ? 76 : 54) : (spec.legend ? 46 : 18);
  const option = {
    animation: false,
    backgroundColor: "transparent",
    color: [...PALETTE],
    textStyle: { fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif" },
    legend: {
      show: spec.legend,
      top: spec.title ? 42 : 8,
      selectedMode: false,
      textStyle: { color: "#4F5266" },
    },
    grid: {
      left: 18,
      right: 18,
      top,
      bottom: 18,
      outerBoundsMode: "same",
      outerBoundsContain: "all",
    },
  };
  if (spec.title) {
    option.title = {
      text: spec.title,
      left: "center",
      top: 8,
      textStyle: { color: "#272A3A", fontSize: 16, fontWeight: 600 },
    };
  }
  if (spec.mode === "numeric") {
    option.xAxis = { type: "value", ...commonAxis(spec.xAxisName) };
    option.yAxis = { type: "value", ...commonAxis(spec.yAxisName) };
    option.series = spec.series.map((series) => {
      const item = {
        id: series.id,
        name: series.name,
        type: "scatter",
        data: series.points.map((point) => [...point]),
        silent: true,
        symbolSize: series.symbolSize ?? 10,
        emphasis: { disabled: true },
      };
      if (series.color) item.itemStyle = { color: series.color };
      return item;
    });
    return option;
  }
  const categoryAxis = {
    type: "category",
    data: [...spec.categories],
    boundaryGap: spec.series.some((series) => series.type === "bar"),
    ...commonAxis(spec.orientation === "vertical" ? spec.xAxisName : spec.yAxisName),
  };
  const valueAxis = {
    type: "value",
    ...commonAxis(spec.orientation === "vertical" ? spec.yAxisName : spec.xAxisName),
  };
  if (spec.orientation === "horizontal") {
    option.xAxis = valueAxis;
    option.yAxis = categoryAxis;
  } else {
    option.xAxis = categoryAxis;
    option.yAxis = valueAxis;
  }
  option.series = spec.series.map(categorySeriesOption);
  return option;
}

export function toEditChartEChartsOption(candidate) {
  const validation = validateEditChartSpec(candidate);
  if (!validation.ok) throw new TypeError(`Invalid Edit Chart Spec: ${validation.code}`);
  return optionForValidatedSpec(validation.spec);
}
