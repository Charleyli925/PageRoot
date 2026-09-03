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

export const RUNTIME_HANDOFF_TOLERANCE_PX: 2;

export type RuntimeViewportSnapshot = {
  iframeScrollX: number;
  iframeScrollY: number;
  sharedScrollLeft: number;
  sharedScrollTop: number;
  /** The authored stable element used as the visual handoff anchor. */
  viewportAnchorStableId: string | null;
  /** Anchor top relative to the iframe viewport, never a source authority. */
  viewportAnchorOffsetY: number | null;
  viewportAnchorSharedOffsetY: number | null;
  selectedStableId: string | null;
  nativeSelection: {
    anchor: number;
    focus: number;
    affinity: "left" | "right";
  } | null;
  caretOffsetY: number | null;
};

export type RuntimeHandoffLayoutFingerprint = {
  iframeWidth: number;
  iframeHeight: number;
  documentClientWidth: number;
  documentClientHeight: number;
  documentScrollWidth: number;
  documentScrollHeight: number;
  sharedClientWidth: number | null;
  sharedClientHeight: number | null;
  sharedScrollWidth: number | null;
  sharedScrollHeight: number | null;
  iframeScrollX: number;
  iframeScrollY: number;
  sharedScrollLeft: number | null;
  sharedScrollTop: number | null;
  viewportAnchorStableId: string | null;
  viewportAnchorOffsetY: number | null;
  viewportAnchorSharedOffsetY: number | null;
  selectedStableId: string | null;
  nativeSelection: RuntimeViewportSnapshot["nativeSelection"];
  caretOffsetY: number | null;
};

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
