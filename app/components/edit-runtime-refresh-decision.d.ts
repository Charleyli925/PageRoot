export type EditRuntimeRefreshAction =
  | "in-place"
  | "candidate-now";

export type StructuralProjectionRefreshInput = Readonly<{
  kind: "in-place" | "candidate" | "reject";
  reason?: string;
}>;

export type EditRuntimeRefreshDecision = Readonly<{
  action: EditRuntimeRefreshAction;
  reason: string;
  synchronizeCurrentFrame: boolean;
}>;

export function decideEditRuntimeRefresh(input?: Readonly<{
  hasRuntime?: boolean;
  mutationKind?: "text" | "style" | "reorder" | "structure";
  programIdentityChanged?: boolean;
  structuralProjection?: StructuralProjectionRefreshInput | null;
}>): EditRuntimeRefreshDecision;
