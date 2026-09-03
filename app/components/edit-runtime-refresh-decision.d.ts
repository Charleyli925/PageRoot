export type EditRuntimeRefreshAction =
  | "in-place"
  | "defer-until-boundary"
  | "candidate-now";

export type EditRuntimeRefreshDecision = Readonly<{
  action: EditRuntimeRefreshAction;
  reason: string;
  synchronizeCurrentFrame: boolean;
  markRuntimeRefreshPending: boolean;
}>;

export function isRuntimeInPlaceAttribute(attributeName: unknown): boolean;

export function decideEditRuntimeRefresh(input?: Readonly<{
  hasRuntime?: boolean;
  nativeEditActive?: boolean;
  mutationKind?: "text" | "style" | "reorder" | "structure" | "attribute";
  programIdentityChanged?: boolean;
  attributeName?: string | null;
}>): EditRuntimeRefreshDecision;
