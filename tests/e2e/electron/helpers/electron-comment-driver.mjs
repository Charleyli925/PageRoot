import { expect } from "@playwright/test";

export async function openRailGlobalCommentComposer(page) {
  // Settled AI history remains visible until the user returns to comments.
  const assistant = page.getByRole("button", { name: "AI 助手", exact: true });
  if (await assistant.getAttribute("aria-expanded") === "true") await assistant.click();
  const button = page.locator('aside[aria-label="本轮评论"]')
    .getByRole("button", { name: "全局评论", exact: true });
  await expect(button).toBeVisible();
  await expect(button).toBeEnabled();
  await button.click();
}
