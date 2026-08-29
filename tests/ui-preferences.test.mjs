import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  FIRST_REAL_HTML_EDIT_GUIDE_GENERATION,
  UI_PREFERENCES_SCHEMA_VERSION,
  decodeUiPreferences,
  normalizeWorkspacePatch,
  readUiPreferences,
  recordFirstEditGuide,
  recordUiWorkspacePreferences,
  rememberBuiltInWelcomeProjectId,
} from "../desktop/ui-preferences.mjs";

async function temporaryUserData(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pageroot-ui-pref-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test("missing or damaged UI preferences decode as pending", async (t) => {
  const userDataPath = await temporaryUserData(t);
  const missing = await readUiPreferences({ userDataPath });
  assert.equal(missing.firstRealHtmlEditGuide.status, "pending");
  assert.equal(missing.firstRealHtmlEditGuide.generation, FIRST_REAL_HTML_EDIT_GUIDE_GENERATION);
  assert.equal(missing.builtInWelcomeProjectId, null);

  await writeFile(path.join(userDataPath, "ui-preferences.json"), "{not-json", "utf8");
  const damaged = await readUiPreferences({ userDataPath });
  assert.equal(damaged.firstRealHtmlEditGuide.status, "pending");

  const oversized = `${"a".repeat(20 * 1024)}`;
  await writeFile(
    path.join(userDataPath, "ui-preferences.json"),
    JSON.stringify({ schemaVersion: 1, padding: oversized }),
    "utf8",
  );
  const tooLarge = await readUiPreferences({ userDataPath });
  assert.equal(tooLarge.firstRealHtmlEditGuide.status, "pending");
});

test("an older guide generation returns to pending", () => {
  const decodedNewer = decodeUiPreferences(JSON.stringify({
    schemaVersion: 1,
    firstRealHtmlEditGuide: {
      status: "dismissed",
      generation: 99,
    },
    builtInWelcomeProjectId: "project_welcome",
  }));
  assert.equal(decodedNewer.firstRealHtmlEditGuide.status, "pending");
  assert.equal(decodedNewer.firstRealHtmlEditGuide.generation, FIRST_REAL_HTML_EDIT_GUIDE_GENERATION);
  assert.equal(decodedNewer.builtInWelcomeProjectId, "project_welcome");

  const decodedPrevious = decodeUiPreferences(JSON.stringify({
    schemaVersion: 1,
    firstRealHtmlEditGuide: {
      status: "presented",
      generation: 1,
    },
  }));
  assert.equal(decodedPrevious.firstRealHtmlEditGuide.status, "pending");
  assert.equal(decodedPrevious.firstRealHtmlEditGuide.generation, FIRST_REAL_HTML_EDIT_GUIDE_GENERATION);
});

test("v1 preferences migrate without losing guide or welcome identity", async (t) => {
  const userDataPath = await temporaryUserData(t);
  await writeFile(path.join(userDataPath, "ui-preferences.json"), JSON.stringify({
    schemaVersion: 1,
    firstRealHtmlEditGuide: {
      key: "first-real-html-edit-guide",
      generation: FIRST_REAL_HTML_EDIT_GUIDE_GENERATION,
      status: "dismissed",
      presentedAt: null,
      dismissedAt: "2026-08-29T00:00:00.000Z",
    },
    builtInWelcomeProjectId: "project_legacy_welcome",
  }), "utf8");

  const migrated = await readUiPreferences({ userDataPath });
  assert.equal(migrated.schemaVersion, UI_PREFERENCES_SCHEMA_VERSION);
  assert.equal(migrated.firstRealHtmlEditGuide.status, "dismissed");
  assert.equal(migrated.builtInWelcomeProjectId, "project_legacy_welcome");
  assert.deepEqual(migrated.workspace, {
    rememberPanelWidths: true,
    sidebarWidth: 264,
    inspectorWidth: 376,
    motion: "system",
    restoreTabsOnLaunch: true,
    defaultAgentProviderId: "qoder",
  });
  assert.equal(JSON.parse(await readFile(
    path.join(userDataPath, "ui-preferences.json"),
    "utf8",
  )).schemaVersion, UI_PREFERENCES_SCHEMA_VERSION);
});

test("v1 migration does not overwrite a concurrent workspace update", async (t) => {
  const userDataPath = await temporaryUserData(t);
  await writeFile(path.join(userDataPath, "ui-preferences.json"), JSON.stringify({
    schemaVersion: 1,
    firstRealHtmlEditGuide: {
      key: "first-real-html-edit-guide",
      generation: FIRST_REAL_HTML_EDIT_GUIDE_GENERATION,
      status: "presented",
      presentedAt: "2026-08-29T00:00:00.000Z",
      dismissedAt: null,
    },
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
  assert.equal(final.builtInWelcomeProjectId, "project_legacy_welcome");
  assert.equal(final.workspace.sidebarWidth, 328);
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
  assert.throws(() => normalizeWorkspacePatch({ sidebarWidth: 999 }), /范围/u);
  assert.throws(() => normalizeWorkspacePatch({ unknown: true }), /未知字段/u);
  assert.throws(() => normalizeWorkspacePatch({ defaultAgentProviderId: "gemini" }), /默认 Agent/u);
});

test("present and dismiss are install-level and dismissed is terminal", async (t) => {
  const userDataPath = await temporaryUserData(t);
  const presented = await recordFirstEditGuide({
    userDataPath,
    action: "presented",
  });
  assert.equal(presented.firstRealHtmlEditGuide.status, "presented");
  assert.equal(typeof presented.firstRealHtmlEditGuide.presentedAt, "string");

  const again = await recordFirstEditGuide({
    userDataPath,
    action: "presented",
  });
  assert.equal(again.firstRealHtmlEditGuide.presentedAt, presented.firstRealHtmlEditGuide.presentedAt);

  const dismissed = await recordFirstEditGuide({
    userDataPath,
    action: "dismissed",
  });
  assert.equal(dismissed.firstRealHtmlEditGuide.status, "dismissed");

  const ignored = await recordFirstEditGuide({
    userDataPath,
    action: "presented",
  });
  assert.equal(ignored.firstRealHtmlEditGuide.status, "dismissed");
});

test("welcome project identity is remembered atomically", async (t) => {
  const userDataPath = await temporaryUserData(t);
  await mkdir(userDataPath, { recursive: true });
  const remembered = await rememberBuiltInWelcomeProjectId({
    userDataPath,
    projectId: "project_welcome_html",
  });
  assert.equal(remembered.builtInWelcomeProjectId, "project_welcome_html");
  const raw = await readFile(path.join(userDataPath, "ui-preferences.json"), "utf8");
  assert.match(raw, /project_welcome_html/u);
  await assert.rejects(
    () => rememberBuiltInWelcomeProjectId({
      userDataPath,
      projectId: "not-a-project",
    }),
    /invalid/u,
  );
});

test("guide and workspace writes serialize against the same v2 document", async (t) => {
  const userDataPath = await temporaryUserData(t);
  const [guide, workspace] = await Promise.all([
    recordFirstEditGuide({ userDataPath, action: "dismissed" }),
    recordUiWorkspacePreferences({
      userDataPath,
      workspace: { sidebarWidth: 320, motion: "reduced" },
    }),
  ]);
  const final = await readUiPreferences({ userDataPath });
  assert.equal(guide.firstRealHtmlEditGuide.status, "dismissed");
  assert.equal(workspace.workspace.sidebarWidth, 320);
  assert.equal(final.firstRealHtmlEditGuide.status, "dismissed");
  assert.equal(final.workspace.sidebarWidth, 320);
  assert.equal(final.workspace.motion, "reduced");
});
