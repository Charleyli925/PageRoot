import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createSourceFileWatcher } from "../desktop/source-file-watch.mjs";

test("source file watcher debounces directory events for the watched basename", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pageroot-source-watch-"));
  const sourcePath = path.join(root, "page.html");
  await writeFile(sourcePath, "<!doctype html><html><body>one</body></html>\n", "utf8");
  const events = [];
  const watcher = createSourceFileWatcher({
    debounceMs: 80,
    onChange: (info) => events.push(info.sourcePath),
  });
  try {
    watcher.watch(sourcePath);
    await writeFile(sourcePath, "<!doctype html><html><body>two</body></html>\n", "utf8");
    await new Promise((resolve) => setTimeout(resolve, 160));
    assert.ok(events.length >= 1, "watched file writes should emit a change");
    const afterWatchedWrite = events.length;
    await writeFile(path.join(root, "other.html"), "<!doctype html><html><body>no</body></html>\n", "utf8");
    await new Promise((resolve) => setTimeout(resolve, 160));
    assert.equal(events.length, afterWatchedWrite);
    assert.ok(events.every((entry) => entry === path.resolve(sourcePath)));
  } finally {
    watcher.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("source file watcher close stops further events", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pageroot-source-watch-close-"));
  const sourcePath = path.join(root, "page.html");
  await writeFile(sourcePath, "<!doctype html><html><body>one</body></html>\n", "utf8");
  const events = [];
  const watcher = createSourceFileWatcher({
    debounceMs: 20,
    onChange: (info) => events.push(info.sourcePath),
  });
  try {
    watcher.watch(sourcePath);
    watcher.close();
    await writeFile(sourcePath, "<!doctype html><html><body>closed</body></html>\n", "utf8");
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(events.length, 0);
    assert.equal(watcher.watchedPath, null);
  } finally {
    watcher.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("watching the same path twice keeps the live watcher", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pageroot-source-watch-idempotent-"));
  const sourcePath = path.join(root, "page.html");
  await writeFile(sourcePath, "<!doctype html><html><body>one</body></html>\n", "utf8");
  const events = [];
  const watcher = createSourceFileWatcher({
    debounceMs: 40,
    onChange: (info) => events.push(info.sourcePath),
  });
  try {
    watcher.watch(sourcePath);
    const firstPath = watcher.watchedPath;
    watcher.watch(sourcePath);
    assert.equal(watcher.watchedPath, firstPath);
    await writeFile(sourcePath, "<!doctype html><html><body>two</body></html>\n", "utf8");
    await new Promise((resolve) => setTimeout(resolve, 120));
    assert.ok(events.length >= 1, "rewatching the same path must keep delivering events");
  } finally {
    watcher.close();
    await rm(root, { recursive: true, force: true });
  }
});
