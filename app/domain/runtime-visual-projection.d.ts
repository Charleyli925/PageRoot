import type { PageViewContext } from "../lib/page-view-context.js";

export type RuntimeVisualCapturePayload = Readonly<{
  html: string;
  sourcePath: string;
  sourceSha256: string;
  sourceNodeAttribute: string;
  candidates: ReadonlyArray<Readonly<{
    sourceNodeId: string;
    tagName: string;
  }>>;
  presentationEntries: ReadonlyArray<Readonly<{
    sourceNodeId: string;
    classAdd: readonly string[];
    classRemove: readonly string[];
    hidden?: boolean;
    open?: boolean;
    ariaSelected?: "true" | "false" | null;
    ariaExpanded?: "true" | "false" | null;
  }>>;
  viewport: Readonly<{ width: number; height: number }>;
}>;

export type RawRuntimeVisualProjection = Readonly<{
  protocol: "pageroot-runtime-visual-projection";
  version: 1;
  sourceSha256: string;
  visuals: ReadonlyArray<Readonly<{
    sourceNodeId: string;
    width: number;
    height: number;
    layoutWidth: number;
    layoutHeight: number;
    dataUrl: string;
  }>>;
}>;

export type RuntimeVisualProjection = Readonly<{
  protocol: "pageroot-runtime-visual-projection";
  version: 1;
  documentKey: string;
  generation: number;
  sourceSha256: string;
  visuals: ReadonlyArray<Readonly<{
    sourceNodeId: string;
    tagName: string;
    width: number;
    height: number;
    layoutWidth: number;
    layoutHeight: number;
    dataUrl: string;
  }>>;
}>;

export const RUNTIME_VISUAL_PROJECTION_PROTOCOL:
  "pageroot-runtime-visual-projection";
export const RUNTIME_VISUAL_PROJECTION_VERSION: 1;

export function prepareRuntimeVisualCapture(options?: {
  html?: string;
  sourcePath?: string;
  viewportWidth?: number;
  pageViewContext?: PageViewContext | null;
}): Readonly<{
  sourceSha256: string;
  candidates: ReadonlyArray<Readonly<{
    sourceNodeId: string;
    tagName: string;
  }>>;
  payload: RuntimeVisualCapturePayload | null;
}> | null;

export function acceptRuntimeVisualProjection(options?: {
  html?: string;
  documentKey?: string;
  generation?: number;
  rawProjection?: RawRuntimeVisualProjection | null;
}): RuntimeVisualProjection | null;
