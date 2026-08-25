import type {
  AgentProviderAvailabilitySnapshot,
  AgentProviderAvailabilityStatus,
  AgentProviderGuidanceKind,
} from "./agent-provider-state.js";

export type QoderAvailability = AgentProviderAvailabilityStatus;

export type QoderAvailabilityReason =
  | "initial"
  | "checking"
  | "not-installed"
  | "auth-required"
  | "invalid-installation"
  | "restart-required"
  | "account-capacity"
  | "timeout"
  | "service-unavailable"
  | null;

export type QoderGuidanceKind = AgentProviderGuidanceKind;

export type QoderAvailabilitySnapshot = AgentProviderAvailabilitySnapshot;

export type QoderAvailabilityPresentation = Readonly<{
  statusLabel: string;
  detail: string;
  tone: "ready" | "checking" | "attention";
}>;

export const QODER_AVAILABILITY_STATUSES: readonly QoderAvailability[];
export const QODER_GUIDANCE_KINDS: readonly QoderGuidanceKind[];
export const INITIAL_QODER_AVAILABILITY: QoderAvailabilitySnapshot;

export function checkingQoderAvailability(
  previous?: QoderAvailabilitySnapshot,
): QoderAvailabilitySnapshot;
export function qoderAvailabilityFromLocalResult(
  result: Readonly<{ status?: string; reason?: string }>,
  previous?: QoderAvailabilitySnapshot,
  checkedAt?: string | null,
): QoderAvailabilitySnapshot;
export function readyQoderAvailability(
  checkedAt?: string | null,
): QoderAvailabilitySnapshot;
export function qoderAvailabilityFromFailureCode(
  code: unknown,
  previous?: QoderAvailabilitySnapshot,
  checkedAt?: string | null,
): QoderAvailabilitySnapshot;
export function qoderAvailabilityWithCopiedGuidance(
  previous: QoderAvailabilitySnapshot,
  kind: QoderGuidanceKind,
  copiedAt?: string | null,
): QoderAvailabilitySnapshot;
export function qoderAvailabilityPresentation(
  availability: QoderAvailabilitySnapshot,
): QoderAvailabilityPresentation;
export function qoderGuidanceInstruction(kind: QoderGuidanceKind): string;
