export type RuntimeVisualSnapshot = Readonly<{
  key: string;
  state: "captured" | "unavailable";
  pngSha256: string;
  width: number;
  height: number;
  byteLength: number;
  pngBytes: Uint8Array;
}>;

export const RUNTIME_VISUAL_SNAPSHOT_LIMIT: 32;

export function acceptRuntimeVisualSnapshots(
  value: unknown,
  allowedCandidateKeys: ReadonlySet<string>,
): readonly RuntimeVisualSnapshot[] | null;

export function runtimeVisualSnapshotsByteSize(
  snapshots: readonly RuntimeVisualSnapshot[] | unknown,
): number;
