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
import {
  PRODUCT_AGENTS_DIRECTORY_NAME,
  PRODUCT_PROJECT_RECORDS_DIRECTORY_NAME,
  PRODUCT_PROJECTS_DIRECTORY_NAME,
  PRODUCT_RECOVERY_JOURNALS_DIRECTORY_NAME,
  PRODUCT_SESSION_DIRECTORY_NAME,
  PRODUCT_PREVIEW_NAME,
  PRODUCT_STABLE_DIRECTORY_NAME,
} from "../shared/product-identity.mjs";

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
  assert.equal(stable.userDataPath, `${appDataPath}/Stemmio`);
  assert.equal(stable.sessionDataPath, `${stable.userDataPath}/chromium`);
  assert.equal(stable.projectFilesRoot, `${documentsPath}/Stemmio/项目`);
  assert.equal(stable.workspacePath, `${documentsPath}/Stemmio/项目记录`);
  assert.equal(preview.userDataPath, `${appDataPath}/Stemmio Developer Preview`);
  assert.equal(preview.sessionDataPath, `${preview.userDataPath}/chromium`);
  assert.equal(preview.projectFilesRoot, `${documentsPath}/Stemmio Developer Preview/项目`);
  assert.equal(preview.workspacePath, `${documentsPath}/Stemmio Developer Preview/项目记录`);
  assert.equal(preview.agentsRoot, `${preview.userDataPath}/agents`);
  assert.equal(preview.recoveryJournalPath, `${preview.userDataPath}/recovery-journals-v1`);
  assert.equal(preview.logsPath, `${logsBasePath}/Stemmio Developer Preview`);
  assert.notEqual(stable.userDataPath, preview.userDataPath);
  assert.notEqual(stable.projectFilesRoot, preview.projectFilesRoot);
});

test("desktop path derivation stays aligned with the shared product contract", () => {
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
  assert.equal(stable.userDataPath, `${appDataPath}/${PRODUCT_STABLE_DIRECTORY_NAME}`);
  assert.equal(stable.sessionDataPath, `${stable.userDataPath}/${PRODUCT_SESSION_DIRECTORY_NAME}`);
  assert.equal(stable.projectFilesRoot, `${documentsPath}/${PRODUCT_STABLE_DIRECTORY_NAME}/${PRODUCT_PROJECTS_DIRECTORY_NAME}`);
  assert.equal(stable.workspacePath, `${documentsPath}/${PRODUCT_STABLE_DIRECTORY_NAME}/${PRODUCT_PROJECT_RECORDS_DIRECTORY_NAME}`);
  assert.equal(stable.agentsRoot, `${stable.userDataPath}/${PRODUCT_AGENTS_DIRECTORY_NAME}`);
  assert.equal(stable.recoveryJournalPath, `${stable.userDataPath}/${PRODUCT_RECOVERY_JOURNALS_DIRECTORY_NAME}`);
  assert.equal(preview.applicationName, PRODUCT_PREVIEW_NAME);
});

test("stable ignores project and workspace path overrides", () => {
  const customProjectsRoot = `${homePath}/Custom Stemmio/项目`;
  const customWorkspaceRoot = `${homePath}/Custom Stemmio/项目记录`;
  const stable = createRuntimeEnvironment({
    channel: "stable",
    environment: {
      STEMMIO_PROJECT_FILES_ROOT: customProjectsRoot,
      STEMMIO_WORKSPACE: customWorkspaceRoot,
    },
    homePath,
    appDataPath,
    documentsPath,
    logsBasePath,
  });
  assert.equal(stable.projectFilesRoot, `${documentsPath}/Stemmio/项目`);
  assert.equal(stable.workspacePath, `${documentsPath}/Stemmio/项目记录`);
});

test("source accepts only explicit Stemmio roots", () => {
  const customProjectsRoot = `${homePath}/Custom Stemmio/项目`;
  const customWorkspaceRoot = `${homePath}/Custom Stemmio/项目记录`;
  const source = createRuntimeEnvironment({
    channel: "source",
    environment: {
      STEMMIO_PROJECT_FILES_ROOT: customProjectsRoot,
      STEMMIO_WORKSPACE: customWorkspaceRoot,
    },
    homePath,
    appDataPath,
    documentsPath,
    logsBasePath,
  });
  assert.equal(source.projectFilesRoot, customProjectsRoot);
  assert.equal(source.workspacePath, customWorkspaceRoot);
});

test("preview ignores stable project and workspace path overrides", () => {
  const preview = createRuntimeEnvironment({
    channel: "preview",
    environment: {
      STEMMIO_PROJECT_FILES_ROOT: `${homePath}/Stemmio/项目`,
      STEMMIO_WORKSPACE: `${homePath}/Stemmio/项目记录`,
    },
    homePath,
    appDataPath,
    documentsPath,
    logsBasePath,
  });
  assert.equal(preview.projectFilesRoot, `${documentsPath}/Stemmio Developer Preview/项目`);
  assert.equal(preview.workspacePath, `${documentsPath}/Stemmio Developer Preview/项目记录`);
});

test("E2E runtime roots stay under the explicitly isolated test directory", () => {
  const isolatedRoot = "/private/tmp/stemmio-native-e2e-example";
  const environment = createRuntimeEnvironment({
    channel: "e2e",
    environment: {
      STEMMIO_PROJECT_FILES_ROOT: `${isolatedRoot}/project-files`,
      STEMMIO_WORKSPACE: `${isolatedRoot}/workspace`,
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
      environment: { STEMMIO_WORKSPACE: `${homePath}/Documents/Stemmio/项目记录` },
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
      resourcesPath: "/Applications/Stemmio Developer Preview.app/Contents/Resources",
      defaultApp: false,
      readFile: (filePath) => {
        assert.equal(filePath, `/Applications/Stemmio Developer Preview.app/Contents/Resources/${RUNTIME_ENVIRONMENT_FILE_NAME}`);
        return JSON.stringify({ schemaVersion: 1, channel: "preview" });
      },
    }),
    "preview",
  );
  assert.equal(
    resolveRuntimeChannel({
      environment: { STEMMIO_RUNTIME_CHANNEL: "e2e" },
      resourcesPath: "/unused",
      defaultApp: false,
    }),
    "e2e",
  );
  assert.equal(
    resolveRuntimeChannel({
      environment: { STEMMIO_RUNTIME_CHANNEL: "stable" },
      resourcesPath: "/Applications/Stemmio Developer Preview.app/Contents/Resources",
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

test("legacy PageRoot channel variables cannot redirect a Stemmio runtime", () => {
  assert.throws(
    () => resolveRuntimeChannel({
      environment: { PAGEROOT_RUNTIME_CHANNEL: "e2e" },
      resourcesPath: "/missing/resources",
      defaultApp: false,
      readFile: () => {
        throw Object.assign(new Error("missing"), { code: "ENOENT" });
      },
    }),
    (error) => error instanceof RuntimeEnvironmentError
      && error.code === "RUNTIME_CHANNEL_MARKER_MISSING",
  );
  const stable = createRuntimeEnvironment({
    channel: "stable",
    environment: {
      PAGEROOT_PROJECT_FILES_ROOT: `${homePath}/old-projects`,
      PAGEROOT_WORKSPACE: `${homePath}/old-workspace`,
    },
    homePath,
    appDataPath,
    documentsPath,
    logsBasePath,
  });
  assert.equal(stable.projectFilesRoot, `${documentsPath}/Stemmio/项目`);
  assert.equal(stable.workspacePath, `${documentsPath}/Stemmio/项目记录`);
});
