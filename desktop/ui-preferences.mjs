import {
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";

export const UI_PREFERENCES_FILE_NAME = "ui-preferences.json";
export const UI_PREFERENCES_SCHEMA_VERSION = 2;
export const FIRST_REAL_HTML_EDIT_GUIDE_KEY = "first-real-html-edit-guide";
export const FIRST_REAL_HTML_EDIT_GUIDE_GENERATION = 2;

export const WORKSPACE_PREFERENCE_DEFAULTS = Object.freeze({
  rememberPanelWidths: true,
  sidebarWidth: 264,
  inspectorWidth: 376,
  motion: "system",
  restoreTabsOnLaunch: true,
  defaultAgentProviderId: "qoder",
});
export const WORKSPACE_PREFERENCE_LIMITS = Object.freeze({
  sidebarWidth: Object.freeze({ min: 200, max: 420 }),
  inspectorWidth: Object.freeze({ min: 280, max: 520 }),
});

const MAX_STATE_BYTES = 16 * 1024;
const PROJECT_ID_PATTERN = /^project_[A-Za-z0-9_-]{1,180}$/u;
const GUIDE_STATUSES = new Set(["pending", "presented", "dismissed"]);
const GUIDE_ACTIONS = new Set(["presented", "dismissed"]);
const MOTION_VALUES = new Set(["system", "reduced"]);
const AGENT_PROVIDER_IDS = new Set(["qoder", "codex"]);
const WORKSPACE_KEYS = new Set(Object.keys(WORKSPACE_PREFERENCE_DEFAULTS));

// Main owns the only durable preference writer. Keeping writes in one queue is
// important because the first-edit guide and the Settings page share a JSON
// document and must never overwrite one another from concurrent read-modify-
// write operations.
let writeTail = Promise.resolve();

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function emptyGuide(generation = FIRST_REAL_HTML_EDIT_GUIDE_GENERATION) {
  return Object.freeze({
    key: FIRST_REAL_HTML_EDIT_GUIDE_KEY,
    generation,
    status: "pending",
    presentedAt: null,
    dismissedAt: null,
  });
}

function emptyWorkspacePreferences() {
  return Object.freeze({ ...WORKSPACE_PREFERENCE_DEFAULTS });
}

function emptyPreferences() {
  return Object.freeze({
    schemaVersion: UI_PREFERENCES_SCHEMA_VERSION,
    firstRealHtmlEditGuide: emptyGuide(),
    builtInWelcomeProjectId: null,
    workspace: emptyWorkspacePreferences(),
  });
}

function isoNow() {
  return new Date().toISOString();
}

function normalizedProjectId(value) {
  if (typeof value !== "string" || !PROJECT_ID_PATTERN.test(value)) return null;
  return value;
}

function normalizedWidth(value, fallback, { min, max }) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.round(Math.min(max, Math.max(min, value)) * 10) / 10;
}

function normalizedAgentProviderId(value) {
  return AGENT_PROVIDER_IDS.has(value)
    ? value
    : WORKSPACE_PREFERENCE_DEFAULTS.defaultAgentProviderId;
}

function normalizedGuide(value, fallbackGeneration) {
  if (!isRecord(value)) return emptyGuide(fallbackGeneration);
  const generation = Number.isSafeInteger(value.generation) && value.generation >= 1
    ? value.generation
    : fallbackGeneration;
  if (generation !== fallbackGeneration) return emptyGuide(fallbackGeneration);
  const status = GUIDE_STATUSES.has(value.status) ? value.status : "pending";
  return Object.freeze({
    key: FIRST_REAL_HTML_EDIT_GUIDE_KEY,
    generation,
    status,
    presentedAt: typeof value.presentedAt === "string" ? value.presentedAt : null,
    dismissedAt: typeof value.dismissedAt === "string" ? value.dismissedAt : null,
  });
}

