import type { EditRuntimeGrant } from "../domain/edit-runtime-contract.js";
import type { RuntimeFrameIdentity } from "./runtime-frame-coordinator.js";

export type RuntimeFrameContext = {
  attempt: RuntimeFrameIdentity;
  verificationToken: string;
  grant: EditRuntimeGrant;
  elementGeneration: number;
  activation: "pending" | "ready" | "failed";
  settled: boolean;
};

export function sameRuntimeGrant(
  left: EditRuntimeGrant | null | undefined,
  right: EditRuntimeGrant | null | undefined,
): boolean;

export function frameDocumentMatchesExpected(
  iframe: HTMLIFrameElement,
  expectedFrameHtml: string,
  writtenHtml: string | null,
): boolean;

export const RUNTIME_HANDOFF_TOLERANCE_PX: 8;

export function clampRuntimeScroll(value: number, maximum: number): number;

export function runtimeAnchorScrollTop(input: {
  currentScrollTop: number;
  currentAnchorOffsetY: number;
  desiredAnchorOffsetY: number;
  maximumScrollTop: number;
}): number;

export function runtimePositionWithinTolerance(
  actual: number,
  expected: number,
  tolerance?: number,
): boolean;

export const READING_POSITION_READY_FRAMES: 30;

export function runtimeRectIntersectsClip(
  screenRect: { top: number; bottom: number } | null | undefined,
  clipRect: { top: number; bottom: number } | null | undefined,
  inset?: number,
): boolean;

export function runtimeElementScreenRect(
  iframe: HTMLIFrameElement | null | undefined,
  element: Element | null | undefined,
): { top: number; bottom: number } | null;

export function runtimeElementIsInReadingViewport(
  iframe: HTMLIFrameElement | null | undefined,
  element: Element | null | undefined,
  clipRect: DOMRect | { top: number; bottom: number } | null | undefined,
): boolean;

export function frameScrollLimits(
  iframe: HTMLIFrameElement | null | undefined,
  documentNode: Document | null | undefined,
): { maxTop: number; maxLeft: number };

export function outerScrollLimits(
  outer: HTMLElement | null | undefined,
): { maxTop: number; maxLeft: number };

export function frameScrollMetricsReady(
  iframe: HTMLIFrameElement | null | undefined,
  documentNode: Document | null | undefined,
): boolean;

export function outerScrollMetricsReady(
  outer: HTMLElement | null | undefined,
  desiredOuterTop: number | null | undefined,
): boolean;

export function scheduleWhenReady(input: {
  isCurrent: () => boolean;
  isReady: () => boolean;
  remainingFrames?: number;
  onReady: () => void;
}): void;

export type RuntimeReadingAnchor = {
  iframeScrollLeft: number;
  iframeScrollTop: number;
  viewportAnchorScreenOffsetY: number | null;
  outerScrollLeft: number | null;
  outerScrollTop: number | null;
};

export function applyReadingPosition(input: {
  iframe: HTMLIFrameElement;
  documentNode: Document;
  outer?: HTMLElement | null;
  anchor: RuntimeReadingAnchor;
  anchorElement?: Element | null;
  adjustOuter?: boolean;
}): boolean;

export function correctReadingPositionOnce(input: {
  iframe: HTMLIFrameElement;
  documentNode: Document;
  outer?: HTMLElement | null;
  anchor: RuntimeReadingAnchor;
  anchorElement?: Element | null;
  adjustOuter?: boolean;
}): void;
