export interface InsertionLayoutAuthority {
  sourceSha256: string;
  documentNode: Document;
}

export function insertionLayoutNeedsRefresh(
  previous: InsertionLayoutAuthority | null | undefined,
  next: InsertionLayoutAuthority | null | undefined,
): boolean;

export function structuralInsertionKey(
  selection: {
    id?: string;
    selector?: string;
    sourceAnchor?: { startOffset?: number } | null;
  } | null | undefined,
): string;

export function uniqueStructuralInsertionPoints<T extends {
  selection?: {
    id?: string;
    selector?: string;
    sourceAnchor?: { startOffset?: number } | null;
  } | null;
}>(
  points: readonly T[] | null | undefined,
): T[];
