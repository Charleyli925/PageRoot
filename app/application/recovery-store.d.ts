export type RecoveryRecord = {
  key: string;
  value: Record<string, unknown>;
};

export type StorageLike = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;

export type RecoveryStore = {
  readRecords(keys: string | string[]): RecoveryRecord[];
  write(keys: string | string[], value: unknown): boolean;
  remove(keys: string | string[]): boolean;
};

export function createRecoveryStore(
  storageProvider: StorageLike | null | (() => StorageLike | null),
): RecoveryStore;
export function createRendererRecoveryStore(): RecoveryStore;
