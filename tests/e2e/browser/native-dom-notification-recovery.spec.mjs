import { expect, test } from "@playwright/test";

import {
  fixtureBuffer,
  loadFixture,
} from "./pageroot-driver.mjs";

async function openFixture(page, name = "notification-recovery.html") {
  await page.goto("/");
  return loadFixture(page, name, {
    buffer: fixtureBuffer("complex-layout.html"),
  });
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
    await expect(page.getByText("notification-recovery.html", { exact: true }).first())
      .toBeVisible();

    const chooserPromise = page.waitForEvent("filechooser");
    await notice.getByRole("button", { name: "重新选择" }).click();
    const chooser = await chooserPromise;
    await chooser.setFiles({
      name: "recovered-utf8.html",
      mimeType: "text/html",
      buffer: fixtureBuffer("complex-layout.html"),
    });

    await expect(page.getByText("recovered-utf8.html", { exact: true }).first())
      .toBeVisible();
    await expect(notice).toHaveCount(0);
  });

  test("a full attachment batch leads back to removable attachments before retry", async ({
    page,
  }) => {
    await openFixture(page);
    await page.getByRole("button", { name: "全局评论" }).click();

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
});
