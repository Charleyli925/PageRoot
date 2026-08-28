import type {
  AgentProviderAvailabilitySnapshot,
  AgentSelection,
} from "../domain/agent-provider-state.js";
import type { AgentProviderCardPresentation } from "./AgentProviderCard";

export type AgentProviderCardData = Readonly<{
  selection: AgentSelection;
  presentation: AgentProviderCardPresentation;
  availability: AgentProviderAvailabilitySnapshot;
}>;
