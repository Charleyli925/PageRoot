import { expect, test } from "@playwright/test";
import {
  ORIGINAL_TEXT,
  chooseClipboardDelivery,
  closePageRootGracefully,
  createSourceFixture,
  launchPageRoot,
  managedProjectRoots,
  removeSourceFixture,
  rewriteWorkspaceDraftComment,
  workspaceContainsDraftComment,
} from "./ai-closed-loop-helpers.mjs";

test("opening a pre-v4 project imports its HTML as a new v4 V1", async () => {
  test.setTimeout(120_000);
  const fixture = createSourceFixture("supplement-ai-loop.html");
  const isolatedUserData = mkdtempSync(
    path.join(tmpdir(), "pageroot-native-e2e-ai-loop-"),
  );
  const legacy = await seedLegacyV3Project({
    isolatedUserData,
    sourcePath: fixture.sourcePath,
  });
  const launched = await launchPageRoot({
    activeSourcePath: fixture.sourcePath,
    isolatedUserData,
  });
  try {
    await waitForProjectReady(launched.page);
    const externalSourcePath = realpathSync(fixture.sourcePath);
    await expect.poll(async () => {
      const active = await launched.page.evaluate(
        async () => await window.htmlAIProjects?.getActiveProject(),
      );
      return active?.sourcePath && active.sourcePath !== externalSourcePath
        ? active
        : null;
    }, { timeout: 45_000 }).toMatchObject({
      sourcePath: expect.stringMatching(/\/supplement-ai-loop-V1\.html$/u),
    });
    const active = await launched.page.evaluate(
      async () => await window.htmlAIProjects?.getActiveProject(),
    );
    expect(active.sourcePath).not.toBe(externalSourcePath);
    expect(readFileSync(fixture.sourcePath).equals(fixture.original)).toBe(true);
    const activeCanonicalPath = realpathSync(active.sourcePath);
    const projectRoot = managedProjectRoots(launched.workspace).find((root) => (
      activeCanonicalPath.startsWith(`${realpathSync(root)}${path.sep}`)
    ));
    expect(projectRoot).toBeTruthy();
    const project = JSON.parse(readFileSync(
      path.join(projectRoot, ".pageroot", "project.json"),
      "utf8",
    ));
    expect(project.projectId).not.toBe(legacy.projectId);
    const manifest = JSON.parse(readFileSync(
      path.join(projectRoot, ".pageroot", "manifest.json"),
      "utf8",
    ));
    expect(manifest.versions.map((version) => version.versionId)).toEqual(["ver_0001"]);
    await expect((await loadedDiskFrame(launched.page, active.sourcePath))
      .locator(caseSelector("list-item"))).toHaveText(ORIGINAL_TEXT);
  } finally {
    await stopPageRoot(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("a persisted global comment stays exact after restart and sends directly", async () => {
  test.setTimeout(120_000);
  const fixture = createSourceFixture("global-comment-restart.html");
  const firstLaunch = await launchPageRoot({ activeSourcePath: fixture.sourcePath });
  const commentText = "重启后仍然保持整个页面的视觉层级。";
  let activeLaunch = firstLaunch;
  try {
    await loadedDiskFrame(firstLaunch.page, fixture.sourcePath);
    await openRailGlobalCommentComposer(firstLaunch.page);
    await firstLaunch.page.getByRole("textbox", { name: "评论内容" })
      .fill(commentText);
    await firstLaunch.page.getByRole("button", { name: "评论", exact: true }).click();
    await expect(firstLaunch.page.locator(".comment-card")
      .filter({ hasText: commentText }))
      .toHaveAttribute("data-resolution", "exact");
    const externalSourcePath = realpathSync(fixture.sourcePath);
    await expect.poll(async () => {
      const activeSourcePath = await firstLaunch.page.evaluate(
        async () => (await window.htmlAIProjects?.getActiveProject())?.sourcePath || "",
      );
      return activeSourcePath && activeSourcePath !== externalSourcePath
        ? activeSourcePath
        : "";
    }, { timeout: 45_000 }).not.toBe("");
    const managedSourcePath = await firstLaunch.page.evaluate(
      async () => (await window.htmlAIProjects?.getActiveProject())?.sourcePath || "",
    );
    const frame = await loadedDiskFrame(firstLaunch.page, managedSourcePath);
    await activateNativeEdit(frame, "list-item");
    await setTextSelection(frame, "list-item", 0, ORIGINAL_TEXT.length);
    await firstLaunch.page.keyboard.insertText("重启兼容测试");
    await expect.poll(
      () => readFileSync(managedSourcePath, "utf8"),
      { timeout: 20_000 },
    ).toContain("重启兼容测试");
    expect(readFileSync(fixture.sourcePath).equals(fixture.original)).toBe(true);
    await expect.poll(
      () => workspaceContainsDraftComment(firstLaunch.workspace, commentText),
      { timeout: 20_000 },
    ).toBe(true);

    await closePageRootGracefully(firstLaunch.electronApp, firstLaunch.page);
    expect(workspaceContainsDraftComment(firstLaunch.workspace, commentText)).toBe(true);
    expect(rewriteWorkspaceDraftComment(
      firstLaunch.workspace,
      commentText,
      (comment) => {
        delete comment.target.fingerprint;
        comment.target.resolution = "orphaned";
      },
    )).toBe(true);
    activeLaunch = await launchPageRoot({
      activeSourcePath: managedSourcePath,
      isolatedUserData: firstLaunch.isolatedUserData,
    });
    await expect.poll(
      () => workspaceContainsDraftComment(activeLaunch.workspace, commentText),
      { timeout: 20_000 },
    ).toBe(true);
    await loadedDiskFrame(activeLaunch.page, managedSourcePath);
    const recoveredComment = activeLaunch.page.locator(".comment-card")
      .filter({ hasText: commentText });
    await expect(recoveredComment).toHaveAttribute("data-resolution", "exact");
    await expect(recoveredComment.getByText("原位置已变化")).toHaveCount(0);

    await activeLaunch.page.getByRole("button", { name: /AI 助手/u }).click();
    await chooseClipboardDelivery(activeLaunch.page);
    // The copied-task fact now lives in the sidebar action bar instead of a toast.
    await expect(activeLaunch.page.getByTestId("ai-conversation-action-bar")
      .getByText("任务已复制，等你的 AI 改完", { exact: true }))
      .toBeVisible({ timeout: 30_000 });
    await expect(activeLaunch.page.getByText(/评论需要重新定位/u)).toHaveCount(0);
  } finally {
    await stopPageRoot(activeLaunch.electronApp, firstLaunch.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});
