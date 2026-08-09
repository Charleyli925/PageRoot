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

export type RuntimeSnapshotHostPair = Readonly<{
  before: RuntimeSnapshotHost;
  after: RuntimeSnapshotHost;
}>;

export const RUNTIME_SNAPSHOT_HOST_LIMIT: 32;

export function resolveRuntimeSnapshotHosts(options?: {
  beforeHtml?: string;
  afterHtml?: string;
  beforeIndex?: unknown;
  afterIndex?: unknown;
  maximum?: number;
}): Readonly<{
  beforeIndex: unknown;
  afterIndex: unknown;
  hosts: readonly RuntimeSnapshotHostPair[];
}> | null;
