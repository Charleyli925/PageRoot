import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// Keep the desktop parser self-contained so it can be loaded from app.asar.
// The Bridge receives the canonical shared/product-identity.mjs as an
// extraResource; tests pin these values to the same frozen contract.
const PRODUCT_DISPLAY_NAME_ZH = "源页";
const PRODUCT_NAME = "Stemmio";
const PRODUCT_PREVIEW_NAME = "Stemmio Developer Preview";
const PRODUCT_SOURCE_DIRECTORY_NAME = "Stemmio Development";
const PRODUCT_STABLE_DIRECTORY_NAME = "Stemmio";
const PRODUCT_PREVIEW_DIRECTORY_NAME = PRODUCT_PREVIEW_NAME;
const PRODUCT_PROJECTS_DIRECTORY_NAME = "项目";
const PRODUCT_PROJECT_RECORDS_DIRECTORY_NAME = "项目记录";
const PRODUCT_SESSION_DIRECTORY_NAME = "chromium";
const PRODUCT_AGENTS_DIRECTORY_NAME = "agents";
const PRODUCT_RECOVERY_JOURNALS_DIRECTORY_NAME = "recovery-journals-v1";
const PRODUCT_ENV = Object.freeze({
  RUNTIME_CHANNEL: "STEMMIO_RUNTIME_CHANNEL",
  E2E: "STEMMIO_E2E",
  E2E_USER_DATA_DIR: "STEMMIO_E2E_USER_DATA_DIR",
  E2E_FOREGROUND: "STEMMIO_E2E_FOREGROUND",
  E2E_ROOT: "STEMMIO_E2E_ROOT",
  WORKSPACE: "STEMMIO_WORKSPACE",
  PROJECT_FILES_ROOT: "STEMMIO_PROJECT_FILES_ROOT",
  AGENTS_ROOT: "STEMMIO_AGENTS_ROOT",
  LOGS_ROOT: "STEMMIO_LOGS_ROOT",
  EXPECTED_PRODUCT_NAME: "STEMMIO_EXPECTED_PRODUCT_NAME",
});

function productDirectoryName(channel) {
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

function productApplicationName(channel) {
  const normalized = String(channel || "").trim().toLowerCase();
  if (normalized === "preview") return PRODUCT_PREVIEW_NAME;
  if (normalized === "stable") return PRODUCT_NAME;
  return PRODUCT_DISPLAY_NAME_ZH;
}

export const RUNTIME_ENVIRONMENT_SCHEMA_VERSION = 1;
export const RUNTIME_ENVIRONMENT_FILE_NAME = "runtime-environment.json";
export const RUNTIME_CHANNELS = Object.freeze([
  "stable",
  "preview",
  "source",
  "e2e",
]);

const PACKAGED_CHANNELS = new Set(["stable", "preview"]);

export class RuntimeEnvironmentError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "RuntimeEnvironmentError";
    this.code = code;
    this.details = details;
  }
}

function assertAbsolute(value, label) {
  if (typeof value !== "string" || !path.isAbsolute(value)) {
    throw new RuntimeEnvironmentError(
      "RUNTIME_PATH_INVALID",
      `${label} must be an absolute path.`,
      { label },
    );
  }
  return path.resolve(value);
}

function normalizeChannel(value, { allowPackagedOnly = false } = {}) {
  const channel = String(value ?? "").trim().toLowerCase();
  if (!RUNTIME_CHANNELS.includes(channel)) {
    throw new RuntimeEnvironmentError(
      "RUNTIME_CHANNEL_INVALID",
      `Unsupported runtime channel: ${channel || "(missing)"}.`,
      { channel },
    );
  }
  if (allowPackagedOnly && !PACKAGED_CHANNELS.has(channel)) {
    throw new RuntimeEnvironmentError(
      "RUNTIME_CHANNEL_MARKER_INVALID",
      `Packaged runtime marker must declare stable or preview, not ${channel}.`,
      { channel },
    );
  }
  return channel;
}

