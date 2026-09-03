import type {
  AgentProviderAvailabilitySnapshot,
  AgentSelection,
} from "../domain/agent-provider-state.js";
import type { AgentProviderCardPresentation } from "./AgentProviderCard";

export type AgentProviderCardData = Readonly<{
  selection: AgentSelection;
  presentation: AgentProviderCardPresentation;
  availability: AgentProviderAvailabilitySnapshot;
  installState?: "idle" | "installing" | "failed" | "cancelling";
  models?: readonly Readonly<{
    id: string;
    displayName: string;
    reasoningChoices?: readonly Readonly<{ id: string; label: string }>[];
  }>[];
  connection?: Readonly<{
    vendorId: string;
    vendorDisplayName: string;
    baseUrl: string;
  }> | null;
}>;
