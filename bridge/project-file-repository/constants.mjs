// Shared schema version, identifier shapes and size limits.
export const PROJECT_FILE_SCHEMA_VERSION = "4.0.0";

export const HTML_EXTENSIONS = new Set([".html", ".htm"]);

export const PROJECT_ID = /^project_[a-f0-9]{16,64}$/u;

export const DOCUMENT_ID = /^doc_[a-f0-9]{16,64}$/u;

export const VERSION_ID = /^ver_\d{4,}$/u;

export const WORKING_COPY_ID = /^work_ver_\d{4,}$/u;

export const SHA256 = /^sha256:[a-f0-9]{64}$/u;

export const SAFE_REQUEST_ID = /^[A-Za-z0-9_-]{1,160}$/u;

export const SAFE_OPERATION_ID = /^[A-Za-z0-9_-]{8,160}$/u;

export const RECONCILE_LOCATOR_REASONS = new Set([
  "watch",
  "rename",
  "startup",
  "safe-action",
]);

export const SAVE_RECOVERY_ID = /^save_work_ver_\d{4,}_(?:current|\d+)_[a-f0-9]{32}$/u;

export const SOURCE_ELEMENT_IDENTITY_MIGRATION_RECOVERY_ID =
  /^identity_work_ver_\d{4,}_v1_[a-f0-9]{32}$/u;

export const MAX_HTML_BYTES = 20 * 1024 * 1024;

// Keep the Request freeze cap aligned with the renderer's Draft attachment
// limit. The repository rechecks actual bytes instead of trusting UI metadata.
export const MAX_REQUEST_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export const MAX_PATH_COMPONENT_BYTES = 255;

export const WORKING_COPY_SAVE_STATES = new Set(["saved", "saving", "failed"]);

export const IMPORT_STAGING_WRAPPER_BYTES = Buffer.byteLength(
  "..pageroot-import-00000000-0000-0000-0000-000000000000",
  "utf8",
);
