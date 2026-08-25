import type {
  AgentProviderAvailabilitySnapshot,
  AgentSelection,
} from "../domain/agent-provider-state.js";
import type { BridgeClient } from "./bridge-client.js";

export type AgentProviderPresentation = Readonly<{
  displayName: string;
  agentName: string;
  logoSrc: string | null;
  cardClassName: string;
  primaryActionDataAttribute: string | null;
  restartLabel?: string;
  restartSupported?: boolean;
  stopLabel?: string;
  frozenPreviewDetail?: string;
  [key: string]: unknown;
}>;
export type AgentProviderDescriptor = Readonly<{
  providerId: string;
  runtimeId: string;
  securityProfile: "client-mediated" | "agent-native";
  trustPolicyVersion: string;
  selection: AgentSelection;
  presentation: AgentProviderPresentation;
  capabilities?: Readonly<Record<string, boolean>>;
  failureReason?: (code: unknown) => string;
  guidanceInstruction?: (kind: "install" | "login") => string;
}>;
export type AgentProviderEntry = AgentProviderDescriptor & Readonly<{
  availability: AgentProviderAvailabilitySnapshot;
  installationDigest: string | null;
  models?: readonly Readonly<Record<string, unknown>>[];
  reasoningEfforts?: readonly Readonly<Record<string, unknown>>[];
  modes?: readonly Readonly<Record<string, unknown>>[];
}>;
export type AgentPreflight = Readonly<Record<string, unknown> & {
  status: string;
  preflightId: string;
  selection: AgentSelection;
  purpose: string;
  trustPolicyVersion: string;
  installationDigest: string;
  securityProfile: "client-mediated" | "agent-native";
}>;
export type AgentCatalogSnapshot = Readonly<{
  providers: Readonly<Record<string, AgentProviderEntry>>;
  selected: AgentSelection | null;
  preflightBySelection: Readonly<Record<string, AgentPreflight>>;
}>;

export const QODER_AGENT_PROVIDER: AgentProviderDescriptor;
export class AgentCatalogState {
  constructor(options?: {
    bridgeClient: BridgeClient;
    handoffPort?: { copy(input: unknown): Promise<unknown> } | null;
    clock?: { now(): number };
    providers?: readonly AgentProviderDescriptor[];
    selected?: AgentSelection | null;
  });
  getSnapshot(): AgentCatalogSnapshot;
  subscribe(listener: (snapshot: AgentCatalogSnapshot) => void): () => void;
  dispose(): void;
  refreshCatalog(): Promise<AgentCatalogSnapshot>;
  select(selection: AgentSelection): AgentSelection;
  freezeSelected(): AgentSelection | null;
  provider(selection?: AgentSelection | null): AgentProviderEntry | null;
  availability(selection?: AgentSelection | null): AgentProviderAvailabilitySnapshot;
  presentation(selection?: AgentSelection | null): AgentProviderPresentation;
  refreshAvailability(selection?: AgentSelection | null): Promise<unknown>;
  preflight(selection?: AgentSelection | null, options?: {
    force?: boolean;
    purpose?: string;
    trustPolicyVersion?: string | null;
    installationDigest?: string | null;
  }): Promise<AgentPreflight>;
  spendTicket(selection?: AgentSelection | null, options?: {
    force?: boolean;
    purpose?: string;
    trustPolicyVersion?: string | null;
    installationDigest?: string | null;
  }): Promise<AgentPreflight>;
  discardTicket(preflight: AgentPreflight): boolean;
  copyGuidance(kind: "install" | "login", selection?: AgentSelection | null): Promise<unknown>;
}
export const AgentProviderCatalog: typeof AgentCatalogState;
