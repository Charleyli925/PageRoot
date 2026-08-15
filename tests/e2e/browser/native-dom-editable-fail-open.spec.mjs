import { expect, test } from "@playwright/test";

import {
  activateNativeEdit,
  caseSelector,
  doubleClickRenderedText,
  exportCurrentHtml,
  loadFixture,
  replaceEditableIslandBytes,
  setTextSelection,
} from "./pageroot-driver.mjs";

const source = Buffer.from(`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <style>
    body { font: 20px/1.6 sans-serif; padding: 32px; }
    [contenteditable="true"] {
      padding: 28px !important;
      font-size: 36px !important;
      outline: 10px solid #c43;
    }
    .visible-empty {
      display: inline-block;
      width: 32px;
      height: 20px;
      background: #e85d3f;
      vertical-align: middle;
    }
  </style>
</head>
<body>
  <p data-native-case="layout-css">排版指纹文字</p>
  <p data-native-case="style-boundary">左<strong style="color:#c43">粗体</strong>右</p>
  <p data-native-case="empty-inline">前文<span class="visible-empty" aria-label="排版空位"></span>后文</p>
  <p data-native-case="text-mismatch">源码投影文字</p>
  <div data-native-case="complex-parent"><div data-keep="chart">图表结构保持</div>裸文本<span data-keep="tail">尾注</span></div>
  <p data-native-case="sibling-untouched">不得改动的邻居</p>
</body>
</html>
`, "utf8");

const blockedCopy = /两种样式的边界|请把光标移入文字内部|空的排版元素|会改变排版的 CSS|这里暂时不能直接改字/u;

async function openFixture(page) {
  await page.goto("/");
  return loadFixture(page, "editable-fail-open.html", { buffer: source });
}

async function editorFeedbackCopy(page, editor) {
  const detail = await editor.getAttribute("data-edit-block-detail");
  const notices = await page.locator('[role="alert"], [role="status"]').allTextContents();
  return `${detail || ""}\n${notices.join("\n")}`;
}

test("layout fingerprint CSS no longer blocks native edit entry", async ({ page }) => {
  const { editor, frame } = await openFixture(page);
  const target = await activateNativeEdit(frame, "layout-css");
  await expect(target).toHaveAttribute("contenteditable", "true");
  expect(await editor.getAttribute("data-native-start-status")).toBe("started");
  expect(await editor.getAttribute("data-native-start-status")).not.toBe("island:layout-changed");
  expect(await editorFeedbackCopy(page, editor)).not.toMatch(blockedCopy);
  await setTextSelection(frame, "layout-css", "排版指纹文字".length);
  await page.keyboard.insertText("可进");
  await expect(target).toContainText("可进");
});

test("style-boundary and empty-inline place a caret instead of refusing", async ({ page }) => {
  const { editor, frame } = await openFixture(page);

  const mixed = await activateNativeEdit(frame, "style-boundary");
  await expect(mixed).toHaveAttribute("contenteditable", "true");
  expect(await mixed.evaluate(() => document.getSelection()?.isCollapsed)).toBe(true);
  await setTextSelection(frame, "style-boundary", 1);
  await page.keyboard.insertText("插");
  await expect(mixed).toContainText("插");
  expect(await editorFeedbackCopy(page, editor)).not.toMatch(blockedCopy);
  await page.keyboard.press("Escape");

  const emptyInline = await activateNativeEdit(frame, "empty-inline");
  await expect(emptyInline).toHaveAttribute("contenteditable", "true");
  await setTextSelection(frame, "empty-inline", "前文".length);
  await page.keyboard.insertText("新");
  await expect(emptyInline).toContainText("前文新");
  await expect(emptyInline.locator("span.visible-empty[aria-label='排版空位']")).toHaveCount(1);
  expect(await editorFeedbackCopy(page, editor)).not.toMatch(blockedCopy);
});

