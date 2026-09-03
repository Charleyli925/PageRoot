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
    identifiedWorkingCopy: true,
  });
}

test.describe("notification recovery paths", () => {
  test("one unsaved comment blocks a second target and Canvas selection keeps its scroll", {
  tag: ["@gate-smoke","@smoke-comments"],
}, async ({
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

    await expect(page.locator(".toast.show")).toHaveCount(0);
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
