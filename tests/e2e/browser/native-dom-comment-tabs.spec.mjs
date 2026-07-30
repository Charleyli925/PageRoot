import { expect, test } from "@playwright/test";

import {
  caseSelector,
  fixtureBuffer,
  loadFixture,
} from "./pageroot-driver.mjs";

async function switchTab(frame, panelId) {
  await frame.evaluate((nextPanelId) => {
    document.querySelectorAll("[data-p]").forEach((tab) => {
      tab.classList.toggle("active", tab.getAttribute("data-p") === nextPanelId);
    });
    document.querySelectorAll(".panel").forEach((panel) => {
      panel.classList.toggle("active", panel.id === nextPanelId);
    });
    window.dispatchEvent(new Event("resize"));
  }, panelId);
  await frame.waitForFunction((nextPanelId) => {
    const panel = document.getElementById(nextPanelId);
    return Boolean(panel && panel.getClientRects().length > 0);
  }, panelId);
}

async function saveComment(page, frame, caseId, text) {
  await frame.locator(caseSelector(caseId)).click();
  await page.getByRole("toolbar", { name: /编辑/u })
    .getByRole("button", { name: /留评论/u })
    .click();
  const composer = page.getByRole("region", { name: "添加评论" });
  await composer.getByRole("textbox", { name: "评论内容" }).fill(text);
  await composer.getByRole("button", { name: "评论", exact: true }).click();
}

test("comments keep current-tab alignment, fold other tabs into the header, and avoid draft overlap", async ({
  page,
}, testInfo) => {
  const browserErrors = [];
  page.on("console", (message) => {
    if (
      message.type() === "error"
      && !message.text().includes(
        "Blocked script execution in 'about:srcdoc' because the document's frame is sandboxed",
      )
    ) {
      browserErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/");
  const { frame } = await loadFixture(page, "tabbed-comments.html", {
    buffer: fixtureBuffer("tabbed-comments.html"),
  });
  const firstText = "第一页已保存评论";
  const secondText = "第二页已保存评论";

  await saveComment(page, frame, "tab-comment-one", firstText);
  await switchTab(frame, "panel-two");
  await saveComment(page, frame, "tab-comment-two", secondText);

  await page.getByRole("button", { name: "预览", exact: true }).click();
  const previewIframe = page.locator('iframe[title="HTML 交互预览"]');
  await expect(previewIframe).toBeVisible();
  const previewFrame = await (await previewIframe.elementHandle())?.contentFrame();
  if (!previewFrame) throw new Error("Interactive preview frame is unavailable.");
  await previewFrame.locator('[data-p="panel-two"]').click();
  await expect(previewFrame.locator("#panel-two")).toBeVisible();
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await expect(frame.locator("#panel-two")).toBeVisible();
  await expect(frame.locator("#panel-one")).toBeHidden();

  const rail = page.locator('aside[aria-label="本轮评论"]');
  await expect(rail.locator(".comments-header h1")).toContainText("2");
  await expect(rail.locator(".comment-card")).toHaveCount(1);
  await expect(rail.locator(".comment-card")).toContainText(secondText);
  await expect(rail.getByRole("button", { name: "其他标签页 1" })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("comment-rail-folded.png"),
  });

  await rail.getByRole("button", { name: "其他标签页 1" }).click();
  const otherTabRegion = rail.getByRole("region", { name: "其他标签页评论" });
  await expect(otherTabRegion).toBeVisible();
  await expect(otherTabRegion.getByRole("button", { name: /第一页.*1 条/u }))
    .toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("comment-rail-expanded.png"),
  });
  await otherTabRegion.getByRole("button", { name: /第一页.*1 条/u }).click();

  await expect(frame.locator("#panel-one")).toBeVisible();
  await expect(frame.locator("#panel-two")).toBeHidden();
  await expect(rail.locator(".comment-card")).toHaveCount(1);
  await expect(rail.locator(".comment-card")).toContainText(firstText);
  await expect(rail.locator(".comment-card")).toHaveAttribute("data-focused", "true");

  const firstTarget = frame.locator(caseSelector("tab-comment-one"));
  await firstTarget.click();
  await page.getByRole("toolbar", { name: /编辑/u })
    .getByRole("button", { name: /留评论/u })
    .click();
  const composer = page.getByRole("region", { name: "添加评论" });
  await composer.getByRole("textbox", { name: "评论内容" })
    .fill("尚未保存但必须保留原样");
  await composer.getByRole("button", { name: "关闭评论编辑器" }).click();

  const recovery = rail.getByRole("region", { name: "未保存评论" });
  const saved = rail.locator(".comment-card").filter({ hasText: firstText });
  await expect(recovery).toHaveClass(/draft-recovery-card rail-status-card/u);
  await expect(saved).toHaveClass(/comment-card/u);
  await expect.poll(async () => {
    const recoveryBox = await recovery.boundingBox();
    const savedBox = await saved.boundingBox();
    if (!recoveryBox || !savedBox) return -1;
    return Math.floor(savedBox.y - (recoveryBox.y + recoveryBox.height));
  }).toBeGreaterThanOrEqual(16);
  await page.screenshot({
    path: testInfo.outputPath("comment-rail-draft-recovery.png"),
  });
  expect(browserErrors).toEqual([]);
});
