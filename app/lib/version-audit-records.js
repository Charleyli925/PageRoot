function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/**
 * Selects the immutable audit collections returned next to a Version
 * manifest. Keeping these records outside the manifest preserves the exact
 * committed manifest bytes while still allowing the history UI to render the
 * already hash-validated archive.
 *
 * @param {Record<string, unknown>} raw
 * @returns {{ comments: unknown[], editEvents: unknown[] }}
 */
export function versionAuditCollections(raw) {
  const topLevelAnnotations = isRecord(raw.annotations)
    && raw.annotations.schemaVersion === "3.0.0"
    ? raw.annotations
    : null;

  return {
    comments:
      topLevelAnnotations && Array.isArray(topLevelAnnotations.comments)
        ? topLevelAnnotations.comments
        : [],
    editEvents:
      topLevelAnnotations && Array.isArray(topLevelAnnotations.editEvents)
        ? topLevelAnnotations.editEvents
        : [],
  };
}
