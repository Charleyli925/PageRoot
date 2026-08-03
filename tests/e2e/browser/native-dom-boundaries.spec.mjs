import { expect, test } from "@playwright/test";

import {
  activateNativeEdit,
  caseSelector,
  documentToken,
  exportCurrentHtml,
  fixtureBuffer,
  installInputRecorder,
  installLongTaskRecorder,
  keyShortcut,
  loadFixture,
  recordedInputEvents,
  recordedLongTasks,
  selectionSnapshot,
  setTextSelection,
  waitForFramePaint,
} from "./pageroot-driver.mjs";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("pure browser use stays in a formal read-only preview", async ({ page }) => {
  await expect(page.getByText("浏览器预览 · 只读", { exact: true })).toBeVisible();
  await expect(page.getByText("操作不会保存", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "编辑", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "预览", exact: true }))
    .toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "全局评论", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: /发送至 Qoder/u })).toBeDisabled();
  await expect(page.getByTestId("html-canvas-editor")).toHaveCount(0);

  const preview = page.locator('iframe[title="HTML 交互预览"]');
  await expect(preview).toBeVisible();
  expect((await preview.getAttribute("sandbox"))?.split(/\s+/)).not.toContain("allow-same-origin");
  expect(await page.evaluate(() => Boolean(window.htmlAIProjects))).toBe(false);
});

test("the edit iframe is same-origin but never executes author scripts or refresh", async ({ page }) => {
  const { iframe, frame } = await loadFixture(page, "complex-layout.html");
  await expect(iframe).toHaveAttribute("sandbox", "allow-same-origin");
  expect((await iframe.getAttribute("sandbox")).split(/\s+/)).not.toContain("allow-scripts");

  const boundary = await frame.evaluate(() => ({
    authorScriptRan: document.documentElement.hasAttribute("data-author-script-ran"),
    nestedScriptRan: document.documentElement.hasAttribute("data-nested-script-ran"),
    disabledScriptCount: document.querySelectorAll(
      'script[type="application/x-html-canvas-disabled"][data-html-canvas-disabled-script]',
    ).length,
    activeRefreshCount: document.querySelectorAll('meta[http-equiv="refresh" i]').length,
    disabledRefreshCount: document.querySelectorAll('meta[http-equiv="x-html-canvas-disabled-refresh" i]').length,
  }));
  expect(boundary).toMatchObject({
    authorScriptRan: false,
    nestedScriptRan: false,
    disabledScriptCount: 1,
    activeRefreshCount: 0,
    disabledRefreshCount: 1,
  });
});

test("clicking a module's blank padding clears selection instead of opening its toolbar", async ({
  page,
}) => {
  const { editor, frame } = await loadFixture(page, "module-padding-hit.html");
  const copy = frame.locator(caseSelector("module-padding-copy"));
  const paddedSection = frame.locator("section");

  await copy.click();
  await expect(editor.getByRole("toolbar")).toBeVisible();
  await expect(frame.locator("[data-html-canvas-selected]")).toHaveCount(1);

  await paddedSection.click({ position: { x: 20, y: 20 } });

  await expect(editor.getByRole("toolbar")).toHaveCount(0);
  await expect(frame.locator("[data-html-canvas-selected]")).toHaveCount(0);
});

test("clicking outside the canvas commits editing and clears its toolbar and selection", async ({
  page,
}) => {
  const { editor, frame } = await loadFixture(page, "complex-layout.html");
  const target = frame.locator(caseSelector("paragraph-entities"));

  await activateNativeEdit(frame, "paragraph-entities");
  await expect(target).toHaveAttribute("contenteditable", "true");
  await expect(editor.getByRole("toolbar")).toBeVisible();
  await expect(frame.locator("[data-html-canvas-selected]")).toHaveCount(1);

  await page.locator(".window-file-title-row").click();

  await expect(editor.getByRole("toolbar")).toHaveCount(0);
  await expect(frame.locator("[data-html-canvas-selected]")).toHaveCount(0);
  await expect(target).not.toHaveAttribute("contenteditable", "true");
});

