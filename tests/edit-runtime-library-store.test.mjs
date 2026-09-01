import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  classifyExactImmutableEchartsUrl,
  createEditRuntimeLibraryStore,
} from "../desktop/edit-runtime-library-store.mjs";

const URL_543 = "https://cdnjs.cloudflare.com/ajax/libs/echarts/5.4.3/echarts.min.js";
const URL_542 = "https://cdn.jsdelivr.net/npm/echarts@5.4.2/dist/echarts.min.js";
const URL_541 = "https://unpkg.com/echarts@5.4.1/dist/echarts.min.js";

test("exact immutable classifier canonicalizes fragments, retains queries, and rejects mutable paths", () => {
  assert.deepEqual(
    classifyExactImmutableEchartsUrl(`${URL_543}?build=core#ignored`),
    {
      url: `${URL_543}?build=core`,
      provider: "cdnjs",
      version: "5.4.3",
      fileName: "echarts.min.js",
    },
  );
  for (const value of [
    "https://cdn.jsdelivr.net/npm/echarts@latest/dist/echarts.min.js",
    "https://cdn.jsdelivr.net/npm/echarts@^5.4.0/dist/echarts.min.js",
    "https://unpkg.com/echarts@5.4.3/lib/echarts.min.js",
    "https://unpkg.com/echarts-gl@5.4.3/dist/echarts.min.js",
    "https://example.com/echarts@5.4.3/dist/echarts.min.js",
  ]) assert.equal(classifyExactImmutableEchartsUrl(value), null);
});

test("network bytes persist by hash and survive store recreation", async (t) => {
  const userDataPath = await mkdtemp(path.join(tmpdir(), "pageroot-library-store-"));
  t.after(() => rm(userDataPath, { recursive: true, force: true }));
  const bytes = Buffer.from("window.echarts={version:'5.4.3'};");
  let fetches = 0;
  const firstStore = createEditRuntimeLibraryStore({ userDataPath });
  const first = await firstStore.load(`${URL_543}#download`, async () => {
    fetches += 1;
    return bytes;
  });
  assert.equal(first.origin, "network");
  assert.equal(first.url, URL_543);

  const secondStore = createEditRuntimeLibraryStore({ userDataPath });
  const second = await secondStore.load(URL_543, async () => {
    fetches += 1;
    throw new Error("disk cache should win");
  });
  assert.equal(second.origin, "disk-cache");
  assert.deepEqual(second.bytes, bytes);
  assert.equal(fetches, 1);
  assert.deepEqual(
    await readFile(path.join(secondStore.paths.blobsPath, `${second.sha256}.js`)),
    bytes,
  );
});

test("corrupt blobs and unknown indexes fail open to verified network bytes", async (t) => {
  const userDataPath = await mkdtemp(path.join(tmpdir(), "pageroot-library-corrupt-"));
  t.after(() => rm(userDataPath, { recursive: true, force: true }));
  const store = createEditRuntimeLibraryStore({ userDataPath });
  const first = await store.load(URL_543, async () => Buffer.from("first-valid"));
  await writeFile(path.join(store.paths.blobsPath, `${first.sha256}.js`), "corrupt");
  let fetches = 0;
  const afterBlobCorruption = await createEditRuntimeLibraryStore({ userDataPath }).load(
    URL_543,
    async () => {
      fetches += 1;
      return Buffer.from("second-valid");
    },
  );
  assert.equal(afterBlobCorruption.origin, "network");
  assert.equal(afterBlobCorruption.bytes.toString(), "second-valid");

  await writeFile(store.paths.indexPath, '{"schemaVersion":999,"entries":[]}\n');
  const afterUnknownIndex = await createEditRuntimeLibraryStore({ userDataPath }).load(
    URL_543,
    async () => {
      fetches += 1;
      return Buffer.from("third-valid");
    },
  );
  assert.equal(afterUnknownIndex.origin, "network");
  assert.equal(afterUnknownIndex.bytes.toString(), "third-valid");
  assert.equal(fetches, 2);
});

test("a later cache read removes bounded orphan blobs and abandoned temporary files", async (t) => {
  const userDataPath = await mkdtemp(path.join(tmpdir(), "pageroot-library-reconcile-"));
  t.after(() => rm(userDataPath, { recursive: true, force: true }));
  const store = createEditRuntimeLibraryStore({ userDataPath });
  await store.load(URL_543, async () => Buffer.from("referenced"));
  const orphanName = `${"f".repeat(64)}.js`;
  await Promise.all([
    writeFile(path.join(store.paths.blobsPath, orphanName), "orphan"),
    writeFile(path.join(store.paths.blobsPath, ".abandoned.tmp"), "temporary"),
  ]);

  assert.ok(await createEditRuntimeLibraryStore({ userDataPath }).get(URL_543));
  const remaining = await readdir(store.paths.blobsPath);
  assert.equal(remaining.includes(orphanName), false);
  assert.equal(remaining.includes(".abandoned.tmp"), false);
});

