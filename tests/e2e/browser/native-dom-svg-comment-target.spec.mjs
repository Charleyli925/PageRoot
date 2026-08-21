import { expect, test } from "@playwright/test";

import {
  caseSelector,
  fixtureBuffer,
  loadFixture,
} from "./pageroot-driver.mjs";

async function dispatchSvgClick(locator) {
  await locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    element.dispatchEvent(new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      clientX: rect.left + (rect.width / 2),
      clientY: rect.top + (rect.height / 2),
    }));
  });
}

test("SVG comments keep the exact source node and reject runtime-only children", async ({
  page,
}) => {
  await page.goto("/");
  const { editor, frame } = await loadFixture(
    page,
    "svg-comment-targets.html",
    { buffer: fixtureBuffer("svg-comment-targets.html") },
  );
  const toolbar = page.getByRole("toolbar", { name: /编辑/u });

  const point = frame.locator(caseSelector("svg-point"));
  const hoverOutline = editor.locator(
    '[data-testid="canvas-capability-outline"][data-tone="hover"]',
  );
  await point.hover();
  await expect(hoverOutline).toBeVisible();
  const hoverRect = await hoverOutline.boundingBox();
  expect(hoverRect).not.toBeNull();

  const line = frame.locator(caseSelector("svg-line"));
  await line.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    element.dispatchEvent(new PointerEvent("pointermove", {
      bubbles: true,
      clientX: rect.left + (rect.width / 2),
      clientY: rect.top + (rect.height / 2),
      pointerId: 1,
      pointerType: "mouse",
    }));
  });
  await editor.getByTestId("canvas-capability-hint").click();
  const selectedOutline = editor.locator(
    '[data-testid="canvas-target-outline"][data-tone="selected"]',
  );
  await expect(selectedOutline).toBeVisible();
  await expect(hoverOutline).toHaveCount(0);
  await expect(line).toHaveAttribute("data-html-canvas-selected", "part");
  await expect(point).not.toHaveAttribute("data-html-canvas-selected", /.+/u);
  expect(await selectedOutline.boundingBox()).toEqual(hoverRect);

  await dispatchSvgClick(line);
  await expect(toolbar).toHaveAttribute(
    "aria-label",
    "编辑SVG 折线 · 第二季度折线",
  );
  await expect(line).toHaveAttribute("data-html-canvas-selected", "part");
  await expect(frame.locator(caseSelector("svg-chart")))
    .not.toHaveAttribute("data-html-canvas-selected", /.+/u);

  await toolbar.getByRole("button", { name: /留评论/u }).click();
  const composer = page.getByRole("region", { name: "添加评论" });
  await expect(composer).toContainText("SVG 折线 · 第二季度折线");
  await expect(composer).not.toContainText("季度趋势总览");
  await composer.getByRole("textbox", { name: "评论内容" })
    .fill("调整这一条折线。");
  await composer.getByRole("button", { name: "评论", exact: true }).click();
  const savedCard = page.locator(".comment-card").filter({
    hasText: "调整这一条折线。",
  });
  await expect(savedCard).toHaveAttribute("data-resolution", "exact");
  await expect(savedCard).toContainText("SVG 折线 · 第二季度折线");

  const label = frame.locator(caseSelector("svg-label"));
  await dispatchSvgClick(label);
  await expect(toolbar).toHaveAttribute("aria-label", "编辑SVG 文字 · Q2 42%");
  await expect(toolbar).not.toHaveAttribute("aria-label", /季度趋势总览/u);

  const runtimePoint = frame.locator('[data-native-case="runtime-svg-point"]');
  await frame.evaluate(() => {
    const svg = document.querySelector('[data-native-case="svg-chart"]');
    if (!svg) throw new Error("SVG fixture root is missing.");
    const point = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "circle",
    );
    point.setAttribute("data-native-case", "runtime-svg-point");
    point.setAttribute("aria-label", "运行时数据点");
    point.setAttribute("cx", "280");
    point.setAttribute("cy", "190");
    point.setAttribute("r", "14");
    point.setAttribute("fill", "#ec4899");
    svg.append(point);
  });
  await dispatchSvgClick(runtimePoint);
  await expect(toolbar).toHaveAttribute(
    "aria-label",
    "编辑SVG 圆形 · 运行时数据点",
  );
  await toolbar.getByRole("button", { name: /留评论/u }).click();
  await expect(page.getByText("请选择可定位的源码元素", { exact: true }))
    .toBeVisible();
  await expect(page.getByText(
    /这部分内容由页面运行时生成，无法对应到源码/u,
  )).toBeVisible();
  await expect(page.getByRole("region", { name: "添加评论" })).toHaveCount(0);

  await line.evaluate((element) => element.setAttribute("hidden", ""));
  await page.setViewportSize({ width: 1279, height: 720 });
  const rail = page.locator('aside[aria-label="本轮评论"]');
  await expect(rail).toHaveAttribute("data-layout-ready", "true");
  await expect(page.getByText("评论位置无法确认", { exact: true }))
    .toHaveCount(0);
  await expect(savedCard).toHaveCount(0);
  await expect(page.getByTestId("html-canvas-editor").getByRole("button", {
    name: "SVG 折线 · 第二季度折线",
    exact: true,
  }).filter({ hasText: "评1" })).toHaveCount(0);
});
