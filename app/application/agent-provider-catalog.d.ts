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
  settingsSupported?: boolean;
  localReadDisclosure?: string;
  stopLabel?: string;
  frozenPreviewDetail?: string;
  [key: string]: unknown;
}>;
export type AgentProviderDescriptor = Readonly<{
  providerId: string;
  runtimeId: string;
  securityProfile: "client-mediated" | "agent-native";
  trustPolicyVersion: string;
  installable?: boolean;
  installSource?: "user" | "managed" | "none";
  installState?: "idle" | "installing" | "failed" | "cancelling";
  selection: AgentSelection;
  presentation: AgentProviderPresentation;
  failureReason?: (code: unknown) => string;
  guidanceInstruction?: (kind: "install" | "login") => string;
}>;
export type AgentProviderEntry = AgentProviderDescriptor & Readonly<{
  availability: AgentProviderAvailabilitySnapshot;
  installationDigest: string | null;
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
export const CODEX_AGENT_PROVIDER: AgentProviderDescriptor;
export function defaultAgentProviders(options?: {
  codexExecution?: boolean;
}): readonly AgentProviderDescriptor[];
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
  select(selection: AgentSelection): AgentSelection;
  freezeSelected(): AgentSelection | null;
  freezeProviderSelection(providerId: string): AgentSelection | null;
  provider(selection?: AgentSelection | null): AgentProviderEntry | null;
  availability(selection?: AgentSelection | null): AgentProviderAvailabilitySnapshot;
  presentation(selection?: AgentSelection | null): AgentProviderPresentation;
  refreshAvailability(selection?: AgentSelection | null): Promise<unknown>;
  preflight(selection?: AgentSelection | null, options?: {
    force?: boolean;
    purpose?: "execution";
    trustPolicyVersion?: string | null;
    installationDigest?: string | null;
  }): Promise<AgentPreflight>;
  spendTicket(selection?: AgentSelection | null, options?: {
    force?: boolean;
    purpose?: "execution";
    trustPolicyVersion?: string | null;
    installationDigest?: string | null;
  }): Promise<AgentPreflight>;
  discardTicket(preflight: AgentPreflight): boolean;
  install(selection?: AgentSelection | null): Promise<unknown>;
  copyGuidance(kind: "install" | "login", selection?: AgentSelection | null): Promise<unknown>;
}
export const AgentProviderCatalog: typeof AgentCatalogState;
