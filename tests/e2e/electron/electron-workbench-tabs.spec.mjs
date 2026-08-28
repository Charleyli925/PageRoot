import { expect, test } from "@playwright/test";
import {
  ORIGINAL_LIST_TEXT,
  ProjectFileRepository,
  caseSelector,
  closePageRootGracefully,
  createSourceFixture,
  currentEditorFrame,
  launchPageRoot,
  loadedDiskFrame,
  managedWorkingCopyPath,
  openRecentProject,
  path,
  readFileSync,
  removeIsolatedUserData,
  removeSourceFixture,
  sha256,
  stopPageRoot,
  waitForProjectReady,
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
    const tablist = firstLaunch.page.getByRole("tablist", { name: "已打开的页面" });
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
    const reopenedTabs = reopened.page.getByRole("tablist", { name: "已打开的页面" });
    await expect(reopenedTabs.getByRole("tab")).toHaveCount(2);
    await expect(reopenedTabs.getByRole("tab").nth(0)).toHaveAttribute("aria-selected", "true");
    await expect(reopened.page.locator("main.workbench")).toHaveAttribute("data-start-page", "true");
    await expect(reopened.page.locator("main.workbench")).toHaveAttribute("data-project-state", "unbound");
    await expect(reopenedTabs.getByRole("tab").nth(1)).not.toHaveText("HTML");

    await reopened.page.getByRole("button", { name: "查看现有项目" }).click();
    const sidebar = reopened.page.locator(".workbench-global-sidebar");
    await sidebar.getByRole("button", {
      name: path.basename(fixture.sourcePath, path.extname(fixture.sourcePath)),
      exact: true,
    }).click();
    await sidebar.locator(".sidebar-version-file").first().click();
    await expect(reopenedTabs.getByRole("tab")).toHaveCount(1, { timeout: 60_000 });
    await expect(reopenedTabs.getByRole("tab").first()).toHaveAttribute("aria-selected", "true");
    await loadedDiskFrame(reopened.page, fixture.sourcePath, "list-item");
    const documentTitle = (await reopenedTabs.getByRole("tab").first().innerText()).trim();

    await reopened.page.getByRole("button", { name: "新标签页" }).click();
    await expect(reopenedTabs.getByRole("tab")).toHaveCount(2);
    const activeStart = reopenedTabs.getByRole("tab").nth(1);
    await expect(activeStart).toHaveAttribute("aria-selected", "true");
    const inactiveClose = reopened.page.getByRole("button", { name: `关闭 ${documentTitle}` });
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
    (source) => source
      .replace(ORIGINAL_LIST_TEXT, "Browser memory A")
      .replace("</body>", `
        <div style="height: 2400px" data-testid="scroll-depth">scroll depth</div>
        <a id="cache-disabled-link" href="https://example.com/should-not-open">disabled link</a>
        <canvas id="cache-scroll-chart" width="320" height="120"></canvas>
        <script>
          setTimeout(() => {
            document.getElementById("cache-scroll-chart").getContext("2d").fillRect(0, 0, 80, 40);
          }, 600);
        </script>
      </body>`),
  );
  const projectB = createSourceFixture(
    "browser-memory-b.html",
    (source) => source.replace(ORIGINAL_LIST_TEXT, "Browser memory B"),
  );
  const additionalProjects = ["C", "D", "E"].map((suffix) => createSourceFixture(
    `browser-memory-${suffix.toLowerCase()}.html`,
    (source) => source.replace(ORIGINAL_LIST_TEXT, `Browser memory ${suffix}`),
  ));
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
    await expect(launched.page.getByTestId("html-canvas-editor").filter({ visible: true }).first())
      .toHaveAttribute("data-render-verified", "true", { timeout: 30_000 });
    let frame = await waitForBrowserText("Browser memory A");
    await expect(frame.locator(caseSelector("list-item"))).toHaveText("Browser memory A");
    const runtimeDocumentToken = await frame.evaluate(() => {
      window.__qaRuntimeDocumentToken = crypto.randomUUID();
      return window.__qaRuntimeDocumentToken;
    });
    const tabs = launched.page.getByRole("tablist", { name: "已打开的页面" }).getByRole("tab");
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
    const cachedAFrame = launched.page.getByTestId("workbench-document-surface-cache")
      .locator(`[data-tab-id="${cachedATabId}"] iframe`);
    const cachedAHandle = await cachedAFrame.elementHandle();
    const cachedADocument = await cachedAHandle.contentFrame();
    expect(cachedADocument).not.toBeNull();
    await expect(cachedAFrame).toHaveCSS("pointer-events", "auto");
    await expect(cachedAFrame.locator("xpath=..")).toHaveCSS("pointer-events", "auto");
    await expect(cachedADocument.locator("script").last())
      .toHaveAttribute("type", "application/x-html-canvas-disabled");
    await expect(cachedADocument.locator("#cache-disabled-link"))
      .toHaveCSS("pointer-events", "none");
    for (const [index, project] of additionalProjects.entries()) {
      const suffix = ["C", "D", "E"][index];
      await htmlInput.setInputFiles(project.sourcePath);
      frame = await waitForBrowserText(`Browser memory ${suffix}`);
    }
    await expect(tabs).toHaveCount(afterA + 4);
    await expect(launched.page.getByTestId("workbench-document-canvas-pool"))
      .toHaveAttribute("data-runtime-hot-count", "5");
    await launched.page.evaluate(() => {
      performance.clearMarks("pageroot:tab-cache:visible-ready");
      performance.clearMarks("pageroot:tab-cache:handoff-complete");
      performance.clearMarks("pageroot:runtime-hot:visible-ready");
    });
    await cachedA.click();
    const visibleRuntimeFrame = launched.page.getByTestId("workbench-document-canvas-pool")
      .locator(`[data-runtime-hot-tab-id="${cachedATabId}"]:not([hidden]) iframe`);
    await expect(visibleRuntimeFrame).toBeVisible({ timeout: 5_000 });
    const visibleRuntimeHandle = await visibleRuntimeFrame.elementHandle();
    const visibleRuntimeDocument = await visibleRuntimeHandle.contentFrame();
    expect(visibleRuntimeDocument).not.toBeNull();
    expect(await visibleRuntimeDocument.evaluate(() => window.__qaRuntimeDocumentToken))
      .toBe(runtimeDocumentToken);
    const visibleScrollFacts = await launched.page.locator("#workbench-content-outlet")
      .evaluate((stage) => ({
        scrollTop: (() => {
          stage.scrollTo({ top: 720, behavior: "auto" });
          return stage.scrollTop;
        })(),
        scrollHeight: stage.scrollHeight,
        clientHeight: stage.clientHeight,
      }));
    expect(visibleScrollFacts.scrollHeight).toBeGreaterThan(visibleScrollFacts.clientHeight);
    expect(visibleScrollFacts.scrollTop).toBeGreaterThan(0);
    frame = await waitForBrowserText("Browser memory A");
    await expect(frame.locator(caseSelector("list-item"))).toHaveText("Browser memory A");
    await expect(tabs).toHaveCount(afterA + 4);
    await expect.poll(() => launched.page.evaluate((tabId) => (
      performance.getEntriesByName("pageroot:runtime-hot:visible-ready", "mark")
        .find((entry) => entry.detail?.tabId === tabId)?.startTime || null
    ), cachedATabId), { timeout: 30_000 }).toEqual(expect.any(Number));
    const runtimePool = launched.page.getByTestId("workbench-document-canvas-pool");
    await expect(runtimePool).toHaveAttribute("data-runtime-hot-limit", "5");
    const cacheRoot = launched.page.getByTestId("workbench-document-surface-cache");
    await expect(cacheRoot).toHaveAttribute("data-hot-count", "5");
    await expect(cacheRoot).toHaveAttribute("data-max-hot-entries", "5");

    await htmlInput.setInputFiles(projectA.sourcePath);
    frame = await waitForBrowserText("Browser memory A");
    await expect(frame.locator(caseSelector("list-item"))).toHaveText("Browser memory A");
    await expect(tabs.filter({ hasText: "browser-memory-a" })).toHaveCount(1);
    await expect(tabs.filter({ hasText: "browser-memory-b" })).toHaveCount(1);
    await expect(tabs).toHaveCount(afterA + 4);
  } finally {
    await stopPageRoot(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(projectA.sourceDirectory);
    removeSourceFixture(projectB.sourceDirectory);
    additionalProjects.forEach((project) => removeSourceFixture(project.sourceDirectory));
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
    const firstTabs = first.page.getByRole("tablist", { name: "已打开的页面" }).getByRole("tab");
    await expect(firstTabs).toHaveCount(2);
    await expect(firstTabs.filter({ hasText: "registry-restart-b" })).toHaveAttribute("aria-selected", "true");
    const cachedSurfaces = first.page.getByTestId("workbench-document-surface-cache")
      .locator("[data-tab-id]");
    await expect(cachedSurfaces).toHaveCount(2, { timeout: 30_000 });
    await expect(cachedSurfaces.locator("iframe")).toHaveCount(2);
    await expect(cachedSurfaces.locator("iframe").first())
      .toHaveAttribute("sandbox", "allow-same-origin");
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
    const restoredTabs = restored.page.getByRole("tablist", { name: "已打开的页面" }).getByRole("tab");
    await expect(restoredTabs.filter({ hasText: "registry-restart-a" })).toHaveCount(1);
    await expect(restoredTabs.filter({ hasText: "registry-restart-b" })).toHaveCount(1);
    await expect(restoredTabs.filter({ hasText: "registry-restart-b" })).toHaveAttribute("aria-selected", "true");
    const restoredCache = restored.page.getByTestId("workbench-document-surface-cache");
    await expect(restoredCache.locator("[data-tab-id]")).toHaveCount(1, { timeout: 30_000 });
    await expect(restoredCache).toHaveAttribute("data-warm-count", "1", { timeout: 30_000 });
    const readStartupPresentation = () => restored.page.evaluate(() => ({
      projected: performance.getEntriesByName("pageroot:tab-cache:prewarmed", "mark")
        .find((entry) => entry.detail?.hot === true)?.startTime || null,
      visible: performance.getEntriesByName("pageroot:tab-cache:visible-ready", "mark")[0]
        ?.startTime || null,
      verified: (() => {
        return performance.getEntriesByName("pageroot:canvas:render-verified", "mark")
          .at(-1)?.startTime || null;
      })(),
    }));
    await expect.poll(readStartupPresentation).toMatchObject({
      projected: expect.any(Number),
      verified: expect.any(Number),
    });
    const startupPresentation = await readStartupPresentation();
    expect(startupPresentation.projected).toBeLessThan(startupPresentation.verified);
    if (startupPresentation.visible !== null) {
      expect(startupPresentation.visible).toBeLessThan(startupPresentation.verified);
    }

    await closePageRootGracefully(restored.electronApp, restored.page);
    restoredClosed = true;

    external = await launchPageRoot({
      isolatedUserData: first.isolatedUserData,
      externalSourcePaths: [projectC.sourcePath],
    });
    await loadedDiskFrame(external.page, projectC.sourcePath, "list-item");
    const externalTabs = external.page.getByRole("tablist", { name: "已打开的页面" }).getByRole("tab");
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

test("Electron sidebar opens an imported historical version in the existing project tab", {
  tag: ["@gate-smoke","@smoke-project-lifecycle"],
}, async () => {
  test.setTimeout(180_000);
  const projectA = createSourceFixture("sidebar-history-a.html");
  const projectB = createSourceFixture("sidebar-history-b.html");
  const launched = await launchPageRoot({ activeSourcePath: projectA.sourcePath });
  try {
    await loadedDiskFrame(launched.page, projectA.sourcePath, "list-item");
    await waitForProjectReady(launched.page);
    const managedAPath = await managedWorkingCopyPath(launched.page, projectA.sourcePath);
    const projectsRoot = path.dirname(path.dirname(managedAPath));
    const repository = new ProjectFileRepository({ projectsRoot });
    const imported = await repository.importExternal({
      sourcePath: projectB.sourcePath,
      expectedSourceSha256: sha256(readFileSync(projectB.sourcePath)),
    });
    let target = imported.target;
    for (const [ordinal, title] of [[2, "sidebar history V2"], [3, "sidebar history V3"]]) {
      const candidate = await repository.createCandidate({
        target,
        requestId: `req_sidebar_history_${ordinal}`,
        candidateId: `candidate_sidebar_history_${ordinal}_0001`,
        html: `<!doctype html><html><head><title>${title}</title></head><body><h1>${title}</h1></body></html>`,
        expectedSourceSha256: target.sourceSha256,
      });
      const promoted = await repository.promoteCandidate({
        target,
        candidateId: candidate.candidate.candidateId,
      });
      expect(promoted.promoted).toBe(true);
      target = promoted.target;
    }

    await launched.page.getByRole("button", { name: "展开左侧边栏" }).click();
    const sidebar = launched.page.locator(".workbench-global-sidebar");
    await expect(sidebar).toHaveAttribute("data-open", "true");
    await expect(sidebar.locator(".sidebar-project-section").first()
      .locator(".sidebar-project-row")).toHaveAttribute("aria-expanded", "true");
    const beforeExpansion = await launched.page.evaluate(() => (
      window.htmlAIProjects?.getActiveProject()?.projectId || null
    ));
    const importedProject = sidebar.locator(".sidebar-imported-project")
      .filter({ hasText: "sidebar-history-b" })
      .first();
    await expect(importedProject).toBeVisible();
    await importedProject.locator(".sidebar-project-row").click();
    await expect(importedProject.locator(".sidebar-version-file")).toHaveCount(3, {
      timeout: 30_000,
    });
    expect(await launched.page.evaluate(() => (
      window.htmlAIProjects?.getActiveProject()?.projectId || null
    ))).toBe(beforeExpansion);

    const tabs = launched.page.getByRole("tablist", { name: "已打开的页面" }).getByRole("tab");
    await expect(tabs).toHaveCount(1);
    await importedProject.locator(".sidebar-version-file").first().click();
    await expect(tabs).toHaveCount(2, { timeout: 60_000 });
    await expect(tabs.filter({ hasText: "sidebar-history-b" }))
      .toHaveAttribute("aria-selected", "true", { timeout: 60_000 });
    await expect.poll(() => sidebar.locator(".sidebar-version-tree").count())
      .toBeGreaterThan(0);
    await expect.poll(() => launched.page.locator(".preview-navigation-banner").count(), {
      timeout: 60_000,
    }).toBe(1);
    await expect(launched.page.locator(".preview-navigation-banner").first())
      .toContainText("正在浏览");

    await sidebar.locator(".sidebar-project-section").first()
      .locator(".sidebar-version-file").first().click();
    await expect(tabs).toHaveCount(2);
  } finally {
    await stopPageRoot(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(projectA.sourceDirectory);
    removeSourceFixture(projectB.sourceDirectory);
  }
});
