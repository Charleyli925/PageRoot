import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { fixtureBuffer } from "../../browser/pageroot-driver.mjs";
import {
  FIRST_REAL_HTML_EDIT_GUIDE_GENERATION,
  FIRST_REAL_HTML_EDIT_GUIDE_KEY,
  UI_PREFERENCES_FILE_NAME,
  UI_PREFERENCES_SCHEMA_VERSION,
} from "../../../../desktop/ui-preferences.mjs";
import { removeValidatedTemporaryDirectory } from "./electron-safe-cleanup.mjs";

const DEFAULT_SOURCE_PREFIX = "pageroot-native-e2e-source-";

export function seedDismissedFirstEditGuide(isolatedUserData) {
  mkdirSync(isolatedUserData, { recursive: true });
  const preferencesPath = path.join(isolatedUserData, UI_PREFERENCES_FILE_NAME);
  if (existsSync(preferencesPath)) return;
  writeFileSync(preferencesPath, `${JSON.stringify({
    schemaVersion: UI_PREFERENCES_SCHEMA_VERSION,
    firstRealHtmlEditGuide: {
      key: FIRST_REAL_HTML_EDIT_GUIDE_KEY,
      generation: FIRST_REAL_HTML_EDIT_GUIDE_GENERATION,
      status: "dismissed",
      presentedAt: null,
      dismissedAt: "2020-01-01T00:00:00.000Z",
    },
    builtInWelcomeProjectId: null,
  }, null, 2)}\n`, "utf8");
}

export function seedActiveDiskProject(
  isolatedUserData,
  sourcePath,
  recentSourcePaths = [sourcePath],
) {
  writeFileSync(
    path.join(isolatedUserData, "html-projects.json"),
    JSON.stringify({
      version: 1,
      activePath: sourcePath,
      recent: recentSourcePaths.map((recentPath, index) => ({
        path: recentPath,
        name: path.basename(recentPath),
        lastOpenedAt: Date.now() - index,
      })),
    }),
    "utf8",
  );
}

export function createSourceFixture({
  fileName = "generated-e2e-source.html",
  transform = (source) => source,
  sourceFixtureName = "complex-layout.html",
  sourceDirectoryPrefix = DEFAULT_SOURCE_PREFIX,
} = {}) {
  const sourceDirectory = mkdtempSync(
    path.join(tmpdir(), sourceDirectoryPrefix),
  );
  const sourcePath = path.join(sourceDirectory, fileName);
  const source = fixtureBuffer(sourceFixtureName).toString("utf8");
  writeFileSync(sourcePath, transform(source), "utf8");
  return { sourceDirectory, sourcePath, original: readFileSync(sourcePath) };
}

export function removeSourceFixture(
  sourceDirectory,
  sourceDirectoryPrefix = DEFAULT_SOURCE_PREFIX,
) {
  removeValidatedTemporaryDirectory(sourceDirectory, sourceDirectoryPrefix);
}
