import { expect, test } from "@playwright/test";

import {
  caseSelector,
  exportCurrentHtml,
  fixtureBuffer,
  loadFixture,
} from "./pageroot-driver.mjs";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("edit mode reveals semantic source content without running authored actions or changing bytes", async ({
  page,
}) => {
  const original = fixtureBuffer("presentation-actions.html");
  const { editor, frame } = await loadFixture(
    page,
    "presentation-actions.html",
    { buffer: original },
  );
  const overviewPanel = frame.locator(caseSelector("overview-panel"));
  const detailsPanel = frame.locator(caseSelector("details-panel"));
  const detailsTab = frame.locator(caseSelector("details-tab"));

  await detailsTab.click();
  await expect(overviewPanel).toBeVisible();
  await expect(detailsPanel).toBeHidden();
  const tabAction = editor.getByRole("button", {
    name: "切换到此页签",
    exact: true,
  });
  await expect(tabAction).toBeVisible();
  await expect(tabAction).toHaveText("切换到此页签");
  await expect(tabAction).not.toContainText("⌥");
  await expect(tabAction).toHaveAttribute("title", /⌥/u);

  await detailsTab.dblclick();
  await expect(detailsTab).toHaveAttribute("contenteditable", "true");
  await expect(overviewPanel).toBeVisible();
  await expect(detailsPanel).toBeHidden();
  await page.keyboard.press("Escape");

  await detailsTab.click();
  await tabAction.click();
  await expect(overviewPanel).toBeHidden();
  await expect(detailsPanel).toBeVisible();
  const currentTabAction = editor.getByRole("button", {
    name: "当前页签",
    exact: true,
  });
  await expect(currentTabAction).toBeVisible();
  await currentTabAction.click();
  await expect(currentTabAction).toBeFocused();
  await expect(detailsPanel).toBeVisible();

  const summary = frame.locator(caseSelector("native-summary"));
  const nativeDetails = frame.locator(caseSelector("native-details"));
  await summary.click();
  await expect(nativeDetails).not.toHaveAttribute("open", "");
  await editor.getByRole("button", {
    name: "展开内容",
    exact: true,
  }).click();
  await expect(nativeDetails).toHaveAttribute("open", "");

  await summary.dblclick({ modifiers: ["Alt"] });
  await expect(nativeDetails).not.toHaveAttribute("open", "");

  const disclosure = frame.locator(caseSelector("more-toggle"));
  const disclosureContent = frame.locator(caseSelector("more-content"));
  await disclosure.click({ modifiers: ["Alt"] });
  await expect(disclosure).toHaveAttribute("aria-expanded", "true");
  await expect(disclosureContent).toBeVisible();

  const beforeLinkUrl = page.url();
  await frame.locator(caseSelector("outside-link")).click({ modifiers: ["Alt"] });
  expect(page.url()).toBe(beforeLinkUrl);
  await expect(editor.getByRole("button", {
    name: /^(?:切换到此页签|当前页签|展开内容|收起内容)$/u,
  })).toHaveCount(0);

  expect(await frame.evaluate(() => ({
    authorAction: document.documentElement.dataset.authorAction ?? null,
    authorScriptRan: document.documentElement.dataset.authorScriptRan ?? null,
  }))).toEqual({
    authorAction: null,
    authorScriptRan: null,
  });
  expect((await exportCurrentHtml(page)).equals(original)).toBe(true);
});
