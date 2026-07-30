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
    window.requestAnimationFrame(() => {
      window.dispatchEvent(new Event("resize"));
    });
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
  const currentCards = rail.locator(
    ".comment-rail-content > .comment-card:not(.draft-comment-card)",
  );
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
  await expect(firstTabGroup.locator(
    ".other-tab-comment-group-header > span",
  )).toHaveCount(0);
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
  await expect(page.getByRole("region", { name: "添加评论" })).toHaveCount(0);

  const firstTarget = frame.locator(caseSelector("tab-comment-one"));
  await firstTarget.click();
  await page.getByRole("toolbar", { name: /编辑/u })
    .getByRole("button", { name: /留评论/u })
    .click();
  const composer = page.getByRole("region", { name: "添加评论" });
  await composer.getByRole("textbox", { name: "评论内容" })
    .fill("尚未保存但必须保留原样");
  await composer.getByRole("button", { name: "关闭评论编辑器" }).click();

  const unsavedShortcut = rail.getByRole("button", {
    name: "有一条未保存评论",
  });
  const recovery = rail.locator(
    ".comment-rail-content > .draft-comment-card",
  );
  const saved = rail.locator(".comment-card").filter({ hasText: firstText });
  await expect(unsavedShortcut).toBeVisible();
  await expect(recovery).toHaveAttribute(
    "aria-label",
    /未保存评论：.*第一页评论目标：尚未保存但必须保留原样/u,
  );
  await expect(recovery.getByText("未保存", { exact: true })).toBeVisible();
  await expect(saved).toHaveClass(/comment-card/u);
  await expect.poll(async () => {
    const recoveryBox = await recovery.boundingBox();
    const savedBox = await saved.boundingBox();
    if (!recoveryBox || !savedBox) return -1;
    return Math.floor(recoveryBox.y - (savedBox.y + savedBox.height));
  }).toBeGreaterThanOrEqual(16);
  await page.screenshot({
    path: testInfo.outputPath("comment-rail-draft-recovery.png"),
  });

  const firstTargetMarker = page.getByTestId("html-canvas-editor")
    .getByRole("button", {
      name: "正文 · 第一页评论目标",
      exact: true,
    })
    .filter({ hasText: "评1" });
  await expect(firstTargetMarker).toHaveText("评1");
  await expect(header.locator("h1")).toContainText("4");

  await unsavedShortcut.click();
  await expect(composer.getByRole("textbox", { name: "评论内容" }))
    .toBeFocused();
  await expect(unsavedShortcut).toBeVisible();
  await expect.poll(async () => {
    const composerBox = await composer.boundingBox();
    const savedBox = await saved.boundingBox();
    if (!composerBox || !savedBox) return -1;
    return Math.floor(composerBox.y - (savedBox.y + savedBox.height));
  }).toBeGreaterThanOrEqual(16);

  await page.getByRole("button", { name: "预览", exact: true }).click();
  const draftPreviewIframe = page.locator('iframe[title="HTML 交互预览"]');
  await expect(draftPreviewIframe).toBeVisible();
  const draftPreviewFrame = await (
    await draftPreviewIframe.elementHandle()
  )?.contentFrame();
  if (!draftPreviewFrame) {
    throw new Error("Draft preview frame is unavailable.");
  }
  await draftPreviewFrame.locator('[data-p="panel-two"]').click();
  await expect(draftPreviewFrame.locator("#panel-two")).toBeVisible();
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await expect(frame.locator("#panel-two")).toBeVisible();
  await expect(unsavedShortcut).toHaveCount(0);
  const otherTabsWithDraft = rail.getByRole("button", {
    name: "其他标签页评论 2",
  });
  await expect(otherTabsWithDraft).toBeVisible();
  await otherTabsWithDraft.click();

  const expandedWithDraft = rail.getByRole("region", {
    name: "其他标签页评论",
  });
  const firstTabGroupWithDraft = expandedWithDraft.getByRole("region", {
    name: "第一页的评论",
  });
  const hiddenDraftCard = firstTabGroupWithDraft.getByRole("button", {
    name: /第一页：未保存评论：.*第一页评论目标：尚未保存但必须保留原样/u,
  });
  await expect(hiddenDraftCard).toBeVisible();
  await expect(hiddenDraftCard.getByText("未保存", { exact: true })).toBeVisible();
  await expect(firstTabGroupWithDraft.getByRole("button")).toHaveCount(2);
  await expect.poll(async () => {
    const headerBox = await header.boundingBox();
    const firstCurrentCardBox = await currentCards.first().boundingBox();
    if (!headerBox || !firstCurrentCardBox) return -1;
    return Math.floor(
      firstCurrentCardBox.y - (headerBox.y + headerBox.height),
    );
  }).toBeGreaterThanOrEqual(16);
  await page.screenshot({
    path: testInfo.outputPath("comment-rail-other-tab-draft.png"),
  });

  await hiddenDraftCard.click();
  await expect(frame.locator("#panel-one")).toBeVisible();
  await expect(frame.locator("#panel-two")).toBeHidden();
  await expect(composer.getByRole("textbox", { name: "评论内容" }))
    .toHaveValue("尚未保存但必须保留原样");
  await expect(composer.getByRole("textbox", { name: "评论内容" }))
    .toBeFocused();
  await expect(unsavedShortcut).toBeVisible();
  await expect.poll(() => rail.locator("[data-comment-measure]")
    .evaluateAll((nodes) => nodes
      .map((node) => ({
        key: node.getAttribute("data-comment-measure"),
        top: Number.parseFloat(getComputedStyle(node).top),
        text: node.textContent || "",
      }))
      .sort((left, right) => left.top - right.top)
      .map((entry) => {
        if (entry.key === "__composer") return "__composer";
        if (entry.text.includes("第一页标签评论一")) return "tab-one";
        if (entry.text.includes("第一页标签评论二")) return "tab-two";
        if (entry.text.includes("第一页已保存评论")) return "first-saved";
        return entry.key;
      }))).toEqual([
    "tab-one",
    "tab-two",
    "first-saved",
    "__composer",
  ]);
  await expect.poll(() => rail.locator("[data-comment-measure]")
    .evaluateAll((nodes) => {
      const boxes = nodes
        .map((node) => node.getBoundingClientRect())
        .sort((left, right) => left.top - right.top);
      return boxes.slice(1).reduce((minimum, box, index) => (
        Math.min(minimum, box.top - boxes[index].bottom)
      ), Number.MAX_SAFE_INTEGER);
    })).toBeGreaterThanOrEqual(16);
  await page.screenshot({
    path: testInfo.outputPath("comment-rail-hidden-draft-resumed.png"),
  });

  await composer.getByRole("button", { name: "删除未保存评论" }).click();
  await expect(composer.getByRole("alert")).toContainText(
    "删除这条未保存评论？",
  );
  await composer.getByRole("button", { name: "删除", exact: true }).click();
  await expect(composer).toHaveCount(0);
  await expect(unsavedShortcut).toHaveCount(0);
  await expect(recovery).toHaveCount(0);
  await expect(header.locator("h1")).toContainText("4");
  await expect(firstTargetMarker).toHaveText("评1");
  expect(browserErrors).toEqual([]);
});
