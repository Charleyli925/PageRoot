import { readPublishedWorkingCopy } from "./helpers/working-copy-publication.mjs";
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, test } from "@playwright/test";
import { _electron as electron } from "playwright";
import { sha256 } from "../../../bridge/lifecycle-core.mjs";
import { ProjectFileRepository } from "../../../bridge/project-file-repository.mjs";
import { sourceBindingPath } from "../../../bridge/project-file-repository/source-binding.mjs";
import { activateNativeEdit, currentEditorFrame, setTextSelection, keyShortcut } from "../browser/stemmio-driver.mjs";
import {
  inspectSourceElementIdentity,
  sourceElementIdentityBindingSha256,
} from "../../../bridge/project-file-repository/working-copy.mjs";
import {
  assertPackagedAppIdentity,
  expectedPackagedAppIdentity,
  readPackagedPlistIdentity,
} from "../../../scripts/packaged-app-identity.mjs";
import { waitForProjectReady } from "./helpers/stemmio-app-fixture.mjs";
import { stagePackagedApplicationForLaunch } from "./helpers/packaged-app-launch.mjs";

const productRoot = path.resolve(import.meta.dirname, "../../..");
const packageJson = JSON.parse(
  readFileSync(path.join(productRoot, "package.json"), "utf8"),
);
const expectedIdentity = expectedPackagedAppIdentity({
  packageJson,
  environment: process.env,
});

function packagedApplication(appPath = process.env.STEMMIO_PACKAGED_APP_PATH) {
  if (!appPath || !path.isAbsolute(appPath) || path.extname(appPath) !== ".app") {
    throw new Error("STEMMIO_PACKAGED_APP_PATH must name an absolute packaged .app path.");
  }
  const productName = path.basename(appPath, ".app");
  const executable = path.join(appPath, "Contents", "MacOS", productName);
  if (!existsSync(executable)) {
    throw new Error(`Packaged application executable is missing: ${executable}`);
  }
  return { appPath, executable };
}

function removeIsolatedDirectory(directory) {
  const resolved = path.resolve(directory);
  if (
    path.dirname(resolved) !== path.resolve(tmpdir())
    || !path.basename(resolved).startsWith("stemmio-native-e2e-packaged-startup-")
  ) {
    throw new Error(`Refusing to remove non-packaged-startup directory: ${directory}`);
  }
  rmSync(resolved, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100,
  });
}

async function stopPackagedAppForCleanup(electronApp) {
  const electronProcess = electronApp.process();
  const closed = electronApp.waitForEvent("close", { timeout: 5_000 }).catch(() => null);
  await electronApp.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await closed;
  if (electronProcess.exitCode === null && electronProcess.signalCode === null) {
    electronProcess.kill("SIGKILL");
  }
}

async function closePackagedGracefully(electronApp, page) {
  const mainRendererUrl = page?.url();
  if (!mainRendererUrl) {
    throw new Error("Stemmio main renderer URL is unavailable for graceful close.");
  }
  const closed = electronApp.waitForEvent("close", { timeout: 30_000 });
  const requested = await electronApp.evaluate(({ BrowserWindow }, rendererUrl) => {
    const mainWindow = BrowserWindow.getAllWindows().find((candidate) => (
      candidate.webContents.getURL() === rendererUrl
    ));
    if (!mainWindow) return false;
    mainWindow.close();
    return true;
  }, mainRendererUrl);
  if (!requested) {
    throw new Error("Stemmio main BrowserWindow was unavailable for graceful close.");
  }
  await closed;
}

function packagedLaunchEnvironment(isolatedUserData) {
  return {
    ...process.env,
    STEMMIO_E2E: "1",
    STEMMIO_E2E_USER_DATA_DIR: isolatedUserData,
    STEMMIO_WORKSPACE: path.join(isolatedUserData, "workspace"),
    STEMMIO_PROJECT_FILES_ROOT: path.join(isolatedUserData, "project-files"),
  };
}

