import {
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { normalizeAgentConfigurations, validAgentConfigurations, normalizeDocumentAgentSelections, validDocumentAgentSelections } from "../shared/agent-configuration-preferences.mjs";

export const UI_PREFERENCES_FILE_NAME = "ui-preferences.json";
export const UI_PREFERENCES_SCHEMA_VERSION = 2;

export const WORKSPACE_PREFERENCE_DEFAULTS = Object.freeze({
  rememberPanelWidths: true,
  sidebarWidth: 264,
  inspectorWidth: 376,
  motion: "system",
  restoreTabsOnLaunch: true,
  reviewChangeContextVisibility: 25,
  reviewCommentContextVisibility: 15,
  defaultAgentProviderId: "qoder",
  agentConfigurations: Object.freeze({}),
  documentAgentSelections: Object.freeze({}),
  disabledAgentProviderIds: Object.freeze([]),
});
export const WORKSPACE_PREFERENCE_LIMITS = Object.freeze({
  sidebarWidth: Object.freeze({ min: 200, max: 420 }),
  inspectorWidth: Object.freeze({ min: 280, max: 520 }),
  reviewChangeContextVisibility: Object.freeze({ min: 0, max: 100 }),
  reviewCommentContextVisibility: Object.freeze({ min: 0, max: 100 }),
});

const MAX_STATE_BYTES = 16 * 1024;
const MOTION_VALUES = new Set(["system", "reduced"]);
const AGENT_PROVIDER_IDS = new Set(["pageroot", "qoder", "codex"]);
const WORKSPACE_KEYS = new Set(Object.keys(WORKSPACE_PREFERENCE_DEFAULTS));

// Main owns the only durable preference writer so Settings and Agent updates
// cannot overwrite one another from concurrent read-modify-write operations.
let writeTail = Promise.resolve();

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function emptyWorkspacePreferences() {
  return Object.freeze({ ...WORKSPACE_PREFERENCE_DEFAULTS });
}

function emptyPreferences() {
  return Object.freeze({
    schemaVersion: UI_PREFERENCES_SCHEMA_VERSION,
    workspace: emptyWorkspacePreferences(),
  });
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

function normalizedDisabledAgentProviderIds(value) {
  if (!Array.isArray(value)) return Object.freeze([]);
  const ids = [];
  const seen = new Set();
  for (const item of value) {
    if (!AGENT_PROVIDER_IDS.has(item) || seen.has(item)) continue;
    seen.add(item);
    ids.push(item);
  }
  return Object.freeze(ids);
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
    reviewChangeContextVisibility: normalizedWidth(
      source.reviewChangeContextVisibility,
      WORKSPACE_PREFERENCE_DEFAULTS.reviewChangeContextVisibility,
      WORKSPACE_PREFERENCE_LIMITS.reviewChangeContextVisibility,
    ),
    reviewCommentContextVisibility: normalizedWidth(
      source.reviewCommentContextVisibility,
      WORKSPACE_PREFERENCE_DEFAULTS.reviewCommentContextVisibility,
      WORKSPACE_PREFERENCE_LIMITS.reviewCommentContextVisibility,
    ),
    defaultAgentProviderId: normalizedAgentProviderId(source.defaultAgentProviderId),
    disabledAgentProviderIds: normalizedDisabledAgentProviderIds(source.disabledAgentProviderIds),
    agentConfigurations: normalizeAgentConfigurations(source.agentConfigurations),
    documentAgentSelections: normalizeDocumentAgentSelections(source.documentAgentSelections),
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
    if (key === "documentAgentSelections") {
      if (!validDocumentAgentSelections(next)) throw new TypeError("文档服务选择无效或已达到数量上限。");
      normalized[key] = normalizeDocumentAgentSelections(next);
      continue;
    }
    if (key === "agentConfigurations") {
      if (!validAgentConfigurations(next)) throw new TypeError("服务配置无效。");
      normalized[key] = normalizeAgentConfigurations(next);
      continue;
    }
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
    if (key === "disabledAgentProviderIds") {
      if (!Array.isArray(next) || next.some((id) => !AGENT_PROVIDER_IDS.has(id))) {
        throw new TypeError("停用的 AI 服务无效。");
      }
      normalized[key] = normalizedDisabledAgentProviderIds(next);
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

function freezePreferences(value) {
  return Object.freeze({
    schemaVersion: UI_PREFERENCES_SCHEMA_VERSION,
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

export function decodeUiPreferences(raw) {
  if (raw == null) return emptyPreferences();
  let parsed;
  try {
    parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return emptyPreferences();
  }
  if (!isRecord(parsed)) return emptyPreferences();
  if (parsed.schemaVersion === 1 || parsed.schemaVersion === UI_PREFERENCES_SCHEMA_VERSION) {
    return freezePreferences(parsed);
  }
  return emptyPreferences();
}

async function readUiPreferencesFile({ userDataPath }) {
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
    preferences: decodeUiPreferences(parsed),
    legacy: isRecord(parsed) && parsed.schemaVersion === 1,
  };
}

export async function readUiPreferences({
  userDataPath,
  persistMigration = true,
} = {}) {
  const loaded = await readUiPreferencesFile({ userDataPath });
  if (loaded.legacy && persistMigration) {
    try {
      await enqueueWrite(async () => {
        const latest = await readUiPreferencesFile({ userDataPath });
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
