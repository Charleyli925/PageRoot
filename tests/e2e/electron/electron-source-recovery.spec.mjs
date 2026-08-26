import { expect, test } from "@playwright/test";
import {
  ORIGINAL_LIST_TEXT,
  bridgeJson,
  createSourceFixture,
  launchPageRoot,
  loadedDiskFrame,
  managedWorkingCopyPath,
  path,
  readFileSync,
  readDesktopProjectState,
  removeIsolatedUserData,
  removeSourceFixture,
  renameSync,
  stopPageRoot,
  waitForActiveSourcePath,
  waitForTitleStem,
} from "./electron-native-harness.mjs";

test("Desktop fails closed when the Working Copy is replaced between Bridge reconcile and Desktop read", {
  tag: ["@smoke-recovery"],
}, async () => {
  const fixture = createSourceFixture("reconcile-hash-race.html");
  let electronApp = null;
  let isolatedUserData = null;
  try {
    const launched = await launchPageRoot({
      activeSourcePath: fixture.sourcePath,
      injectedEnv: { PAGEROOT_E2E_RECONCILE_REPLACE_BEFORE_READ: "1" },
    });
    electronApp = launched.electronApp;
    isolatedUserData = launched.isolatedUserData;
    await loadedDiskFrame(launched.page, fixture.sourcePath, "list-item");
    const managedSourcePath = await managedWorkingCopyPath(
      launched.page,
      fixture.sourcePath,
    );
    const beforeWorkspace = await bridgeJson(
      launched.page,
      `/workspace?sourcePath=${encodeURIComponent(managedSourcePath)}`,
    );
    const beforeTarget = beforeWorkspace.body?.openTarget || beforeWorkspace.body;
    const expectedSha256 = beforeWorkspace.body?.currentHtmlSha256;
    const beforeState = await readDesktopProjectState(isolatedUserData);

    // Drive the exact race window: the Bridge verifies the Working Copy, and
    // the E2E injection replaces its bytes before Desktop reads them again.
    const outcome = await launched.page.evaluate(async (payload) => {
      try {
        const result = await window.htmlAIProjects.reconcileActiveManagedSource(payload);
        return { resolved: true, result };
      } catch (error) {
        return {
          resolved: false,
          message: String(error?.message || error || ""),
        };
      }
    }, {
      operationId: "reconcile_e2e_hash_race_0001",
      previousSourcePath: managedSourcePath,
      expectedSourceSha256: expectedSha256,
      projectId: beforeTarget.projectId,
      documentId: beforeTarget.documentId,
      workingCopyId: beforeTarget.workingCopyId,
      versionId: beforeTarget.versionId,
      reason: "safe-action",
    });

    // contextBridge strips custom error fields, so assert the dedicated
    // fail-closed message plus the untouched state instead of the code.
    expect(outcome).toEqual({
      resolved: false,
      message: "托管工作文件与已确认的项目内容不一致，当前文件没有切换。",
    });

    // The replacement must have landed inside the race window.
    expect(readFileSync(managedSourcePath, "utf8"))
      .toContain("data-e2e-reconcile-hash-race");

    // Fail closed: neither the active path nor the managed locator may move.
    const afterState = await readDesktopProjectState(isolatedUserData);
    expect(afterState.activePath).toBe(beforeState.activePath);
    expect(afterState.activeManagedLocator).toEqual(beforeState.activeManagedLocator);

    const activeProject = await launched.page.evaluate(() => (
      window.htmlAIProjects?.getActiveProject()
    ));
    expect(sameDesktopSourcePath(activeProject?.sourcePath, managedSourcePath)).toBe(true);
  } finally {
    if (electronApp && isolatedUserData) {
      await stopPageRoot(electronApp, isolatedUserData);
    }
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("Electron restores a Finder rename after the process is killed", {
  tag: ["@smoke-recovery"],
}, async () => {
  const fixture = createSourceFixture("finder-rename-restart.html");
  let electronApp = null;
  let isolatedUserData = null;
  try {
    const launched = await launchPageRoot({ activeSourcePath: fixture.sourcePath });
    electronApp = launched.electronApp;
    isolatedUserData = launched.isolatedUserData;
    await loadedDiskFrame(launched.page, fixture.sourcePath, "list-item");
    const managedSourcePath = await managedWorkingCopyPath(
      launched.page,
      fixture.sourcePath,
    );
    const beforeWorkspace = await bridgeJson(
      launched.page,
      `/workspace?sourcePath=${encodeURIComponent(managedSourcePath)}`,
    );
    const beforeTarget = beforeWorkspace.body?.openTarget || beforeWorkspace.body;
    const finderName = "重启后仍是同一文件-V1.html";
    const finderPath = path.join(path.dirname(managedSourcePath), finderName);
    renameSync(managedSourcePath, finderPath);
    await waitForTitleStem(launched.page, path.basename(finderName, ".html"));
    await waitForActiveSourcePath(launched.page, finderPath);

    await stopPageRoot(electronApp, isolatedUserData, { cleanup: false });
    electronApp = null;
    const relaunched = await launchPageRoot({ isolatedUserData });
    electronApp = relaunched.electronApp;
    await waitForTitleStem(relaunched.page, path.basename(finderName, ".html"));
    await waitForActiveSourcePath(relaunched.page, finderPath);
    const afterWorkspace = await bridgeJson(
      relaunched.page,
      `/workspace?sourcePath=${encodeURIComponent(finderPath)}`,
    );
    const afterTarget = afterWorkspace.body?.openTarget || afterWorkspace.body;
    expect(afterTarget.projectId).toBe(beforeTarget.projectId);
    expect(afterTarget.documentId).toBe(beforeTarget.documentId);
    expect(afterTarget.workingCopyId).toBe(beforeTarget.workingCopyId);
    expect(readFileSync(finderPath, "utf8")).toContain(ORIGINAL_LIST_TEXT);
  } finally {
    if (electronApp && isolatedUserData) {
      await stopPageRoot(electronApp, isolatedUserData, { cleanup: false });
    }
    if (isolatedUserData) removeIsolatedUserData(isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});
