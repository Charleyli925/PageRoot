import { expect, test } from "@playwright/test";
import {
  ORIGINAL_LIST_TEXT,
  activateNativeEdit,
  addCanvasComment,
  caseSelector,
  chooseClipboardDelivery,
  closePageRootGracefully,
  createSourceFixture,
  existsSync,
  fixtureBuffer,
  launchPageRoot,
  loadedDiskFrame,
  managedWorkingCopyPath,
  mkdtempSync,
  openRailGlobalCommentComposer,
  path,
  readFileSync,
  readdirSync,
  removeIsolatedUserData,
  removeSourceFixture,
  requestDirectoryCount,
  sendToMainRenderer,
  setTextSelection,
  stopPageRoot,
  tmpdir,
  workspaceContainsDraftComment,
  writeFileSync,
} from "./electron-native-harness.mjs";

test("Electron preview shows the read-only comment marker and opens it on hover and keyboard focus", async () => {
  test.setTimeout(90_000);
  const sourceDirectory = mkdtempSync(
    path.join(tmpdir(), "pageroot-preview-comment-e2e-"),
  );
  const sourcePath = path.join(sourceDirectory, "commented-page.html");
  const commentText = "这个标题再简洁一些。";
  writeFileSync(
    sourcePath,
    `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>带评论的页面</title></head>
<body>
  <main>
    <h1 id="headline" data-native-case="preview-comment-headline">季度经营大盘</h1>
    <p id="summary">本季度整体达成预期。</p>
  </main>
</body>
</html>
`,
    "utf8",
  );

  let electronApp = null;
  let isolatedUserData = null;
  try {
    const launched = await launchPageRoot({ activeSourcePath: sourcePath });
    electronApp = launched.electronApp;
    isolatedUserData = launched.isolatedUserData;
    const { frame: editFrame } = await loadedDiskFrame(
      launched.page,
      sourcePath,
      "preview-comment-headline",
    );

    // A comment anchored to one element, not a global page comment: only an
    // element target has a place on the page to mark.
    await editFrame.locator(caseSelector("preview-comment-headline")).click();
    await launched.page.getByRole("toolbar", { name: /编辑/u })
      .getByRole("button", { name: /留评论/u })
      .click();
    const composer = launched.page.getByRole("region", { name: "添加评论" });
    await expect(composer).toBeVisible();
    await composer.getByRole("textbox", { name: "评论内容" }).fill(commentText);
    await composer.getByRole("button", { name: "评论", exact: true }).click();

    await launched.page.getByRole("button", { name: "预览", exact: true }).click();
    await expect(launched.page.locator('iframe[title="HTML 交互预览"]'))
      .toBeVisible();

    const marker = launched.page.getByTestId("preview-comment-marker");
    await expect(marker).toHaveCount(1, { timeout: 30_000 });
    await expect(marker).toBeVisible();
    // The marker sits over the page, never at the viewport origin.
    await expect.poll(async () => {
      const box = await marker.boundingBox();
      return box ? box.x > 0 && box.y > 0 : false;
    }).toBe(true);

    // Comment text lives in the trusted host, never inside the previewed page.
    const previewFrame = launched.page.frames().find(
      (frame) => /^pageroot-preview:/u.test(frame.url()),
    );
    if (previewFrame) {
      await expect.poll(() => previewFrame.locator("html").evaluate(
        (element, text) => element.innerHTML.includes(text),
        commentText,
      )).toBe(false);
    }

    const bubble = marker.getByTestId("preview-comment-bubble");
    await expect(bubble).toBeHidden();
    await marker.hover();
    await expect(bubble).toBeVisible();
    await expect(bubble).toContainText(commentText);

    await launched.page.getByRole("button", { name: "编辑", exact: true }).hover();
    await expect(bubble).toBeHidden();

    // Keyboard focus reaches the same bubble. Press Tab first so the input
    // modality is keyboard again; the bubble binds :focus-visible.
    await launched.page.keyboard.press("Tab");
    await marker.focus();
    await expect(bubble).toBeVisible();
    await expect(bubble).toContainText(commentText);

    // The marker is read-only: it never enters editing or moves the selection.
    await launched.page.keyboard.press("Enter");
    await launched.page.keyboard.press("Space");
    await expect(bubble).toBeVisible();
    await expect(launched.page.getByRole("region", { name: "添加评论" }))
      .toHaveCount(0);
    await expect(launched.page.locator('iframe[title="HTML 交互预览"]'))
      .toBeVisible();

    await marker.blur();
    await expect(bubble).toBeHidden();
  } finally {
    if (electronApp && isolatedUserData) {
      await stopPageRoot(electronApp, isolatedUserData);
    }
    removeValidatedTemporaryDirectory(
      sourceDirectory,
      "pageroot-preview-comment-e2e-",
    );
  }
});

