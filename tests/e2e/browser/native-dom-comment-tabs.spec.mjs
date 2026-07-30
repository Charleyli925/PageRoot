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

test("comments keep current-tab alignment, render other tabs as neutral header cards, and avoid draft overlap", async ({
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
  await saveComment(page, frame, "tab-control-one", "第一页标签评论一");
  await saveComment(page, frame, "tab-control-one", "第一页标签评论二");
  const firstTabMarker = page.getByRole("button", {
    name: /第一页已有2条评论/u,
  });
  await expect(firstTabMarker).toHaveText("评2");
  await expect(firstTabMarker).toHaveAttribute("data-placement", "tab-side");
  const [firstTabBox, firstTabMarkerBox] = await Promise.all([
    frame.locator(caseSelector("tab-control-one")).boundingBox(),
    firstTabMarker.boundingBox(),
  ]);
  expect(firstTabBox).not.toBeNull();
  expect(firstTabMarkerBox).not.toBeNull();
  expect(
    firstTabMarkerBox.x + (firstTabMarkerBox.width / 2),
  ).toBeGreaterThan(firstTabBox.x + firstTabBox.width);
  expect(firstTabMarkerBox.y + firstTabMarkerBox.height)
    .toBeLessThanOrEqual(firstTabBox.y + 8);
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
  const header = rail.locator(".comment-rail-header");
  const currentCards = rail.locator(".comment-rail-content > .comment-card");
  await expect(header.locator("h1")).toContainText("4");
  await expect(header).not.toContainText("当前标签页");
  await expect(currentCards).toHaveCount(3);
  await expect(currentCards.filter({ hasText: secondText })).toBeVisible();
  const otherTabsToggle = rail.getByRole("button", {
    name: "其他标签页评论 1",
  });
  await expect(otherTabsToggle).toBeVisible();
  const [foldedHeaderBox, otherTabsToggleBox] = await Promise.all([
    header.boundingBox(),
    otherTabsToggle.boundingBox(),
  ]);
  expect(foldedHeaderBox).not.toBeNull();
  expect(otherTabsToggleBox).not.toBeNull();
  expect(otherTabsToggleBox.width)
    .toBeGreaterThanOrEqual(foldedHeaderBox.width - 40);
  await page.screenshot({
    path: testInfo.outputPath("comment-rail-folded.png"),
  });

  await otherTabsToggle.click();
  const otherTabRegion = rail.getByRole("region", { name: "其他标签页评论" });
  await expect(otherTabRegion).toBeVisible();
  const firstTabGroup = otherTabRegion.getByRole("region", {
    name: "第一页的评论",
  });
  const firstOtherTabCard = firstTabGroup.getByRole("button", {
    name: new RegExp(firstText, "u"),
  });
  await expect(firstOtherTabCard)
    .toHaveClass(/comment-card other-tab-comment-card/u);
  expect(await otherTabRegion.evaluate((element) => (
    element.parentElement?.classList.contains("comment-rail-header")
  ))).toBe(true);
  expect(await firstOtherTabCard.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      backgroundColor: style.backgroundColor,
      borderRadius: style.borderRadius,
    };
  })).toEqual({
    backgroundColor: "rgb(255, 255, 255)",
    borderRadius: "16px",
  });
  await page.screenshot({
    path: testInfo.outputPath("comment-rail-expanded.png"),
  });
  await firstOtherTabCard.click();

  await expect(frame.locator("#panel-one")).toBeVisible();
  await expect(frame.locator("#panel-two")).toBeHidden();
  await expect(currentCards).toHaveCount(3);
  await expect(currentCards.filter({ hasText: firstText })).toBeVisible();
  await expect(currentCards.filter({ hasText: firstText }))
    .toHaveAttribute("data-focused", "true");

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
