export type EditChartFailure = Readonly<{ ok: false; code: string }>;

export type EditChartCategorySeries = Readonly<{
  id: string;
  name: string;
  type: "bar" | "line";
  values: ReadonlyArray<number | null>;
  color?: string;
  stack?: string;
  area?: boolean;
  smooth?: boolean;
  symbol?: "none" | "circle";
}>;

export type EditChartScatterSeries = Readonly<{
  id: string;
  name: string;
  type: "scatter";
  points: ReadonlyArray<Readonly<[number, number]>>;
  color?: string;
  symbolSize?: number;
}>;

type EditChartSpecBase = Readonly<{
  version: "0.1";
  title?: string;
  legend: boolean;
  xAxisName?: string;
  yAxisName?: string;
}>;

export type EditChartCategorySpec = EditChartSpecBase & Readonly<{
  mode: "category";
  orientation: "vertical" | "horizontal";
  categories: ReadonlyArray<string>;
  series: ReadonlyArray<EditChartCategorySeries>;
}>;

export type EditChartNumericSpec = EditChartSpecBase & Readonly<{
  mode: "numeric";
  series: ReadonlyArray<EditChartScatterSeries>;
}>;

export type EditChartSpec = EditChartCategorySpec | EditChartNumericSpec;

export type EditChartSlotCandidate = Readonly<{
  tagName: string;
  hostId: string;
  chartKind: string;
  specId: string;
  width: string | number;
  height: string | number;
  role: string;
  ariaLabel: string;
  isSourceEmpty: boolean;
  hasShadowRoot: boolean;
  aspectRatio: string;
}>;

export type EditChartSlot = Readonly<{
  tagName: "div";
  hostId: string;
  chartKind: "cartesian-v0.1";
  specId: string;
  width: number;
  height: number;
  role: "img";
  ariaLabel: string;
  aspectRatio: number;
  viewBox: string;
}>;

export const EDIT_CHART_SOURCE_CONTRACT: Readonly<{
  chartKind: "cartesian-v0.1";
  specVersion: "0.1";
  hostTagName: "div";
  attributes: Readonly<{
    chartKind: "data-report-chart-slot";
    specId: "data-report-chart-spec-id";
    width: "data-report-chart-width";
    height: "data-report-chart-height";
    specVersion: "data-report-chart-spec";
  }>;
}>;

export const EDIT_CHART_LIMITS: Readonly<{
  sourceBytes: number;
  svgBytes: number;
  chartsPerDocument: number;
  totalSpecBytes: number;
  totalPointsPerDocument: number;
  totalSvgBytes: number;
  width: Readonly<{ min: number; max: number }>;
  height: Readonly<{ min: number; max: number }>;
  categories: number;
  series: number;
  totalPoints: number;
  textCodePoints: number;
  categoryCodePoints: number;
  numericMagnitude: number;
}>;

export function parseEditChartSpec(
  source: unknown,
): Readonly<{ ok: true; spec: EditChartSpec; sourceBytes: number }> | EditChartFailure;

export function validateEditChartSpec(
  candidate: unknown,
): Readonly<{ ok: true; spec: EditChartSpec }> | EditChartFailure;

export function validateEditChartSlot(
  candidate: unknown,
): Readonly<{ ok: true; slot: EditChartSlot }> | EditChartFailure;

export function validateEditChartDocumentBudget(
  candidate: ReadonlyArray<Readonly<{
    sourceBytes: number;
    spec: EditChartSpec;
    svgBytes?: number;
  }>>,
): Readonly<{
  ok: true;
  budget: Readonly<{
    chartCount: number;
    totalSpecBytes: number;
    totalPoints: number;
    totalSvgBytes: number | null;
  }>;
}> | EditChartFailure;

export function toEditChartEChartsOption(candidate: unknown): Record<string, unknown>;