test("Electron preview mounts the modification-only AI sidebar across reopen", async () => {
  test.setTimeout(90_000);
  const sourceDirectory = mkdtempSync(
    path.join(tmpdir(), "pageroot-ai-sidebar-e2e-"),
  );
  const sourcePath = path.join(sourceDirectory, "sidebar-page.html");
  writeFileSync(
    sourcePath,
    `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>侧栏页面</title></head>
<body><main><h1 id="headline" data-native-case="sidebar-headline">季度大盘</h1></main></body>
</html>
`,
    "utf8",
  );

  let electronApp = null;
  let isolatedUserData = null;
  try {
    const launched = await launchPageRoot({ activeSourcePath: sourcePath });
    electronApp = launched.electronApp;
    isolatedUserData = launched.isolatedUserData;
    await loadedDiskFrame(launched.page, sourcePath, "sidebar-headline");

    await openRailGlobalCommentComposer(launched.page);
    await launched.page.getByRole("textbox", { name: "评论内容" })
      .fill("请把季度大盘标题改得更简洁。");
    await launched.page.getByRole("button", { name: "评论", exact: true }).click();

    await launched.page.getByRole("button", { name: "预览", exact: true }).click();
    await expect(launched.page.locator('iframe[title="HTML 交互预览"]'))
      .toBeVisible();

    // The sidebar is opt-in in preview: a docked aside, not a modal.
    const openToggle = launched.page.getByRole("button", { name: "AI 助手" });
    await expect(openToggle).toHaveCount(1);
    await expect(openToggle).toBeVisible();
    await openToggle.click();

    const sidebar = launched.page.getByTestId("ai-conversation-sidebar");
    await expect(sidebar).toBeVisible();
    await expect(launched.page.getByTestId("ai-conversation-mode"))
      .toHaveText("修改 · 待发送");
    // The preview iframe stays alive beside the sidebar — not replaced by a modal.
    await expect(launched.page.locator('iframe[title="HTML 交互预览"]'))
      .toBeVisible();

    // Wait for the conversation to finish loading: the empty-state copy appears
    // only once the Bridge has established this Document's conversation. Typing
    // before that would be dropped by the controlled composer.
    await expect(sidebar.getByText("还没有修改记录", { exact: false }))
      .toBeVisible({ timeout: 15_000 });
    await expect(sidebar.getByTestId("ai-conversation-input")).toHaveCount(0);
    await expect(sidebar.getByTestId("ai-conversation-intent")).toHaveCount(0);
    await expect(sidebar.getByTestId("ai-conversation-context-summary"))
      .toContainText("1 条评论");

    // Collapsing and reopening keeps the same single-purpose product surface.
    await launched.page.getByRole("button", { name: "收起 AI 助手" }).click();
    await expect(sidebar).toHaveCount(0);
    await launched.page.getByRole("button", { name: "AI 助手" }).click();
    await expect(launched.page.getByTestId("ai-conversation-mode"))
      .toHaveText("修改 · 待发送", { timeout: 15_000 });
    await expect(launched.page.getByTestId("ai-conversation-input")).toHaveCount(0);
  } finally {
    if (electronApp && isolatedUserData) {
      await stopPageRoot(electronApp, isolatedUserData);
    }
    removeValidatedTemporaryDirectory(
      sourceDirectory,
      "pageroot-ai-sidebar-e2e-",
    );
  }
});

