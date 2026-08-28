import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

const CACHE_SCHEMA_VERSION = 1;
const CACHE_DIRECTORY_NAME = "edit-runtime-library-cache";
const INDEX_FILE_NAME = "index.json";
const MAX_CACHE_BYTES = 128 * 1024 * 1024;
const MIN_RETAINED_LIBRARIES = 10;
const MAX_LIBRARY_BYTES = 3 * 1024 * 1024;
const SHA256 = /^[a-f0-9]{64}$/u;

export const BUNDLED_ECHARTS_VERSION = "5.5.0";
export const BUNDLED_ECHARTS_SHA256 =
  "42f8329d989b6f6539dd2b15bbdf0d82025762ac112fbb60dc57b27d7bcf3946";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function normalizedUrl(value) {
  const url = new URL(String(value || ""));
  url.hash = "";
  return url.href;
}

export function isBundledEchartsUrl(value) {
  try {
    const url = new URL(String(value || ""));
    const host = url.hostname.toLowerCase();
    const pathname = url.pathname.toLowerCase();
    if (host === "cdnjs.cloudflare.com") {
      return pathname === `/ajax/libs/echarts/${BUNDLED_ECHARTS_VERSION}/echarts.min.js`;
    }
    if (host === "cdn.jsdelivr.net") {
      return pathname === `/npm/echarts@${BUNDLED_ECHARTS_VERSION}/dist/echarts.min.js`;
    }
    if (host === "unpkg.com") {
      return pathname === `/echarts@${BUNDLED_ECHARTS_VERSION}/dist/echarts.min.js`;
    }
    return false;
  } catch {
    return false;
  }
}

function validIndexEntry(value) {
  return Boolean(value)
    && typeof value === "object"
    && typeof value.url === "string"
    && SHA256.test(String(value.sha256 || ""))
    && Number.isSafeInteger(value.byteLength)
    && value.byteLength > 0
    && value.byteLength <= MAX_LIBRARY_BYTES
    && Number.isFinite(value.lastUsedAt);
}

function emptyIndex() {
  return { schemaVersion: CACHE_SCHEMA_VERSION, entries: [] };
}

async function readIndex(indexPath) {
  try {
    const parsed = JSON.parse(await readFile(indexPath, "utf8"));
    if (parsed?.schemaVersion !== CACHE_SCHEMA_VERSION || !Array.isArray(parsed.entries)) {
      return emptyIndex();
    }
    return {
      schemaVersion: CACHE_SCHEMA_VERSION,
      entries: parsed.entries.filter(validIndexEntry),
    };
  } catch {
    return emptyIndex();
  }
}

async function writeIndex(indexPath, index) {
  const temporaryPath = `${indexPath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(index)}\n`, { mode: 0o600 });
  await rename(temporaryPath, indexPath);
}

async function verifiedBytes(filePath, expectedSha, expectedLength) {
  try {
    const information = await stat(filePath);
    if (!information.isFile() || information.size !== expectedLength) return null;
    const bytes = Buffer.from(await readFile(filePath));
    return sha256(bytes) === expectedSha ? bytes : null;
  } catch {
    return null;
  }
}

/**
 * Owns immutable author-library bytes only. It does not own an Edit runtime
 * session, execution identity, source authority, or compatibility decision.
 */
