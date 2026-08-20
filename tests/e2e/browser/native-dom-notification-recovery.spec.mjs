import { expect, test } from "@playwright/test";

import {
  caseSelector,
  fixtureBuffer,
  loadFixture,
} from "./pageroot-driver.mjs";

async function openFixture(page, name = "notification-recovery.html") {
  await page.goto("/");
  return loadFixture(page, name, {
    buffer: fixtureBuffer("complex-layout.html"),
  });
}

async function openHiddenGlobalCommentComposer(page) {
  const button = page.locator(".global-comment-button");
  await expect(button).toBeHidden();
  await expect(button).toBeEnabled();
  await button.evaluate((element) => element.click());
}

test.describe("notification recovery paths", () => {
  test("a browser encoding error preserves the current page and reopens the HTML picker", async ({
    page,
  }) => {
    await openFixture(page);

    const htmlInput = page.locator('input[type="file"][accept*=".html"]').first();
    await htmlInput.setInputFiles({
      name: "not-utf8.html",
      mimeType: "text/html",
      buffer: Buffer.from([0xc3, 0x28]),
    });

    const notice = page.locator(".toast.show");
    await expect(notice).toContainText("文件编码不支持");
    await expect(notice).toContainText(
      "原文件没有被修改。请先转换为 UTF-8，再重新选择。",
    );
    await expect(notice).toHaveAttribute("role", "status");
    await expect(notice).toHaveAttribute("aria-live", "polite");
    await expect(page.getByText("notification-recovery", { exact: true }).first())
      .toBeVisible();

    const chooserPromise = page.waitForEvent("filechooser");
    const retry = notice.getByRole("button", { name: "重新选择" });
    await retry.focus();
    await page.keyboard.press("Enter");
    const chooser = await chooserPromise;
    await chooser.setFiles({
      name: "recovered-utf8.html",
      mimeType: "text/html",
      buffer: fixtureBuffer("complex-layout.html"),
    });

    await expect(page.getByText("recovered-utf8", { exact: true }).first())
      .toBeVisible();
    await expect(notice).toHaveCount(0);
  });

  test("a notice dismissal is keyboard-accessible and keeps the current page visible", async ({
    page,
  }) => {
    await openFixture(page);

    const htmlInput = page.locator('input[type="file"][accept*=".html"]').first();
    await htmlInput.setInputFiles({
      name: "not-utf8.html",
      mimeType: "text/html",
      buffer: Buffer.from([0xc3, 0x28]),
    });

    const notice = page.locator(".toast.show");
    await expect(notice).toHaveAttribute("role", "status");
    const dismiss = notice.getByRole("button", { name: "关闭提醒" });
    await dismiss.focus();
    await page.keyboard.press("Enter");

    await expect(notice).toHaveCount(0);
    await expect(page.getByText("notification-recovery", { exact: true }).first())
      .toBeVisible();
  });

  test("a full attachment batch leads back to removable attachments before retry", async ({
    page,
  }) => {
    await openFixture(page);
    await openHiddenGlobalCommentComposer(page);

    const composer = page.getByRole("region", { name: "添加评论" });
    await expect(composer).toBeVisible();

    const firstChooserPromise = page.waitForEvent("filechooser");
    await composer.getByRole("button", { name: "添加附件" }).click();
    const firstChooser = await firstChooserPromise;
    await firstChooser.setFiles(Array.from({ length: 10 }, (_, index) => ({
      name: `attachment-${index + 1}.txt`,
      mimeType: "text/plain",
      buffer: Buffer.from(`attachment ${index + 1}`),
    })));

    const attachments = composer.locator(".comment-attachments");
    await expect(attachments).toHaveAttribute("aria-label", "10 个附件");

    const overflowChooserPromise = page.waitForEvent("filechooser");
    await composer.getByRole("button", { name: "添加附件" }).click();
    const overflowChooser = await overflowChooserPromise;
    await overflowChooser.setFiles({
      name: "overflow.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("overflow"),
    });

    const notice = page.locator(".toast.show");
    await expect(notice).toContainText("附件没有加入");
    await expect(notice).toContainText("请先移除一个附件，再重新选择。");
    await notice.getByRole("button", { name: "查看附件" }).click();
    await expect(composer.getByRole("textbox", { name: "评论内容" })).toBeFocused();

    await composer.getByRole("button", { name: "移除文件 attachment-1.txt" }).click();
    await expect(attachments).toHaveAttribute("aria-label", "9 个附件");

    const retryChooserPromise = page.waitForEvent("filechooser");
    await composer.getByRole("button", { name: "添加附件" }).click();
    const retryChooser = await retryChooserPromise;
    await retryChooser.setFiles({
      name: "overflow.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("overflow"),
    });

    await expect(attachments).toHaveAttribute("aria-label", "10 个附件");
    await expect(attachments).toContainText("overflow.txt");
  });

  test("one unsaved comment blocks a second target and Canvas selection keeps its scroll", async ({
    page,
  }) => {
    const { frame } = await openFixture(page);
    const toolbar = page.getByRole("toolbar", { name: /编辑/u });
    const commentButton = toolbar.getByRole("button", { name: /留评论/u });
    const firstTarget = frame.locator(caseSelector("list-item"));
    const secondTarget = frame.locator(caseSelector("flex-copy"));
    const firstComment = "先保存这一条，再继续下一处。";

    await firstTarget.click();
    await commentButton.click();
    const composer = page.getByRole("region", { name: "添加评论" });
    await composer.getByRole("textbox", { name: "评论内容" }).fill(firstComment);
    await composer.getByRole("button", { name: "关闭评论编辑器" }).click();

    const recoveryCard = page.locator(
      ".comment-rail-content > .draft-comment-card",
    );
    const unsavedShortcut = page.getByRole("button", {
      name: "有一条未保存评论",
    });
    await expect(recoveryCard).toHaveCount(1);
    await expect(unsavedShortcut).toHaveCount(1);
    await secondTarget.click();
    await commentButton.click();

    const notice = page.locator(".toast.show");
    await expect(notice).toContainText("上一条评论还未保存");
    await expect(notice).toContainText(
      "请先点击“评论”保存；保存后仍可修改，再为其他内容添加评论。",
    );
    await expect(composer).toHaveCount(0);
    await expect(recoveryCard).toHaveCount(1);

    await notice.getByRole("button", { name: "继续填写" }).click();
    await expect(composer.getByRole("textbox", { name: "评论内容" }))
      .toHaveValue(firstComment);
    await expect(unsavedShortcut).toHaveCount(1);
    await composer.getByRole("button", { name: "评论", exact: true }).click();
    await expect(page.locator(".comment-card").filter({ hasText: firstComment }))
      .toBeVisible();
    await expect(unsavedShortcut).toHaveCount(0);

    await secondTarget.click();
    await commentButton.click();
    await expect(composer.getByRole("textbox", { name: "评论内容" })).toHaveValue("");
    await composer.getByRole("button", { name: "关闭评论编辑器" }).click();

    await firstTarget.scrollIntoViewIfNeeded();
    const stage = page.locator(".review-scroll-stage");
    const canvasMarker = page.getByTestId("html-canvas-editor")
      .getByRole("button", {
        name: "列表项 · 列表项中的文字保持项目符号和缩进。",
        exact: true,
      });
    await expect(canvasMarker).toBeVisible();
    await expect.poll(() => stage.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0);
    await page.waitForTimeout(350);
    const markerBox = await canvasMarker.boundingBox();
    expect(markerBox).not.toBeNull();
    const beforeClick = await stage.evaluate((element) => element.scrollTop);
    await page.mouse.click(
      markerBox.x + markerBox.width / 2,
      markerBox.y + markerBox.height / 2,
    );
    await page.waitForTimeout(500);
    const afterClick = await stage.evaluate((element) => element.scrollTop);

    expect(Math.abs(afterClick - beforeClick)).toBeLessThanOrEqual(1);
    await expect(page.locator(".comment-card").filter({ hasText: firstComment }))
      .toHaveAttribute("data-focused", "true");
  });
});