test("project resources drain edited rules before leaving", async () => {
  const fixture = createSourceFixture("project-resources.html");
  const launched = await launchPageRoot({ activeSourcePath: fixture.sourcePath });
  try {
    const { frame } = await loadedDiskFrame(launched.page, fixture.sourcePath, "list-item");
    const projectCount = () => {
      const projectsRoot = path.join(path.dirname(launched.workspace), "project-files");
      return existsSync(projectsRoot)
        ? readdirSync(projectsRoot).filter((entry) => !entry.startsWith(".")).length
        : 0;
    };
    expect(projectCount()).toBe(1);
    await addCanvasComment(
      launched.page,
      frame,
      "list-item",
      "创建受管项目后再编辑项目资料。",
    );
    const managedSourcePath = await managedWorkingCopyPath(launched.page, fixture.sourcePath);
    await loadedDiskFrame(launched.page, managedSourcePath, "list-item");
    const projectRoot = path.dirname(managedSourcePath);
    expect(projectCount()).toBe(1);
    await launched.page.getByRole("button", { name: "项目", exact: true }).click();
    expect(projectCount()).toBe(1);
    // The rules row is a disclosure inside the console: it expands in place
    // instead of navigating away from the version tree.
    const rulesButton = launched.page.getByRole("button", {
      name: /项目规则.*每次 AI Agent 修改本项目 HTML 都会读取/u,
    });
    await expect(rulesButton).toBeVisible();
    await expect(rulesButton).toHaveAttribute("aria-expanded", "false");
    await rulesButton.click();
    await expect(rulesButton).toHaveAttribute("aria-expanded", "true");
    await expect(launched.page.getByText(
      "修改会自动保存。每次发送至 Qoder 时，源页都会把这份规则与本轮要求一起交接；规则只影响后续任务，不会修改当前 HTML。",
      { exact: true },
    )).toBeVisible();
    const rulesEditor = launched.page.getByRole("textbox", { name: "项目长期规则" });
    await expect(rulesEditor).toBeEnabled();
    const originalRules = await rulesEditor.inputValue();
    const updatedRules = `${originalRules}\n\n- 测试自动保存保护`;
    await rulesEditor.fill(updatedRules);
    const projectRulesPath = path.join(projectRoot, "PROJECT.md");
    await expect.poll(
      () => readFileSync(projectRulesPath, "utf8"),
      { timeout: 20_000 },
    ).toBe(updatedRules);
    // Only a real edit that reached disk announces itself.
    await expect(launched.page.getByText("项目规则已保存", { exact: true }))
      .toBeVisible();

    await rulesEditor.fill(`${updatedRules}\n- 这行只用于验证还原`);
    await launched.page.getByRole("button", { name: "还原修改" }).click();
    await expect(rulesEditor).toHaveValue(updatedRules);
    // Collapsing keeps the console open, so the version tree stays in place.
    await rulesButton.click();
    await expect(rulesButton).toHaveAttribute("aria-expanded", "false");
    await expect(rulesEditor).toHaveCount(0);
    await expect(launched.page.getByText("版本树", { exact: true })).toBeVisible();
    expect(readFileSync(fixture.sourcePath).equals(fixture.original)).toBe(true);
  } finally {
    await stopPageRoot(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});

// Unquarantined and hardened by the #281 product fix: the relink action now
// lives on the persistent comment-rail card instead of a toast button, which
// could be detached mid-click by a reflow window with no retry loop for a
// human. The card survives reflows, so its button-state flip is a
// deterministic oracle and the original send still resumes after every
// target is re-proven.

test("multiple orphaned comments relink in sequence and resume the original send", async () => {
  test.setTimeout(120_000);
  const fixture = createSourceFixture("orphaned-comments-resume-send.html");
  const firstLaunch = await launchPageRoot({ activeSourcePath: fixture.sourcePath });
  const firstComment = "把原列表项改成更简洁的表达。";
  const secondComment = "把原表格单元格改成更清楚的说明。";
  let activeLaunch = firstLaunch;
  let firstAppClosed = false;
  try {
    const { frame: firstCommentFrame } = await loadedDiskFrame(
      firstLaunch.page,
      fixture.sourcePath,
      "list-item",
    );
    await addCanvasComment(
      firstLaunch.page,
      firstCommentFrame,
      "list-item",
      firstComment,
    );
    const managedSourcePath = await managedWorkingCopyPath(
      firstLaunch.page,
      fixture.sourcePath,
    );
    const { frame: secondCommentFrame } = await loadedDiskFrame(
      firstLaunch.page,
      managedSourcePath,
      "table-cell",
    );
    await addCanvasComment(
      firstLaunch.page,
      secondCommentFrame,
      "table-cell",
      secondComment,
    );
    const { frame: editingFrame } = await loadedDiskFrame(
      firstLaunch.page,
      managedSourcePath,
      "list-item",
    );

    await activateNativeEdit(editingFrame, "list-item");
    await setTextSelection(editingFrame, "list-item", 0, ORIGINAL_LIST_TEXT.length);
    await firstLaunch.page.keyboard.insertText("失联评论登记测试");
    await expect.poll(
      () => workspaceContainsDraftComment(firstLaunch.workspace, secondComment),
      { timeout: 20_000 },
    ).toBe(true);
    await closePageRootGracefully(firstLaunch.electronApp, firstLaunch.page);
    firstAppClosed = true;

    const externallyChanged = readFileSync(managedSourcePath, "utf8")
      .replace(
        /<li data-native-case="list-item"[^>]*>[\s\S]*?<\/li>/u,
        "",
      )
      .replace(
        /<td data-native-case="table-cell"[^>]*>[\s\S]*?<\/td>/u,
        "",
      );
    writeFileSync(managedSourcePath, externallyChanged, "utf8");

    activeLaunch = await launchPageRoot({
      isolatedUserData: firstLaunch.isolatedUserData,
    });
    const { frame: recoveredFrame } = await loadedDiskFrame(
      activeLaunch.page,
      managedSourcePath,
      "flex-copy",
    );
    const recoveredComments = activeLaunch.page.locator(".comment-card");
    await expect(recoveredComments).toHaveCount(2);
    await expect(recoveredComments.filter({ hasText: firstComment }))
      .toHaveAttribute("data-resolution", "orphaned");
    await expect(recoveredComments.filter({ hasText: secondComment }))
      .toHaveAttribute("data-resolution", "orphaned");

    await activeLaunch.page.getByRole("button", { name: /AI 助手/u }).click();
    await chooseClipboardDelivery(activeLaunch.page);
    // The relink entry is a persistent card on the comment rail, not a toast
    // button: a toast could be detached mid-click by a reflow window and a
    // human has no retry loop (#281). The rail is outside the canvas flow, so
    // the card's button-state flip ("正在等待选择…") is the deterministic
    // oracle that the handler ran; no re-click loop is needed.
    const relinkCard = activeLaunch.page.locator(".comment-rail .rail-relink-status");
    await expect(relinkCard).toContainText("2 条评论需要重新定位");
    await relinkCard.getByRole("button", { name: "开始重新定位" }).click();
    await expect(relinkCard.getByRole("button", { name: "正在等待选择…" }))
      .toBeVisible();

    await recoveredFrame.locator(caseSelector("flex-copy")).click();
    await expect(relinkCard).toContainText("1 条评论需要重新定位");
    await expect(recoveredComments.filter({ hasText: firstComment }))
      .toHaveAttribute("data-resolution", "exact");
    await expect(recoveredComments.filter({ hasText: secondComment }))
      .toHaveAttribute("data-resolution", "orphaned");

    await recoveredFrame.locator(caseSelector("grid-card")).click();
    await expect(activeLaunch.page.getByTestId("ai-conversation-action-bar"))
      .toContainText("任务已复制，等你的 AI 改完", { timeout: 30_000 });
    await expect.poll(
      () => requestDirectoryCount(activeLaunch.workspace),
      { timeout: 20_000 },
    ).toBe(1);
  } finally {
    if (activeLaunch !== firstLaunch) {
      await stopPageRoot(activeLaunch.electronApp, firstLaunch.isolatedUserData);
    } else if (!firstAppClosed) {
      await stopPageRoot(firstLaunch.electronApp, firstLaunch.isolatedUserData);
    } else {
      removeIsolatedUserData(firstLaunch.isolatedUserData);
    }
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("automatic update actions keep the header geometry and About lifecycle", async () => {
  const fixture = createSourceFixture("update-indicator.html");
  const launched = await launchPageRoot({ activeSourcePath: fixture.sourcePath });
  try {
    await loadedDiskFrame(launched.page, fixture.sourcePath, "list-item");
    const captureHeader = async ({ badgeExpected = true } = {}) => {
      const geometry = await launched.page.evaluate(() => {
        const rect = (selector) => {
          const element = document.querySelector(selector);
          if (!element) return null;
          const box = element.getBoundingClientRect();
          return {
            left: box.left,
            top: box.top,
            right: box.right,
            bottom: box.bottom,
            width: box.width,
            height: box.height,
          };
        };
        return {
          header: rect(".workbench-header"),
          cluster: rect(".window-file-icon-cluster"),
          icon: rect(".window-file-about-button"),
          badge: rect(".window-file-update-badge"),
          badgeLabel: rect(".window-file-update-badge > span"),
          fileCopy: rect(".window-file-copy"),
        };
      });
      expect(geometry.header).not.toBeNull();
      expect(geometry.cluster).not.toBeNull();
      expect(geometry.icon).not.toBeNull();
      expect(geometry.fileCopy).not.toBeNull();
      expect(Math.abs(
        (geometry.icon.top + geometry.icon.bottom) / 2
        - (geometry.cluster.top + geometry.cluster.bottom) / 2,
      )).toBeLessThanOrEqual(0.5);
      if (badgeExpected) {
        expect(geometry.badge).not.toBeNull();
        expect(geometry.badgeLabel).not.toBeNull();
        expect(geometry.badgeLabel.top).toBeGreaterThanOrEqual(
          geometry.header.top,
        );
        expect(geometry.badgeLabel.bottom).toBeLessThanOrEqual(
          geometry.header.bottom,
        );
        expect(geometry.badgeLabel.right).toBeLessThanOrEqual(
          geometry.fileCopy.left - 8,
        );
        expect(geometry.badgeLabel.top).toBeLessThan(geometry.icon.bottom);
      } else {
        expect(geometry.badge).toBeNull();
        expect(geometry.badgeLabel).toBeNull();
      }
      return geometry;
    };

    const noUpdateGeometry = await captureHeader({ badgeExpected: false });
    const updateStatus = {
      currentVersion: "0.8.6",
      latestVersion: "9.9.9",
      minimumMacOS: "12.0",
      architecture: "arm64",
      publishedAt: "2026-07-23T00:00:00.000Z",
    };
    await sendToMainRenderer(
      launched.electronApp,
      launched.page,
      "html-updates:status",
      { ...updateStatus, status: "available" },
    );
    await expect(launched.page.getByRole("button", {
      name: "发现 PageRoot 9.9.9，下载更新",
    })).toBeVisible();
    const availableGeometry = await captureHeader();

    await launched.page.getByRole("button", { name: "关于源页" }).click();
    await expect(launched.page.getByRole("dialog", { name: "源页" }))
      .toBeVisible();
    await launched.page.getByRole("button", { name: "关闭关于源页" }).click();
    await expect(launched.page.locator("dialog.about-dialog[open]"))
      .toHaveCount(0);

    await sendToMainRenderer(
      launched.electronApp,
      launched.page,
      "html-updates:status",
      { ...updateStatus, status: "downloaded" },
    );
    await expect(launched.page.getByRole("button", {
      name: "PageRoot 9.9.9 已下载，重启更新",
    })).toBeVisible();
    await expect(launched.page.getByRole("dialog", {
      name: "现在重启并安装更新？",
    })).toBeVisible();
    await launched.page.getByRole("button", { name: "稍后" }).click();
    await expect(launched.page.locator("dialog.restart-update-dialog[open]"))
      .toHaveCount(0);
    const downloadedGeometry = await captureHeader();
    for (const geometry of [availableGeometry, downloadedGeometry]) {
      expect(geometry.icon).toEqual(noUpdateGeometry.icon);
      expect(geometry.cluster).toEqual(noUpdateGeometry.cluster);
      expect(geometry.fileCopy).toEqual(noUpdateGeometry.fileCopy);
    }
  } finally {
    await stopPageRoot(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("PROJECT.md read failure never becomes editable data and recovers in place", async () => {
  test.setTimeout(60_000);
  const sourceDirectory = mkdtempSync(path.join(tmpdir(), "pageroot-native-source-e2e-"));
  const sourcePath = path.join(sourceDirectory, "project-rules-recovery.html");
  writeFileSync(sourcePath, fixtureBuffer("complex-layout.html"));
  const isolatedUserData = mkdtempSync(path.join(tmpdir(), "pageroot-native-e2e-"));
  let electronApp = null;
  try {
    const launched = await launchPageRoot({
      isolatedUserData,
      activeSourcePath: sourcePath,
    });
    electronApp = launched.electronApp;
    const { frame } = await loadedDiskFrame(launched.page, sourcePath, "list-item");
    await addCanvasComment(
      launched.page,
      frame,
      "list-item",
      "创建受管项目以验证项目规则读取失败。",
    );
    const managedSourcePath = await managedWorkingCopyPath(launched.page, sourcePath);
    await loadedDiskFrame(launched.page, managedSourcePath, "list-item");

    await launched.page.getByRole("button", { name: "项目", exact: true }).click();
    const projectRules = launched.page.getByRole("button", {
      name: /项目规则/u,
    });
    await expect(projectRules).toBeEnabled({ timeout: 20_000 });

    const projectFileRoute = "**/file?**";
    const rejectProjectRulesRead = async (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get("path") === "PROJECT.md") {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({
            ok: false,
            error: { message: "测试注入：项目规则暂时不可读。" },
          }),
        });
        return;
      }
      await route.continue();
    };
    await launched.page.route(projectFileRoute, rejectProjectRulesRead);

    await projectRules.click();
    const failure = launched.page.getByRole("alert")
      .filter({ hasText: "内容没有读取成功" });
    await expect(failure).toBeVisible();
    await expect(failure).toContainText("项目规则暂时不可读");
    await expect(launched.page.getByRole("textbox", { name: "项目长期规则" }))
      .toHaveCount(0);
    await expect(failure.getByRole("button", { name: "重试读取" })).toBeVisible();
    // The console stays put, so the version tree is still alongside the failure.
    await expect(launched.page.getByText("版本树", { exact: true })).toBeVisible();

    await launched.page.unroute(projectFileRoute, rejectProjectRulesRead);
    await failure.getByRole("button", { name: "重试读取" }).click();
    const editor = launched.page.getByRole("textbox", { name: "项目长期规则" });
    await expect(editor).toBeVisible();
    await expect(editor).not.toHaveValue(/测试注入|文件尚未生成/u);
  } finally {
    if (electronApp) {
      await stopPageRoot(electronApp, isolatedUserData, { cleanup: false });
    }
    removeIsolatedUserData(isolatedUserData);
    removeValidatedTemporaryDirectory(
      sourceDirectory,
      "pageroot-native-source-e2e-",
    );
  }
});

test("workspace failure keeps the current page visible with export and relaunch paths", async () => {
  const sourceDirectory = mkdtempSync(path.join(tmpdir(), "pageroot-native-source-e2e-"));
  const sourcePath = path.join(sourceDirectory, "workspace-recovery.html");
  writeFileSync(sourcePath, fixtureBuffer("complex-layout.html"));
  const isolatedUserData = mkdtempSync(path.join(tmpdir(), "pageroot-native-e2e-"));
  let electronApp = null;
  try {
    const launched = await launchPageRoot({
      isolatedUserData,
      activeSourcePath: sourcePath,
    });
    electronApp = launched.electronApp;
    await loadedDiskFrame(launched.page, sourcePath, "list-item");
    const mainRendererUrl = launched.page.url();
    await launched.electronApp.evaluate(({ BrowserWindow }, rendererUrl) => {
      const mainWindow = BrowserWindow.getAllWindows().find((candidate) => (
        candidate.webContents.getURL() === rendererUrl
      ));
      if (!mainWindow) {
        throw new Error("PageRoot main BrowserWindow is unavailable for workspace recovery.");
      }
      mainWindow.webContents.send(
        "html-app:workspace-unavailable",
        {
          title: "本地项目资料暂时不可用",
          message: "当前页面内容仍保留。可先导出当前编辑，再重新打开源页。",
        },
      );
    }, mainRendererUrl);

    const recovery = launched.page.getByRole("alert")
      .filter({ hasText: "本地项目资料暂时不可用" });
    await expect(recovery).toBeVisible();
    await expect(recovery.getByRole("button", { name: "导出当前编辑" }))
      .toBeVisible();
    await expect(recovery.getByRole("button", { name: "重新打开源页" }))
      .toBeVisible();
    const globalCommentButton = launched.page.locator('aside[aria-label="本轮评论"]')
      .getByRole("button", { name: "全局评论", exact: true });
    await expect(globalCommentButton).toBeVisible();
    await expect(globalCommentButton).toBeDisabled();
    await expect(launched.page.getByTestId("html-canvas-editor")
      .filter({ visible: true })
      .first()
      .locator('iframe[title*="本轮已锁定"]')).toBeVisible();
  } finally {
    if (electronApp) {
      await stopPageRoot(electronApp, isolatedUserData, { cleanup: false });
    }
    removeIsolatedUserData(isolatedUserData);
    removeValidatedTemporaryDirectory(
      sourceDirectory,
      "pageroot-native-source-e2e-",
    );
  }
});