test("concurrent misses share one per-URL remote load", async (t) => {
  const userDataPath = await mkdtemp(path.join(tmpdir(), "pageroot-library-flight-"));
  t.after(() => rm(userDataPath, { recursive: true, force: true }));
  const store = createEditRuntimeLibraryStore({ userDataPath });
  let release = null;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let started = null;
  const remoteStarted = new Promise((resolve) => {
    started = resolve;
  });
  let fetches = 0;
  const fetchRemote = async () => {
    fetches += 1;
    started();
    await gate;
    return Buffer.from("shared-network-bytes");
  };
  const first = store.load(URL_543, fetchRemote);
  const second = store.load(`${URL_543}#same-resource`, fetchRemote);
  await remoteStarted;
  assert.equal(fetches, 1);
  release();
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.deepEqual(firstResult.bytes, secondResult.bytes);
  assert.equal(fetches, 1);
});

test("LRU enforces maxEntries and maxBytes independently", async (t) => {
  const countRoot = await mkdtemp(path.join(tmpdir(), "pageroot-library-count-"));
  const bytesRoot = await mkdtemp(path.join(tmpdir(), "pageroot-library-bytes-"));
  t.after(() => Promise.all([
    rm(countRoot, { recursive: true, force: true }),
    rm(bytesRoot, { recursive: true, force: true }),
  ]));
  let clock = 0;
  const countStore = createEditRuntimeLibraryStore({
    userDataPath: countRoot,
    maxEntries: 2,
    maxBytes: 100,
    now: () => ++clock,
  });
  await countStore.load(URL_543, async () => Buffer.from("543"));
  await countStore.load(URL_542, async () => Buffer.from("542"));
  await countStore.get(URL_543);
  await countStore.load(URL_541, async () => Buffer.from("541"));
  const countIndex = JSON.parse(await readFile(countStore.paths.indexPath, "utf8"));
  assert.deepEqual(
    new Set(countIndex.entries.map((entry) => entry.url)),
    new Set([URL_543, URL_541]),
  );

  const bytesStore = createEditRuntimeLibraryStore({
    userDataPath: bytesRoot,
    maxEntries: 10,
    maxBytes: 5,
    now: () => ++clock,
  });
  await bytesStore.load(URL_543, async () => Buffer.from("1234"));
  await bytesStore.load(URL_542, async () => Buffer.from("5678"));
  const bytesIndex = JSON.parse(await readFile(bytesStore.paths.indexPath, "utf8"));
  assert.equal(bytesIndex.entries.length, 1);
  assert.equal(bytesIndex.entries[0].url, URL_542);
  assert.equal(bytesIndex.entries[0].byteLength, 4);
});

test("atomic persistence failure never blocks already verified network bytes", async (t) => {
  const userDataPath = await mkdtemp(path.join(tmpdir(), "pageroot-library-atomic-"));
  t.after(() => rm(userDataPath, { recursive: true, force: true }));
  const store = createEditRuntimeLibraryStore({
    userDataPath,
    fileSystem: {
      async rename() {
        throw new Error("synthetic atomic rename failure");
      },
    },
  });
  let fetches = 0;
  const load = () => store.load(URL_543, async () => {
    fetches += 1;
    return Buffer.from("usable-network-bytes");
  });
  assert.equal((await load()).origin, "network");
  assert.equal((await load()).bytes.toString(), "usable-network-bytes");
  assert.equal(fetches, 2);
  const files = await readdir(store.paths.blobsPath);
  assert.equal(files.some((fileName) => fileName.endsWith(".tmp")), false);
});

test("store refuses to persist mutable or unknown library URLs", async (t) => {
  const userDataPath = await mkdtemp(path.join(tmpdir(), "pageroot-library-refuse-"));
  t.after(() => rm(userDataPath, { recursive: true, force: true }));
  const store = createEditRuntimeLibraryStore({ userDataPath });
  await assert.rejects(
    store.load("https://unpkg.com/echarts@latest/dist/echarts.min.js", async () => "x"),
    /not exact and immutable/u,
  );
});
