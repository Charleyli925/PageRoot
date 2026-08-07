import { expect, test } from "@playwright/test";

import {
  caseSelector,
  exportCurrentHtml,
  fixtureBuffer,
  loadFixture,
  replaceEditableIslandBytes,
} from "./pageroot-driver.mjs";

async function activateAtLeadingText(page, frame, caseId) {
  const target = frame.locator(caseSelector(caseId));
  const point = await target.evaluate((element) => {
    const text = Array.from(element.childNodes).find(
      (node) => node.nodeType === Node.TEXT_NODE && (node.textContent || "").trim(),
    );
    if (!text) throw new Error("Fixture target has no leading text node.");
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, Math.min(1, text.textContent?.length || 0));
    const glyph = range.getBoundingClientRect();
    const targetRect = element.getBoundingClientRect();
    return {
      x: glyph.left - targetRect.left + Math.max(1, glyph.width / 2),
      y: glyph.top - targetRect.top + Math.max(1, glyph.height / 2),
    };
  });
  await target.dblclick({ position: point, force: true });
  await expect(target).toHaveAttribute("contenteditable", "true");
  await expect(page.locator(".toast.show")).toHaveCount(0);
  return target;
}

async function selectLeadingText(target) {
  await target.evaluate((element) => {
    const text = Array.from(element.childNodes).find(
      (node) => node.nodeType === Node.TEXT_NODE && (node.textContent || "").trim(),
    );
    if (!text) throw new Error("Fixture target has no leading text node.");
    const range = document.createRange();
    range.selectNodeContents(text);
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
}

function replaceExactOnce(buffer, before, after) {
  const source = buffer.toString("utf8");
  const first = source.indexOf(before);
  expect(first).toBeGreaterThanOrEqual(0);
  expect(source.indexOf(before, first + before.length)).toBe(-1);
  return Buffer.from(
    source.slice(0, first) + after + source.slice(first + before.length),
    "utf8",
  );
}

async function selectElementText(element) {
  await element.evaluate((node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
}

test("nested list headings and wbr text edit without changing their authored structure", async ({
  page,
}) => {
  await page.goto("/");
  const source = fixtureBuffer("structural-text.html");
  const { frame } = await loadFixture(page, "structural-text.html", {
    buffer: source,
  });

  const nested = await activateAtLeadingText(page, frame, "nested-list-title");
  await expect(nested.locator(":scope > ul")).toHaveAttribute(
    "contenteditable",
    "false",
  );
  await selectLeadingText(nested);
  await page.keyboard.type("发现与验证阶段");
  await expect(nested).toContainText("发现与验证阶段");
  await expect(nested.locator(":scope > ul")).toContainText("访谈 12 位内容创作者");
  await page.keyboard.press("Escape");
  await expect(nested).not.toHaveAttribute("contenteditable", "true");

  const nestedExpected = replaceEditableIslandBytes(
    source,
    "nested-list-title",
    '发现与验证阶段<ul data-keep="yes"><li>访谈 12 位内容创作者</li><li>审计现有流程</li></ul>',
  );
  expect((await exportCurrentHtml(page)).equals(nestedExpected)).toBe(true);

  const wbr = await activateAtLeadingText(page, frame, "wbr-text");
  await wbr.evaluate((element) => {
    const textNodes = Array.from(element.childNodes).filter(
      (node) => node.nodeType === Node.TEXT_NODE,
    );
    const first = textNodes[0];
    if (!first) throw new Error("Fixture wbr target has no leading text.");
    const range = document.createRange();
    range.setStart(first, first.textContent?.length || 0);
    range.collapse(true);
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await page.keyboard.type("ual");
  await expect(wbr).toContainText("HypertextualMarkupLanguage");
  await expect(wbr.locator("wbr")).toHaveCount(2);
  await page.keyboard.press("Escape");
  await expect(wbr).not.toHaveAttribute("contenteditable", "true");

  const expected = replaceEditableIslandBytes(
    nestedExpected,
    "wbr-text",
    "软换行机会：Hypertextual<wbr>Markup<wbr>Language",
  );
  expect((await exportCurrentHtml(page)).equals(expected)).toBe(true);
});

test("mixed block parents fall back to safe inline hosts and exact bare-text fragments", async ({
  page,
}) => {
  await page.goto("/");
  const source = fixtureBuffer("structural-text.html");
  const { frame } = await loadFixture(page, "structural-text.html", {
    buffer: source,
  });
  const mixedParent = frame.locator(caseSelector("mixed-parent"));
  const mixedInline = frame.locator(caseSelector("mixed-inline"));

  await mixedInline.dblclick({ force: true });
  await expect(mixedInline).toHaveAttribute("contenteditable", "true");
  await expect(mixedParent).not.toHaveAttribute("contenteditable", "true");
  await selectElementText(mixedInline);
  await page.keyboard.type("强化文字");
  await page.keyboard.press("Escape");
  let expected = replaceExactOnce(
    source,
    '<b data-native-case="mixed-inline">强调文字</b>',
    '<b data-native-case="mixed-inline">强化文字</b>',
  );
  expect((await exportCurrentHtml(page)).equals(expected)).toBe(true);

  const bareTextPoint = await mixedParent.evaluate((element) => {
    const text = Array.from(element.childNodes).find(
      (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.includes("裸文本"),
    );
    if (!text) throw new Error("Mixed fixture has no direct bare text.");
    const start = text.textContent.indexOf("裸文本");
    const range = document.createRange();
    range.setStart(text, start);
    range.setEnd(text, start + 1);
    const glyph = range.getBoundingClientRect();
    const parent = element.getBoundingClientRect();
    return {
      x: glyph.left - parent.left + Math.max(1, glyph.width / 2),
      y: glyph.top - parent.top + Math.max(1, glyph.height / 2),
    };
  });
  await mixedParent.dblclick({ position: bareTextPoint, force: true });
  const fragmentHost = mixedParent.locator(
    ':scope > pageroot-text-fragment[data-pageroot-text-fragment-host="true"]',
  );
  await expect(fragmentHost).toHaveAttribute("contenteditable", "true");
  await expect(mixedParent).not.toHaveAttribute("contenteditable", "true");
  await selectElementText(fragmentHost);
  await page.keyboard.type("，新版裸文本");
  await expect(fragmentHost).toHaveText("，新版裸文本");
  await fragmentHost.evaluate((element) => {
    const text = element.lastChild;
    if (!(text instanceof Text)) throw new Error("Fragment host has no text node.");
    element.focus({ preventScroll: true });
    const selection = document.getSelection();
    const range = document.createRange();
    range.setStart(text, text.data.length);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    element.dispatchEvent(new CompositionEvent("compositionstart", {
      bubbles: true,
      data: "",
    }));
    text.data += "你";
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
  });
  await expect(fragmentHost).toHaveText("，新版裸文本你");
  await page.keyboard.press("Meta+s");
  await expect(fragmentHost).toHaveAttribute("contenteditable", "true");
  await expect(fragmentHost).toHaveText("，新版裸文本你");
  await page.keyboard.press("Escape");
  await expect(fragmentHost).toHaveCount(0);
  expected = replaceExactOnce(expected, "，裸文本", "，新版裸文本你");
  expect((await exportCurrentHtml(page)).equals(expected)).toBe(true);
  await expect(mixedParent.locator(':scope > div[data-keep="chart"]')).toHaveText(
    "图表结构保持",
  );
  await expect(mixedParent.locator(':scope > span[data-keep="tail"]')).toHaveText("尾注");

  const ordinary = frame.locator(caseSelector("ordinary-inline"));
  const ordinaryChild = frame.locator(caseSelector("ordinary-inline-child"));
  await ordinaryChild.dblclick({ force: true });
  await expect(ordinary).toHaveAttribute("contenteditable", "true");
  await expect(ordinaryChild).not.toHaveAttribute("contenteditable", "true");
  await selectElementText(ordinaryChild);
  await page.keyboard.type("继续安全");
  await page.keyboard.press("Escape");
  expected = replaceExactOnce(
    expected,
    '<strong data-native-case="ordinary-inline-child">安全</strong>',
    '<strong data-native-case="ordinary-inline-child">继续安全</strong>',
  );
  expect((await exportCurrentHtml(page)).equals(expected)).toBe(true);
});
