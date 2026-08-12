import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

import {
  activateNativeEdit,
  caseSelector,
  currentEditorFrame,
  documentToken,
  replaceUniqueBytes,
  setTextSelection,
} from "../browser/pageroot-driver.mjs";
import {
  createSourceFixture,
  launchPageRoot,
  loadedDiskFrame,
  removeSourceFixture,
  stopPageRoot,
} from "./helpers/pageroot-app-fixture.mjs";

const ORIGINAL_COPY = "图表旁边的正文仍然使用原生选择和中文输入。";

async function activateTab(page, editor, caseId) {
  const frame = await currentEditorFrame(page);
  await frame.locator(caseSelector(caseId)).click();
  const action = editor.getByRole("button", {
    name: "切换到此页签",
    exact: true,
  });
  await expect(action).toBeVisible();
  await action.click();
  return currentEditorFrame(page);
}

test("Electron keeps declared Edit charts source-backed through Tabs, comments, IME, and Canvas renewal", async () => {
  test.setTimeout(120_000);
  const fixture = createSourceFixture({
    fileName: "edit-chart-visuals-electron.html",
    sourceFixtureName: "edit-chart-visuals.html",
  });
  let launched = null;
  try {
    launched = await launchPageRoot({ activeSourcePath: fixture.sourcePath });
    const { editor, frame } = await loadedDiskFrame(
      launched.page,
      fixture.sourcePath,
      {
        expectedCase: "chart-mixed",
        includeEditor: true,
        timeout: 60_000,
      },
    );
    const initialDocumentToken = await documentToken(launched.page);
    expect(await frame.evaluate(() => ({
      authorScriptRan: window.__editChartAuthorScriptRan === true,
      visibleChart: Boolean(
        document.querySelector('[data-native-case="chart-mixed"]')
          ?.shadowRoot?.querySelector('svg[viewBox="0 0 640 320"]'),
      ),
      hiddenChartPrepared: Boolean(
        document.querySelector('[data-native-case="chart-scatter"]')
          ?.shadowRoot?.querySelector('svg[viewBox="0 0 640 320"]'),
      ),
      hiddenChartVisible: Boolean(
        document.querySelector('[data-native-case="chart-scatter"]')
          ?.getClientRects().length,
      ),
      canvasCount: document.querySelectorAll("canvas").length,
    }))).toEqual({
      authorScriptRan: false,
      visibleChart: true,
      hiddenChartPrepared: true,
      hiddenChartVisible: false,
      canvasCount: 0,
    });

    let currentFrame = await activateTab(
      launched.page,
      editor,
      "chart-tab-scatter",
    );
    await expect(currentFrame.locator(caseSelector("chart-scatter"))).toBeVisible();
    expect(await documentToken(launched.page)).toBe(initialDocumentToken);
    await currentFrame.locator(caseSelector("chart-scatter")).click();
    await editor.getByRole("button", {
      name: /商品量价分布散点图.*留评论/u,
    }).click();
    const composer = launched.page.getByRole("region", { name: "添加评论" });
    const commentText = "Electron 图表评论仍然属于源码槽位。";
    await composer.getByRole("textbox", { name: "评论内容" }).fill(commentText);
    await composer.getByRole("button", { name: "评论", exact: true }).click();
    const card = launched.page.locator(
      ".comment-rail-content > .comment-card:not(.draft-comment-card)",
    ).filter({ hasText: commentText });
    await expect(card).toHaveAttribute("data-resolution", "exact");
    expect(readFileSync(fixture.sourcePath).equals(fixture.original)).toBe(true);

    currentFrame = await activateTab(
      launched.page,
      editor,
      "chart-tab-overview",
    );
    await expect(currentFrame.locator(caseSelector("chart-scatter"))).toBeHidden();
    await expect(launched.page.getByRole("button", {
      name: "其他标签页评论 1",
    })).toBeVisible();
    expect(readFileSync(fixture.sourcePath).equals(fixture.original)).toBe(true);

    const adjacent = await activateNativeEdit(currentFrame, "chart-adjacent-copy");
    await setTextSelection(
      currentFrame,
      "chart-adjacent-copy",
      ORIGINAL_COPY.length,
    );
    const cdp = await launched.page.context().newCDPSession(launched.page);
    try {
      await cdp.send("Input.imeSetComposition", {
        text: "tubiao",
        selectionStart: 6,
        selectionEnd: 6,
      });
      await cdp.send("Input.insertText", { text: "图表" });
    } finally {
      await cdp.detach();
    }
    await expect(adjacent).toContainText(`${ORIGINAL_COPY}图表`);
    await adjacent.press("Escape");

    const expected = replaceUniqueBytes(
      fixture.original,
      ORIGINAL_COPY,
      `${ORIGINAL_COPY}图表`,
    );
    await expect.poll(
      () => readFileSync(fixture.sourcePath).equals(expected),
      { timeout: 30_000 },
    ).toBe(true);
    const renewedFrame = await currentEditorFrame(launched.page);
    await expect(renewedFrame.locator(caseSelector("chart-mixed"))).toBeVisible();
    expect(await renewedFrame.evaluate(() => ({
      authorScriptRan: window.__editChartAuthorScriptRan === true,
      chartRestored: Boolean(
        document.querySelector('[data-native-case="chart-mixed"]')
          ?.shadowRoot?.querySelector('svg[viewBox="0 0 640 320"]'),
      ),
      lightDomSvgCount: document.querySelector(
        '[data-native-case="chart-mixed"]',
      )?.querySelectorAll("svg").length ?? -1,
    }))).toEqual({
      authorScriptRan: false,
      chartRestored: true,
      lightDomSvgCount: 0,
    });
  } finally {
    if (launched) {
      await stopPageRoot(launched.electronApp, launched.isolatedUserData);
    }
    removeSourceFixture(fixture.sourceDirectory);
  }
});