export function runtimeEnvironmentMarker(channel) {
  return Object.freeze({
    schemaVersion: RUNTIME_ENVIRONMENT_SCHEMA_VERSION,
    channel: normalizeChannel(channel, { allowPackagedOnly: true }),
  });
}

export function parseRuntimeEnvironmentMarker(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RuntimeEnvironmentError(
      "RUNTIME_CHANNEL_MARKER_INVALID",
      "Runtime environment marker must be an object.",
    );
  }
  if (value.schemaVersion !== RUNTIME_ENVIRONMENT_SCHEMA_VERSION) {
    throw new RuntimeEnvironmentError(
      "RUNTIME_CHANNEL_MARKER_INVALID",
      "Runtime environment marker schema is unsupported.",
      { schemaVersion: value.schemaVersion },
    );
  }
  return runtimeEnvironmentMarker(value.channel);
}

export function resolveRuntimeChannel({
  environment = process.env,
  resourcesPath = process.resourcesPath,
  defaultApp = process.defaultApp === true,
  allowEnvironmentOverride = true,
  readFile = readFileSync,
} = {}) {
  const explicit = String(environment?.[PRODUCT_ENV.RUNTIME_CHANNEL] ?? "").trim();
  if (explicit && allowEnvironmentOverride) return normalizeChannel(explicit);

  const markerPath = path.join(
    assertAbsolute(resourcesPath, "resourcesPath"),
    RUNTIME_ENVIRONMENT_FILE_NAME,
  );
  try {
    const raw = readFile(markerPath, "utf8");
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return parseRuntimeEnvironmentMarker(parsed).channel;
  } catch (cause) {
    if (cause instanceof RuntimeEnvironmentError) throw cause;
    if (defaultApp && cause?.code === "ENOENT") return "source";
    throw new RuntimeEnvironmentError(
      cause?.code === "ENOENT"
        ? "RUNTIME_CHANNEL_MARKER_MISSING"
        : "RUNTIME_CHANNEL_MARKER_INVALID",
      cause?.code === "ENOENT"
        ? `Packaged runtime marker is missing: ${markerPath}`
        : `Packaged runtime marker could not be read: ${markerPath}`,
      { markerPath, cause: cause instanceof Error ? cause.message : String(cause) },
    );
  }
}

function configuredPath(environment, name, fallback, { basePath, label }) {
  const value = String(environment?.[name] ?? "").trim();
  if (!value) return fallback;
  const resolved = assertAbsolute(value, name);
  if (basePath && !isInside(resolved, basePath)) {
    throw new RuntimeEnvironmentError(
      "RUNTIME_PATH_OUTSIDE_ISOLATED_ROOT",
      `${label} must stay inside the isolated E2E root.`,
      { path: resolved, root: basePath },
    );
  }
  return resolved;
}

function isInside(candidate, root) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (
    relative !== ".."
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative)
  );
}

