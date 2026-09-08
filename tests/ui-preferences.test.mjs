import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  UI_PREFERENCES_SCHEMA_VERSION,
  decodeUiPreferences,
  normalizeWorkspacePatch,
  readUiPreferences,
  recordUiWorkspacePreferences,
} from "../desktop/ui-preferences.mjs";

const DEFAULT_WORKSPACE = {
  rememberPanelWidths: true,
  sidebarWidth: 264,
  inspectorWidth: 376,
  motion: "system",
  restoreTabsOnLaunch: true,
  defaultAgentProviderId: "qoder",
  disabledAgentProviderIds: [],
  agentConfigurations: {},
  documentAgentSelections: {},
};

async function temporaryUserData(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pageroot-ui-pref-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test("missing, damaged, and oversized UI preferences use safe workspace defaults", async (t) => {
  const userDataPath = await temporaryUserData(t);
  const missing = await readUiPreferences({ userDataPath });
  assert.equal(missing.schemaVersion, UI_PREFERENCES_SCHEMA_VERSION);
  assert.deepEqual(missing.workspace, DEFAULT_WORKSPACE);

  await writeFile(path.join(userDataPath, "ui-preferences.json"), "{not-json", "utf8");
  assert.deepEqual((await readUiPreferences({ userDataPath })).workspace, DEFAULT_WORKSPACE);

  const oversized = "a".repeat(20 * 1024);
  await writeFile(
    path.join(userDataPath, "ui-preferences.json"),
    JSON.stringify({ schemaVersion: 1, padding: oversized }),
    "utf8",
  );
  assert.deepEqual((await readUiPreferences({ userDataPath })).workspace, DEFAULT_WORKSPACE);
});

test("retired first-edit-guide fields are ignored", () => {
  const decoded = decodeUiPreferences({
    schemaVersion: UI_PREFERENCES_SCHEMA_VERSION,
    firstRealHtmlEditGuide: { status: "dismissed", generation: 99 },
    builtInWelcomeProjectId: "project_welcome",
    workspace: { sidebarWidth: 320 },
  });
  assert.equal("firstRealHtmlEditGuide" in decoded, false);
  assert.equal("builtInWelcomeProjectId" in decoded, false);
  assert.equal(decoded.workspace.sidebarWidth, 320);
});

test("v1 preferences migrate to the workspace-only shape", async (t) => {
  const userDataPath = await temporaryUserData(t);
  await writeFile(path.join(userDataPath, "ui-preferences.json"), JSON.stringify({
    schemaVersion: 1,
    firstRealHtmlEditGuide: {
      key: "first-real-html-edit-guide",
      generation: 2,
      status: "dismissed",
    },
    builtInWelcomeProjectId: "project_legacy_welcome",
  }), "utf8");

  const migrated = await readUiPreferences({ userDataPath });
  assert.equal(migrated.schemaVersion, UI_PREFERENCES_SCHEMA_VERSION);
  assert.deepEqual(migrated.workspace, DEFAULT_WORKSPACE);
  const persisted = JSON.parse(await readFile(
    path.join(userDataPath, "ui-preferences.json"),
    "utf8",
  ));
  assert.deepEqual(Object.keys(persisted).sort(), ["schemaVersion", "workspace"]);
});

test("v1 migration does not overwrite a concurrent workspace update", async (t) => {
  const userDataPath = await temporaryUserData(t);
  await writeFile(path.join(userDataPath, "ui-preferences.json"), JSON.stringify({
    schemaVersion: 1,
    firstRealHtmlEditGuide: { status: "presented", generation: 2 },
    builtInWelcomeProjectId: "project_legacy_welcome",
  }), "utf8");

  await Promise.all([
    readUiPreferences({ userDataPath }),
    recordUiWorkspacePreferences({
      userDataPath,
      workspace: { sidebarWidth: 328 },
    }),
  ]);
  const final = await readUiPreferences({ userDataPath });
  assert.equal(final.schemaVersion, UI_PREFERENCES_SCHEMA_VERSION);
  assert.equal(final.workspace.sidebarWidth, 328);
  assert.equal("firstRealHtmlEditGuide" in final, false);
});

test("workspace preference decoding clamps damaged values and strict writes reject unsafe patches", () => {
  const decoded = decodeUiPreferences({
    schemaVersion: UI_PREFERENCES_SCHEMA_VERSION,
    workspace: {
      sidebarWidth: 999,
      inspectorWidth: 1,
      motion: "unknown",
      restoreTabsOnLaunch: "yes",
      defaultAgentProviderId: "unknown",
    },
  });
  assert.equal(decoded.workspace.sidebarWidth, 420);
  assert.equal(decoded.workspace.inspectorWidth, 280);
  assert.equal(decoded.workspace.motion, "system");
  assert.equal(decoded.workspace.restoreTabsOnLaunch, true);
  assert.equal(decoded.workspace.defaultAgentProviderId, "qoder");
  assert.deepEqual(decoded.workspace.disabledAgentProviderIds, []);
  assert.throws(() => normalizeWorkspacePatch({ sidebarWidth: 999 }), /范围/u);
  assert.throws(() => normalizeWorkspacePatch({ unknown: true }), /未知字段/u);
  assert.throws(() => normalizeWorkspacePatch({ defaultAgentProviderId: "gemini" }), /默认 Agent/u);
  assert.throws(() => normalizeWorkspacePatch({ disabledAgentProviderIds: ["gemini"] }), /停用的 AI 服务/u);
  assert.equal(normalizeWorkspacePatch({ defaultAgentProviderId: "pageroot" }).defaultAgentProviderId, "pageroot");
  assert.deepEqual(
    normalizeWorkspacePatch({ disabledAgentProviderIds: ["codex", "codex"] }).disabledAgentProviderIds,
    ["codex"],
  );
});

test("provider configurations accept only bounded public choices and preserve the default", async (t) => {
  const userDataPath = await temporaryUserData(t);
  const configurations = { pageroot: { modelId: "pageroot:deepseek-v4-pro", reasoning: "high" } };
  await recordUiWorkspacePreferences({ userDataPath, workspace: { defaultAgentProviderId: "codex" } });
  await recordUiWorkspacePreferences({ userDataPath, workspace: { agentConfigurations: configurations } });
  const persisted = await readUiPreferences({ userDataPath });
  assert.deepEqual(persisted.workspace.agentConfigurations, configurations);
  assert.equal(persisted.workspace.defaultAgentProviderId, "codex");
  for (const unsafe of [
    { pageroot: { ...configurations.pageroot, apiKey: "secret" } },
    { pageroot: { ...configurations.pageroot, modelId: "codex:other-provider" } },
    { pageroot: { ...configurations.pageroot, reasoning: "../../secret" } },
    { other: configurations.pageroot },
  ]) assert.throws(() => normalizeWorkspacePatch({ agentConfigurations: unsafe }), /服务配置无效/u);
});

test("concurrent workspace writes serialize into one v2 document", async (t) => {
  const userDataPath = await temporaryUserData(t);
  await Promise.all([
    recordUiWorkspacePreferences({
      userDataPath,
      workspace: { sidebarWidth: 320, motion: "reduced" },
    }),
    recordUiWorkspacePreferences({
      userDataPath,
      workspace: { defaultAgentProviderId: "codex" },
    }),
  ]);
  const final = await readUiPreferences({ userDataPath });
  assert.equal(final.workspace.sidebarWidth, 320);
  assert.equal(final.workspace.motion, "reduced");
  assert.equal(final.workspace.defaultAgentProviderId, "codex");
});

test("document service choice survives reload separately from the default and disabled services", async (t) => {
  const userDataPath = await temporaryUserData(t);
  const documentAgentSelections = { doc_aaaaaaaaaaaaaaaa: "qoder", doc_bbbbbbbbbbbbbbbb: "codex" };
  await recordUiWorkspacePreferences({ userDataPath, workspace: {
    defaultAgentProviderId: "pageroot", disabledAgentProviderIds: ["qoder"], documentAgentSelections,
  } });
  const restored = await readUiPreferences({ userDataPath });
  assert.deepEqual(restored.workspace.documentAgentSelections, documentAgentSelections);
  assert.equal(restored.workspace.defaultAgentProviderId, "pageroot");
  assert.deepEqual(restored.workspace.disabledAgentProviderIds, ["qoder"]);
  assert.throws(() => normalizeWorkspacePatch({ documentAgentSelections: { "/tmp/private": "codex" } }));
});
