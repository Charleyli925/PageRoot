import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  BUNDLED_ECHARTS_SHA256,
  createEditRuntimeLibraryStore,
  isBundledEchartsUrl,
} from "../desktop/edit-runtime-library-store.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundledEchartsPath = path.join(
  repositoryRoot,
  "node_modules",
  "echarts",
  "dist",
  "echarts.min.js",
);

test("known ECharts 5.5.0 CDN URLs resolve to integrity-checked bundled bytes", async (t) => {
  const userDataPath = await mkdtemp(path.join(os.tmpdir(), "pageroot-runtime-store-"));
  t.after(() => rm(userDataPath, { recursive: true, force: true }));
  const store = createEditRuntimeLibraryStore({ userDataPath, bundledEchartsPath });
  const urls = [
    "https://cdnjs.cloudflare.com/ajax/libs/echarts/5.5.0/echarts.min.js",
    "https://cdn.jsdelivr.net/npm/echarts@5.5.0/dist/echarts.min.js",
    "https://unpkg.com/echarts@5.5.0/dist/echarts.min.js",
  ];
  for (const url of urls) {
    assert.equal(isBundledEchartsUrl(url), true);
    const loaded = await store.load(url, () => {
      throw new Error("bundled ECharts must not use the network");
    });
    assert.equal(loaded.origin, "bundled");
    assert.equal(loaded.sha256, BUNDLED_ECHARTS_SHA256);
    assert.deepEqual(loaded.bytes, await readFile(bundledEchartsPath));
  }
});

test("other ECharts versions persist once by content hash and survive store recreation", async (t) => {
  const userDataPath = await mkdtemp(path.join(os.tmpdir(), "pageroot-runtime-store-"));
  t.after(() => rm(userDataPath, { recursive: true, force: true }));
  const url = "https://cdnjs.cloudflare.com/ajax/libs/echarts/5.4.0/echarts.min.js";
  const remoteBytes = Buffer.from("window.echarts={init(){return {}}};", "utf8");
  let fetches = 0;
  const firstStore = createEditRuntimeLibraryStore({ userDataPath, bundledEchartsPath });
  const first = await firstStore.load(url, async () => {
    fetches += 1;
    return remoteBytes;
  });
  assert.equal(first.origin, "network");
  assert.equal(fetches, 1);

  const secondStore = createEditRuntimeLibraryStore({ userDataPath, bundledEchartsPath });
  const second = await secondStore.load(url, async () => {
    fetches += 1;
    throw new Error("disk cache should satisfy the second request");
  });
  assert.equal(second.origin, "disk-cache");
  assert.deepEqual(second.bytes, remoteBytes);
  assert.equal(fetches, 1);
  const blob = path.join(secondStore.paths.blobsPath, `${second.sha256}.js`);
  assert.deepEqual(await readFile(blob), remoteBytes);
});

test("near-match URLs never impersonate the bundled ECharts identity", () => {
  for (const url of [
    "https://cdnjs.cloudflare.com/ajax/libs/echarts/5.5.1/echarts.min.js",
    "https://evil.example/echarts/5.5.0/echarts.min.js",
    "https://cdn.jsdelivr.net/npm/echarts@5.5.0/dist/echarts.min.js/extra",
  ]) assert.equal(isBundledEchartsUrl(url), false);
});
