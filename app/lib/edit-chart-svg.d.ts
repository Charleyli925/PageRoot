import type {
  EditChartFailure,
  EditChartSlot,
  EditChartSlotCandidate,
  EditChartSpec,
} from "../domain/edit-chart-spec.js";

export const EDIT_CHART_RENDERER_VERSION: string;

export function isEditChartSvgElementNameAllowed(value: unknown): boolean;

export function isEditChartSvgAttributeAllowed(
  name: unknown,
  value: unknown,
): boolean;

export function validateEditChartSvg(
  source: unknown,
  dimensions: Readonly<{ width: number; height: number }>,
): Readonly<{ ok: true; bytes: number; viewBox: string }> | EditChartFailure;

export function renderEditChartSvg(candidate: Readonly<{
  slot: EditChartSlotCandidate;
  spec: EditChartSpec;
}>): Readonly<{
  ok: true;
  svg: string;
  bytes: number;
  viewBox: string;
  rendererVersion: string;
  slot: EditChartSlot;
}> | EditChartFailure;
