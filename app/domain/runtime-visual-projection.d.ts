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
  version: 2;
  sourceSha256: string;
  visuals: ReadonlyArray<Readonly<{
    sourceNodeId: string;
    width: number;
    height: number;
    layoutWidth: number;
    layoutHeight: number;
    captureBox: "border" | "content";
    dataUrl: string;
  }>>;
  deferredSourceNodeIds: readonly string[];
}>;

export type RuntimeVisualProjection = Readonly<{
  protocol: "pageroot-runtime-visual-projection";
  version: 2;
  documentKey: string;
  generation: number;
  sourceSha256: string;
  visuals: ReadonlyArray<Readonly<{
    sourceNodeId: string;
    tagName: string;
    captureKey: string;
    width: number;
    height: number;
    layoutWidth: number;
    layoutHeight: number;
    captureBox: "border" | "content";
    dataUrl: string;
  }>>;
  deferredCaptureKeys: readonly string[];
}>;

export const RUNTIME_VISUAL_PROJECTION_PROTOCOL:
  "pageroot-runtime-visual-projection";
export const RUNTIME_VISUAL_PROJECTION_VERSION: 2;

export type RuntimeVisualCaptureDescriptor = Readonly<{
  sourceSha256: string;
  dependencySha256: string;
  candidates: ReadonlyArray<Readonly<{
    sourceNodeId: string;
    tagName: string;
    captureKey: string;
  }>>;
  presentationEntries: RuntimeVisualCapturePayload["presentationEntries"];
  presentationDependencySha256: string;
  viewportWidth: number;
}>;

export function describeRuntimeVisualCapture(options?: {
  html?: string;
  sourcePath?: string;
  viewportWidth?: number;
  pageViewContext?: PageViewContext | null;
  sourceIndex?: unknown;
}): RuntimeVisualCaptureDescriptor | null;

export function prepareRuntimeVisualCapture(options?: {
  html?: string;
  sourcePath?: string;
  viewportWidth?: number;
  pageViewContext?: PageViewContext | null;
  sourceIndex?: unknown;
}): Readonly<{
  sourceSha256: string;
  dependencySha256: string;
  candidates: ReadonlyArray<Readonly<{
    sourceNodeId: string;
    tagName: string;
    captureKey: string;
  }>>;
  payload: RuntimeVisualCapturePayload | null;
}> | null;

export function acceptRuntimeVisualProjection(options?: {
  html?: string;
  documentKey?: string;
  generation?: number;
  rawProjection?: RawRuntimeVisualProjection | null;
  sourceIndex?: unknown;
}): RuntimeVisualProjection | null;

export function rebindRuntimeVisualProjection(options?: {
  html?: string;
  documentKey?: string;
  generation?: number;
  projection?: RuntimeVisualProjection | null;
  sourceIndex?: unknown;
}): RuntimeVisualProjection | null;

export function mergeDeferredRuntimeVisualProjection(options?: {
  html?: string;
  documentKey?: string;
  generation?: number;
  projection?: RuntimeVisualProjection | null;
  fallbackProjection?: RuntimeVisualProjection | null;
  sourceIndex?: unknown;
}): RuntimeVisualProjection | null;
