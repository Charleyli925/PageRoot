import { createHash, randomBytes } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
} from "node:fs/promises";
import path from "node:path";

const CACHE_SCHEMA_VERSION = 1;
const CACHE_DIRECTORY_NAME = "edit-runtime-library-cache";
const INDEX_FILE_NAME = "index.json";
const DEFAULT_MAX_ENTRIES = 32;
const DEFAULT_MAX_BYTES = 128 * 1024 * 1024;
const DEFAULT_MAX_LIBRARY_BYTES = 3 * 1024 * 1024;
const SHA256 = /^[a-f0-9]{64}$/u;
const EXACT_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;

const defaultFileSystem = Object.freeze({
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
});

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function canonicalUrl(value) {
  const url = new URL(String(value || ""));
  url.hash = "";
  return url;
}

/**
 * Classifies only immutable, exact-version ECharts core distribution URLs.
 * Query parameters remain part of the cache identity; fragments do not.
 */
export function classifyExactImmutableEchartsUrl(value) {
  try {
    const url = canonicalUrl(value);
    if (
      url.protocol !== "https:"
      || url.username
      || url.password
      || url.port
    ) return null;
    const host = url.hostname.toLowerCase();
    const patterns = host === "cdnjs.cloudflare.com"
      ? [{ provider: "cdnjs", expression: /^\/ajax\/libs\/echarts\/([^/]+)\/(echarts(?:\.min)?\.js)$/u }]
      : host === "cdn.jsdelivr.net"
        ? [{ provider: "jsdelivr", expression: /^\/npm\/echarts@([^/]+)\/dist\/(echarts(?:\.min)?\.js)$/u }]
        : host === "unpkg.com"
          ? [{ provider: "unpkg", expression: /^\/echarts@([^/]+)\/dist\/(echarts(?:\.min)?\.js)$/u }]
          : [];
    for (const { provider, expression } of patterns) {
      const match = url.pathname.match(expression);
      if (!match || !EXACT_VERSION.test(match[1])) continue;
      return Object.freeze({
        url: url.href,
        provider,
        version: match[1],
        fileName: match[2],
      });
    }
    return null;
  } catch {
    return null;
  }
}

function validIndexEntry(value, maxLibraryBytes) {
  const classification = classifyExactImmutableEchartsUrl(value?.url);
  return Boolean(classification)
    && classification.url === value.url
    && SHA256.test(String(value.sha256 || ""))
    && Number.isSafeInteger(value.byteLength)
    && value.byteLength > 0
    && value.byteLength <= maxLibraryBytes
    && Number.isFinite(value.lastUsedAt);
}

function emptyIndex() {
  return { schemaVersion: CACHE_SCHEMA_VERSION, entries: [] };
}

async function readIndex(indexPath, fileSystem, maxLibraryBytes) {
  try {
    const parsed = JSON.parse(await fileSystem.readFile(indexPath, "utf8"));
    if (parsed?.schemaVersion !== CACHE_SCHEMA_VERSION || !Array.isArray(parsed.entries)) {
      return emptyIndex();
    }
    const urls = new Set();
    return {
      schemaVersion: CACHE_SCHEMA_VERSION,
      entries: parsed.entries.filter((entry) => {
        if (!validIndexEntry(entry, maxLibraryBytes) || urls.has(entry.url)) return false;
        urls.add(entry.url);
        return true;
      }),
    };
  } catch {
    return emptyIndex();
  }
}

