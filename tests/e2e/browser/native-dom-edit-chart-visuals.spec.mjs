import { expect, test } from "@playwright/test";

import {
  activateNativeEdit,
  caseSelector,
  documentToken,
  exportCurrentHtml,
  fixtureBuffer,
  loadFixture,
  replaceUniqueBytes,
  setTextSelection,
} from "./pageroot-driver.mjs";

const FIXTURE_NAME = "edit-chart-visuals.html";
const CHART_CASES = [
  "chart-mixed",
  "chart-stacked-bar",
  "chart-area",
  "chart-horizontal",
  "chart-scatter",
  "chart-line",
];

async function activateTab(editor, frame, caseId) {
  await frame.locator(caseSelector(caseId)).click();
  const action = editor.getByRole("button", {
    name: "切换到此页签",
    exact: true,
  });
  await expect(action).toBeVisible();
  await action.click();
}

async function saveSelectedChartComment(page, text) {
  await page.getByRole("toolbar", { name: /编辑/u })
    .getByRole("button", { name: /留评论/u })
    .click();
  const composer = page.getByRole("region", { name: "添加评论" });
  const textbox = composer.getByRole("textbox", { name: "评论内容" });
  await expect(textbox).toBeFocused();
  await textbox.fill(text);
  await composer.getByRole("button", { name: "评论", exact: true }).click();
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.addInitScript(() => {
    const originalAttachShadow = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function attachShadowForChartReadiness(init) {
      if (this.hasAttribute("data-report-chart-slot")) {
        window.__PAGEROOT_CHART_MOUNT_READY_STATES__ ??= [];
        window.__PAGEROOT_CHART_MOUNT_READY_STATES__.push(document.readyState);
      }
      return originalAttachShadow.call(this, init);
    };
  });
  await page.goto("/");
});

test("eligible charts mount before Edit ready and hidden Tabs reuse the same SVG nodes", async ({
  page,
}) => {
  const browserErrors = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  const original = fixtureBuffer(FIXTURE_NAME);
  const { editor, frame } = await loadFixture(page, FIXTURE_NAME, {
    buffer: original,
  });
  const initialDocumentToken = await documentToken(page);

  const initial = await frame.evaluate((chartCases) => {
    window.__PAGEROOT_EDIT_CHART_IDENTITIES__ = new Map();
    return {
      authorScriptRan: window.__editChartAuthorScriptRan === true,
      mountReadyStates: window.__PAGEROOT_CHART_MOUNT_READY_STATES__ || [],
      charts: chartCases.map((caseId) => {
        const host = document.querySelector(`[data-native-case=${JSON.stringify(caseId)}]`);
        const svg = host?.shadowRoot?.querySelector("svg") || null;
        if (svg) window.__PAGEROOT_EDIT_CHART_IDENTITIES__.set(caseId, svg);
        return {
          caseId,
          hostVisible: Boolean(host?.getClientRects().length),
          hasShadow: Boolean(host?.shadowRoot),
          svgWidth: svg?.getAttribute("width") || null,
          svgHeight: svg?.getAttribute("height") || null,
          viewBox: svg?.getAttribute("viewBox") || null,
          ariaHidden: svg?.getAttribute("aria-hidden") || null,
          pointerEvents: svg ? getComputedStyle(svg).pointerEvents : null,
          forbiddenCount: svg?.querySelectorAll(
            "script,foreignObject,image,iframe,object,embed",
          ).length ?? -1,
        };
      }),
    };
  }, CHART_CASES);

  expect(initial.authorScriptRan).toBe(false);
  expect(initial.mountReadyStates).toHaveLength(CHART_CASES.length);
  expect(initial.mountReadyStates).not.toContain("loading");
  expect(initial.charts).toHaveLength(CHART_CASES.length);
  for (const chart of initial.charts) {
    expect(chart).toMatchObject({
      hasShadow: true,
      svgWidth: "640",
      svgHeight: "320",
      viewBox: "0 0 640 320",
      ariaHidden: "true",
      pointerEvents: "none",
      forbiddenCount: 0,
    });
  }
  expect(initial.charts.find(({ caseId }) => caseId === "chart-mixed").hostVisible)
    .toBe(true);
  expect(initial.charts.find(({ caseId }) => caseId === "chart-scatter").hostVisible)
    .toBe(false);

  await activateTab(editor, frame, "chart-tab-scatter");
  await expect(frame.locator(caseSelector("chart-scatter"))).toBeVisible();
  await expect(frame.locator(caseSelector("chart-mixed"))).toBeHidden();
  expect(await documentToken(page)).toBe(initialDocumentToken);
  expect(await frame.evaluate((chartCases) => chartCases.every((caseId) => {
    const host = document.querySelector(`[data-native-case=${JSON.stringify(caseId)}]`);
    return host?.shadowRoot?.querySelector("svg")
      === window.__PAGEROOT_EDIT_CHART_IDENTITIES__.get(caseId);
  }), CHART_CASES)).toBe(true);

  await activateTab(editor, frame, "chart-tab-overview");
  await expect(frame.locator(caseSelector("chart-mixed"))).toBeVisible();
  await expect(frame.locator(caseSelector("chart-scatter"))).toBeHidden();
  expect(await documentToken(page)).toBe(initialDocumentToken);
  expect((await exportCurrentHtml(page)).equals(original)).toBe(true);
  expect(browserErrors).toEqual([]);
});

