import { expect, test } from "@playwright/test";

import {
  activateNativeEdit,
  doubleClickRenderedText,
  exportCurrentHtml,
  identifiedHtmlBuffer,
  loadFixture,
  replaceEditableIslandTextByCase,
  setTextSelection,
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
const identifiedSource = identifiedHtmlBuffer(source);

async function openBoundaryFixture(page) {
  await page.goto("/");
  return loadFixture(page, "source-fidelity.html", {
    buffer: identifiedSource,
    identifiedWorkingCopy: false,
  });
}

async function attemptDirectEdit(frame, id) {
  return doubleClickRenderedText(frame, id);
}

test("visible empty inline boundary stays structurally intact while surrounding text remains editable", {
  tag: ["@gate-smoke","@smoke-editing"],
}, async ({ page }) => {
  const { frame } = await openBoundaryFixture(page);
  const before = await exportCurrentHtml(page);
  const target = await attemptDirectEdit(frame, "visible-empty-boundary");

  await expect(target).toHaveAttribute("contenteditable", "true");
  await setTextSelection(frame, "visible-empty-boundary", 4);
  await page.keyboard.insertText("新增");
  await expect(target).toHaveText("前文后文新增");
  await expect(target.locator("span.visible-empty[aria-label='排版空位']")).toHaveCount(1);
  const expected = replaceEditableIslandTextByCase(
    before,
    "visible-empty-boundary",
    "后文",
    "后文新增",
  );
  expect((await exportCurrentHtml(page)).equals(expected)).toBe(true);
});

test("authored comment boundary remains byte-stable while adjacent text is editable", async ({ page }) => {
  const { frame } = await openBoundaryFixture(page);
  const before = await exportCurrentHtml(page);
  const target = await activateNativeEdit(frame, "source-comment-boundary");

  await expect(target).toHaveAttribute("contenteditable", "true");
  await setTextSelection(frame, "source-comment-boundary", 2);
  await page.keyboard.insertText("新增");
  await expect(target).toHaveText("甲乙新增");
  const expected = Buffer.from(
    before.toString("utf8").replace(
      "甲<!-- authored source boundary -->乙",
      "甲<!-- authored source boundary -->乙新增",
    ),
    "utf8",
  );
  expect((await exportCurrentHtml(page)).equals(expected)).toBe(true);
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
    clone.querySelectorAll("*").forEach((node) => {
      node.removeAttribute("data-pageroot-id");
      node.removeAttribute("data-pageroot-edit-runtime-source");
    });
    clone.removeAttribute("data-pageroot-id");
    clone.removeAttribute("data-pageroot-edit-runtime-source");
    return clone.innerHTML;
  });
}

test("collapsed typing at every non-empty inline style boundary inherits deterministically", async ({ page }) => {
  const expectedInnerHtml = {
    "strong-text-start": '<em style="color:#c43"><strong>XAB</strong></em>C',
    "strong-text-end": '<em style="color:#c43"><strong>ABX</strong></em>C',
    "trailing-text-start": '<em style="color:#c43"><strong>ABX</strong></em>C',
    "root-before-inline": '<em style="color:#c43"><strong>XAB</strong></em>C',
    "root-between-inline-and-text": '<em style="color:#c43"><strong>ABX</strong></em>C',
    "strong-element-start": '<em style="color:#c43"><strong>XAB</strong></em>C',
    "em-element-start": '<em style="color:#c43"><strong>XAB</strong></em>C',
  };
  for (const point of styledBoundaryPoints) {
    const { frame } = await openBoundaryFixture(page);
    const target = await attemptDirectEdit(frame, "styled-inline-boundary");
    await expect(target).toHaveAttribute("contenteditable", "true");
    await setStyledBoundaryPoint(target, point);

    await page.keyboard.insertText("X");

    expect(await authoredInnerHtml(target)).toBe(expectedInnerHtml[point]);
    const expected = replaceEditableIslandTextByCase(
      identifiedSource,
      "styled-inline-boundary",
      ">AB<",
      expectedInnerHtml[point].includes("XAB") ? ">XAB<" : ">ABX<",
    );
    expect((await exportCurrentHtml(page)).equals(expected)).toBe(true);
  }
});

test("typing strictly inside a styled inline wrapper stays native and source-exact", async ({ page }) => {
  const { frame } = await openBoundaryFixture(page);
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
  const expected = replaceEditableIslandTextByCase(
    identifiedSource,
    "styled-inline-boundary",
    ">AB<",
    ">AXB<",
  );
  expect((await exportCurrentHtml(page)).equals(expected)).toBe(true);
});

test("the toolbar previews the left style at an inline boundary", async ({ page }) => {
  const { frame } = await openBoundaryFixture(page);
  const target = await attemptDirectEdit(frame, "styled-inline-boundary");
  await setStyledBoundaryPoint(target, "trailing-text-start");

  const toolbar = page.getByRole("toolbar");
  await expect(toolbar.getByRole("button", { name: "加粗" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(toolbar.getByRole("button", { name: "斜体" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await page.keyboard.insertText("X");
  expect(await authoredInnerHtml(target)).toBe(
    '<em style="color:#c43"><strong>ABX</strong></em>C',
  );
});

test("an IME epoch at an inline boundary commits into the left style", async ({ page }) => {
  const { frame } = await openBoundaryFixture(page);
  const target = await attemptDirectEdit(frame, "styled-inline-boundary");
  await setStyledBoundaryPoint(target, "trailing-text-start");

  const beforeInputAccepted = await target.evaluate((element) => {
    const strongText = element.querySelector("strong")?.firstChild;
    if (!(strongText instanceof Text)) throw new Error("Strong text is missing.");
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
    strongText.data = "AB你";
    const selection = document.getSelection();
    const range = document.createRange();
    range.setStart(strongText, strongText.data.length);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
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
    return accepted;
  });

  expect(beforeInputAccepted).toBe(true);
  expect(await authoredInnerHtml(target)).toBe(
    '<em style="color:#c43"><strong>AB你</strong></em>C',
  );
  const expected = replaceEditableIslandTextByCase(
    identifiedSource,
    "styled-inline-boundary",
    ">AB<",
    ">AB你<",
  );
  expect((await exportCurrentHtml(page)).equals(expected)).toBe(true);
});
