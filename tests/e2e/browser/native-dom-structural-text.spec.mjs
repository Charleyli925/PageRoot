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

async function directTextPoint(element, textSnippet) {
  return element.evaluate((node, snippet) => {
    const text = Array.from(node.childNodes).find(
      (child) => child.nodeType === Node.TEXT_NODE && child.textContent?.includes(snippet),
    );
    if (!text) throw new Error(`Fixture has no direct text matching ${snippet}.`);
    const start = text.textContent.indexOf(snippet);
    const range = document.createRange();
    range.setStart(text, start);
    range.setEnd(text, start + 1);
    const glyph = range.getBoundingClientRect();
    const parent = node.getBoundingClientRect();
    return {
      x: glyph.left - parent.left + Math.max(1, glyph.width / 2),
      y: glyph.top - parent.top + Math.max(1, glyph.height / 2),
    };
  }, textSnippet);
}

async function selectTextRange(element, start, end) {
  await element.evaluate((node, offsets) => {
    const text = Array.from(node.childNodes).find(
      (child) => child.nodeType === Node.TEXT_NODE,
    );
    if (!(text instanceof Text)) throw new Error("Fragment host has no direct text node.");
    if (offsets.start < 0 || offsets.end < offsets.start || offsets.end > text.data.length) {
      throw new RangeError(`Selection ${offsets.start}:${offsets.end} exceeds fragment text.`);
    }
    node.focus({ preventScroll: true });
    const range = document.createRange();
    range.setStart(text, offsets.start);
    range.setEnd(text, offsets.end);
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, { start, end });
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

test("mixed block parents fall back to safe inline hosts and exact bare-text fragments", {
  tag: ["@gate-smoke","@smoke-editing"],
}, async ({
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
  expect(await mixedInline.evaluate(() => document.getSelection()?.isCollapsed)).toBe(true);
  await selectElementText(mixedInline);
  await page.keyboard.type("强化文字");
  await page.keyboard.press("Escape");
  let expected = replaceExactOnce(
    source,
    '<b data-native-case="mixed-inline">强调文字</b>',
    '<b data-native-case="mixed-inline">强化文字</b>',
  );
  expect((await exportCurrentHtml(page)).equals(expected)).toBe(true);

  const bareTextPoint = await directTextPoint(mixedParent, "裸文本");
  await mixedParent.dblclick({ position: bareTextPoint, force: true });
  const fragmentHost = mixedParent.locator(
    ':scope > pageroot-text-fragment[data-pageroot-text-fragment-host="true"]',
  );
  await expect(fragmentHost).toHaveAttribute("contenteditable", "true");
  await expect(mixedParent).not.toHaveAttribute("contenteditable", "true");
  expect(await fragmentHost.evaluate(() => document.getSelection()?.isCollapsed)).toBe(true);
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

test("bare-text fragments persist toolbar and shortcut formatting through guarded source patches", {
  tag: ["@gate-smoke","@smoke-editing"],
}, async ({
  page,
}) => {
  await page.goto("/");
  const source = fixtureBuffer("structural-text.html");
  const { frame } = await loadFixture(page, "structural-text.html", {
    buffer: source,
  });
  const mixedParent = frame.locator(caseSelector("mixed-parent"));
  const fragmentHost = mixedParent.locator(
    'pageroot-text-fragment[data-pageroot-text-fragment-host="true"]',
  );
  const editingHost = mixedParent.locator('[contenteditable="true"]');
  const initialDocument = await frame.evaluate(() => {
    const key = "__PAGEROOT_FORMAT_DOCUMENT_TOKEN__";
    window[key] ||= crypto.randomUUID();
    return window[key];
  });

  await mixedParent.dblclick({
    position: await directTextPoint(mixedParent, "裸文本"),
    force: true,
  });
  await expect(fragmentHost).toHaveAttribute("contenteditable", "true");
  await selectTextRange(fragmentHost, 1, 2);
  const boldButton = page.getByRole("button", { name: "加粗", exact: true });
  await expect(boldButton).toBeEnabled();
  await boldButton.click();
  await expect.poll(async () => ({
    fragmentCount: await fragmentHost.count(),
    startStatus: await page.getByTestId("html-canvas-editor")
      .getAttribute("data-native-start-status"),
    formatResume: await page.getByTestId("html-canvas-editor")
      .getAttribute("data-native-format-resume"),
    blockedDetail: await page.getByTestId("html-canvas-editor")
      .getAttribute("data-edit-block-detail"),
    candidateId: await page.getByTestId("html-canvas-editor")
      .getAttribute("data-runtime-candidate-id"),
    editingTags: await editingHost
      .evaluateAll((elements) => elements.map((element) => element.tagName)),
  })).toEqual({
    fragmentCount: 0,
    startStatus: "started",
    formatResume: "source:requested:resumed",
    blockedDetail: null,
    candidateId: null,
    editingTags: ["SPAN"],
  });
  await expect(editingHost).toHaveAttribute("contenteditable", "true");
  await expect.poll(() => editingHost.evaluate((element) => (
    element.ownerDocument.activeElement === element
  ))).toBe(true);
  expect(await frame.evaluate(() => window.__PAGEROOT_FORMAT_DOCUMENT_TOKEN__))
    .toBe(initialDocument);

  let expected = replaceExactOnce(
    source,
    '，裸文本<span data-keep="tail">',
    '，<span style="all: unset; display: inline !important; font-weight: 700">裸</span>文本<span data-keep="tail">',
  );
  await expect.poll(async () => (
    await exportCurrentHtml(page)
  ).toString("utf8")).toBe(expected.toString("utf8"));
  await expect(page.locator(".toast.show")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(editingHost).toHaveCount(0);

  await mixedParent.dblclick({
    position: await directTextPoint(mixedParent, "文本"),
    force: true,
  });
  await expect(fragmentHost).toHaveAttribute("contenteditable", "true");
  await selectTextRange(fragmentHost, 0, 2);
  await page.keyboard.press("Meta+i");
  await expect(editingHost).toHaveAttribute("contenteditable", "true");
  await expect.poll(() => editingHost.evaluate((element) => (
    element.ownerDocument.activeElement === element
  ))).toBe(true);
  expect(await frame.evaluate(() => window.__PAGEROOT_FORMAT_DOCUMENT_TOKEN__))
    .toBe(initialDocument);

  expected = replaceExactOnce(
    expected,
    '</span>文本<span data-keep="tail">',
    '</span><span style="all: unset; display: inline !important; font-style: italic">文本</span><span data-keep="tail">',
  );
  await expect.poll(async () => (
    await exportCurrentHtml(page)
  ).toString("utf8")).toBe(expected.toString("utf8"));
  await expect(page.locator(".toast.show")).toHaveCount(0);
  await expect(mixedParent.locator(':scope > div[data-keep="chart"]')).toHaveText(
    "图表结构保持",
  );
  await expect(mixedParent.locator(':scope > span[data-keep="tail"]')).toHaveText("尾注");
});

test("deleting a bare-text fragment ends its session without a blocked resume", {
  tag: ["@gate-smoke","@smoke-editing"],
}, async ({
  page,
}) => {
  await page.goto("/");
  const source = fixtureBuffer("structural-text.html");
  const { editor, frame } = await loadFixture(page, "structural-text.html", {
    buffer: source,
  });
  const mixedParent = frame.locator(caseSelector("mixed-parent"));
  const fragmentHost = mixedParent.locator(
    ':scope > pageroot-text-fragment[data-pageroot-text-fragment-host="true"]',
  );

  await mixedParent.dblclick({
    position: await directTextPoint(mixedParent, "裸文本"),
    force: true,
  });
  await expect(fragmentHost).toHaveAttribute("contenteditable", "true");
  await selectElementText(fragmentHost);
  await page.keyboard.press("Backspace");

  const expected = replaceExactOnce(
    source,
    '，裸文本<span data-keep="tail">',
    '<span data-keep="tail">',
  );
  await expect(fragmentHost).toHaveCount(0);
  await expect(mixedParent).not.toHaveAttribute("contenteditable", "true");
  await expect.poll(() => editor.getAttribute("data-edit-block-detail")).toBeNull();
  await expect(editor).toHaveAttribute("data-render-verified", "true");
  // Export only after the terminal source patch has reconnected its iframe;
  // otherwise this assertion races a keyboard event against navigation.
  expect((await exportCurrentHtml(page, "Control+Shift+E")).equals(expected)).toBe(true);
  await expect(page.locator(".toast.show")).toHaveCount(0);
  await expect(mixedParent.locator(':scope > div[data-keep="chart"]')).toHaveText(
    "图表结构保持",
  );
  await expect(mixedParent.locator(':scope > b[data-native-case="mixed-inline"]')).toHaveText(
    "强调文字",
  );
  await expect(mixedParent.locator(':scope > span[data-keep="tail"]')).toHaveText("尾注");
});
