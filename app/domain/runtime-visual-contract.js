export const RUNTIME_VISUAL_CONTRACT_VERSION = 1;

export const RUNTIME_VISUAL_CONTRACT = Object.freeze({
  version: RUNTIME_VISUAL_CONTRACT_VERSION,
  candidateLimit: 128,
  identityAttributeLimit: 24,
  ownerDeadlineMs: 1_500,
  pageBudget: Object.freeze({
    htmlBytes: 25 * 1024 * 1024,
    visualLimit: 32,
    hostAtoms: 4_096,
    atoms: 8_192,
    nodes: 8_192,
    hostValueLength: 200_000,
    valueLength: 400_000,
    canvasPixels: 4_194_304,
    visualBytes: 16_000_000,
  }),
});

export const RUNTIME_VISUAL_SOURCE_SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
export const RUNTIME_VISUAL_SESSION_ID_PATTERN =
  /^(?:review|runtime)-[a-z0-9][a-z0-9._:-]{7,127}$/u;

export function isRuntimeVisualSourceSha256(value) {
  return typeof value === "string"
    && RUNTIME_VISUAL_SOURCE_SHA256_PATTERN.test(value);
}

export function isRuntimeVisualSessionIdentity(value) {
  return typeof value === "string"
    && RUNTIME_VISUAL_SESSION_ID_PATTERN.test(value);
}

export function acceptedRuntimeVisualEnvelope(value, expected = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const contractVersion = value.contractVersion;
  const sessionId = value.sessionId;
  const sourceSha256 = value.sourceSha256;
  if (
    contractVersion !== RUNTIME_VISUAL_CONTRACT_VERSION
    || !isRuntimeVisualSessionIdentity(sessionId)
    || !isRuntimeVisualSourceSha256(sourceSha256)
    || (
      typeof expected.sessionId === "string"
      && sessionId !== expected.sessionId
    )
    || (
      typeof expected.sourceSha256 === "string"
      && sourceSha256 !== expected.sourceSha256
    )
  ) return null;
  return Object.freeze({ contractVersion, sessionId, sourceSha256 });
}
