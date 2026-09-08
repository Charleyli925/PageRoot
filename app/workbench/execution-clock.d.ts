export function createExecutionClock(input: {
  startedAt: string | null; wallNow?: () => number; monotonicNow?: () => number;
}): Readonly<{ sample(input?: { resume?: boolean }): number; stop(): number }>;
