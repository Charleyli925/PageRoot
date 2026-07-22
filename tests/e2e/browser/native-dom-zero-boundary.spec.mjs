import { expect, test } from "@playwright/test";

import {
  doubleClickRenderedText,
  exportCurrentHtml,
  loadFixture,
} from "./pageroot-driver.mjs";

const source = Buffer.from(`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <style>
    body { font: 20px/1.6 sans-serif; padding: 40px; }
    .visible-empty { display: inline-block; width: 40px; height: 24px; background: #e85d3f; vertical-align: middle; }
  </style>
</head>
<body>
  <p data-native-case="visible-empty-boundary">前文<span class="visible-empty" aria-label="排版空位"></span>后文</p>
  <p data-native-case="source-comment-boundary">甲<!-- authored source boundary -->乙</p>
  <p data-native-case="styled-inline-boundary"><em style="color:#c43"><strong>AB</strong></em>C</p>
</body>
</html>
`, "utf8");

async function openBoundaryFixture(page) {
  await page.goto("/");
  return loadFixture(page, "source-fidelity.html", { buffer: source });
}

async function attemptDirectEdit(frame, id) {
  return doubleClickRenderedText(frame, id);
}

test("visible empty inline boundary stays selectable/commentable and never becomes editable", async ({ page }) => {
  const { editor, frame } = await openBoundaryFixture(page);
  const target = await attemptDirectEdit(frame, "visible-empty-boundary");

  await expect(page.locator('[role="status"], [role="alert"]').filter({
    hasText: /空的排版元素/,
  }).first()).toContainText(/输入可能跑到错误位置/);
  expect(await target.getAttribute("contenteditable")).toBeNull();
  expect(await target.evaluate((element) => element.isContentEditable)).toBe(false);
  expect(await frame.locator('[contenteditable="plaintext-only"]').count()).toBe(0);

  await page.keyboard.insertText("不应写入");
  expect(await target.textContent()).toBe("前文后文");
  expect(await editor.getAttribute("data-undo-depth")).toBe("0");
  expect((await exportCurrentHtml(page)).equals(source)).toBe(true);
});

test("authored comment boundary also fails closed and preserves every source byte", async ({ page }) => {
  const { editor, frame } = await openBoundaryFixture(page);
  const target = await attemptDirectEdit(frame, "source-comment-boundary");

  await expect(page.locator('[role="status"], [role="alert"]').filter({
    hasText: /需要保留的网页结构/,
  }).first()).toContainText(/选中文字.*添加评论/);
  expect(await target.getAttribute("contenteditable")).toBeNull();
  expect(await target.evaluate((element) => element.isContentEditable)).toBe(false);

  await page.keyboard.insertText("不应写入");
  expect(await target.textContent()).toBe("甲乙");
  expect(await editor.getAttribute("data-undo-depth")).toBe("0");
  expect((await exportCurrentHtml(page)).equals(source)).toBe(true);
});

const styledBoundaryPoints = [
  "strong-text-start",
  "strong-text-end",
  "trailing-text-start",
  "root-before-inline",
  "root-between-inline-and-text",
  "strong-element-start",
  "em-element-start",
];

