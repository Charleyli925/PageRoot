import { expect, test } from "@playwright/test";
import {
  ORIGINAL_LIST_TEXT,
  caseSelector,
  closePageRootGracefully,
  createSourceFixture,
  currentEditorFrame,
  launchPageRoot,
  loadedDiskFrame,
  openRecentProject,
  path,
  readFileSync,
  removeIsolatedUserData,
  removeSourceFixture,
  stopPageRoot,
} from "./electron-native-harness.mjs";

test("Electron tab keyboard navigation manages focus and a persisted Start suppresses activePath restart", {
  tag: ["@gate-smoke","@smoke-project-lifecycle"],
}, async () => {
  test.setTimeout(180_000);
  const fixture = createSourceFixture("workbench-tabs-restart.html");
  const firstLaunch = await launchPageRoot({ activeSourcePath: fixture.sourcePath });
  let firstClosed = false;
  let reopened = null;
  try {
    await loadedDiskFrame(firstLaunch.page, fixture.sourcePath, "list-item");
    await expect(firstLaunch.page.getByRole("button", { name: "导入并打开" }))
      .toBeHidden({ timeout: 30_000 });
    const tablist = firstLaunch.page.getByRole("tablist", { name: "已打开的 HTML" });
    await expect(tablist.getByRole("tab")).toHaveCount(1);
    await firstLaunch.page.getByRole("button", { name: "新标签页" }).click();
    await firstLaunch.page.getByRole("button", { name: "新标签页" }).click();
    await expect(tablist.getByRole("tab")).toHaveCount(3);
    await expect(firstLaunch.page.getByTestId("workbench-document-surface-cache")
      .locator("[data-tab-id] iframe")).toHaveCount(1);

    const documentTab = tablist.getByRole("tab").nth(0);
    const firstStart = tablist.getByRole("tab").nth(1);
    const lastStart = tablist.getByRole("tab").nth(2);
    await expect(lastStart).toHaveAttribute("aria-selected", "true");
    await lastStart.focus();

    await lastStart.press("ArrowLeft");
    await expect(firstStart).toHaveAttribute("aria-selected", "true", { timeout: 60_000 });
    await expect(firstStart).toBeFocused();
    await firstStart.press("ArrowLeft");
    await expect(documentTab).toHaveAttribute("aria-selected", "true");
    await expect(documentTab).toBeFocused();
    await loadedDiskFrame(firstLaunch.page, fixture.sourcePath, "list-item");
    await documentTab.press("ArrowRight");
    await expect(firstStart).toHaveAttribute("aria-selected", "true");
    await expect(firstStart).toBeFocused();
    await firstStart.press("Home");
    await expect(documentTab).toHaveAttribute("aria-selected", "true", { timeout: 60_000 });
    await expect(documentTab).toBeFocused();
    await loadedDiskFrame(firstLaunch.page, fixture.sourcePath, "list-item");
    await firstLaunch.page.evaluate(() => new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
    await documentTab.press("End");
    await expect(lastStart).toHaveAttribute("aria-selected", "true");
    await expect(lastStart).toBeFocused();

    const tabsStatePath = path.join(firstLaunch.isolatedUserData, "workbench-tabs.json");
    await expect.poll(() => {
      try {
        return JSON.parse(readFileSync(tabsStatePath, "utf8"));
      } catch {
        return null;
      }
    }).toMatchObject({ version: 1, activeTabId: null });

    await closePageRootGracefully(firstLaunch.electronApp, firstLaunch.page);
    firstClosed = true;
    reopened = await launchPageRoot({ isolatedUserData: firstLaunch.isolatedUserData });
    const reopenedTabs = reopened.page.getByRole("tablist", { name: "已打开的 HTML" });
    await expect(reopenedTabs.getByRole("tab")).toHaveCount(2);
    await expect(reopenedTabs.getByRole("tab").nth(0)).toHaveAttribute("aria-selected", "true");
    await expect(reopened.page.locator("main.workbench")).toHaveAttribute("data-start-page", "true");
    await expect(reopened.page.locator("main.workbench")).toHaveAttribute("data-project-state", "unbound");
    await expect(reopenedTabs.getByRole("tab").nth(1)).not.toHaveText("HTML");

    const restoredTitle = (await reopenedTabs.getByRole("tab").nth(1).innerText()).trim();
    await reopened.page.getByRole("button", { name: "查看现有项目" }).click();
    await reopened.page.getByRole("button", { name: restoredTitle, exact: true }).click();
    await expect(reopenedTabs.getByRole("tab")).toHaveCount(1, { timeout: 60_000 });
    await expect(reopenedTabs.getByRole("tab").first()).toHaveAttribute("aria-selected", "true");
    await loadedDiskFrame(reopened.page, fixture.sourcePath, "list-item");

    await reopened.page.getByRole("button", { name: "新标签页" }).click();
    await expect(reopenedTabs.getByRole("tab")).toHaveCount(2);
    const activeStart = reopenedTabs.getByRole("tab").nth(1);
    await expect(activeStart).toHaveAttribute("aria-selected", "true");
    const inactiveClose = reopened.page.getByRole("button", { name: `关闭 ${restoredTitle}` });
    await inactiveClose.focus();
    await inactiveClose.press("Enter");
    await expect(reopenedTabs.getByRole("tab")).toHaveCount(1);
    await expect(reopenedTabs.getByRole("tab").first()).toBeFocused();

    await reopened.page.getByRole("button", { name: "新标签页" }).click();
    await expect(reopenedTabs.getByRole("tab")).toHaveCount(2);
    const closingActiveStart = reopenedTabs.getByRole("tab").nth(1);
    await closingActiveStart.focus();
    await closingActiveStart.press(process.platform === "darwin" ? "Meta+w" : "Control+w");
    await expect(reopenedTabs.getByRole("tab")).toHaveCount(1);
    await expect(reopenedTabs.getByRole("tab").first()).toBeFocused();
  } finally {
    if (reopened) {
      await stopPageRoot(reopened.electronApp, reopened.isolatedUserData);
    } else if (!firstClosed) {
      await stopPageRoot(firstLaunch.electronApp, firstLaunch.isolatedUserData);
    } else {
      removeIsolatedUserData(firstLaunch.isolatedUserData);
    }
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("Electron browser A to B to A reopens exact in-memory HTML and deduplicates reselection", {
  tag: ["@gate-smoke","@smoke-project-lifecycle"],
}, async () => {
  test.setTimeout(180_000);
  const projectA = createSourceFixture(
    "browser-memory-a.html",
    (source) => source.replace(ORIGINAL_LIST_TEXT, "Browser memory A"),
  );
  const projectB = createSourceFixture(
    "browser-memory-b.html",
    (source) => source.replace(ORIGINAL_LIST_TEXT, "Browser memory B"),
  );
  const launched = await launchPageRoot();
  try {
    const htmlInput = launched.page.locator('input[type="file"][accept*=".html"]').first();
    const waitForBrowserText = async (text) => {
      await expect.poll(async () => {
        try {
          const candidate = await currentEditorFrame(launched.page);
          return await candidate.locator(caseSelector("list-item")).textContent();
        } catch {
          return null;
        }
      }, { timeout: 30_000 }).toBe(text);
      return currentEditorFrame(launched.page);
    };
    await htmlInput.setInputFiles(projectA.sourcePath);
    let frame = await waitForBrowserText("Browser memory A");
    await expect(frame.locator(caseSelector("list-item"))).toHaveText("Browser memory A");
    const tabs = launched.page.getByRole("tablist", { name: "已打开的 HTML" }).getByRole("tab");
    await expect(tabs.filter({ hasText: "browser-memory-a" })).toHaveCount(1);
    const afterA = await tabs.count();

    await htmlInput.setInputFiles(projectB.sourcePath);
    frame = await waitForBrowserText("Browser memory B");
    await expect(frame.locator(caseSelector("list-item"))).toHaveText("Browser memory B");
    await expect(tabs.filter({ hasText: "browser-memory-b" })).toHaveCount(1);
    await expect(tabs).toHaveCount(afterA + 1);
    const cachedA = tabs.filter({ hasText: "browser-memory-a" });
    const cachedATabId = String(await cachedA.getAttribute("id"))
      .replace(/^workbench-tab-/u, "");
    await launched.page.evaluate(() => {
      performance.clearMarks("pageroot:tab-cache:visible-ready");
      performance.clearMarks("pageroot:tab-cache:handoff-complete");
    });
    await cachedA.click();
    frame = await waitForBrowserText("Browser memory A");
    await expect(frame.locator(caseSelector("list-item"))).toHaveText("Browser memory A");
    await expect(tabs).toHaveCount(afterA + 1);
    await expect.poll(() => launched.page.evaluate((tabId) => {
      const mark = (name) => performance.getEntriesByName(name, "mark")
        .find((entry) => entry.detail?.tabId === tabId)?.startTime || null;
      return {
        visible: mark("pageroot:tab-cache:visible-ready"),
        handoff: mark("pageroot:tab-cache:handoff-complete"),
      };
    }, cachedATabId), { timeout: 30_000 }).toMatchObject({
      visible: expect.any(Number),
      handoff: expect.any(Number),
    });
    const cacheTiming = await launched.page.evaluate((tabId) => {
      const mark = (name) => performance.getEntriesByName(name, "mark")
        .find((entry) => entry.detail?.tabId === tabId)?.startTime || null;
      return {
        visible: mark("pageroot:tab-cache:visible-ready"),
        handoff: mark("pageroot:tab-cache:handoff-complete"),
      };
    }, cachedATabId);
    expect(cacheTiming.visible).toBeLessThan(cacheTiming.handoff);
    const cacheRoot = launched.page.getByTestId("workbench-document-surface-cache");
    await expect(cacheRoot).toHaveAttribute("data-hot-count", "2");
    await expect(cacheRoot).toHaveAttribute("data-max-hot-entries", "2");

    await htmlInput.setInputFiles(projectA.sourcePath);
    frame = await waitForBrowserText("Browser memory A");
    await expect(frame.locator(caseSelector("list-item"))).toHaveText("Browser memory A");
    await expect(tabs.filter({ hasText: "browser-memory-a" })).toHaveCount(1);
    await expect(tabs.filter({ hasText: "browser-memory-b" })).toHaveCount(1);
    await expect(tabs).toHaveCount(afterA + 1);
  } finally {
    await stopPageRoot(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(projectA.sourceDirectory);
    removeSourceFixture(projectB.sourceDirectory);
  }
});

test("Electron restores multiple Registry tabs, the persisted active document, and external cold-start priority", {
  tag: ["@gate-smoke","@smoke-project-lifecycle"],
}, async () => {
  test.setTimeout(300_000);
  const projectA = createSourceFixture("registry-restart-a.html");
  const projectB = createSourceFixture("registry-restart-b.html");
  const projectC = createSourceFixture("external-cold-priority-c.html");
  const first = await launchPageRoot({
    activeSourcePath: projectA.sourcePath,
    recentSourcePaths: [projectA.sourcePath, projectB.sourcePath],
  });
  let firstClosed = false;
  let restored = null;
  let restoredClosed = false;
  let external = null;
  try {
    await loadedDiskFrame(first.page, projectA.sourcePath, "list-item");
    await openRecentProject(first.page, projectB.sourcePath);
    const firstTabs = first.page.getByRole("tablist", { name: "已打开的 HTML" }).getByRole("tab");
    await expect(firstTabs).toHaveCount(2);
    await expect(firstTabs.filter({ hasText: "registry-restart-b" })).toHaveAttribute("aria-selected", "true");
    const cachedSurfaces = first.page.getByTestId("workbench-document-surface-cache")
      .locator("[data-tab-id]");
    await expect(cachedSurfaces).toHaveCount(2, { timeout: 30_000 });
    await expect(cachedSurfaces.locator("iframe")).toHaveCount(2);
    await expect(cachedSurfaces.locator("iframe").first()).toHaveAttribute("sandbox", "");
    const tabsStatePath = path.join(first.isolatedUserData, "workbench-tabs.json");
    await expect.poll(() => {
      try {
        return JSON.parse(readFileSync(tabsStatePath, "utf8"));
      } catch {
        return null;
      }
    }).toMatchObject({
      activeTabId: expect.stringContaining("document:"),
      tabs: expect.arrayContaining([
        expect.objectContaining({ projectId: expect.stringContaining("project_") }),
        expect.objectContaining({ projectId: expect.stringContaining("project_") }),
      ]),
    });
    await closePageRootGracefully(first.electronApp, first.page);
    firstClosed = true;

    restored = await launchPageRoot({ isolatedUserData: first.isolatedUserData });
    await loadedDiskFrame(restored.page, projectB.sourcePath, "list-item");
    const restoredTabs = restored.page.getByRole("tablist", { name: "已打开的 HTML" }).getByRole("tab");
    await expect(restoredTabs.filter({ hasText: "registry-restart-a" })).toHaveCount(1);
    await expect(restoredTabs.filter({ hasText: "registry-restart-b" })).toHaveCount(1);
    await expect(restoredTabs.filter({ hasText: "registry-restart-b" })).toHaveAttribute("aria-selected", "true");
    await closePageRootGracefully(restored.electronApp, restored.page);
    restoredClosed = true;

    external = await launchPageRoot({
      isolatedUserData: first.isolatedUserData,
      externalSourcePaths: [projectC.sourcePath],
    });
    await loadedDiskFrame(external.page, projectC.sourcePath, "list-item");
    const externalTabs = external.page.getByRole("tablist", { name: "已打开的 HTML" }).getByRole("tab");
    await expect(externalTabs.filter({ hasText: "external-cold-priority-c" }))
      .toHaveAttribute("aria-selected", "true");
  } finally {
    if (external) {
      await stopPageRoot(external.electronApp, external.isolatedUserData);
    } else if (restored && !restoredClosed) {
      await stopPageRoot(restored.electronApp, restored.isolatedUserData);
    } else if (!firstClosed) {
      await stopPageRoot(first.electronApp, first.isolatedUserData);
    } else {
      removeIsolatedUserData(first.isolatedUserData);
    }
    removeSourceFixture(projectA.sourceDirectory);
    removeSourceFixture(projectB.sourceDirectory);
    removeSourceFixture(projectC.sourceDirectory);
  }
});
