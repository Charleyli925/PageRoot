import assert from "node:assert/strict";
import { mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createSourceFileWatcher } from "../desktop/source-file-watch.mjs";

async function waitFor(predicate, message) {
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(message);
}

test("source file watcher coalesces directory events without requiring the old basename", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pageroot-source-watch-"));
  const sourcePath = path.join(root, "page.html");
  const renamedPath = path.join(root, "page Finder.html");
  await writeFile(sourcePath, "<!doctype html><html><body>one</body></html>\n", "utf8");
  const events = [];
  const watcher = createSourceFileWatcher({
    debounceMs: 60,
    onChange: (info) => events.push(info),
  });
  try {
    watcher.watch(sourcePath);
    const generation = watcher.watcherGeneration;
    await writeFile(path.join(root, "sibling.html"), "<!doctype html><html><body>sib</body></html>\n", "utf8");
    await rename(sourcePath, renamedPath);
    await waitFor(() => events.length >= 1, "directory changes should emit a hint");
    assert.equal(events.at(-1).sourcePath, path.resolve(sourcePath));
    assert.equal(events.at(-1).watcherGeneration, generation);
    const afterFirst = events.length;
    await writeFile(renamedPath, "<!doctype html><html><body>two</body></html>\n", "utf8");
    await writeFile(renamedPath, "<!doctype html><html><body>three</body></html>\n", "utf8");
    await new Promise((resolve) => setTimeout(resolve, 180));
    assert.ok(events.length >= afterFirst);
    assert.ok(events.every((entry) => entry.sourcePath === path.resolve(sourcePath)));
  } finally {
    watcher.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("source file watcher close stops further events and advances generation on rewatch", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pageroot-source-watch-close-"));
  const sourcePath = path.join(root, "page.html");
  const nextPath = path.join(root, "next.html");
  await writeFile(sourcePath, "<!doctype html><html><body>one</body></html>\n", "utf8");
  await writeFile(nextPath, "<!doctype html><html><body>next</body></html>\n", "utf8");
  const events = [];
  const watcher = createSourceFileWatcher({
    debounceMs: 20,
    onChange: (info) => events.push(info),
  });
  try {
    watcher.watch(sourcePath);
    const firstGeneration = watcher.watcherGeneration;
    watcher.close();
    await writeFile(sourcePath, "<!doctype html><html><body>closed</body></html>\n", "utf8");
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(events.length, 0);
    assert.equal(watcher.watchedPath, null);
    watcher.watch(nextPath);
    assert.ok(watcher.watcherGeneration > firstGeneration);
    assert.equal(watcher.watchedPath, path.resolve(nextPath));
  } finally {
    watcher.close();
    await rm(root, { recursive: true, force: true });
  }
});
