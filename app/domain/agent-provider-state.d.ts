export type AgentProviderAvailabilityStatus =
  | "checking"
  | "ready"
  | "not-installed"
  | "auth-required"
  | "unavailable";

export type AgentProviderGuidanceKind = "install" | "login";
export type AgentDiagnosticReadiness =
  | "checking"
  | "ready"
  | "not-installed"
  | "auth-required"
  | "invalid-installation"
  | "connection-failed";
export type AgentDiagnosticSnapshot = Readonly<{
  readiness: AgentDiagnosticReadiness;
  cause: string | null;
  operation: "diagnose" | "refresh";
  checkedAt: string | null;
  activeInstallation: Readonly<{ phase: "installing" | "cancelling" }> | null;
}>;
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
export const AGENT_DIAGNOSTIC_READINESS: readonly AgentDiagnosticReadiness[];
export const AGENT_DIAGNOSTIC_OPERATIONS: readonly AgentDiagnosticSnapshot["operation"][];
export const INITIAL_AGENT_PROVIDER_AVAILABILITY: AgentProviderAvailabilitySnapshot;
export function agentDiagnosticSnapshot(
  value?: Partial<AgentDiagnosticSnapshot>,
  checkedAt?: string | null,
): AgentDiagnosticSnapshot;
export function agentProviderAvailabilityFromDiagnostic(
  diagnostic: Partial<AgentDiagnosticSnapshot>,
  previous?: AgentProviderAvailabilitySnapshot,
  checkedAt?: string | null,
): AgentProviderAvailabilitySnapshot;
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
  lastCheck?: "local" | "use",
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
