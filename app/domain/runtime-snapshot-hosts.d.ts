export type RuntimeSnapshotHostKind = "canvas" | "svg" | "host";

export type RuntimeSnapshotTargetRef = Readonly<{
  targetId: string;
  label: string;
  level: string;
  selector?: string;
  sourceAnchor?: Readonly<{ startOffset: number; endOffset: number; sourceSha256: string }>;
  fingerprint?: Readonly<Record<string, unknown>>;
}>;

export type RuntimeSnapshotOwnerBinding = Readonly<{
  path: readonly number[];
  tagName: string;
  kind: RuntimeSnapshotHostKind;
  identityAttributes: readonly (readonly [string, string])[];
}>;

export type RuntimeSnapshotHost = Readonly<{
  sourceNodeId: string;
  kind: RuntimeSnapshotHostKind;
  hostTargetRef: RuntimeSnapshotTargetRef;
  binding: RuntimeSnapshotOwnerBinding;
}>;

export type RuntimeSnapshotCaptureCandidate = Readonly<{
  key: string;
  path: readonly number[];
  tagName: string;
  kind: RuntimeSnapshotHostKind;
  identityAttributes: readonly (readonly [string, string])[];
}>;

export const EDIT_RUNTIME_HOST_LIMIT: 32;

export function resolveEditRuntimeHosts(options?: {
  html?: string;
  sourceIndex?: unknown;
  maximum?: number;
}): Readonly<{
  sourceIndex: unknown;
  hosts: readonly RuntimeSnapshotHost[];
}> | null;

export function editRuntimeCaptureCandidate(
  key: string,
  host: RuntimeSnapshotHost,
): RuntimeSnapshotCaptureCandidate | null;
