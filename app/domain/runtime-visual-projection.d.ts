import type { PageViewContext } from "../lib/page-view-context.js";

export type RuntimeVisualHostTargetRef = Readonly<{
  targetId: string;
  label: string;
  level: "subregion";
  selector?: string;
  sourceAnchor: Readonly<{
    startOffset: number;
    endOffset: number;
    sourceSha256: string;
  }>;
  fingerprint: Readonly<{
    tagName?: string;
    stableAttributes?: Readonly<Record<string, string>>;
    ancestorFingerprint?: readonly string[];
    textPrefix?: string;
    textSuffix?: string;
  }>;
  resolution: "exact";
}>;

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
    deviceScaleFactor: number;
    captureBox: "border" | "content";
    crop: Readonly<{ x: number; y: number; width: number; height: number }>;
    sizingMode: "contain";
    runtimeContentSha256: string;
    byteLength: number;
    pngBytes: Uint8Array;
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
    hostTargetRef: RuntimeVisualHostTargetRef;
    width: number;
    height: number;
    layoutWidth: number;
    layoutHeight: number;
    deviceScaleFactor: number;
    captureBox: "border" | "content";
    crop: Readonly<{ x: number; y: number; width: number; height: number }>;
    sizingMode: "contain";
    runtimeContentSha256: string;
    byteLength: number;
    pngBytes: Uint8Array;
  }>>;
  deferredCaptureKeys: readonly string[];
  deferredTargets: ReadonlyArray<Readonly<{
    captureKey: string;
    tagName: string;
    hostTargetRef: RuntimeVisualHostTargetRef;
  }>>;
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
    hostTargetRef: RuntimeVisualHostTargetRef;
  }>>;
  presentationEntries: RuntimeVisualCapturePayload["presentationEntries"];
  presentationDependencySha256: string;
  viewportWidth: number;
  viewportBucket: number;
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
  viewportBucket: number;
  candidates: ReadonlyArray<Readonly<{
    sourceNodeId: string;
    tagName: string;
    captureKey: string;
    hostTargetRef: RuntimeVisualHostTargetRef;
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

/** Re-issues generation metadata only when the supplied HTML has the same exact source Hash. */
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
