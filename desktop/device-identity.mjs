import {
  mkdir,
  readFile,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";

// The device identity is the custodian half of record provenance. It lives in
// Application Support, never in the managed projects directory: that directory
// sits under ~/Documents and can be synchronised by iCloud, which would clone
// one device identity onto several machines.
//
// This module is deliberately self-contained. `shared/provenance.mjs` holds the
// canonical pattern, but it ships through electron-builder `extraResources`
// into Resources/shared, while this file is packaged inside the asar through
// `build.files`. A relative import across that boundary resolves in development
// and fails only in the packaged application, so the pattern is restated here
// and `tests/record-provenance.test.mjs` pins the two copies together.
export const DEVICE_IDENTITY_FILE_NAME = "device-identity.json";
export const DEVICE_IDENTITY_STATE_VERSION = 1;

const MAX_STATE_BYTES = 64 * 1024;
const DEVICE_ID_PATTERN =
  /^device_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function identityPath(userDataPath) {
  if (typeof userDataPath !== "string" || !path.isAbsolute(userDataPath)) {
    throw new TypeError("Device identity requires an absolute userData path.");
  }
  return path.join(userDataPath, DEVICE_IDENTITY_FILE_NAME);
}

function newDeviceIdentity(createUuid, now) {
  return {
    version: DEVICE_IDENTITY_STATE_VERSION,
    deviceId: `device_${createUuid()}`,
    createdAt: new Date(now()).toISOString(),
  };
}

function validDeviceIdentity(value) {
  return Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value)
    && value.version === DEVICE_IDENTITY_STATE_VERSION
    && typeof value.deviceId === "string"
    && DEVICE_ID_PATTERN.test(value.deviceId)
    && typeof value.createdAt === "string"
    && Number.isFinite(Date.parse(value.createdAt));
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

async function loadDeviceIdentity(filePath) {
  try {
    const information = await stat(filePath);
    if (!information.isFile() || information.size > MAX_STATE_BYTES) return null;
    const parsed = JSON.parse(await readFile(filePath, "utf8"));
    return validDeviceIdentity(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// A device that cannot persist its identity still has to attribute the records
// it writes, so a transient identity is returned rather than failing the
// launch. It is reported as unpersisted so the caller can decide what to log.
export async function readOrCreateDeviceIdentity({
  userDataPath,
  createUuid = randomUUID,
  now = () => Date.now(),
} = {}) {
  const filePath = identityPath(userDataPath);
  const existing = await loadDeviceIdentity(filePath);
  if (existing) {
    return { deviceId: existing.deviceId, createdAt: existing.createdAt, created: false, persisted: true };
  }
  const created = newDeviceIdentity(createUuid, now);
  if (!validDeviceIdentity(created)) {
    throw new TypeError("Device identity requires a version 4 UUID generator.");
  }
  try {
    await atomicWrite(filePath, created);
  } catch {
    return { deviceId: created.deviceId, createdAt: created.createdAt, created: true, persisted: false };
  }
  return { deviceId: created.deviceId, createdAt: created.createdAt, created: true, persisted: true };
}