function expectManagedV1Identity(managedSourcePath, original) {
  const managed = readFileSync(managedSourcePath);
  expect(managed).not.toEqual(original);
  expect(inspectSourceElementIdentity(managed.toString("utf8")).complete).toBe(true);
  const controlRoot = path.join(path.dirname(managedSourcePath), ".stemmio");
  const manifest = JSON.parse(readFileSync(path.join(controlRoot, "manifest.json"), "utf8"));
  const firstVersion = manifest.versions.find((version) => version.versionId === "ver_0001");
  const firstWorkingCopy = manifest.workingCopies.find(
    (workingCopy) => workingCopy.workingCopyId === "work_ver_0001",
  );
  expect(readFileSync(path.join(controlRoot, firstVersion.snapshotRelativePath))).toEqual(original);
  const state = JSON.parse(readFileSync(
    path.join(controlRoot, firstWorkingCopy.stateRelativePath),
    "utf8",
  ));
  expect(state).toMatchObject({
    baseSha256: sha256(original),
    currentSha256: sha256(managed),
    differsFromBase: true,
    sourceElementIdentitySchemaVersion: 1,
    sourceElementIdentityBindingSha256:
      sourceElementIdentityBindingSha256(managed.toString("utf8")),
  });
}

test("packaged app preserves identity and imports external HTML as V1 across startup states", async () => {
  test.setTimeout(180_000);
  const isolatedUserData = mkdtempSync(
    path.join(tmpdir(), "stemmio-native-e2e-packaged-startup-"),
  );
  const startupAlias = path.join(isolatedUserData, "qoder-startup.html");
  const liveAlias = path.join(isolatedUserData, "qoder-live.htm");
  writeFileSync(
    startupAlias,
    "<!doctype html><html><head><title>Startup</title></head><body><main>Qoder startup HTML</main></body></html>",
    "utf8",
  );
  writeFileSync(
    liveAlias,
    "<!doctype html><html><head><title>Live</title></head><body><main data-native-case=\"durable-binding\">Qoder live HTML</main></body></html>",
    "utf8",
  );
  const startupSourcePath = realpathSync(startupAlias);
  const liveSourcePath = realpathSync(liveAlias);
  const startupOriginal = readFileSync(startupSourcePath);
  const liveOriginal = readFileSync(liveSourcePath);
  const sourcePackagedApp = packagedApplication();
  const stagedPackagedApp = stagePackagedApplicationForLaunch({
    appPath: sourcePackagedApp.appPath,
    isolationRoot: isolatedUserData,
  });
  const packagedApp = packagedApplication(stagedPackagedApp.appPath);
  let electronApp = null;
  try {
    electronApp = await electron.launch({
      executablePath: packagedApp.executable,
      cwd: stagedPackagedApp.cwd,
      args: [startupSourcePath],
      env: {
        ...process.env,
        STEMMIO_E2E: "1",
        STEMMIO_E2E_USER_DATA_DIR: isolatedUserData,
        STEMMIO_WORKSPACE: path.join(isolatedUserData, "workspace"),
        STEMMIO_PROJECT_FILES_ROOT: path.join(isolatedUserData, "project-files"),
      },
    });
    const page = await electronApp.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await expect(page).toHaveTitle("源页");
    await expect(page.locator("main.workbench")).toBeVisible();
    await waitForProjectReady(page, { timeout: 60_000 });
    await expect(
      page.getByTestId("html-canvas-editor").filter({ visible: true }).first(),
    ).toHaveAttribute("data-render-verified", "true", { timeout: 30_000 });
    await page.evaluate(() => new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
    const runtime = await page.evaluate(() => ({
      appVersion: window.stemmioRuntime?.appVersion || "",
      connection: window.stemmioRuntime?.getBridgeConnection?.() || null,
      startupTiming: window.stemmioRuntime?.getStartupTiming?.() || null,
    }));
    expect(runtime?.appVersion).toBe(expectedIdentity.version);
    const runtimeIdentity = await electronApp.evaluate(({ app }) => ({
      name: app.getName(),
      version: app.getVersion(),
    }));
    const plistIdentity = await readPackagedPlistIdentity(packagedApp.appPath);
    assertPackagedAppIdentity({
      ...runtimeIdentity,
      bundleId: plistIdentity.bundleId,
    }, expectedIdentity);
    expect(plistIdentity.bundleVersion).toBe(expectedIdentity.version);
    expect(runtimeIdentity).toEqual({
      name: expectedIdentity.name,
      version: expectedIdentity.version,
    });
    expect(runtime.connection?.bridgePort).toMatch(/^[1-9]\d{0,4}$/u);
    expect(Number(runtime.connection?.bridgePort)).toBeGreaterThan(0);
    expect(Number(runtime.connection?.bridgePort)).toBeLessThanOrEqual(65_535);
    const startupStages = runtime.startupTiming?.marks.map((mark) => mark.stage) || [];
    expect(startupStages.indexOf("renderer-shell-load-start"))
      .toBeLessThan(startupStages.indexOf("bridge-start"));
    expect(startupStages.indexOf("renderer-shell-loaded"))
      .toBeLessThan(startupStages.indexOf("bridge-await-finished"));
    expect(startupStages).toContain("bridge-connection-published");
    await expect.poll(
      async () => (await page.evaluate(
        () => window.stemmioProjects?.getActiveProject(),
      ))?.sourcePath,
      { timeout: 30_000 },
    ).toMatch(/\/qoder-startup\.html$/u);
    const startupManagedSourcePath = await page.evaluate(async () => (
      await window.stemmioProjects?.getActiveProject()
    )?.sourcePath || "");
    expect(startupManagedSourcePath).not.toBe(startupSourcePath);
    expect(readFileSync(startupSourcePath)).toEqual(startupOriginal);
    expectManagedV1Identity(startupManagedSourcePath, startupOriginal);

    await electronApp.evaluate(({ app }, sourcePath) => {
      app.emit("open-file", { preventDefault() {} }, sourcePath);
    }, liveSourcePath);
    await waitForProjectReady(page, { timeout: 60_000 });
    await expect.poll(
      async () => (await page.evaluate(
        () => window.stemmioProjects?.getActiveProject(),
      ))?.sourcePath,
      { timeout: 30_000 },
    ).toMatch(/\/qoder-live\.htm$/u);
    const liveManagedSourcePath = await page.evaluate(async () => (
      await window.stemmioProjects?.getActiveProject()
    )?.sourcePath || "");
    expect(liveManagedSourcePath).not.toBe(liveSourcePath);
    expect(readFileSync(liveSourcePath)).toEqual(liveOriginal);
    expectManagedV1Identity(liveManagedSourcePath, liveOriginal);
    await expect.poll(
      () => page.locator("main.workbench").getAttribute("data-project-state"),
      { timeout: 30_000 },
    ).toBe("ready");

    const managedBeforeRestart = readFileSync(liveManagedSourcePath);
    const manifestPath = path.join(path.dirname(liveManagedSourcePath), ".stemmio", "manifest.json");
    await closePackagedGracefully(electronApp, page);
    electronApp = null;
    const repository = new ProjectFileRepository({ projectsRoot: path.join(isolatedUserData, "project-files") });
    const startupTarget = await repository.resolveOpenTarget({ sourcePath: startupManagedSourcePath });
    const candidateId = "candidate_packaged_restart_0001";
    await repository.createCandidate({ target: startupTarget, requestId: "req_packaged_restart_0001", candidateId,
      html: readFileSync(startupManagedSourcePath, "utf8").replace("<title ", "<title data-restart-proof=\"next\" "),
      expectedSourceSha256: startupTarget.sourceSha256 });
    await repository.promoteCandidate({ target: startupTarget, candidateId, decisionOperationId: `promote_${candidateId}` });
    const migratedMembers = [];
    for (const root of [path.dirname(startupManagedSourcePath), path.dirname(liveManagedSourcePath)]) {
      const file = path.join(root, ".stemmio", "manifest.json");
      const staleManifest = JSON.parse(readFileSync(file, "utf8"));
      for (const member of staleManifest.workingCopies) {
        const sourcePath = path.join(root, member.sourceRelativePath);
        migratedMembers.push({ root, sourcePath, workingCopyId: member.workingCopyId, bytes: readFileSync(sourcePath) });
        member.fileIdentity.device = "123";
        rmSync(sourceBindingPath(root, member.workingCopyId), { force: true });
      }
      writeFileSync(file, JSON.stringify(staleManifest));
    }
    // Current-draft projects keep one Working Copy per registered project;
    // promoting the startup candidate replaces its current Working Copy
    // instead of creating an additional historical member.
    expect(migratedMembers).toHaveLength(2);
    electronApp = await electron.launch({
      executablePath: packagedApp.executable,
      cwd: stagedPackagedApp.cwd,
      args: [],
      env: {
        ...process.env,
        STEMMIO_E2E: "1",
        STEMMIO_E2E_USER_DATA_DIR: isolatedUserData,
        STEMMIO_WORKSPACE: path.join(isolatedUserData, "workspace"),
        STEMMIO_PROJECT_FILES_ROOT: path.join(isolatedUserData, "project-files"),
      },
    });
    const restarted = await electronApp.firstWindow();
    await waitForProjectReady(restarted, { timeout: 60_000 });
    const projects = await restarted.evaluate(() => window.stemmioProjects.listRegisteredProjects());
    expect(projects).toHaveLength(2);
    const expandSidebar = restarted.getByRole("button", { name: "展开左侧边栏" });
    if (await expandSidebar.count()) await expandSidebar.click();
    await expect(restarted.locator(".sidebar-project-row[data-availability=ready]")).toHaveCount(2);
    expect(projects.every((project) => project.availability === "ready")).toBe(true);
    expect(readFileSync(liveManagedSourcePath)).toEqual(managedBeforeRestart);
    expect(JSON.parse(readFileSync(manifestPath, "utf8")).workingCopies.every((member) => member.fileIdentity.device !== "123")).toBe(true);
    // The inactive startup V1 must migrate too. Catalog/open probes alone
    // only touch active members and cannot satisfy startup migration.
    for (const member of migratedMembers) {
      expect(readFileSync(member.sourcePath)).toEqual(member.bytes);
      expect(lstatSync(sourceBindingPath(member.root, member.workingCopyId)).ino).toBe(lstatSync(member.sourcePath).ino);
      const manifest = JSON.parse(readFileSync(path.join(member.root, ".stemmio", "manifest.json"), "utf8"));
      expect(manifest.workingCopies.find((entry) => entry.workingCopyId === member.workingCopyId).fileIdentity.device).not.toBe("123");
    }
    const frame = await currentEditorFrame(restarted);
    await activateNativeEdit(frame, "durable-binding");
    await setTextSelection(frame, "durable-binding", 0, "Qoder live HTML".length);
    await restarted.keyboard.insertText("Saved after durable restart");
    await restarted.keyboard.press(keyShortcut("S"));
    await expect.poll(() => readPublishedWorkingCopy(liveManagedSourcePath, "utf8"), { timeout: 30_000 }).toContain("Saved after durable restart");
    await closePackagedGracefully(electronApp, restarted);
    electronApp = null;
  } finally {
    if (electronApp) await stopPackagedAppForCleanup(electronApp);
    removeIsolatedDirectory(isolatedUserData);
  }
});

test("packaged app creates one durable welcome project on an empty first launch", async () => {
  test.setTimeout(180_000);
  const isolatedUserData = mkdtempSync(
    path.join(tmpdir(), "stemmio-native-e2e-packaged-startup-"),
  );
  const sourcePackagedApp = packagedApplication();
  const stagedPackagedApp = stagePackagedApplicationForLaunch({
    appPath: sourcePackagedApp.appPath,
    isolationRoot: isolatedUserData,
  });
  const packagedApp = packagedApplication(stagedPackagedApp.appPath);
  const launchOptions = {
    executablePath: packagedApp.executable,
    cwd: stagedPackagedApp.cwd,
    args: [],
    env: packagedLaunchEnvironment(isolatedUserData),
  };
  const externalWelcomePath = path.join(isolatedUserData, "欢迎来到源页.html");
  let electronApp = null;
  try {
    electronApp = await electron.launch(launchOptions);
    const page = await electronApp.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await expect(page).toHaveTitle("源页");
    await expect(page.locator("main.workbench")).toBeVisible();
    await waitForProjectReady(page, { timeout: 60_000 });

    const firstActive = await page.evaluate(() => window.stemmioProjects?.getActiveProject());
    expect(firstActive).toMatchObject({
      projectId: expect.stringMatching(/^project_[A-Za-z0-9_-]+$/u),
      documentId: expect.stringMatching(/^doc_[A-Za-z0-9_-]+$/u),
      sourcePath: expect.stringMatching(/\/欢迎来到源页\.html$/u),
    });
    expect(firstActive.sourcePath).not.toBe(externalWelcomePath);
    await expect.poll(() => existsSync(externalWelcomePath)).toBe(true);
    await expect.poll(() => existsSync(firstActive.sourcePath)).toBe(true);

    const firstProjects = await page.evaluate(() => window.stemmioProjects.listRegisteredProjects());
    expect(firstProjects).toHaveLength(1);
    expect(firstProjects[0]).toMatchObject({
      projectId: firstActive.projectId,
      documentId: firstActive.documentId,
      availability: "ready",
    });

    const editor = page.getByTestId("html-canvas-editor").filter({ visible: true }).first();
    await expect(editor).toHaveAttribute("data-render-verified", "true", { timeout: 30_000 });
    const firstFrame = await currentEditorFrame(page);
    await expect.poll(() => firstFrame.locator('img[alt="源页 Logo"]').evaluate(
      (image) => image.complete && image.naturalWidth > 0,
    )).toBe(true);

    const editableIntro = firstFrame.locator(".intro");
    await editableIntro.dblclick();
    await expect.poll(() => editableIntro.getAttribute("contenteditable"))
      .toMatch(/^(?:plaintext-only|true)$/u);
    const editedIntro = "欢迎页首启验证已保存。";
    await editableIntro.fill(editedIntro);
    await expect.poll(() => readFileSync(firstActive.sourcePath, "utf8"), {
      timeout: 30_000,
    }).toContain(editedIntro);

    const firstProjectIdentity = {
      projectId: firstActive.projectId,
      documentId: firstActive.documentId,
      sourcePath: firstActive.sourcePath,
    };
    await closePackagedGracefully(electronApp, page);
    electronApp = null;

    electronApp = await electron.launch(launchOptions);
    const restarted = await electronApp.firstWindow();
    await restarted.waitForLoadState("domcontentloaded");
    await expect(restarted).toHaveTitle("源页");
    await expect(restarted.locator("main.workbench")).toBeVisible();
    await waitForProjectReady(restarted, { timeout: 60_000 });
    const restartedActive = await restarted.evaluate(() => window.stemmioProjects?.getActiveProject());
    expect(restartedActive).toMatchObject(firstProjectIdentity);
    const restartedProjects = await restarted.evaluate(() => window.stemmioProjects.listRegisteredProjects());
    expect(restartedProjects).toHaveLength(1);
    expect(restartedProjects[0]).toMatchObject({
      projectId: firstProjectIdentity.projectId,
      documentId: firstProjectIdentity.documentId,
      availability: "ready",
    });
    expect(readFileSync(firstActive.sourcePath, "utf8")).toContain(editedIntro);

    const restartedEditor = restarted.getByTestId("html-canvas-editor").filter({ visible: true }).first();
    await expect(restartedEditor).toHaveAttribute("data-render-verified", "true", { timeout: 30_000 });
    const restartedFrame = await currentEditorFrame(restarted);
    await expect(restartedFrame.locator(".intro")).toContainText(editedIntro);
    await expect.poll(() => restartedFrame.locator('img[alt="源页 Logo"]').evaluate(
      (image) => image.complete && image.naturalWidth > 0,
    )).toBe(true);
    await closePackagedGracefully(electronApp, restarted);
    electronApp = null;
  } finally {
    if (electronApp) await stopPackagedAppForCleanup(electronApp);
    removeIsolatedDirectory(isolatedUserData);
  }
});
