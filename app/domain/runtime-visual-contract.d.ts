export interface RuntimeVisualViewportBudget {
  readonly minWidth: 320;
  readonly minHeight: 320;
  readonly maxWidth: 4096;
  readonly maxHeight: 2400;
}

export interface RuntimeVisualPageBudget {
  readonly htmlBytes: 26214400;
  readonly visualLimit: 32;
  readonly viewport: RuntimeVisualViewportBudget;
  readonly hostAtoms: 4096;
  readonly atoms: 8192;
  readonly nodes: 8192;
  readonly hostValueLength: 200000;
  readonly valueLength: 400000;
  readonly canvasPixels: 4194304;
  readonly pngBytes: 2000000;
  readonly pngDimension: 4096;
  readonly aggregatePngBytes: 16000000;
  readonly renderedTextBytes: 65536;
}

export interface RuntimeVisualContract {
  readonly version: 2;
  readonly candidateLimit: 128;
  readonly identityAttributeLimit: 24;
  readonly ownerDeadlineMs: 1500;
  readonly pageBudget: RuntimeVisualPageBudget;
}

export interface RuntimeVisualEnvelope {
  readonly contractVersion: 2;
  readonly sessionId: string;
  readonly sourceSha256: string;
}

export const RUNTIME_VISUAL_CONTRACT_VERSION: 2;
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
