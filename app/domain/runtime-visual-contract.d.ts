export interface RuntimeVisualPageBudget {
  readonly htmlBytes: 26214400;
  readonly visualLimit: 32;
  readonly hostAtoms: 4096;
  readonly atoms: 8192;
  readonly nodes: 8192;
  readonly hostValueLength: 200000;
  readonly valueLength: 400000;
  readonly canvasPixels: 4194304;
  readonly visualBytes: 16000000;
}

export interface RuntimeVisualContract {
  readonly version: 1;
  readonly candidateLimit: 128;
  readonly identityAttributeLimit: 24;
  readonly ownerDeadlineMs: 1500;
  readonly comparisonDeadlineMs: 500;
  readonly pageBudget: RuntimeVisualPageBudget;
}

export interface RuntimeVisualEnvelope {
  readonly contractVersion: 1;
  readonly sessionId: string;
  readonly sourceSha256: string;
}

export const RUNTIME_VISUAL_CONTRACT_VERSION: 1;
export const RUNTIME_VISUAL_CONTRACT: RuntimeVisualContract;
export const RUNTIME_VISUAL_SOURCE_SHA256_PATTERN: RegExp;
export const RUNTIME_VISUAL_SESSION_ID_PATTERN: RegExp;

export function isRuntimeVisualSourceSha256(value: unknown): value is string;
export function isRuntimeVisualSessionIdentity(value: unknown): value is string;
export function acceptedRuntimeVisualEnvelope(
  value: unknown,
  expected?: {
    sessionId?: string;
    sourceSha256?: string;
  },
): RuntimeVisualEnvelope | null;
