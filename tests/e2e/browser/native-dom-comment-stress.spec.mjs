import { expect, test } from "@playwright/test";

import {
  caseSelector,
  fixtureBuffer,
  loadFixture as loadRawFixture,
} from "./pageroot-driver.mjs";
import { COMMENT_VIRTUALIZATION_THRESHOLD } from "../../../app/lib/comment-virtualization.js";

const loadFixture = (page, name, options = {}) => loadRawFixture(page, name, {
  ...options,
  identifiedWorkingCopy: true,
});

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
  const commentCount = commentRail.locator(".comments-header h1");
  const initialCount = COMMENT_VIRTUALIZATION_THRESHOLD + 1;

  for (let index = 1; index <= initialCount; index += 1) {
    await target.click();
    await toolbar.getByRole("button", { name: /留评论/u }).click();
    await page.getByRole("textbox", { name: "评论内容" })
      .fill(`压力评论 ${String(index).padStart(3, "0")}`);
    await page.getByRole("button", { name: "评论", exact: true }).click();
    // The first save may be waiting for the lazy project registration. Wait
    // for its committed state before starting the next user action so this
    // stress test exercises virtualization, not a submission race.
    await expect(commentCount).toContainText(String(index));
  }

  await expect(commentCount)
    .toContainText(String(initialCount));
  await expect(commentRail.getByRole("button", {
    name: "全局评论",
    exact: true,
  })).toBeVisible();
  await expect(commentRail).not.toContainText("与正文同步滚动");
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
  await expect(commentCount)
    .toContainText(String(nextCount));
  await expect(commentRail.locator(".comment-card")
    .filter({ hasText: `压力评论 ${String(nextCount).padStart(3, "0")}` }))
    .toBeVisible();
  await expect(page.getByRole("textbox", { name: "评论内容" })).toHaveCount(0);
});
