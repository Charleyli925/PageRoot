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

export type RuntimeSnapshotCaptureCandidate = Readonly<{
  key: string;
  path: readonly number[];
  tagName: string;
  kind: RuntimeSnapshotHostKind;
  identityAttributes: readonly (readonly [string, string])[];
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

/** Edit-only source-empty host resolver. Review remains intentionally narrower. */
export function resolveEditRuntimeHosts(options?: {
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

export function runtimeSnapshotCaptureCandidate(
  key: string,
  host: RuntimeSnapshotHost,
): RuntimeSnapshotCaptureCandidate | null;
