export type RuntimeVisualSnapshot = Readonly<{
  key: string;
  state: "captured" | "unavailable";
  pngSha256: string;
  width: number;
  height: number;
  /** CSS-pixel dimensions of the captured owner rectangle. */
  layoutWidth: number;
  layoutHeight: number;
  byteLength: number;
  pngBytes: Uint8Array;
  /** SHA-256 of the owner-isolated, normalized visible DOM/SVG text. */
  renderedTextSha256: string;
}>;

export const RUNTIME_VISUAL_SNAPSHOT_LIMIT: 32;

export function acceptRuntimeVisualSnapshots(
  value: unknown,
  allowedCandidateKeys: ReadonlySet<string>,
): readonly RuntimeVisualSnapshot[] | null;
