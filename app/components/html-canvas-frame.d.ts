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
