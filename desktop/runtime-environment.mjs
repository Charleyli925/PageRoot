import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

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
  const explicit = String(environment?.PAGEROOT_RUNTIME_CHANNEL ?? "").trim();
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
      "HTML_AI_PROJECT_FILES_ROOT",
      path.join(isolatedRoot, "project-files"),
      { basePath: isolatedRoot, label: "HTML_AI_PROJECT_FILES_ROOT" },
    );
    const workspacePath = configuredPath(
      environment,
      "HTML_AI_WORKSPACE",
      path.join(isolatedRoot, "workspace"),
      { basePath: isolatedRoot, label: "HTML_AI_WORKSPACE" },
    );
    const agentsRoot = configuredPath(
      environment,
      "HTML_AI_AGENTS_ROOT",
      path.join(isolatedRoot, "agents"),
      { basePath: isolatedRoot, label: "HTML_AI_AGENTS_ROOT" },
    );
    const logsPath = configuredPath(
      environment,
      "PAGEROOT_LOGS_ROOT",
      path.join(isolatedRoot, "logs"),
      { basePath: isolatedRoot, label: "PAGEROOT_LOGS_ROOT" },
    );
    return Object.freeze({
      channel: normalizedChannel,
      applicationName: String(environment?.PAGEROOT_EXPECTED_PRODUCT_NAME || "源页").trim() || "源页",
      userDataPath,
      sessionDataPath,
      projectFilesRoot,
      workspacePath,
      agentsRoot,
      recoveryJournalPath: path.join(userDataPath, "recovery-journals-v1"),
      logsPath,
    });
  }

  const directoryName = normalizedChannel === "preview"
    ? "PageRoot Developer Preview"
    : normalizedChannel === "source"
      ? "PageRoot Development"
      : "PageRoot";
  const userDataPath = path.join(appDataRoot, directoryName);
  const documentsPathForChannel = path.join(documentsRoot, directoryName);
  return Object.freeze({
    channel: normalizedChannel,
    applicationName: normalizedChannel === "preview"
      ? "PageRoot Developer Preview"
      : normalizedChannel === "stable"
        ? "PageRoot"
        : "源页",
    userDataPath,
    // Keep the formal app's existing Electron session location unchanged;
    // only Preview and isolated test channels receive an explicit chromium/
    // child directory.
    sessionDataPath: normalizedChannel === "preview"
      ? path.join(userDataPath, "chromium")
      : userDataPath,
    projectFilesRoot: path.join(documentsPathForChannel, "项目"),
    workspacePath: path.join(documentsPathForChannel, "项目记录"),
    agentsRoot: path.join(userDataPath, "agents"),
    recoveryJournalPath: path.join(userDataPath, "recovery-journals-v1"),
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
