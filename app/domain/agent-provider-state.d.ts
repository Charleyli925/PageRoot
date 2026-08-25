export type AgentProviderAvailabilityStatus =
  | "checking"
  | "ready"
  | "not-installed"
  | "auth-required"
  | "unavailable";

export type AgentProviderGuidanceKind = "install" | "login";
export type AgentProviderAvailabilitySnapshot = Readonly<{
  status: AgentProviderAvailabilityStatus;
  reason: string | null;
  lastCheck: "local" | "use" | null;
  checkedAt: string | null;
  guidanceCopied: AgentProviderGuidanceKind | null;
  guidanceCopiedAt: string | null;
}>;

export type AgentReasoningSelection = Readonly<{
  requested: string | null;
  applied: string | null;
  resolution: string;
}>;

export type AgentSelection = Readonly<{
  providerId: string;
  runtimeId: string;
  requestedModelId: string | null;
  resolvedModelId: string | null;
  reasoning: AgentReasoningSelection;
  installationDigest?: string;
}>;

export const AGENT_PROVIDER_AVAILABILITY_STATUSES: readonly AgentProviderAvailabilityStatus[];
export const AGENT_PROVIDER_GUIDANCE_KINDS: readonly AgentProviderGuidanceKind[];
export const INITIAL_AGENT_PROVIDER_AVAILABILITY: AgentProviderAvailabilitySnapshot;
export function checkingAgentProviderAvailability(
  previous?: AgentProviderAvailabilitySnapshot,
): AgentProviderAvailabilitySnapshot;
export function agentProviderAvailabilityFromLocalResult(
  result: Readonly<{ status?: string; reason?: string }>,
  previous?: AgentProviderAvailabilitySnapshot,
  checkedAt?: string | null,
): AgentProviderAvailabilitySnapshot;
export function readyAgentProviderAvailability(
  checkedAt?: string | null,
): AgentProviderAvailabilitySnapshot;
export function agentProviderAvailabilityFromFailureReason(
  reason: string,
  previous?: AgentProviderAvailabilitySnapshot,
  checkedAt?: string | null,
): AgentProviderAvailabilitySnapshot;
export function agentProviderAvailabilityWithCopiedGuidance(
  previous: AgentProviderAvailabilitySnapshot,
  kind: AgentProviderGuidanceKind,
  copiedAt?: string | null,
): AgentProviderAvailabilitySnapshot;
export function freezeAgentSelection(selection: AgentSelection): AgentSelection;
export function agentSelectionKey(
  selection: AgentSelection,
  options?: {
    installationDigest?: string;
    trustPolicyVersion?: string;
    purpose?: string;
  },
): string;
export const agentPreflightKey: typeof agentSelectionKey;