export function normalizeWorkspacePreferences(value) {
  const source = isRecord(value) ? value : {};
  return Object.freeze({
    rememberPanelWidths: typeof source.rememberPanelWidths === "boolean"
      ? source.rememberPanelWidths
      : WORKSPACE_PREFERENCE_DEFAULTS.rememberPanelWidths,
    sidebarWidth: normalizedWidth(
      source.sidebarWidth,
      WORKSPACE_PREFERENCE_DEFAULTS.sidebarWidth,
      WORKSPACE_PREFERENCE_LIMITS.sidebarWidth,
    ),
    inspectorWidth: normalizedWidth(
      source.inspectorWidth,
      WORKSPACE_PREFERENCE_DEFAULTS.inspectorWidth,
      WORKSPACE_PREFERENCE_LIMITS.inspectorWidth,
    ),
    motion: MOTION_VALUES.has(source.motion)
      ? source.motion
      : WORKSPACE_PREFERENCE_DEFAULTS.motion,
    restoreTabsOnLaunch: typeof source.restoreTabsOnLaunch === "boolean"
      ? source.restoreTabsOnLaunch
      : WORKSPACE_PREFERENCE_DEFAULTS.restoreTabsOnLaunch,
    defaultAgentProviderId: normalizedAgentProviderId(source.defaultAgentProviderId),
  });
}

export function normalizeWorkspacePatch(value) {
  if (!isRecord(value) || !Object.keys(value).length) {
    throw new TypeError("工作台偏好不能为空。");
  }
  const keys = Object.keys(value);
  if (keys.some((key) => !WORKSPACE_KEYS.has(key))) {
    throw new TypeError("工作台偏好包含未知字段。");
  }
  const normalized = {};
  for (const key of keys) {
    const next = value[key];
    if (key === "rememberPanelWidths" || key === "restoreTabsOnLaunch") {
      if (typeof next !== "boolean") throw new TypeError(`${key} 必须是布尔值。`);
      normalized[key] = next;
      continue;
    }
    if (key === "motion") {
      if (!MOTION_VALUES.has(next)) throw new TypeError("动态效果选项无效。");
      normalized[key] = next;
      continue;
    }
    if (key === "defaultAgentProviderId") {
      if (!AGENT_PROVIDER_IDS.has(next)) throw new TypeError("默认 Agent 无效。");
      normalized[key] = next;
      continue;
    }
    const limits = WORKSPACE_PREFERENCE_LIMITS[key];
    if (
      typeof next !== "number"
      || !Number.isFinite(next)
      || next < limits.min
      || next > limits.max
    ) throw new TypeError(`${key} 超出允许范围。`);
    normalized[key] = Math.round(next * 10) / 10;
  }
  return Object.freeze(normalized);
}

function freezePreferences(value, generation = FIRST_REAL_HTML_EDIT_GUIDE_GENERATION) {
  return Object.freeze({
    schemaVersion: UI_PREFERENCES_SCHEMA_VERSION,
    firstRealHtmlEditGuide: normalizedGuide(
      value?.firstRealHtmlEditGuide,
      generation,
    ),
    builtInWelcomeProjectId: normalizedProjectId(value?.builtInWelcomeProjectId),
    workspace: normalizeWorkspacePreferences(value?.workspace),
  });
}

function preferencesPath(userDataPath) {
  if (typeof userDataPath !== "string" || !path.isAbsolute(userDataPath)) {
    throw new TypeError("UI preferences require an absolute userData path.");
  }
  return path.join(userDataPath, UI_PREFERENCES_FILE_NAME);
}

async function atomicWrite(filePath, payload) {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${filePath}.${randomBytes(8).toString("hex")}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryPath, filePath);
  } catch (cause) {
    await unlink(temporaryPath).catch(() => {});
    throw cause;
  }
}

export function decodeUiPreferences(
  raw,
  { generation = FIRST_REAL_HTML_EDIT_GUIDE_GENERATION } = {},
) {
  if (raw == null) return emptyPreferences();
  let parsed;
  try {
    parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return emptyPreferences();
  }
  if (!isRecord(parsed)) return emptyPreferences();
  if (parsed.schemaVersion === 1 || parsed.schemaVersion === UI_PREFERENCES_SCHEMA_VERSION) {
    return freezePreferences({
      ...parsed,
      firstRealHtmlEditGuide: normalizedGuide(parsed.firstRealHtmlEditGuide, generation),
    }, generation);
  }
  return emptyPreferences();
}

