import { expect, test } from "@playwright/test";

import {
  caseSelector,
  fixtureBuffer,
  loadFixture,
} from "./pageroot-driver.mjs";
import { COMMENT_VIRTUALIZATION_THRESHOLD } from "../../../app/lib/comment-virtualization.js";

test("comments virtualize immediately above the threshold and remain navigable", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/");
  const { frame } = await loadFixture(
    page,
    "complex-layout.html",
    { buffer: fixtureBuffer("complex-layout.html") },
  );
  const target = frame.locator(caseSelector("list-item"));
  const toolbar = page.getByRole("toolbar", { name: /编辑/u });
  const commentRail = page.locator('aside[aria-label="本轮评论"]');
  const initialCount = COMMENT_VIRTUALIZATION_THRESHOLD + 1;

  for (let index = 1; index <= initialCount; index += 1) {
    await target.click();
    await toolbar.getByRole("button", { name: /留评论/u }).click();
    await page.getByRole("textbox", { name: "评论内容" })
      .fill(`压力评论 ${String(index).padStart(3, "0")}`);
    await page.getByRole("button", { name: "评论", exact: true }).click();
  }

  await expect(commentRail.locator(".comments-header h1"))
    .toContainText(String(initialCount));
  await expect(commentRail.locator(".comments-header small"))
    .toContainText(/当前加载 \d+ 条/u);
  const renderedCount = await commentRail.locator(".comment-card").count();
  expect(renderedCount).toBeLessThan(40);
  await expect(page.getByTestId("html-canvas-editor")
    .getByRole("button", { name: /^列表项 ·/u })).toHaveCount(1);
  await expect(commentRail.locator(".comment-card")
    .filter({ hasText: `压力评论 ${String(initialCount).padStart(3, "0")}` }))
    .toBeVisible();

  const nextCount = initialCount + 1;
  await target.click();
  await toolbar.getByRole("button", { name: /留评论/u }).click();
  await page.getByRole("textbox", { name: "评论内容" })
    .fill(`压力评论 ${String(nextCount).padStart(3, "0")}`);
  await page.getByRole("button", { name: "评论", exact: true }).click();
  await expect(commentRail.locator(".comments-header h1"))
    .toContainText(String(nextCount));
  await expect(commentRail.locator(".comment-card")
    .filter({ hasText: `压力评论 ${String(nextCount).padStart(3, "0")}` }))
    .toBeVisible();
  await expect(page.getByRole("textbox", { name: "评论内容" })).toHaveCount(0);
});
