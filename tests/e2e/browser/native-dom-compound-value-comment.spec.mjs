import { expect, test } from "@playwright/test";

import {
  caseSelector,
  fixtureBuffer,
  loadFixture,
} from "./pageroot-driver.mjs";

test("clicking a metric unit comments the complete compound value", async ({ page }) => {
  await page.goto("/");
  const original = fixtureBuffer("compound-value-comment.html");
  const { frame } = await loadFixture(
    page,
    "compound-value-comment.html",
    { buffer: original },
  );
  await frame.locator(caseSelector("compound-unit")).click();
  const toolbar = page.getByRole("toolbar", { name: /编辑/u });
  await expect(toolbar).toHaveAttribute("aria-label", /4\.6天/u);
  await toolbar.getByRole("button", { name: /留评论/u }).click();
  const composer = page.getByRole("region", { name: "添加评论" });
  await composer.getByRole("textbox", { name: "评论内容" }).fill(
    "把完整周期改为 3.8 天。",
  );
  await composer.getByRole("button", { name: "评论", exact: true }).click();
  const card = page.locator(".comment-card").filter({
    hasText: "把完整周期改为 3.8 天。",
  });
  await expect(card).toContainText("4.6天");
});
