export function normalizedSha256(value) {
  return String(value ?? "").replace(/^sha256:/u, "");
}

export function isPositionalSelector(selector) {
  return /:(?:nth(?:-last)?|first|last|only)-(?:child|of-type)\s*\(/iu.test(
    String(selector ?? ""),
  ) || /:(?:first|last|only)-(?:child|of-type)\b/iu.test(
    String(selector ?? ""),
  );
}

export function isStalePositionalTarget(target, actualSha256) {
  return (
    isPositionalSelector(target?.selector)
    && (
      !target?.sourceAnchor?.sourceSha256
      || normalizedSha256(target.sourceAnchor.sourceSha256)
        !== normalizedSha256(actualSha256)
    )
  );
}

export function matchingFingerprintPrefixCount(expected = [], actual = []) {
  let count = 0;
  const length = Math.min(expected.length, actual.length);
  for (let index = 0; index < length; index += 1) {
    if (expected[index] !== actual[index]) break;
    count += 1;
  }
  return count;
}