test("the source host owns pointer selection and comments across Tab visibility changes", async ({
  page,
}) => {
  const original = fixtureBuffer(FIXTURE_NAME);
  const { editor, frame } = await loadFixture(page, FIXTURE_NAME, {
    buffer: original,
  });
  await activateTab(editor, frame, "chart-tab-scatter");
  await frame.evaluate(() => {
    window.__PAGEROOT_SCATTER_SVG__ = document.querySelector(
      '[data-native-case="chart-scatter"]',
    )?.shadowRoot?.querySelector("svg") || null;
  });

  expect(await frame.locator(caseSelector("chart-scatter")).evaluate((host) => {
    const rect = host.getBoundingClientRect();
    return document.elementFromPoint(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
    )?.id || null;
  })).toBe("chart-scatter");
  await frame.locator(caseSelector("chart-scatter")).click();
  await expect(editor.getByRole("button", {
    name: /商品量价分布散点图.*留评论/u,
  })).toBeVisible();

  const commentText = "量价分布图仍然锚定整个源码槽位。";
  await saveSelectedChartComment(page, commentText);
  const rail = page.locator('aside[aria-label="本轮评论"]');
  const card = rail.locator(
    ".comment-rail-content > .comment-card:not(.draft-comment-card)",
  ).filter({ hasText: commentText });
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute("data-resolution", "exact");

  await activateTab(editor, frame, "chart-tab-overview");
  await expect(frame.locator(caseSelector("chart-scatter"))).toBeHidden();
  await expect(card).toHaveCount(0);
  const otherTabGroup = rail.getByRole("button", {
    name: "其他标签页评论 1",
  });
  await expect(otherTabGroup).toBeVisible();
  await otherTabGroup.click();
  const otherTabCard = rail
    .getByRole("region", { name: "其他标签页评论" })
    .getByRole("button", { name: new RegExp(commentText, "u") });
  await expect(otherTabCard).toBeVisible();
  await otherTabCard.click();

  await expect(frame.locator(caseSelector("chart-scatter"))).toBeVisible();
  await expect(rail.locator(
    ".comment-rail-content > .comment-card:not(.draft-comment-card)",
  ).filter({ hasText: commentText })).toHaveAttribute("data-resolution", "exact");
  expect(await frame.evaluate(() => (
    document.querySelector('[data-native-case="chart-scatter"]')
      ?.shadowRoot?.querySelector("svg") === window.__PAGEROOT_SCATTER_SVG__
  ))).toBe(true);
  expect((await exportCurrentHtml(page)).equals(original)).toBe(true);
});

test("adjacent native editing patches only source text and never serializes SVG", async ({
  page,
}) => {
  const original = fixtureBuffer(FIXTURE_NAME);
  const originalText = "图表旁边的正文仍然使用原生选择和中文输入。";
  const { frame } = await loadFixture(page, FIXTURE_NAME, { buffer: original });
  const target = await activateNativeEdit(frame, "chart-adjacent-copy");
  await setTextSelection(frame, "chart-adjacent-copy", originalText.length);
  await page.keyboard.insertText("图表");
  await target.press("Escape");
  await expect(target).not.toHaveAttribute("contenteditable", /^(?:plaintext-only|true)$/u);
  await expect(target).toHaveText(`${originalText}图表`);

  const expected = replaceUniqueBytes(original, originalText, `${originalText}图表`);
  expect((await exportCurrentHtml(page)).equals(expected)).toBe(true);
  expect(await frame.evaluate(() => Boolean(
    document.querySelector('[data-native-case="chart-mixed"]')
      ?.shadowRoot?.querySelector('svg[viewBox="0 0 640 320"]'),
  ))).toBe(true);
});