async function setStyledBoundaryPoint(target, point) {
  await target.evaluate((element, placement) => {
    const emphasis = element.querySelector("em");
    const strong = element.querySelector("strong");
    const strongText = strong?.firstChild;
    const trailingText = element.lastChild;
    if (
      !emphasis
      || !strong
      || !(strongText instanceof Text)
      || !(trailingText instanceof Text)
    ) throw new Error("Styled inline fixture is incomplete.");
    const positions = {
      "strong-text-start": [strongText, 0],
      "strong-text-end": [strongText, strongText.data.length],
      "trailing-text-start": [trailingText, 0],
      "root-before-inline": [element, 0],
      "root-between-inline-and-text": [element, 1],
      "strong-element-start": [strong, 0],
      "em-element-start": [emphasis, 0],
    };
    const selection = document.getSelection();
    const range = document.createRange();
    const position = positions[placement];
    if (!position) throw new Error(`Unknown boundary placement: ${placement}`);
    element.focus({ preventScroll: true });
    range.setStart(position[0], position[1]);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, point);
}

async function authoredInnerHtml(target) {
  return target.evaluate((element) => {
    const clone = element.cloneNode(true);
    if (!(clone instanceof HTMLElement)) throw new Error("Expected an HTML element clone.");
    clone.querySelectorAll("[data-html-ai-source-node-id]").forEach((node) => {
      node.removeAttribute("data-html-ai-source-node-id");
    });
    return clone.innerHTML;
  });
}

test("collapsed typing is blocked at every non-empty inline style boundary", async ({ page }) => {
  for (const point of styledBoundaryPoints) {
    const { editor, frame } = await openBoundaryFixture(page);
    const target = await attemptDirectEdit(frame, "styled-inline-boundary");
    await expect(target).toHaveAttribute("contenteditable", "plaintext-only");
    await setStyledBoundaryPoint(target, point);

    await page.keyboard.insertText("X");

    await expect(page.locator('[role="status"], [role="alert"]').filter({
      hasText: /两种文字样式的边界/,
    }).first()).toContainText(/移到样式内一个字的位置/);
    expect(await authoredInnerHtml(target)).toBe('<em style="color:#c43"><strong>AB</strong></em>C');
    expect(await editor.getAttribute("data-undo-depth")).toBe("0");
    expect((await exportCurrentHtml(page)).equals(source)).toBe(true);
  }
});

test("typing strictly inside a styled inline wrapper stays native and source-exact", async ({ page }) => {
  const { editor, frame } = await openBoundaryFixture(page);
  const target = await attemptDirectEdit(frame, "styled-inline-boundary");
  await target.evaluate((element) => {
    const text = element.querySelector("strong")?.firstChild;
    if (!(text instanceof Text)) throw new Error("Strong text is missing.");
    const selection = document.getSelection();
    const range = document.createRange();
    range.setStart(text, 1);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
  });

  await page.keyboard.insertText("X");

  await expect(target).toHaveText("AXBC");
  expect(await authoredInnerHtml(target)).toBe('<em style="color:#c43"><strong>AXB</strong></em>C');
  await expect.poll(() => editor.getAttribute("data-undo-depth")).toBe("1");
  const expected = Buffer.from(source.toString("utf8").replace(
    "<strong>AB</strong>",
    "<strong>AXB</strong>",
  ), "utf8");
  expect((await exportCurrentHtml(page)).equals(expected)).toBe(true);
});

test("an IME epoch at an inline boundary is cancelled before DOM mutation and drains late tails", async ({ page }) => {
  const { editor, frame } = await openBoundaryFixture(page);
  const target = await attemptDirectEdit(frame, "styled-inline-boundary");
  await setStyledBoundaryPoint(target, "trailing-text-start");

  const beforeInputAccepted = await target.evaluate((element) => {
    element.dispatchEvent(new CompositionEvent("compositionstart", {
      bubbles: true,
      data: "",
    }));
    const accepted = element.dispatchEvent(new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      data: "你",
      inputType: "insertCompositionText",
      isComposing: true,
    }));
    // Exercise defensive draining even if a platform bridge sends events
    // after the cancelable beforeinput was prevented.
    element.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      data: "你",
      inputType: "insertCompositionText",
      isComposing: true,
    }));
    element.dispatchEvent(new CompositionEvent("compositionend", {
      bubbles: true,
      data: "你",
    }));
    element.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      data: null,
      inputType: "insertText",
      isComposing: false,
    }));
    return accepted;
  });

  expect(beforeInputAccepted).toBe(false);
  await expect(page.locator('[role="status"], [role="alert"]').filter({
    hasText: /两种文字样式的边界/,
  }).first()).toContainText(/添加评论/);
  expect(await authoredInnerHtml(target)).toBe('<em style="color:#c43"><strong>AB</strong></em>C');
  expect(await editor.getAttribute("data-undo-depth")).toBe("0");
  expect((await exportCurrentHtml(page)).equals(source)).toBe(true);
});
