export type InternalFailureRecord = Readonly<{
  area: string;
  operation: string;
  code: string;
  recovered: boolean;
  at: number;
}>;

export function setInternalFailureTelemetry(
  sink: ((record: InternalFailureRecord) => void) | null,
): void;

export function reportInternalFailure(input?: {
  area?: string;
  operation?: string;
  code?: string;
  recovered?: boolean;
  cause?: unknown;
}): InternalFailureRecord;
