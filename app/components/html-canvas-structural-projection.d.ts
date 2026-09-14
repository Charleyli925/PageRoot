import type { SemanticIdentityDelta } from "../lib/semantic-operation-kernel.js";
import type { RuntimeSourceAuthority } from "./html-canvas-source-authority.js";
import type { SourceIndexValue } from "./html-canvas-internal-types";

export type StructuralProjectionAction = "insert" | "delete" | "move";

export type VerifiedStructuralProjectionPlan = Readonly<{
  operationId: string;
  beforeSourceSha256: string;
  afterSourceSha256: string;
  frameGeneration: number;
  executionId: string | null;
  action: StructuralProjectionAction;
  identityDelta: SemanticIdentityDelta;
  addedRootElementId: string | null;
  removedRootElementId: string | null;
  movedElementId: string | null;
  parentElementId: string | null;
  beforeElementId: string | null;
  sourceParentElementId: string | null;
  selectionLandingElementId: string | null;
  fragmentHtml: string | null;
  capabilityReason: string;
}>;

export type StructuralProjectionDecision =
  | { kind: "in-place"; plan: VerifiedStructuralProjectionPlan; reason: string }
  | { kind: "candidate"; reason: string }
  | { kind: "reject"; reason: string };

export type StructuralProjectionContext = Readonly<{
  operationId: string;
  operationType: string | null | undefined;
  mutationProperty: string | null | undefined;
  beforeSourceSha256: string;
  afterSourceSha256: string;
  beforeIndex: SourceIndexValue;
  afterIndex: SourceIndexValue;
  identityDelta: SemanticIdentityDelta | null | undefined;
  frameGeneration: number;
  executionId: string | null;
  programIdentityChanged?: boolean;
  enabled?: boolean;
}>;

export type LiveStructuralSurface = {
  documentNode: Document;
  frameGeneration: number;
  executionId: string | null;
  authority: RuntimeSourceAuthority | null;
  markerAttribute: string;
  isProvenSourceElement?: ((element: HTMLElement) => boolean) | null;
};

export function applyStructuralProjectionObservation(
  element: Element | null | undefined,
  observation: {
    kind?: string;
    reason?: string;
    planned?: string;
    outcome?: string;
  } | null | undefined,
): void;

export function isVerifiedStructuralProjectionPlan(
  plan: unknown,
): plan is VerifiedStructuralProjectionPlan;

export function isStructuralInPlaceEnabled(
  globalObject?: { __PAGEROOT_DISABLE_STRUCTURAL_IN_PLACE__?: unknown },
): boolean;

export function isUnsupportedInPlaceTag(tagName: string | null | undefined): boolean;

export function isUnsupportedInPlaceParentTag(tagName: string | null | undefined): boolean;

export function resolveDeleteSelectionLanding(
  beforeIndex: SourceIndexValue,
  removedRootElementId: string,
): string | null;

export function decideStructuralProjection(
  context: StructuralProjectionContext,
): StructuralProjectionDecision;

export function executeVerifiedStructuralProjection(options: {
  plan: VerifiedStructuralProjectionPlan;
  nextHtml: string;
  afterIndex: SourceIndexValue;
  live: LiveStructuralSurface;
}): { ok: true; selectedElementId: string | null } | { ok: false; reason: string };
