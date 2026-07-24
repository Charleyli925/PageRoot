import { expect, test } from "@playwright/test";

import {
  caseSelector,
  fixtureBuffer,
  loadFixture,
} from "./pageroot-driver.mjs";

test("100 real comments stay bounded, virtualized, navigable, and capped", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/");
  const { frame } = await loadFixture(
    page,
    "complex-layout.html",
    { buffer: fixtureBuffer("complex-layout.html") },
  );
  const target = frame.locator(caseSelector("list-item"));
  const toolbar = page.getByRole("toolbar", { name: /编辑/u });
  const commentRail = page.locator('aside[aria-label="本轮评论"]');

  for (let index = 1; index <= 100; index += 1) {
    await target.click();
    await toolbar.getByRole("button", { name: /留评论/u }).click();
    await page.getByRole("textbox", { name: "评论内容" })
      .fill(`压力评论 ${String(index).padStart(3, "0")}`);
    await page.getByRole("button", { name: "评论", exact: true }).click();
  }

  await expect(commentRail.locator(".comments-header h1")).toContainText("100");
  await expect(commentRail.locator(".comments-header small"))
    .toContainText(/当前加载 \d+ 条/u);
  const renderedCount = await commentRail.locator(".comment-card").count();
  expect(renderedCount).toBeLessThan(40);
  await expect(page.getByTestId("html-canvas-editor")
    .getByRole("button", { name: /^列表项 ·/u })).toHaveCount(1);
  await expect(commentRail.locator(".comment-card")
    .filter({ hasText: "压力评论 100" })).toBeVisible();

  await target.click();
  await toolbar.getByRole("button", { name: /留评论/u }).click();
  await page.getByRole("textbox", { name: "评论内容" }).fill("压力评论 101");
  await page.getByRole("button", { name: "评论", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "本轮评论已达上限" }))
    .toBeVisible();
  await expect(commentRail.locator(".comments-header h1")).toContainText("100");
  await expect(page.getByRole("textbox", { name: "评论内容" }))
    .toHaveValue("压力评论 101");
});
