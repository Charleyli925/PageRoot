import { expect } from "@playwright/test";

export async function openRailGlobalCommentComposer(page) {
  const button = page.locator('aside[aria-label="本轮评论"]')
    .getByRole("button", { name: "全局评论", exact: true });
  await expect(button).toBeVisible();
  await expect(button).toBeEnabled();
  await button.click();
}