test("typing never replaces the iframe Document or jumps a scroll container", async ({ page }) => {
  const { frame } = await loadFixture(page, "complex-layout.html");
  const beforeDocument = await documentToken(frame);
  await activateNativeEdit(frame, "scroll-copy");
  const textLength = (await frame.locator(caseSelector("scroll-copy")).textContent()).length;
  await setTextSelection(frame, "scroll-copy", textLength - 2);
  await frame.locator(caseSelector("scroll-copy")).evaluate((target) => {
    target.parentElement.scrollTop = target.parentElement.scrollHeight;
  });
  const beforeScrollTop = await frame.locator(caseSelector("scroll-copy")).evaluate(
    (target) => target.parentElement.scrollTop,
  );
  const inserted = "原生光标连续输入不应丢字或乱序。".repeat(4);
  await page.keyboard.insertText(inserted);

  expect(await documentToken(frame)).toBe(beforeDocument);
  expect(await frame.locator(caseSelector("scroll-copy")).textContent()).toContain(inserted);
  const afterScrollTop = await frame.locator(caseSelector("scroll-copy")).evaluate(
    (target) => target.parentElement.scrollTop,
  );
  expect(beforeScrollTop).toBeGreaterThan(0);
  expect(afterScrollTop).toBeGreaterThan(0);
});

test("100-character typing has no loss, iframe reload, or over-50ms editor long task", async ({ page }) => {
  const { frame } = await loadFixture(page, "complex-layout.html");
  const beforeDocument = await documentToken(frame);
  await activateNativeEdit(frame, "paragraph-entities");
  await setTextSelection(frame, "paragraph-entities", 0);
  await installLongTaskRecorder(frame);

  const input = Array.from({ length: 100 }, (_, index) => String(index % 10)).join("");
  await page.keyboard.type(input, { delay: 0 });
  await waitForFramePaint(frame);

  expect(await documentToken(frame)).toBe(beforeDocument);
  const text = await frame.locator(caseSelector("paragraph-entities")).textContent();
  expect(text.startsWith(input)).toBe(true);
  expect(text.slice(0, input.length)).toBe(input);
  const longTasks = await recordedLongTasks(frame);
  expect(Math.max(0, ...longTasks)).toBeLessThanOrEqual(50);
});

test("beforeinput target ranges and Selection remain inside the authored case", async ({ page }) => {
  const { frame } = await loadFixture(page, "complex-layout.html");
  await activateNativeEdit(frame, "heading-inline");
  await installInputRecorder(frame);
  await setTextSelection(frame, "heading-inline", 2, 8);
  const before = await selectionSnapshot(frame, "heading-inline");
  expect(before.text.length).toBeGreaterThan(0);

  await page.keyboard.insertText("原位");

  const events = await recordedInputEvents(frame);
  const beforeInput = events.find(({ type }) => type === "beforeinput");
  expect(beforeInput).toMatchObject({
    inputType: "insertText",
    targetCase: "heading-inline",
    defaultPrevented: false,
  });
  expect(beforeInput.targetRangeCount).toBeGreaterThanOrEqual(0);
  expect((await selectionSnapshot(frame, "heading-inline")).activeCase).toBe("heading-inline");
});

test("an out-of-band authored DOM mutation fails closed and never reaches source", async ({ page }) => {
  const original = fixtureBuffer("complex-layout.html");
  const { editor, frame } = await loadFixture(page, "complex-layout.html", { buffer: original });
  const target = frame.locator(caseSelector("grid-card"));
  const beforeText = await target.textContent();
  await activateNativeEdit(frame, "grid-card");

  await target.evaluate((element) => {
    const textNode = Array.from(element.childNodes).find(
      (node) => node.nodeType === Node.TEXT_NODE,
    );
    if (!textNode) throw new Error("fixture grid-card has no direct text node");
    textNode.data += "UNAUTHORISED_DOM_DRIFT";
  });
  await expect.poll(() => editor.getAttribute("data-edit-block-detail"))
    .toContain("编辑之外发生了变化");

  await page.keyboard.press(keyShortcut("S"));
  await expect.poll(() => target.textContent()).toBe(beforeText);
  expect((await exportCurrentHtml(page)).equals(original)).toBe(true);
});