export function createEditRuntimeLibraryStore({
  userDataPath,
  bundledEchartsPath,
  now = () => Date.now(),
  maxCacheBytes = MAX_CACHE_BYTES,
  minRetainedLibraries = MIN_RETAINED_LIBRARIES,
} = {}) {
  if (!userDataPath || !bundledEchartsPath) {
    throw new TypeError("Edit runtime library store requires cache and bundled paths.");
  }
  const rootPath = path.join(userDataPath, CACHE_DIRECTORY_NAME, `v${CACHE_SCHEMA_VERSION}`);
  const blobsPath = path.join(rootPath, "blobs");
  const indexPath = path.join(rootPath, INDEX_FILE_NAME);
  const inFlight = new Map();
  let indexSerial = Promise.resolve();

  const withIndex = (operation) => {
    const next = indexSerial.then(operation, operation);
    indexSerial = next.catch(() => undefined);
    return next;
  };

  const bundled = async () => {
    const bytes = Buffer.from(await readFile(bundledEchartsPath));
    if (
      bytes.byteLength < 1
      || bytes.byteLength > MAX_LIBRARY_BYTES
      || sha256(bytes) !== BUNDLED_ECHARTS_SHA256
    ) {
      throw new TypeError("Bundled ECharts bytes failed integrity verification.");
    }
    return Object.freeze({ bytes, origin: "bundled", sha256: BUNDLED_ECHARTS_SHA256 });
  };

  const prune = async (index) => {
    const sorted = [...index.entries].sort((left, right) => right.lastUsedAt - left.lastUsedAt);
    let totalBytes = sorted.reduce((sum, entry) => sum + entry.byteLength, 0);
    const retained = [];
    for (const entry of sorted) {
      if (retained.length < minRetainedLibraries || totalBytes <= maxCacheBytes) {
        retained.push(entry);
        continue;
      }
      totalBytes -= entry.byteLength;
      await unlink(path.join(blobsPath, `${entry.sha256}.js`)).catch(() => undefined);
    }
    return { schemaVersion: CACHE_SCHEMA_VERSION, entries: retained };
  };

  const loadCached = async (url) => withIndex(async () => {
    await mkdir(blobsPath, { recursive: true, mode: 0o700 });
    const index = await readIndex(indexPath);
    const entry = index.entries.find((candidate) => candidate.url === url);
    if (!entry) return null;
    const bytes = await verifiedBytes(
      path.join(blobsPath, `${entry.sha256}.js`),
      entry.sha256,
      entry.byteLength,
    );
    if (!bytes) {
      index.entries = index.entries.filter((candidate) => candidate !== entry);
      await writeIndex(indexPath, index);
      return null;
    }
    entry.lastUsedAt = now();
    await writeIndex(indexPath, index);
    return Object.freeze({ bytes, origin: "disk-cache", sha256: entry.sha256 });
  });

  const persist = async (url, bytes) => withIndex(async () => {
    await mkdir(blobsPath, { recursive: true, mode: 0o700 });
    const digest = sha256(bytes);
    const blobPath = path.join(blobsPath, `${digest}.js`);
    const existing = await verifiedBytes(blobPath, digest, bytes.byteLength);
    if (!existing) {
      const temporaryPath = `${blobPath}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(temporaryPath, bytes, { mode: 0o600 });
      await rename(temporaryPath, blobPath);
    }
    const index = await readIndex(indexPath);
    index.entries = index.entries.filter((entry) => entry.url !== url);
    index.entries.push({
      url,
      sha256: digest,
      byteLength: bytes.byteLength,
      lastUsedAt: now(),
    });
    const pruned = await prune(index);
    await writeIndex(indexPath, pruned);
    return Object.freeze({ bytes, origin: "network", sha256: digest });
  });

  const load = async (value, fetchRemote) => {
    const url = normalizedUrl(value);
    if (isBundledEchartsUrl(url)) return bundled();
    const cached = await loadCached(url);
    if (cached) return cached;
    if (typeof fetchRemote !== "function") {
      throw new TypeError("Edit runtime library store requires a remote loader.");
    }
    if (inFlight.has(url)) return inFlight.get(url);
    const loading = Promise.resolve()
      .then(fetchRemote)
      .then((value) => {
        const bytes = Buffer.from(value || []);
        if (bytes.byteLength < 1 || bytes.byteLength > MAX_LIBRARY_BYTES) {
          throw new TypeError("Edit runtime library bytes are invalid.");
        }
        return persist(url, bytes);
      })
      .finally(() => inFlight.delete(url));
    inFlight.set(url, loading);
    return loading;
  };

  return Object.freeze({
    load,
    paths: Object.freeze({ rootPath, blobsPath, indexPath, bundledEchartsPath }),
  });
}