async function syncDirectory(directoryPath, fileSystem) {
  const directory = await fileSystem.open(directoryPath, "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

async function atomicWrite(filePath, value, mode, fileSystem) {
  const directoryPath = path.dirname(filePath);
  const temporaryPath = path.join(
    directoryPath,
    `.${path.basename(filePath)}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`,
  );
  let temporaryHandle = null;
  let renamed = false;
  try {
    temporaryHandle = await fileSystem.open(temporaryPath, "wx", mode);
    await temporaryHandle.writeFile(value);
    await temporaryHandle.sync();
    await temporaryHandle.close();
    temporaryHandle = null;
    await fileSystem.rename(temporaryPath, filePath);
    renamed = true;
    await syncDirectory(directoryPath, fileSystem);
  } finally {
    if (temporaryHandle) await temporaryHandle.close().catch(() => undefined);
    if (!renamed) await fileSystem.unlink(temporaryPath).catch(() => undefined);
  }
}

async function verifiedBytes(filePath, expectedSha, expectedLength, fileSystem) {
  try {
    const information = await fileSystem.stat(filePath);
    if (!information.isFile() || information.size !== expectedLength) return null;
    const bytes = Buffer.from(await fileSystem.readFile(filePath));
    return sha256(bytes) === expectedSha ? bytes : null;
  } catch {
    return null;
  }
}

async function reconcileBlobs(blobsPath, index, fileSystem) {
  const referenced = new Set(index.entries.map((entry) => `${entry.sha256}.js`));
  const entries = await fileSystem.readdir(blobsPath, { withFileTypes: true }).catch(() => []);
  const stale = entries.filter((entry) => (
    entry.isFile()
    && (
      entry.name.endsWith(".tmp")
      || (/^[a-f0-9]{64}\.js$/u.test(entry.name) && !referenced.has(entry.name))
    )
  )).slice(0, 128);
  await Promise.all(stale.map((entry) => (
    fileSystem.unlink(path.join(blobsPath, entry.name)).catch(() => undefined)
  )));
}

function retainedByLru(entries, maxEntries, maxBytes) {
  const sorted = [...entries].sort((left, right) => right.lastUsedAt - left.lastUsedAt);
  const retained = [];
  const retainedDigests = new Set();
  let retainedBytes = 0;
  for (const entry of sorted) {
    const additionalBytes = retainedDigests.has(entry.sha256) ? 0 : entry.byteLength;
    if (retained.length >= maxEntries || retainedBytes + additionalBytes > maxBytes) continue;
    retained.push(entry);
    retainedDigests.add(entry.sha256);
    retainedBytes += additionalBytes;
  }
  return retained;
}

/**
 * Owns only immutable CDN script bytes. Sessions, source identity, compatible
 * variants and execution identities remain outside this store.
 */
export function createEditRuntimeLibraryStore({
  userDataPath,
  now = () => Date.now(),
  maxEntries = DEFAULT_MAX_ENTRIES,
  maxBytes = DEFAULT_MAX_BYTES,
  maxLibraryBytes = DEFAULT_MAX_LIBRARY_BYTES,
  fileSystem: fileSystemOverrides = {},
} = {}) {
  if (!userDataPath) {
    throw new TypeError("Edit runtime library store requires a userData path.");
  }
  const boundedMaxEntries = Math.max(1, Math.floor(Number(maxEntries)) || DEFAULT_MAX_ENTRIES);
  const boundedMaxBytes = Math.max(1, Math.floor(Number(maxBytes)) || DEFAULT_MAX_BYTES);
  const boundedMaxLibraryBytes = Math.max(
    1,
    Math.floor(Number(maxLibraryBytes)) || DEFAULT_MAX_LIBRARY_BYTES,
  );
  const fileSystem = Object.freeze({ ...defaultFileSystem, ...fileSystemOverrides });
  const rootPath = path.join(userDataPath, CACHE_DIRECTORY_NAME, `v${CACHE_SCHEMA_VERSION}`);
  const blobsPath = path.join(rootPath, "blobs");
  const indexPath = path.join(rootPath, INDEX_FILE_NAME);
  const inFlight = new Map();
  let indexSerial = Promise.resolve();
  let lastUsedAt = 0;

  const nextLastUsedAt = () => {
    const current = Number(now());
    lastUsedAt = Math.max(Number.isFinite(current) ? current : 0, lastUsedAt + 1);
    return lastUsedAt;
  };

  const withIndex = (operation) => {
    const next = indexSerial.then(operation, operation);
    indexSerial = next.catch(() => undefined);
    return next;
  };

  const ensureDirectories = async () => {
    await fileSystem.mkdir(blobsPath, { recursive: true, mode: 0o700 });
  };

  const writeIndex = (index) => atomicWrite(
    indexPath,
    `${JSON.stringify(index)}\n`,
    0o600,
    fileSystem,
  );

  const get = async (value) => {
    const classification = classifyExactImmutableEchartsUrl(value);
    if (!classification) return null;
    return withIndex(async () => {
      try {
        await ensureDirectories();
        const index = await readIndex(indexPath, fileSystem, boundedMaxLibraryBytes);
        await reconcileBlobs(blobsPath, index, fileSystem);
        const entry = index.entries.find((candidate) => candidate.url === classification.url);
        if (!entry) return null;
        const blobPath = path.join(blobsPath, `${entry.sha256}.js`);
        const bytes = await verifiedBytes(
          blobPath,
          entry.sha256,
          entry.byteLength,
          fileSystem,
        );
        if (!bytes) {
          index.entries = index.entries.filter((candidate) => candidate !== entry);
          await writeIndex(index).catch(() => undefined);
          await fileSystem.unlink(blobPath).catch(() => undefined);
          return null;
        }
        entry.lastUsedAt = nextLastUsedAt();
        await writeIndex(index).catch(() => undefined);
        return Object.freeze({
          bytes,
          origin: "disk-cache",
          sha256: entry.sha256,
          url: classification.url,
        });
      } catch {
        return null;
      }
    });
  };

  const persist = (classification, bytes) => withIndex(async () => {
    await ensureDirectories();
    const digest = sha256(bytes);
    const blobPath = path.join(blobsPath, `${digest}.js`);
    const existing = await verifiedBytes(blobPath, digest, bytes.byteLength, fileSystem);
    if (!existing) await atomicWrite(blobPath, bytes, 0o600, fileSystem);

    const index = await readIndex(indexPath, fileSystem, boundedMaxLibraryBytes);
    const candidateEntries = index.entries.filter((entry) => entry.url !== classification.url);
    candidateEntries.push({
      url: classification.url,
      sha256: digest,
      byteLength: bytes.byteLength,
      lastUsedAt: nextLastUsedAt(),
    });
    const retainedEntries = retainedByLru(
      candidateEntries,
      boundedMaxEntries,
      boundedMaxBytes,
    );
    await writeIndex({ schemaVersion: CACHE_SCHEMA_VERSION, entries: retainedEntries });

    const retainedDigests = new Set(retainedEntries.map((entry) => entry.sha256));
    const removedDigests = new Set(
      candidateEntries
        .map((entry) => entry.sha256)
        .filter((candidate) => !retainedDigests.has(candidate)),
    );
    await Promise.all([...removedDigests].map((candidate) => (
      fileSystem.unlink(path.join(blobsPath, `${candidate}.js`)).catch(() => undefined)
    )));
    await reconcileBlobs(
      blobsPath,
      { schemaVersion: CACHE_SCHEMA_VERSION, entries: retainedEntries },
      fileSystem,
    );
  });

  const load = async (value, fetchRemote) => {
    const classification = classifyExactImmutableEchartsUrl(value);
    if (!classification) {
      throw new TypeError("Edit runtime library URL is not exact and immutable.");
    }
    const cached = await get(classification.url);
    if (cached) return cached;
    if (typeof fetchRemote !== "function") {
      throw new TypeError("Edit runtime library store requires a remote loader.");
    }
    if (inFlight.has(classification.url)) return inFlight.get(classification.url);
    const loading = Promise.resolve()
      .then(() => fetchRemote(classification.url))
      .then(async (valueFromNetwork) => {
        const bytes = Buffer.from(valueFromNetwork || []);
        if (bytes.byteLength < 1 || bytes.byteLength > boundedMaxLibraryBytes) {
          throw new TypeError("Edit runtime library bytes are invalid.");
        }
        const digest = sha256(bytes);
        await persist(classification, bytes).catch(() => undefined);
        return Object.freeze({
          bytes,
          origin: "network",
          sha256: digest,
          url: classification.url,
        });
      })
      .finally(() => inFlight.delete(classification.url));
    inFlight.set(classification.url, loading);
    return loading;
  };

  return Object.freeze({
    get,
    load,
    paths: Object.freeze({ rootPath, blobsPath, indexPath }),
  });
}
