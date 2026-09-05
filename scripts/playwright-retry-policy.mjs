export const INFRA_SENSITIVE_TAG = "@infra-sensitive";
export const PRODUCT_CONTRACT_RETRIES = 0;

export function playwrightRetries({ infraSensitive = false } = {}) {
  if (!infraSensitive) return PRODUCT_CONTRACT_RETRIES;
  return process.env.CI ? 1 : 0;
}

export function isInfraSensitiveTest({ title = "", tags = [] } = {}) {
  const names = Array.isArray(tags) ? tags.map(String) : [];
  if (names.includes(INFRA_SENSITIVE_TAG)) return true;
  return String(title).includes(INFRA_SENSITIVE_TAG);
}
