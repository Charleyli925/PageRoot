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
  mkdirSync,
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

function identityPreservingCandidateHtml(target, title) {
  const current = readFileSync(target.exactSourcePath, "utf8");
  const candidate = current.replace(
    /(<title\b[^>]*>)[\s\S]*?(<\/title>)/iu,
    (_match, opening, closing) => `${opening}${title}${closing}`,
  );
  return candidate === current
    ? current.replace(/<\/html\s*>/iu, `<!-- ${title} --></html>`)
    : candidate;
}

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

test("Electron settings routes categories and persists restore preference without hiding external opens", {
  tag: ["@gate-smoke", "@smoke-project-lifecycle"],
}, async () => {
  test.setTimeout(240_000);
  const fixture = createSourceFixture("settings-workspace-preferences.html");
  const first = await launchPageRoot({
    activeSourcePath: fixture.sourcePath,
    firstEditGuide: true,
  });
  let firstClosed = false;
  let reopened = null;
  let reopenedClosed = false;
  let external = null;
  try {
    await loadedDiskFrame(first.page, fixture.sourcePath, "list-item");
    await waitForProjectReady(first.page);
    const guideClose = first.page.getByRole("button", { name: "跳过这次说明" });
    if (await guideClose.count()) await guideClose.click();

    await first.page.getByRole("button", { name: "展开左侧边栏" }).click();
    const sidebar = first.page.locator(".workbench-global-sidebar");
    const preferencesPath = path.join(first.isolatedUserData, "ui-preferences.json");
    const sidebarResizer = sidebar.locator('[data-resizer="sidebar"]');
    await sidebarResizer.focus();
    await sidebarResizer.press("ArrowRight");
    await expect.poll(() => {
      try {
        return JSON.parse(readFileSync(preferencesPath, "utf8"));
      } catch {
        return null;
      }
    }).toMatchObject({
      schemaVersion: 2,
      workspace: { sidebarWidth: 280 },
    });
    await sidebar.getByRole("button", { name: "设置", exact: true }).click();
    const settings = first.page.locator(".workbench-settings-page");
    await expect(settings.getByRole("heading", { name: "常规" })).toBeFocused();
    await expect(settings).not.toContainText("智能滚动");
    await expect(settings).not.toContainText("快捷键提示");
    await expect(settings).not.toContainText("最近打开记录");
    const visibleToast = first.page.locator(".toast.show");
    await visibleToast.waitFor({ state: "visible", timeout: 2_000 }).catch(() => {});
    if (await visibleToast.isVisible().catch(() => false)) {
      await visibleToast.getByRole("button", { name: "关闭提醒" }).click();
      await expect(visibleToast).toBeHidden();
    }
    const captureDirectory = process.env.PAGEROOT_CAPTURE_SETTINGS_DIR
      ? path.resolve(process.env.PAGEROOT_CAPTURE_SETTINGS_DIR)
      : null;
    const captureSettings = async (name, width, height) => {
      if (!captureDirectory) return;
      mkdirSync(captureDirectory, { recursive: true });
      const bounds = await first.electronApp.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows().find((candidate) => (
          candidate.webContents.getURL().includes("/dist-desktop/renderer/")
          || candidate.getTitle() === "源页"
        ));
        return window?.getBounds() || null;
      });
      await first.electronApp.evaluate(({ BrowserWindow }, nextBounds) => {
        const window = BrowserWindow.getAllWindows().find((candidate) => (
          candidate.webContents.getURL().includes("/dist-desktop/renderer/")
          || candidate.getTitle() === "源页"
        ));
        window?.setBounds(nextBounds, false);
      }, { ...(bounds || {}), width, height });
      await expect.poll(() => first.page.evaluate(() => window.innerWidth)).toBe(width);
      await first.page.waitForTimeout(220);
      await first.page.screenshot({
        path: path.join(captureDirectory, `${name}.png`),
        animations: "disabled",
      });
    };
    await captureSettings("settings-general-1440x1024", 1440, 1024);
    await captureSettings("settings-general-1024x768", 1024, 768);
    await captureSettings("settings-general-960x720", 960, 720);

    await settings.getByRole("checkbox", { name: "启动时恢复上次标签页" }).uncheck();
    await expect.poll(() => {
      try {
        return JSON.parse(readFileSync(preferencesPath, "utf8"));
      } catch {
        return null;
      }
    }).toMatchObject({
      schemaVersion: 2,
      workspace: { restoreTabsOnLaunch: false },
    });

    await first.page.getByRole("button", { name: "AI Agent", exact: true }).click();
    await expect(settings.getByRole("heading", { name: "AI Agent" })).toBeFocused();
    await captureSettings("settings-agent-1440x1024", 1440, 1024);
    await settings.getByRole("combobox", { name: "默认 Agent" }).selectOption({ label: "Codex" });
    await expect.poll(() => {
      try {
        return JSON.parse(readFileSync(preferencesPath, "utf8"));
      } catch {
        return null;
      }
    }).toMatchObject({ workspace: { defaultAgentProviderId: "codex" } });
    await first.page.getByRole("button", { name: "软件更新", exact: true }).click();
    await expect(settings.getByRole("heading", { name: "软件更新" })).toBeFocused();
    await captureSettings("settings-updates-1440x1024", 1440, 1024);

    const tabs = first.page.getByRole("tablist", { name: "已打开的页面" }).getByRole("tab");
    await tabs.filter({ hasText: "settings-workspace-preferences" }).click();
    await expect(settings).toHaveCount(0);
    await first.page.getByRole("tab", { name: "设置", exact: true }).click();
    await expect(settings.getByRole("heading", { name: "软件更新" })).toBeFocused();

    await first.page.getByRole("button", { name: "返回工作台" }).click();
    await expect(settings).toHaveCount(0);
    await sidebar.getByRole("button", { name: "设置", exact: true }).click();
    await expect(settings.getByRole("heading", { name: "常规" })).toBeFocused();
    await expect(settings.getByRole("checkbox", { name: "启动时恢复上次标签页" }))
      .not.toBeChecked();
    await settings.getByRole("checkbox", { name: "记住面板宽度" }).uncheck();
    await expect.poll(() => {
      try {
        return JSON.parse(readFileSync(preferencesPath, "utf8"));
      } catch {
        return null;
      }
    }).toMatchObject({ workspace: { rememberPanelWidths: false } });
    await first.page.getByRole("button", { name: "返回工作台" }).click();
    await sidebarResizer.focus();
    await sidebarResizer.press("ArrowRight");
    await expect.poll(() => {
      try {
        return JSON.parse(readFileSync(preferencesPath, "utf8"))?.workspace?.sidebarWidth;
      } catch {
        return null;
      }
    }).toBe(280);

    await closePageRootGracefully(first.electronApp, first.page);
    firstClosed = true;
    reopened = await launchPageRoot({
      isolatedUserData: first.isolatedUserData,
      firstEditGuide: true,
    });
    const reopenedTabs = reopened.page.getByRole("tablist", { name: "已打开的页面" })
      .getByRole("tab");
    await expect(reopened.page.locator("main.workbench")).toHaveAttribute(
      "data-start-page",
      "true",
    );
    await expect.poll(() => reopened.page.locator("main.workbench").evaluate((element) => (
      getComputedStyle(element).getPropertyValue("--workbench-sidebar-width-saved").trim()
    ))).toBe("280px");
    await expect(reopenedTabs).toHaveCount(1);
    await closePageRootGracefully(reopened.electronApp, reopened.page);
    reopenedClosed = true;

    external = await launchPageRoot({
      isolatedUserData: first.isolatedUserData,
      externalSourcePaths: [fixture.sourcePath],
      firstEditGuide: true,
    });
    await loadedDiskFrame(external.page, fixture.sourcePath, "list-item");
    await expect(external.page.locator("main.workbench")).not.toHaveAttribute(
      "data-start-page",
      "true",
    );
  } finally {
    if (external) {
      await stopPageRoot(external.electronApp, external.isolatedUserData);
    } else if (reopened && !reopenedClosed) {
      await stopPageRoot(reopened.electronApp, reopened.isolatedUserData);
    } else if (!firstClosed) {
      await stopPageRoot(first.electronApp, first.isolatedUserData);
    } else {
      removeIsolatedUserData(first.isolatedUserData);
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
  const additionalProjects = ["C", "D", "E", "F"].map((suffix) => createSourceFixture(
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
    await frame.evaluate(() => {
      window.__qaRuntimeDocumentToken = crypto.randomUUID();
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
    const cachedAEntry = launched.page.getByTestId("workbench-document-surface-cache")
      .locator(`[data-tab-id="${cachedATabId}"]`);
    const cachedASourceSha256 = await cachedAEntry.getAttribute("data-source-sha256");
    expect(cachedASourceSha256).toMatch(/^sha256:/u);
    const cachedAFrame = cachedAEntry.locator("iframe");
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
      const suffix = ["C", "D", "E", "F"][index];
      await htmlInput.setInputFiles(project.sourcePath);
      frame = await waitForBrowserText(`Browser memory ${suffix}`);
    }
    await expect(tabs).toHaveCount(afterA + 5);
    await expect(launched.page.getByTestId("workbench-document-canvas-pool"))
      .toHaveAttribute("data-runtime-hot-count", "5");
    const cacheRoot = launched.page.getByTestId("workbench-document-surface-cache");
    await expect(cacheRoot).toHaveAttribute("data-hot-count", "5");
    await expect(cacheRoot).toHaveAttribute("data-max-hot-entries", "5");
    await expect(cacheRoot.locator(`[data-tab-id="${cachedATabId}"]`)).toHaveCount(0);
    await launched.page.evaluate((tabId) => {
      const states = [];
      const inspect = () => {
        const root = document.querySelector('[data-testid="workbench-document-surface-cache"]');
        const entries = root ? [...root.querySelectorAll("[data-tab-id]")] : [];
        states.push({
          rootVisible: root?.dataset.visible === "true",
          visibleEntries: entries
            .filter((entry) => !entry.hidden)
            .map((entry) => ({
              tabId: entry.dataset.tabId,
              sourceSha256: entry.dataset.sourceSha256,
              ready: entry.querySelector("[data-display-ready]")?.dataset.displayReady === "true",
            })),
        });
      };
      const observer = new MutationObserver(inspect);
      observer.observe(document.body, {
        attributes: true,
        attributeFilter: [
          "data-display-ready",
          "data-source-sha256",
          "data-tab-id",
          "data-visible",
          "hidden",
        ],
        childList: true,
        subtree: true,
      });
      window.__qaCacheVisibilityStates = states;
      window.__qaCacheVisibilityObserver = observer;
      void tabId;
    }, cachedATabId);
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
    await expect(tabs).toHaveCount(afterA + 5);
    const cacheVisibilityStates = await launched.page.evaluate(() => {
      window.__qaCacheVisibilityObserver?.disconnect();
      return window.__qaCacheVisibilityStates || [];
    });
    expect(cacheVisibilityStates).not.toHaveLength(0);
    expect(cacheVisibilityStates.some((state) => (
      state.rootVisible
      && state.visibleEntries.some((entry) => entry.ready !== true)
    ))).toBe(false);
    for (const state of cacheVisibilityStates) {
      if (!state.rootVisible) continue;
      expect(state.visibleEntries).toHaveLength(1);
      expect(state.visibleEntries[0].ready).toBe(true);
    }
    const visibleCacheState = cacheVisibilityStates.find((state) => (
      state.rootVisible
      && state.visibleEntries[0]?.tabId === cachedATabId
    ));
    if (visibleCacheState) {
      expect(visibleCacheState.visibleEntries[0].sourceSha256).toBe(cachedASourceSha256);
    }
    await expect.poll(() => launched.page.evaluate((tabId) => (
      performance.getEntriesByName("pageroot:runtime-hot:visible-ready", "mark")
        .find((entry) => entry.detail?.tabId === tabId)?.startTime || null
    ), cachedATabId), { timeout: 30_000 }).toEqual(expect.any(Number));
    const runtimePool = launched.page.getByTestId("workbench-document-canvas-pool");
    await expect(runtimePool).toHaveAttribute("data-runtime-hot-limit", "5");
    await expect(cacheRoot).toHaveAttribute("data-hot-count", "5");
    await expect(cacheRoot).toHaveAttribute("data-max-hot-entries", "5");

    await htmlInput.setInputFiles(projectA.sourcePath);
    frame = await waitForBrowserText("Browser memory A");
    await expect(frame.locator(caseSelector("list-item"))).toHaveText("Browser memory A");
    await expect(tabs.filter({ hasText: "browser-memory-a" })).toHaveCount(1);
    await expect(tabs.filter({ hasText: "browser-memory-b" })).toHaveCount(1);
    await expect(tabs).toHaveCount(afterA + 5);
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
        html: identityPreservingCandidateHtml(target, title),
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

test("Electron sidebar keeps multiple project trees expanded without switching identity", {
  tag: ["@gate-smoke", "@smoke-project-lifecycle"],
}, async () => {
  test.setTimeout(180_000);
  const projectA = createSourceFixture("sidebar-expansion-a.html");
  const projectB = createSourceFixture("sidebar-expansion-b.html");
  const projectC = createSourceFixture(
    "sidebar-expansion-c-with-a-very-long-file-name-for-tooltip.html",
  );
  const launched = await launchPageRoot({ activeSourcePath: projectA.sourcePath });
  try {
    await loadedDiskFrame(launched.page, projectA.sourcePath, "list-item");
    await waitForProjectReady(launched.page);
    const managedAPath = await managedWorkingCopyPath(launched.page, projectA.sourcePath);
    const repository = new ProjectFileRepository({
      projectsRoot: path.dirname(path.dirname(managedAPath)),
    });
    for (const project of [projectB, projectC]) {
      const imported = await repository.importExternal({
        sourcePath: project.sourcePath,
        expectedSourceSha256: sha256(readFileSync(project.sourcePath)),
      });
      expect(imported.target.projectId).toMatch(/^project_[a-f0-9]{16,64}$/u);
      if (project === projectC) {
        let target = imported.target;
        for (const [ordinal, title] of [[2, "sidebar expansion V2"], [3, "sidebar expansion V3"]]) {
          const candidate = await repository.createCandidate({
            target,
            requestId: `req_sidebar_expansion_${ordinal}`,
            candidateId: `candidate_sidebar_expansion_${ordinal}_0001`,
            html: identityPreservingCandidateHtml(target, title),
            expectedSourceSha256: target.sourceSha256,
          });
          const promoted = await repository.promoteCandidate({
            target,
            candidateId: candidate.candidate.candidateId,
          });
          expect(promoted.promoted).toBe(true);
          target = promoted.target;
        }
      }
    }

    await launched.page.getByRole("button", { name: "展开左侧边栏" }).click();
    const sidebar = launched.page.locator(".workbench-global-sidebar");
    await expect(sidebar).toHaveAttribute("data-open", "true");
    await expect(sidebar.locator(".sidebar-imported-project")).toHaveCount(2, {
      timeout: 30_000,
    });
    const currentProjectId = await launched.page.evaluate(() => (
      window.htmlAIProjects?.getActiveProject()?.projectId || null
    ));
    const currentRow = sidebar.locator(".sidebar-project-row-current");
    await expect(currentRow).toHaveAttribute("aria-expanded", "true");

    const importedProject = (fileName) => sidebar.locator(".sidebar-imported-project")
      .filter({ hasText: path.basename(fileName, path.extname(fileName)) })
      .first();
    const projectBRow = importedProject(projectB.sourcePath).locator(".sidebar-project-row");
    const projectCContainer = importedProject(projectC.sourcePath);
    const projectCRow = projectCContainer.locator(".sidebar-project-row");
    await expect(projectBRow).toBeVisible();
    await expect(projectCRow).toBeVisible();

    await projectBRow.click();
    await expect(projectBRow).toHaveAttribute("aria-expanded", "true");
    await expect(importedProject(projectB.sourcePath).locator(".sidebar-version-file"))
      .toHaveCount(1, { timeout: 30_000 });
    expect(await launched.page.evaluate(() => (
      window.htmlAIProjects?.getActiveProject()?.projectId || null
    ))).toBe(currentProjectId);

    await projectCRow.click();
    await expect(projectCRow).toHaveAttribute("aria-expanded", "true");
    await expect(importedProject(projectB.sourcePath).locator(".sidebar-project-row"))
      .toHaveAttribute("aria-expanded", "true");
    await expect(projectCContainer.locator(".sidebar-version-file"))
      .toHaveCount(3, { timeout: 30_000 });
    const longVersionLabel = await projectCContainer.locator(".sidebar-version-file").first()
      .getAttribute("aria-label");
    expect(longVersionLabel).toMatch(
      /^sidebar-expansion-c-with-a-very-long-file-name-for-tooltip(?:-V1)?\.html/u,
    );

    await projectBRow.click();
    await expect(projectBRow).toHaveAttribute("aria-expanded", "false");
    await expect(projectCRow).toHaveAttribute("aria-expanded", "true");
    expect(await launched.page.evaluate(() => (
      window.htmlAIProjects?.getActiveProject()?.projectId || null
    ))).toBe(currentProjectId);

    const versionVisualFacts = await projectCContainer.locator(".sidebar-version-tree")
      .evaluate((tree) => ({
        fileIcons: tree.querySelectorAll(".sidebar-version-file > svg").length,
        currentLabels: tree.querySelectorAll(".sidebar-version-current-label").length,
        paths: [...tree.querySelectorAll(".sidebar-version-rail-path")]
          .map((element) => getComputedStyle(element).strokeWidth),
        nodes: [...tree.querySelectorAll(
          ".sidebar-version-node:not(.sidebar-version-node-center)",
        )].map((element) => element.getAttribute("r")),
      }));
    expect(versionVisualFacts.fileIcons).toBe(0);
    expect(versionVisualFacts.currentLabels).toBe(0);
    expect(new Set(versionVisualFacts.paths), JSON.stringify(versionVisualFacts))
      .toEqual(new Set(["1.25px"]));
    expect(new Set(versionVisualFacts.nodes)).toEqual(new Set(["3.5"]));

    const tabs = launched.page.getByRole("tablist", { name: "已打开的页面" }).getByRole("tab");
    await projectCContainer.locator(".sidebar-version-file").first().click();
    await expect(tabs.filter({ hasText: "sidebar-expansion-c-with-a-very-long-file-name-for-tooltip" }))
      .toHaveAttribute("aria-selected", "true", { timeout: 60_000 });
    await expect(sidebar.locator(".sidebar-project-row-current"))
      .toHaveAttribute("aria-expanded", "true");
  } finally {
    await stopPageRoot(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(projectA.sourceDirectory);
    removeSourceFixture(projectB.sourceDirectory);
    removeSourceFixture(projectC.sourceDirectory);
  }
});