async function readUiPreferencesFile({ userDataPath, generation }) {
  const filePath = preferencesPath(userDataPath);
  let raw;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { preferences: emptyPreferences(), legacy: false };
    }
    return { preferences: emptyPreferences(), legacy: false };
  }
  if (Buffer.byteLength(raw, "utf8") > MAX_STATE_BYTES) {
    return { preferences: emptyPreferences(), legacy: false };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { preferences: emptyPreferences(), legacy: false };
  }
  return {
    preferences: decodeUiPreferences(parsed, { generation }),
    legacy: isRecord(parsed) && parsed.schemaVersion === 1,
  };
}

export async function readUiPreferences({
  userDataPath,
  generation = FIRST_REAL_HTML_EDIT_GUIDE_GENERATION,
  persistMigration = true,
} = {}) {
  const loaded = await readUiPreferencesFile({ userDataPath, generation });
  if (loaded.legacy && persistMigration) {
    try {
      await enqueueWrite(async () => {
        const latest = await readUiPreferencesFile({ userDataPath, generation });
        if (!latest.legacy) return latest.preferences;
        await atomicWrite(preferencesPath(userDataPath), latest.preferences);
        return latest.preferences;
      });
    } catch {
      // The normalized v2 snapshot remains usable even if migration cannot be
      // persisted. The next successful preference write retries the upgrade.
    }
  }
  return loaded.preferences;
}

async function writeUiPreferences(userDataPath, next) {
  const frozen = freezePreferences(next);
  await atomicWrite(preferencesPath(userDataPath), frozen);
  return frozen;
}

function enqueueWrite(task) {
  const next = writeTail.then(task, task);
  writeTail = next.catch(() => {});
  return next;
}

async function updateUiPreferences(userDataPath, update) {
  return enqueueWrite(async () => {
    const current = await readUiPreferences({
      userDataPath,
      persistMigration: false,
    });
    const next = update(current);
    return next === current ? current : writeUiPreferences(userDataPath, next);
  });
}

export async function recordFirstEditGuide({
  userDataPath,
  action,
  generation = FIRST_REAL_HTML_EDIT_GUIDE_GENERATION,
} = {}) {
  if (!GUIDE_ACTIONS.has(action)) {
    throw new TypeError("First-edit guide action must be presented or dismissed.");
  }
  return updateUiPreferences(userDataPath, (current) => {
    const guide = current.firstRealHtmlEditGuide;
    if (guide.status === "dismissed") return current;
    if (action === "presented" && guide.status !== "pending") return current;
    const at = isoNow();
    return {
      ...current,
      firstRealHtmlEditGuide: {
        ...guide,
        generation,
        status: action,
        presentedAt: action === "presented" ? at : guide.presentedAt || at,
        dismissedAt: action === "dismissed" ? at : guide.dismissedAt,
      },
    };
  });
}

export async function rememberBuiltInWelcomeProjectId({
  userDataPath,
  projectId,
} = {}) {
  const nextProjectId = normalizedProjectId(projectId);
  if (!nextProjectId) {
    throw new TypeError("Built-in welcome projectId is invalid.");
  }
  return updateUiPreferences(userDataPath, (current) => (
    current.builtInWelcomeProjectId === nextProjectId
      ? current
      : {
        ...current,
        builtInWelcomeProjectId: nextProjectId,
      }
  ));
}

export async function recordUiWorkspacePreferences({
  userDataPath,
  workspace,
} = {}) {
  const patch = normalizeWorkspacePatch(workspace);
  return updateUiPreferences(userDataPath, (current) => ({
    ...current,
    workspace: {
      ...current.workspace,
      ...patch,
    },
  }));
}
