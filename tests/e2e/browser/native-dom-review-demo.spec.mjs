import { expect, test } from "@playwright/test";

test("review evidence, table pairing, and historical comment pins stay truthful", async ({ page }) => {
  await page.goto("/review-demo");
  await page.getByRole("button", { name: "模拟 AI 返回" }).click();
  await page.getByRole("button", { name: "审阅修改" }).click();

  const before = page.frameLocator('iframe[title^="修改前"]');
  const after = page.frameLocator('iframe[title^="修改后"]');
  const commentMarkers = before.getByRole("button", { name: "查看此前评论" });
  await expect(commentMarkers).toHaveCount(7);
  await expect(commentMarkers.first()).toHaveText("评");
  await commentMarkers.first().click();
  await expect(before.getByRole("note")).toBeVisible();
  await expect(before.getByRole("note")).toContainText("让页面开头更像真实产品入口");

  await page.getByRole("button", { name: "打开并固定内容地图" }).click();
  await expect(before.getByRole("note")).toBeHidden();
  await expect(commentMarkers.first()).toHaveText("评");
  await commentMarkers.first().click();
  await expect(before.getByRole("note")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(before.getByRole("note")).toBeHidden();
  await commentMarkers.first().click();
  await expect(before.getByRole("note")).toBeVisible();
  await after.locator("#faq").click({ position: { x: 20, y: 20 } });
  await expect(before.getByRole("note")).toBeHidden();

  const contentMap = page.getByRole("navigation", { name: "页面内容与变化位置" });
  await expect(contentMap.locator('[data-state="checking"]')).toHaveCount(0);
  await expect(contentMap.locator('[data-state="changed"]')).toHaveCount(7);

  const openingMapItem = contentMap.getByRole("button", { name: /为复杂页面而生 \/ 数字实验场/u });
  await openingMapItem.click();
  await before.locator("#top").evaluate((section) => {
    section.innerHTML = '<p data-test-no-change="true">没有可见变化</p>';
  });
  await after.locator("#top").evaluate((section) => {
    section.innerHTML = '<p data-test-no-change="true">没有可见变化</p>';
  });
  await expect(openingMapItem).toHaveAttribute("data-state", "unchanged");
  await expect(openingMapItem).toBeDisabled();
  await expect(openingMapItem).toContainText("未检测到变化");
  await expect(contentMap.locator('[data-state="changed"]')).toHaveCount(6);

  const dashboardMapItem = contentMap.getByRole("button", { name: /从宏观指标到微观事件/u });
  await before.locator("#dashboard").evaluate((section) => {
    section.innerHTML = '<p>相同的可见内容</p><p class="metric-label" style="display:none">只在修改前出现</p>';
  });
  await after.locator("#dashboard").evaluate((section) => {
    section.innerHTML = '<p>相同的可见内容</p><p class="metric-label" style="display:none">只在修改后出现</p>';
  });
  await expect(dashboardMapItem).toHaveAttribute("data-state", "unchanged");
  await expect(dashboardMapItem).toBeDisabled();
  await expect(contentMap.locator('[data-state="changed"]')).toHaveCount(5);

  await contentMap.getByRole("button", { name: /包含完整表格语义的运营后台/u }).click();
  const removedRow = before.locator("#project-table tbody tr", {
    hasText: "城市慢行信息系统",
  });
  const unchangedIdentity = before.locator("#project-table tbody tr", {
    hasText: "未来工作方式观察站",
  }).locator("th");
  await expect(removedRow.locator('[data-pageroot-token="true"]')).not.toHaveCount(0);
  await expect(unchangedIdentity.locator('[data-pageroot-token="true"]')).toHaveCount(0);

  await page.getByRole("button", { name: "显示并固定审阅工具" }).click();
  await page.getByRole("button", { name: "文字与数据" }).click();
  const firstTextFrame = before.locator(".pageroot-clause-frame").first();
  await expect(firstTextFrame).toBeAttached();
  const initialFrameTop = Number.parseFloat(await firstTextFrame.getAttribute("style")
    .then((style) => style?.match(/top:\s*([\d.]+)px/u)?.[1] ?? "0"));
  expect(await before.locator("body").evaluate(() => {
    const tolerance = 1;
    return [...document.querySelectorAll("[data-pageroot-frame-owner]")].every((owner) => {
      const ownerId = owner.getAttribute("data-pageroot-frame-owner");
      const clauses = [...owner.querySelectorAll("[data-pageroot-clause='true']")]
        .flatMap((clause) => [...clause.getClientRects()]);
      const frame = document.querySelector(
        `[data-pageroot-clause-frame][data-pageroot-frame-owner='${ownerId}']`,
      );
      if (!clauses.length || !frame) return true;
      const bounds = frame.getBoundingClientRect();
      return bounds.left <= Math.min(...clauses.map((rect) => rect.left)) + tolerance
        && bounds.top <= Math.min(...clauses.map((rect) => rect.top)) + tolerance
        && bounds.right >= Math.max(...clauses.map((rect) => rect.right)) - tolerance
        && bounds.bottom >= Math.max(...clauses.map((rect) => rect.bottom)) - tolerance;
    });
  })).toBe(true);

  await before.locator("#project-table").evaluate((table) => {
    const spacer = document.createElement("div");
    spacer.style.height = "48px";
    spacer.dataset.testLayoutShift = "true";
    table.before(spacer);
  });
  await expect.poll(async () => Number.parseFloat(
    (await firstTextFrame.getAttribute("style"))?.match(/top:\s*([\d.]+)px/u)?.[1] ?? "0",
  )).toBeGreaterThan(initialFrameTop + 40);
});
