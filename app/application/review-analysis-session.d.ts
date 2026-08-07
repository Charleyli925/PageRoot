export class ReviewAnalysisCancelledError extends Error {}

export class ReviewAnalysisSession<T = unknown> {
  constructor(options?: {
    maxCacheEntries?: number;
    maxCacheBytes?: number;
    estimateSize?: (value: T) => number;
  });
  analyze(options?: {
    key?: string;
    compute?: (control: Readonly<{
      isCancelled: () => boolean;
    }>) => T | Promise<T>;
  }): Promise<T>;
  cancel(): void;
  clear(): void;
  dispose(): void;
}