export function createRuntimeEnvironment({
  channel,
  environment = process.env,
  homePath = os.homedir(),
  appDataPath = path.join(homePath, "Library", "Application Support"),
  documentsPath = path.join(homePath, "Documents"),
  logsBasePath = path.join(homePath, "Library", "Logs"),
  e2eUserDataPath = null,
} = {}) {
  const normalizedChannel = normalizeChannel(channel);
  const appDataRoot = assertAbsolute(appDataPath, "appDataPath");
  const documentsRoot = assertAbsolute(documentsPath, "documentsPath");
  const logsRoot = assertAbsolute(logsBasePath, "logsBasePath");

  if (normalizedChannel === "e2e") {
    const isolatedRoot = assertAbsolute(e2eUserDataPath, "e2eUserDataPath");
    const userDataPath = isolatedRoot;
    const sessionDataPath = path.join(isolatedRoot, "chromium");
    const projectFilesRoot = configuredPath(
      environment,
      PRODUCT_ENV.PROJECT_FILES_ROOT,
      path.join(isolatedRoot, "project-files"),
      { basePath: isolatedRoot, label: PRODUCT_ENV.PROJECT_FILES_ROOT },
    );
    const workspacePath = configuredPath(
      environment,
      PRODUCT_ENV.WORKSPACE,
      path.join(isolatedRoot, "workspace"),
      { basePath: isolatedRoot, label: PRODUCT_ENV.WORKSPACE },
    );
    const agentsRoot = configuredPath(
      environment,
      PRODUCT_ENV.AGENTS_ROOT,
      path.join(isolatedRoot, PRODUCT_AGENTS_DIRECTORY_NAME),
      { basePath: isolatedRoot, label: PRODUCT_ENV.AGENTS_ROOT },
    );
    const logsPath = configuredPath(
      environment,
      PRODUCT_ENV.LOGS_ROOT,
      path.join(isolatedRoot, "logs"),
      { basePath: isolatedRoot, label: PRODUCT_ENV.LOGS_ROOT },
    );
    return Object.freeze({
      channel: normalizedChannel,
      applicationName: String(environment?.[PRODUCT_ENV.EXPECTED_PRODUCT_NAME] || "源页").trim() || "源页",
      userDataPath,
      sessionDataPath,
      projectFilesRoot,
      workspacePath,
      agentsRoot,
      recoveryJournalPath: path.join(userDataPath, PRODUCT_RECOVERY_JOURNALS_DIRECTORY_NAME),
      logsPath,
    });
  }

  const directoryName = productDirectoryName(normalizedChannel);
  const userDataPath = path.join(appDataRoot, directoryName);
  const documentsPathForChannel = path.join(documentsRoot, directoryName);
  const defaultProjectFilesRoot = path.join(documentsPathForChannel, PRODUCT_PROJECTS_DIRECTORY_NAME);
  const defaultWorkspacePath = path.join(documentsPathForChannel, PRODUCT_PROJECT_RECORDS_DIRECTORY_NAME);
  const projectFilesRoot = normalizedChannel === "source"
    ? configuredPath(environment, PRODUCT_ENV.PROJECT_FILES_ROOT, defaultProjectFilesRoot, {
      label: PRODUCT_ENV.PROJECT_FILES_ROOT,
    })
    : defaultProjectFilesRoot;
  const workspacePath = normalizedChannel === "source"
    ? configuredPath(environment, PRODUCT_ENV.WORKSPACE, defaultWorkspacePath, {
      label: PRODUCT_ENV.WORKSPACE,
    })
    : defaultWorkspacePath;
  return Object.freeze({
    channel: normalizedChannel,
    applicationName: productApplicationName(normalizedChannel),
    userDataPath,
    sessionDataPath: path.join(userDataPath, PRODUCT_SESSION_DIRECTORY_NAME),
    projectFilesRoot,
    workspacePath,
    agentsRoot: path.join(userDataPath, PRODUCT_AGENTS_DIRECTORY_NAME),
    recoveryJournalPath: path.join(userDataPath, PRODUCT_RECOVERY_JOURNALS_DIRECTORY_NAME),
    logsPath: path.join(logsRoot, directoryName),
  });
}

export function assertRuntimeEnvironment(environment) {
  const value = environment && typeof environment === "object" ? environment : null;
  if (!value) throw new RuntimeEnvironmentError("RUNTIME_ENVIRONMENT_INVALID", "Runtime environment is missing.");
  for (const [key, label] of [
    ["userDataPath", "userDataPath"],
    ["sessionDataPath", "sessionDataPath"],
    ["projectFilesRoot", "projectFilesRoot"],
    ["workspacePath", "workspacePath"],
    ["agentsRoot", "agentsRoot"],
    ["recoveryJournalPath", "recoveryJournalPath"],
    ["logsPath", "logsPath"],
  ]) {
    assertAbsolute(value[key], label);
  }
  return Object.freeze({ ...value });
}
