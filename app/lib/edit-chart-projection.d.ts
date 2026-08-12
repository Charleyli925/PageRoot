import type { buildSourceIndex } from "./source-patch-core.js";
import type { EditChartSlot } from "../domain/edit-chart-spec.js";

export type PreparedEditChartVisual = Readonly<{
  hostId: string;
  hostNodeId: string;
  specId: string;
  specNodeId: string;
  specSource: string;
  slot: EditChartSlot;
  svg: string;
  svgBytes: number;
}>;

export type EditChartProjection = Readonly<{
  ok: true;
  sourceSha256: string;
  declaredCount: number;
  visuals: ReadonlyArray<PreparedEditChartVisual>;
  budget: Readonly<{
    chartCount: number;
    totalSpecBytes: number;
    totalPoints: number;
    totalSvgBytes: number | null;
  }> | null;
}>;

export function prepareEditChartProjection(
  sourceIndex: ReturnType<typeof buildSourceIndex>,
): EditChartProjection | Readonly<{ ok: false; code: string }>;

export function mountEditChartProjection(
  documentNode: Document,
  projection: EditChartProjection,
): Readonly<{ mounted: number; skipped: number }>;
