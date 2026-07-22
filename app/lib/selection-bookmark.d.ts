import type { SourceAffinity, SourceAnchor } from "./source-text-map";
import type { RuntimeDomSourceMap } from "./runtime-dom-source-map";

export type SelectionBookmark = {
  version: 1;
  sourceSha256: string | null;
  rootRuntimeId: string | null;
  collapsed: boolean;
  anchor: SourceAnchor;
  focus: SourceAnchor;
};

export type ResolvedSelectionBookmark =
  | {
      ok: true;
      anchorNode: Node;
      anchorOffset: number;
      focusNode: Node;
      focusOffset: number;
      collapsed: boolean;
    }
  | {
      ok: false;
      code: string;
      reason: string;
      details?: Record<string, unknown>;
    };

export declare class SelectionBookmarkError extends Error {
  code: string;
  details: Record<string, unknown>;
}

export declare function createSelectionBookmark(
  selection: Selection,
  runtimeMap: RuntimeDomSourceMap,
  options?: {
    root?: Node | null;
    sourceSha256?: string | null;
    anchorAffinity?: SourceAffinity;
    focusAffinity?: SourceAffinity;
  },
): SelectionBookmark;

export declare function resolveSelectionBookmark(
  bookmark: SelectionBookmark,
  runtimeMap: RuntimeDomSourceMap,
  options?: {
    root?: Node | null;
    sourceSha256?: string | null;
    allowSourceMismatch?: boolean;
  },
): ResolvedSelectionBookmark;

export declare function restoreSelectionBookmark(
  selection: Selection,
  bookmark: SelectionBookmark,
  runtimeMap: RuntimeDomSourceMap,
  options?: {
    root?: Node | null;
    sourceSha256?: string | null;
    allowSourceMismatch?: boolean;
  },
): { ok: true } | { ok: false; code: string; reason: string };
