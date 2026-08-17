import {
  mkdir,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";

export const UI_PREFERENCES_FILE_NAME = "ui-preferences.json";
export const UI_PREFERENCES_SCHEMA_VERSION = 1;
export const FIRST_REAL_HTML_EDIT_GUIDE_KEY = "first-real-html-edit-guide";
export const FIRST_REAL_HTML_EDIT_GUIDE_GENERATION = 2;

const MAX_STATE_BYTES = 16 * 1024;
const PROJECT_ID_PATTERN = /^project_[A-Za-z0-9_-]{1,180}$/u;
const GUIDE_STATUSES = new Set(["pending", "presented", "dismissed"]);
const GUIDE_ACTIONS = new Set(["presented", "dismissed"]);

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

function emptyPreferences() {
  return Object.freeze({
    schemaVersion: UI_PREFERENCES_SCHEMA_VERSION,
    firstRealHtmlEditGuide: emptyGuide(),
    builtInWelcomeProjectId: null,
  });
}

function isoNow() {
  return new Date().toISOString();
}

function normalizedProjectId(value) {
  if (typeof value !== "string" || !PROJECT_ID_PATTERN.test(value)) return null;
  return value;
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

function freezePreferences(value) {
  return Object.freeze({
    schemaVersion: UI_PREFERENCES_SCHEMA_VERSION,
    firstRealHtmlEditGuide: normalizedGuide(
      value?.firstRealHtmlEditGuide,
      FIRST_REAL_HTML_EDIT_GUIDE_GENERATION,
    ),
    builtInWelcomeProjectId: normalizedProjectId(value?.builtInWelcomeProjectId),
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
  await writeFile(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporaryPath, filePath);
}

export function decodeUiPreferences(raw, { generation = FIRST_REAL_HTML_EDIT_GUIDE_GENERATION } = {}) {
  if (raw == null) return emptyPreferences();
  let parsed;
  try {
    parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return emptyPreferences();
  }
  if (!isRecord(parsed) || parsed.schemaVersion !== UI_PREFERENCES_SCHEMA_VERSION) {
    return emptyPreferences();
  }
  return freezePreferences({
    ...parsed,
    firstRealHtmlEditGuide: normalizedGuide(parsed.firstRealHtmlEditGuide, generation),
  });
}

export async function readUiPreferences({
  userDataPath,
  generation = FIRST_REAL_HTML_EDIT_GUIDE_GENERATION,
} = {}) {
  const filePath = preferencesPath(userDataPath);
  let raw;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return emptyPreferences();
    return emptyPreferences();
  }
  if (Buffer.byteLength(raw, "utf8") > MAX_STATE_BYTES) return emptyPreferences();
  return decodeUiPreferences(raw, { generation });
}

async function writeUiPreferences(userDataPath, next) {
  const frozen = freezePreferences(next);
  await atomicWrite(preferencesPath(userDataPath), frozen);
  return frozen;
}

export async function recordFirstEditGuide({
  userDataPath,
  action,
  generation = FIRST_REAL_HTML_EDIT_GUIDE_GENERATION,
} = {}) {
  if (!GUIDE_ACTIONS.has(action)) {
    throw new TypeError("First-edit guide action must be presented or dismissed.");
  }
  const current = await readUiPreferences({ userDataPath, generation });
  const guide = current.firstRealHtmlEditGuide;
  if (guide.status === "dismissed") return current;
  if (action === "presented" && guide.status !== "pending") return current;
  const at = isoNow();
  return writeUiPreferences(userDataPath, {
    ...current,
    firstRealHtmlEditGuide: {
      ...guide,
      generation,
      status: action,
      presentedAt: action === "presented" ? at : guide.presentedAt || at,
      dismissedAt: action === "dismissed" ? at : guide.dismissedAt,
    },
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
  const current = await readUiPreferences({ userDataPath });
  if (current.builtInWelcomeProjectId === nextProjectId) return current;
  return writeUiPreferences(userDataPath, {
    ...current,
    builtInWelcomeProjectId: nextProjectId,
  });
}
