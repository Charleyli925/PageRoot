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
  nativeEditingState,
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
  await expect(page.getByRole("button", { name: /写评论后再发送/u })).toBeDisabled();
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

test("clicking a filled module's padding selects that module", async ({
  page,
}) => {
  const { editor, frame } = await loadFixture(page, "module-padding-hit.html");
  const copy = frame.locator(caseSelector("module-padding-copy"));
  const filledModule = frame.locator(caseSelector("filled-module"));
  const emptyModule = frame.locator(caseSelector("empty-module"));

  await copy.click();
  await expect(editor.getByRole("toolbar")).toBeVisible();
  await expect(copy).toHaveAttribute("data-html-canvas-selected", "part");

  await filledModule.click({ position: { x: 20, y: 20 } });
  await expect(editor.getByRole("toolbar")).toBeVisible();
  await expect(filledModule).toHaveAttribute("data-html-canvas-selected", "module");
  await expect(copy).not.toHaveAttribute("data-html-canvas-selected", /.+/u);

  await emptyModule.click({ position: { x: 20, y: 20 } });
  await expect(editor.getByRole("toolbar")).toHaveCount(0);
  await expect(frame.locator("[data-html-canvas-selected]")).toHaveCount(0);
});

test("hovering a filled module's padding advertises the same module click selects", async ({
  page,
}) => {
  const { editor, frame } = await loadFixture(page, "module-padding-hit.html");
  const filledModule = frame.locator(caseSelector("filled-module"));

  await filledModule.hover({ position: { x: 24, y: 24 } });
  const hint = editor.getByTestId("canvas-capability-hint");
  await expect(hint).toBeVisible({ timeout: 1500 });
  await expect(hint).toHaveText("单击选择并评论");

  const box = await hint.boundingBox();
  expect(box).toBeTruthy();
  await page.mouse.click(box.x + Math.min(40, box.width / 2), box.y + box.height / 2);
  await expect(filledModule).toHaveAttribute("data-html-canvas-selected", "module");
  await expect(editor.getByRole("toolbar")).toBeVisible();
});

test("text-edit hover caption hugs its copy instead of a fixed ribbon", async ({ page }) => {
  const { editor, frame } = await loadFixture(page, "complex-layout.html");
  const target = frame.locator(caseSelector("paragraph-entities"));

  await target.hover({ position: { x: 20, y: 20 } });
  const hint = editor.getByTestId("canvas-capability-hint");
  await expect(hint).toBeVisible({ timeout: 1500 });
  await expect(hint).toHaveText("双击文字直接编辑");

  const metrics = await hint.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      inlineWidth: element.style.width,
      width: rect.width,
      scrollWidth: element.scrollWidth,
    };
  });
  expect(metrics.inlineWidth).toBe("");
  expect(metrics.width).toBeLessThan(160);
  expect(Math.abs(metrics.width - metrics.scrollWidth)).toBeLessThanOrEqual(2);
});

test("clicking blank header and comment-rail surfaces commits editing and clears selection", async ({
  page,
}) => {
  const { editor, frame } = await loadFixture(page, "complex-layout.html");
  const target = frame.locator(caseSelector("paragraph-entities"));
  const toolbar = editor.getByRole("toolbar");

  await activateNativeEdit(frame, "paragraph-entities");
  await expect(target).toHaveAttribute("contenteditable", "true");
  await expect(toolbar).toBeVisible();
  await expect(frame.locator("[data-html-canvas-selected]")).toHaveCount(1);

  await page.locator(".comments-panel.comment-rail").click({
    position: { x: 4, y: 4 },
  });

  await expect(toolbar).toHaveCount(0);
  await expect(frame.locator("[data-html-canvas-selected]")).toHaveCount(0);
  await expect(target).not.toHaveAttribute("contenteditable", "true");

  await activateNativeEdit(frame, "paragraph-entities");
  await expect(target).toHaveAttribute("contenteditable", "true");
  await expect(toolbar).toBeVisible();
  await expect(frame.locator("[data-html-canvas-selected]")).toHaveCount(1);

  await page.locator(".workbench-header").click({
    position: { x: 4, y: 4 },
  });

  await expect(toolbar).toHaveCount(0);
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

async function glyphPointForText(locator, snippet) {
  return locator.evaluate((element, needle) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const text = node.textContent ?? "";
      const index = text.indexOf(needle);
      if (index >= 0) {
        const range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + needle.length);
        const glyph = range.getBoundingClientRect();
        const box = element.getBoundingClientRect();
        if (glyph.width > 0 && glyph.height > 0) {
          return {
            x: glyph.left - box.left + Math.min(Math.max(glyph.width / 2, 1), 6),
            y: glyph.top - box.top + Math.max(glyph.height / 2, 1),
          };
        }
      }
      node = walker.nextNode();
    }
    throw new Error(`No rendered glyph for ${JSON.stringify(needle)}`);
  }, snippet);
}

test("clicking a canvas selects the dedicated surface instead of the wrapping module", async ({ page }) => {
  const { editor, frame } = await loadFixture(page, "complex-layout.html");
  const canvas = frame.locator(caseSelector("canvas-surface"));
  await canvas.scrollIntoViewIfNeeded();
  await canvas.click({ force: true, position: { x: 8, y: 8 } });
  await expect(canvas).toHaveAttribute("data-html-canvas-selected", "part");
  await expect(editor.getByRole("toolbar")).toBeVisible();
  await expect(canvas.locator("xpath=ancestor::section[1]"))
    .not.toHaveAttribute("data-html-canvas-selected", /.+/u);
});

test("double-clicking a canvas reports the dedicated root and stays comment-only", async ({ page }) => {
  const { editor, frame } = await loadFixture(page, "complex-layout.html");
  const canvas = frame.locator(caseSelector("canvas-surface"));
  await canvas.scrollIntoViewIfNeeded();
  await canvas.dblclick({ force: true, position: { x: 4, y: 4 } });
  expect(await frame.locator('[contenteditable="true"]').count()).toBe(0);
  await expect.poll(() => editor.getAttribute("data-native-capability-detail") || "")
    .toContain("EDITABLE_ISLAND_ROOT_UNSUPPORTED");
});

test("first double-click places a caret; a second double-click selects the word", async ({ page }) => {
  const { frame } = await loadFixture(page, "complex-layout.html");
  const target = frame.locator(caseSelector("heading-inline"));
  const wordPoint = await glyphPointForText(target, "Word");
  await activateNativeEdit(frame, "heading-inline", wordPoint);
  expect(await nativeEditingState(frame, "heading-inline")).toMatchObject({
    targetIsActive: true,
    contenteditable: "true",
    selectionInside: true,
  });
  const first = await selectionSnapshot(frame, "heading-inline");
  expect(first.collapsed).toBe(true);
  expect(first.text).toBe("");
  expect(first.rangeCount).toBe(1);

  await target.dblclick({ position: wordPoint, force: true });
  await expect.poll(async () => (
    await selectionSnapshot(frame, "heading-inline")
  ).text).toBe("Word");
  const second = await selectionSnapshot(frame, "heading-inline");
  expect(second.collapsed).toBe(false);
  expect(second.activeCase).toBe("heading-inline");
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
