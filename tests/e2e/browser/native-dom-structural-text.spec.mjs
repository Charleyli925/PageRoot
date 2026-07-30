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
