import assert from "node:assert/strict";
import test from "node:test";

import {
  RUNTIME_ENVIRONMENT_FILE_NAME,
  RuntimeEnvironmentError,
  createRuntimeEnvironment,
  parseRuntimeEnvironmentMarker,
  resolveRuntimeChannel,
  runtimeEnvironmentMarker,
} from "../desktop/runtime-environment.mjs";

const homePath = "/Users/tester";
const appDataPath = `${homePath}/Library/Application Support`;
const documentsPath = `${homePath}/Documents`;
const logsBasePath = `${homePath}/Library/Logs`;

test("runtime environment keeps stable and preview roots separate", () => {
  const stable = createRuntimeEnvironment({
    channel: "stable",
    homePath,
    appDataPath,
    documentsPath,
    logsBasePath,
  });
  const preview = createRuntimeEnvironment({
    channel: "preview",
    homePath,
    appDataPath,
    documentsPath,
    logsBasePath,
  });
  assert.equal(stable.userDataPath, `${appDataPath}/PageRoot`);
  assert.equal(stable.sessionDataPath, stable.userDataPath);
  assert.equal(stable.projectFilesRoot, `${documentsPath}/PageRoot/项目`);
  assert.equal(stable.workspacePath, `${documentsPath}/PageRoot/项目记录`);
  assert.equal(preview.userDataPath, `${appDataPath}/PageRoot Developer Preview`);
  assert.equal(preview.sessionDataPath, `${preview.userDataPath}/chromium`);
  assert.equal(preview.projectFilesRoot, `${documentsPath}/PageRoot Developer Preview/项目`);
  assert.equal(preview.workspacePath, `${documentsPath}/PageRoot Developer Preview/项目记录`);
  assert.equal(preview.agentsRoot, `${preview.userDataPath}/agents`);
  assert.equal(preview.recoveryJournalPath, `${preview.userDataPath}/recovery-journals-v1`);
  assert.equal(preview.logsPath, `${logsBasePath}/PageRoot Developer Preview`);
  assert.notEqual(stable.userDataPath, preview.userDataPath);
  assert.notEqual(stable.projectFilesRoot, preview.projectFilesRoot);
});

test("stable preserves legacy project and workspace path overrides", () => {
  const customProjectsRoot = `${homePath}/Custom PageRoot/项目`;
  const customWorkspaceRoot = `${homePath}/Custom PageRoot/项目记录`;
  const stable = createRuntimeEnvironment({
    channel: "stable",
    environment: {
      HTML_AI_PROJECT_FILES_ROOT: customProjectsRoot,
      HTML_AI_WORKSPACE: customWorkspaceRoot,
    },
    homePath,
    appDataPath,
    documentsPath,
    logsBasePath,
  });
  assert.equal(stable.projectFilesRoot, customProjectsRoot);
  assert.equal(stable.workspacePath, customWorkspaceRoot);
});

test("preview ignores stable project and workspace path overrides", () => {
  const preview = createRuntimeEnvironment({
    channel: "preview",
    environment: {
      HTML_AI_PROJECT_FILES_ROOT: `${homePath}/PageRoot/项目`,
      HTML_AI_WORKSPACE: `${homePath}/PageRoot/项目记录`,
    },
    homePath,
    appDataPath,
    documentsPath,
    logsBasePath,
  });
  assert.equal(preview.projectFilesRoot, `${documentsPath}/PageRoot Developer Preview/项目`);
  assert.equal(preview.workspacePath, `${documentsPath}/PageRoot Developer Preview/项目记录`);
});

test("E2E runtime roots stay under the explicitly isolated test directory", () => {
  const isolatedRoot = "/private/tmp/pageroot-native-e2e-example";
  const environment = createRuntimeEnvironment({
    channel: "e2e",
    environment: {
      HTML_AI_PROJECT_FILES_ROOT: `${isolatedRoot}/project-files`,
      HTML_AI_WORKSPACE: `${isolatedRoot}/workspace`,
    },
    e2eUserDataPath: isolatedRoot,
    homePath,
    appDataPath,
    documentsPath,
    logsBasePath,
  });
  assert.equal(environment.userDataPath, isolatedRoot);
  assert.equal(environment.sessionDataPath, `${isolatedRoot}/chromium`);
  assert.equal(environment.projectFilesRoot, `${isolatedRoot}/project-files`);
  assert.equal(environment.workspacePath, `${isolatedRoot}/workspace`);
  assert.throws(
    () => createRuntimeEnvironment({
      channel: "e2e",
      environment: { HTML_AI_WORKSPACE: `${homePath}/Documents/PageRoot/项目记录` },
      e2eUserDataPath: isolatedRoot,
    }),
    (error) => error instanceof RuntimeEnvironmentError
      && error.code === "RUNTIME_PATH_OUTSIDE_ISOLATED_ROOT",
  );
});

test("packaged channel is read from an explicit marker and missing marker fails closed", () => {
  assert.deepEqual(runtimeEnvironmentMarker("preview"), {
    schemaVersion: 1,
    channel: "preview",
  });
  assert.equal(
    resolveRuntimeChannel({
      resourcesPath: "/Applications/PageRoot Developer Preview.app/Contents/Resources",
      defaultApp: false,
      readFile: (filePath) => {
        assert.equal(filePath, `/Applications/PageRoot Developer Preview.app/Contents/Resources/${RUNTIME_ENVIRONMENT_FILE_NAME}`);
        return JSON.stringify({ schemaVersion: 1, channel: "preview" });
      },
    }),
    "preview",
  );
  assert.equal(
    resolveRuntimeChannel({
      environment: { PAGEROOT_RUNTIME_CHANNEL: "e2e" },
      resourcesPath: "/unused",
      defaultApp: false,
    }),
    "e2e",
  );
  assert.equal(
    resolveRuntimeChannel({
      environment: { PAGEROOT_RUNTIME_CHANNEL: "stable" },
      resourcesPath: "/Applications/PageRoot Developer Preview.app/Contents/Resources",
      defaultApp: false,
      allowEnvironmentOverride: false,
      readFile: () => JSON.stringify({ schemaVersion: 1, channel: "preview" }),
    }),
    "preview",
  );
  assert.throws(
    () => resolveRuntimeChannel({
      resourcesPath: "/missing/resources",
      defaultApp: false,
      readFile: () => {
        throw Object.assign(new Error("missing"), { code: "ENOENT" });
      },
    }),
    (error) => error instanceof RuntimeEnvironmentError
      && error.code === "RUNTIME_CHANNEL_MARKER_MISSING",
  );
  assert.throws(
    () => parseRuntimeEnvironmentMarker({ schemaVersion: 1, channel: "source" }),
    (error) => error instanceof RuntimeEnvironmentError
      && error.code === "RUNTIME_CHANNEL_MARKER_INVALID",
  );
});
