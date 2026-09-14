/**
 * The product identity contract is deliberately data-only. Runtime paths and
 * filesystem authority stay in desktop/runtime-environment.mjs and the Bridge
 * repositories; consumers may import these constants without gaining I/O.
 */
export const PRODUCT_DISPLAY_NAME_ZH = "源页";
export const PRODUCT_NAME = "Stemmio";
export const PRODUCT_TECHNICAL_NAME = "stemmio";
export const PRODUCT_BUNDLE_ID = "com.stemmio.app";
export const PRODUCT_PREVIEW_NAME = "Stemmio Developer Preview";
export const PRODUCT_PREVIEW_BUNDLE_ID = "com.stemmio.app.developer-preview";
export const PRODUCT_SOURCE_DIRECTORY_NAME = "Stemmio Development";
export const PRODUCT_STABLE_DIRECTORY_NAME = "Stemmio";
export const PRODUCT_PREVIEW_DIRECTORY_NAME = PRODUCT_PREVIEW_NAME;
export const PRODUCT_PROJECTS_DIRECTORY_NAME = "项目";
export const PRODUCT_PROJECT_RECORDS_DIRECTORY_NAME = "项目记录";
export const PRODUCT_SESSION_DIRECTORY_NAME = "chromium";
export const PRODUCT_AGENTS_DIRECTORY_NAME = "agents";
export const PRODUCT_RECOVERY_JOURNALS_DIRECTORY_NAME = "recovery-journals-v1";
export const PRODUCT_LOG_DIRECTORY_NAME = "logs";
export const PRODUCT_CONTROL_DIRECTORY_NAME = ".stemmio";
export const PRODUCT_REGISTRY_FILE_NAME = ".stemmio-registry.json";
export const PRODUCT_REGISTRY_LOCK_FILE_NAME = ".stemmio-registry-write-lock";
export const PRODUCT_IMPORT_TEMP_PREFIX = "..stemmio-import-";
export const PRODUCT_NON_REPLACE_TEMP_PREFIX = ".stemmio-new-";
export const PRODUCT_PREVIEW_PROTOCOL_SCHEME = "stemmio-preview";
export const PRODUCT_EDIT_RUNTIME_PROTOCOL_SCHEME = "stemmio-edit-runtime";
export const PRODUCT_PREVIEW_ORIGIN = "https://stemmio-preview.invalid";
export const PRODUCT_CONVERSATION_ACTOR = "stemmio";
export const PRODUCT_SCHEMA_BASE_URI = "https://stemmio.local/schemas/";

export const PRODUCT_ENV = Object.freeze({
  RUNTIME_CHANNEL: "STEMMIO_RUNTIME_CHANNEL",
  E2E: "STEMMIO_E2E",
  E2E_USER_DATA_DIR: "STEMMIO_E2E_USER_DATA_DIR",
  E2E_FOREGROUND: "STEMMIO_E2E_FOREGROUND",
  E2E_ROOT: "STEMMIO_E2E_ROOT",
  WORKSPACE: "STEMMIO_WORKSPACE",
  PROJECT_FILES_ROOT: "STEMMIO_PROJECT_FILES_ROOT",
  AGENTS_ROOT: "STEMMIO_AGENTS_ROOT",
  LOGS_ROOT: "STEMMIO_LOGS_ROOT",
  USER_DATA_ROOT: "STEMMIO_USER_DATA_ROOT",
  SESSION_DATA_ROOT: "STEMMIO_SESSION_DATA_ROOT",
  RECOVERY_JOURNALS_ROOT: "STEMMIO_RECOVERY_JOURNALS_ROOT",
  BRIDGE_AUTH_TOKEN: "STEMMIO_BRIDGE_AUTH_TOKEN",
  BRIDGE_PORT: "STEMMIO_BRIDGE_PORT",
  DEVICE_ID: "STEMMIO_DEVICE_ID",
  FAILPOINT: "STEMMIO_FAILPOINT",
  ALLOW_FILE_ORIGIN: "STEMMIO_ALLOW_FILE_ORIGIN",
  EXPECTED_PRODUCT_NAME: "STEMMIO_EXPECTED_PRODUCT_NAME",
  EXPECTED_APP_VERSION: "STEMMIO_EXPECTED_APP_VERSION",
  EXPECTED_BUNDLE_ID: "STEMMIO_EXPECTED_BUNDLE_ID",
  POSTHOG_HOST: "STEMMIO_POSTHOG_HOST",
  POSTHOG_TOKEN: "STEMMIO_POSTHOG_TOKEN",
  REQUIRE_NOTARIZATION: "STEMMIO_REQUIRE_NOTARIZATION",
  REQUIRE_TELEMETRY_CONFIG: "STEMMIO_REQUIRE_TELEMETRY_CONFIG",
  TELEMETRY_DISABLED: "STEMMIO_TELEMETRY_DISABLED",
  TELEMETRY_DEV: "STEMMIO_TELEMETRY_DEV",
  AGENT_INSTALL_STUB_FETCH: "STEMMIO_AGENT_INSTALL_STUB_FETCH",
  AUTOSAVE_FAILURE: "STEMMIO_E2E_AUTOSAVE_FAILURE",
  GENERATED_VERSION_OPEN_FAILURE: "STEMMIO_E2E_GENERATED_VERSION_OPEN_FAILURE",
  RECONCILE_REPLACE_BEFORE_READ: "STEMMIO_E2E_RECONCILE_REPLACE_BEFORE_READ",
});

export function productDirectoryName(channel) {
  switch (String(channel || "").trim().toLowerCase()) {
    case "stable":
      return PRODUCT_STABLE_DIRECTORY_NAME;
    case "preview":
      return PRODUCT_PREVIEW_DIRECTORY_NAME;
    case "source":
      return PRODUCT_SOURCE_DIRECTORY_NAME;
    default:
      return null;
  }
}

export function productApplicationName(channel) {
  const normalized = String(channel || "").trim().toLowerCase();
  if (normalized === "preview") return PRODUCT_PREVIEW_NAME;
  if (normalized === "stable") return PRODUCT_NAME;
  return PRODUCT_DISPLAY_NAME_ZH;
}
