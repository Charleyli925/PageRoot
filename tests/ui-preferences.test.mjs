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
  decodeUiPreferences,
  readUiPreferences,
  recordFirstEditGuide,
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
