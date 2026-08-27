import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  normalizeWorkbenchTabsState,
  readWorkbenchTabsState,
  writeWorkbenchTabsState,
} from "../desktop/workbench-tabs-state.mjs";

const valid = {
  version: 1,
  activeTabId: "document:project_alpha:doc_alpha",
  tabs: [{
    tabId: "document:project_alpha:doc_alpha",
    projectId: "project_alpha",
    documentId: "doc_alpha",
  }],
};

test("workbench tab persistence accepts presentation identity and rejects authority fields", () => {
  assert.deepEqual(normalizeWorkbenchTabsState(valid), valid);
  assert.equal(normalizeWorkbenchTabsState({
    ...valid,
    tabs: [{ ...valid.tabs[0], sourcePath: "/Users/demo/alpha.html" }],
  }), null);
  assert.equal(normalizeWorkbenchTabsState({ ...valid, activeTabId: "missing" }), null);
});

test("workbench tab persistence accepts many identity-only tabs", () => {
  const tabs = Array.from({ length: 2_048 }, (_, index) => ({
    tabId: `document:project_many_${index}:doc_many_${index}`,
    projectId: `project_many_${index}`,
    documentId: `doc_many_${index}`,
  }));
  const state = { version: 1, activeTabId: tabs.at(-1).tabId, tabs };
  assert.deepEqual(normalizeWorkbenchTabsState(state), state);
});

test("workbench tab state is atomically written and malformed state fails visibly closed", async () => {
  const userDataPath = await mkdtemp(path.join(os.tmpdir(), "pageroot-tabs-"));
  await writeWorkbenchTabsState({ userDataPath, state: valid });
  assert.deepEqual(await readWorkbenchTabsState({ userDataPath }), valid);
  const filePath = path.join(userDataPath, "workbench-tabs.json");
  await writeFile(filePath, "{not json", "utf8");
  await assert.rejects(readWorkbenchTabsState({ userDataPath }), SyntaxError);
  assert.equal((await readFile(filePath, "utf8")), "{not json");
});

test("concurrent tab projections use distinct atomic temporary files", async () => {
  const userDataPath = await mkdtemp(path.join(os.tmpdir(), "pageroot-tabs-concurrent-"));
  await Promise.all(Array.from({ length: 12 }, () => (
    writeWorkbenchTabsState({ userDataPath, state: valid })
  )));
  assert.deepEqual(await readWorkbenchTabsState({ userDataPath }), valid);
});