test("canvas text mismatch remounts from source then enters", async ({ page }) => {
  const { editor, frame } = await openFixture(page);
  const previewTarget = frame.locator(caseSelector("text-mismatch"));
  await previewTarget.evaluate((element) => {
    element.textContent = "已经被脚本改掉";
  });
  await expect(previewTarget).toHaveText("已经被脚本改掉");

  const target = await activateNativeEdit(frame, "text-mismatch");
  await expect(target).toHaveAttribute("contenteditable", "true");
  await expect(target).toHaveText("源码投影文字");
  expect(await editor.getAttribute("data-native-start-status")).toBe("started");
  expect(await editorFeedbackCopy(page, editor)).not.toMatch(/画布文字与源码节点已经漂移/u);

  await setTextSelection(frame, "text-mismatch", "源码投影文字".length);
  await page.keyboard.insertText("已进");
  await expect(target).toContainText("已进");
});

test("complex parent prefers an exact text-fragment instead of comment-only", async ({ page }) => {
  const { editor, frame } = await openFixture(page);
  const parent = frame.locator(caseSelector("complex-parent"));
  const point = await parent.evaluate((element) => {
    const text = Array.from(element.childNodes).find(
      (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.includes("裸文本"),
    );
    if (!(text instanceof Text)) throw new Error("Fixture has no bare text node.");
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 1);
    const glyph = range.getBoundingClientRect();
    const box = element.getBoundingClientRect();
    return {
      x: glyph.left - box.left + Math.max(1, glyph.width / 2),
      y: glyph.top - box.top + Math.max(1, glyph.height / 2),
    };
  });
  await parent.dblclick({ position: point, force: true });
  const fragmentHost = parent.locator(
    ':scope > pageroot-text-fragment[data-pageroot-text-fragment-host="true"]',
  );
  await expect(fragmentHost).toHaveAttribute("contenteditable", "true");
  await expect(parent).not.toHaveAttribute("contenteditable", "true");
  expect(await editorFeedbackCopy(page, editor)).not.toMatch(
    /复杂网页结构|添加评论交给 AI 处理/u,
  );
  await fragmentHost.evaluate((element) => {
    const text = element.firstChild;
    if (!(text instanceof Text)) throw new Error("Fragment host has no text.");
    const range = document.createRange();
    range.selectNodeContents(text);
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await page.keyboard.type("精确裸文本");
  await expect(fragmentHost).toHaveText("精确裸文本");
  await page.keyboard.press("Escape");
  const exported = (await exportCurrentHtml(page)).toString("utf8");
  expect(exported).toContain(">精确裸文本<span data-keep=\"tail\">尾注</span>");
  expect(exported).toContain('<div data-keep="chart">图表结构保持</div>');
  expect(exported).toContain("不得改动的邻居");
  expect(exported).not.toMatch(/>裸文本<span data-keep="tail">/u);
});

test("unauthorized island mutation still rolls back after fail-open entry", async ({ page }) => {
  const { editor, frame } = await openFixture(page);
  const target = await activateNativeEdit(frame, "layout-css");
  await setTextSelection(frame, "layout-css", "排版".length);
  await page.keyboard.insertText("安全");
  await target.evaluate((element) => element.append("越权"));
  await expect(target).not.toContainText("越权");
  await expect(target).toContainText("安全");
  await expect.poll(() => editor.getAttribute("data-edit-block-detail")).toContain("编辑之外");
});

test("fail-open entry still writes only the selected island bytes", async ({ page }) => {
  const { frame } = await openFixture(page);
  const target = await activateNativeEdit(frame, "layout-css");
  await setTextSelection(frame, "layout-css", "排版指纹文字".length);
  await page.keyboard.insertText("补丁");
  await expect(target).toContainText("补丁");
  await page.keyboard.press("Escape");
  const expected = replaceEditableIslandBytes(
    source,
    "layout-css",
    "排版指纹文字补丁",
  );
  expect((await exportCurrentHtml(page)).toString("utf8")).toBe(expected.toString("utf8"));
});
