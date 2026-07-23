import { expect, test } from "@playwright/test";

import {
  activateNativeEdit,
  exportCurrentHtml,
  keyShortcut,
  loadFixture,
  nativeEditingState,
  replaceUniqueBytes,
  selectionSnapshot,
  setTextSelection,
} from "./pageroot-driver.mjs";

const formatSource = Buffer.from(`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <style>
    body { font: 20px/1.6 sans-serif; padding: 40px; }
    .guarded { color: rgb(12, 34, 56); }
    .format-shift .guarded { color: rgb(210, 20, 30); }
  </style>
</head>
<body>
  <p data-native-case="nested-format">前<strong data-weight="kept">粗<em><span class="tone" style='font-size:21px; color:rgb(180, 40, 30)'>彩色字号</span>斜</em>尾</strong>后</p>
  <p data-native-case="single-link">去<a href='/docs?q=1&amp;x=2' class="link" data-kind="kept">链接文字</a>返回</p>
  <p data-native-case="cross-link">甲<a href="/one" class="first-link">链接一</a>乙<a href="/two" class="second-link">链接二</a>丙</p>
  <p data-native-case="computed-style-guard"><span class="guarded">Alpha</span><em>Omega</em></p>
</body>
</html>
`, "utf8");

async function openFormatFixture(page) {
  await page.goto("/");
  return loadFixture(page, "source-fidelity.html", { buffer: formatSource });
}

async function expectNoCommittedEdit(page, editor) {
  await expect.poll(() => editor.getAttribute("data-undo-depth")).toBe("0");
  expect(await editor.getAttribute("data-redo-depth")).toBe("0");
  await expect(page.locator(".round-record-counts")).toHaveText(
    "0 条评论 · 0 项直接编辑记录",
  );
}

async function waitForResumedSession(frameOrPage, caseId) {
  await expect.poll(() => nativeEditingState(frameOrPage, caseId)).toMatchObject({
    targetIsActive: true,
    contenteditable: "plaintext-only",
    isContentEditable: true,
    activeCase: caseId,
    selectionInside: true,
  });
}

test("nested bold, italic, color, size, span attributes and outside bytes survive an internal edit", async ({ page }) => {
  const { editor, frame } = await openFormatFixture(page);
  const caseId = "nested-format";
  const target = await activateNativeEdit(frame, caseId);
  const expectedSource = replaceUniqueBytes(
    formatSource,
    ">彩色字号</span>",
    ">彩新文号</span>",
  );

  // 前(0) 粗(1) 彩(2) 色(3) 字(4) 号(5) 斜(6) 尾(7) 后(8)
  await setTextSelection(frame, caseId, 3, 5);
  await page.keyboard.insertText("新文");

  await expect.poll(() => editor.getAttribute("data-undo-depth")).toBe("1");
  await expect(target).toHaveText("前粗彩新文号斜尾后");
  await expect(target.locator("strong[data-weight=kept]")).toHaveCount(1);
  await expect(target.locator("strong > em > span.tone")).toHaveText("彩新文号");
  expect(await target.locator("span.tone").getAttribute("style"))
    .toBe("font-size:21px; color:rgb(180, 40, 30)");
  expect(await target.locator("span.tone").evaluate((span) => {
    const style = getComputedStyle(span);
    return {
      fontWeight: style.fontWeight,
      fontStyle: style.fontStyle,
      fontSize: style.fontSize,
      color: style.color,
    };
  })).toEqual({
    fontWeight: "700",
    fontStyle: "italic",
    fontSize: "21px",
    color: "rgb(180, 40, 30)",
  });
  expect(await selectionSnapshot(frame, caseId)).toMatchObject({
    collapsed: true,
    anchorOffset: 5,
    focusOffset: 5,
    activeCase: caseId,
  });
  expect((await exportCurrentHtml(page)).equals(expectedSource)).toBe(true);

  await waitForResumedSession(frame, caseId);
  await page.keyboard.press(keyShortcut("Z"));
  await expect.poll(() => editor.getAttribute("data-undo-depth")).toBe("0");
  await expect(target).toHaveText("前粗彩色字号斜尾后");
  await waitForResumedSession(frame, caseId);
  expect(await selectionSnapshot(frame, caseId)).toMatchObject({
    collapsed: false,
    anchorOffset: 3,
    focusOffset: 5,
    text: "色字",
  });
  expect((await exportCurrentHtml(page)).equals(formatSource)).toBe(true);
});

test("editing link text preserves the authored link boundary and every non-text byte", async ({ page }) => {
  const { editor, frame } = await openFormatFixture(page);
  const caseId = "single-link";
  const target = await activateNativeEdit(frame, caseId);
  const expectedSource = replaceUniqueBytes(
    formatSource,
    ">链接文字</a>",
    ">新链</a>",
  );

  await setTextSelection(frame, caseId, 1, 5);
  await page.keyboard.insertText("新链");

  await expect.poll(() => editor.getAttribute("data-undo-depth")).toBe("1");
  await expect(target).toHaveText("去新链返回");
  const link = target.locator("a.link[data-kind=kept]");
  await expect(link).toHaveCount(1);
  await expect(link).toHaveText("新链");
  expect(await link.getAttribute("href")).toBe("/docs?q=1&x=2");
  expect(await selectionSnapshot(frame, caseId)).toMatchObject({
    collapsed: true,
    anchorOffset: 3,
    focusOffset: 3,
    activeCase: caseId,
  });
  expect((await exportCurrentHtml(page)).equals(expectedSource)).toBe(true);
});

test("a replacement crossing a link boundary is rejected even when the wrapper DOM remains intact", async ({ page }) => {
  const { editor, frame } = await openFormatFixture(page);
  const caseId = "cross-link";
  const target = await activateNativeEdit(frame, caseId);

  await setTextSelection(frame, caseId, 0, 4);
  const accepted = await target.evaluate((element) => {
    const leadingText = element.firstChild;
    const firstLink = element.querySelector("a.first-link");
    const linkedText = firstLink?.firstChild;
    if (!(leadingText instanceof Text) || !(linkedText instanceof Text)) {
      throw new Error("Cross-link fixture text nodes are missing.");
    }
    const beforeInput = new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      data: "越界",
      inputType: "insertText",
    });
    const deliveryAccepted = element.dispatchEvent(beforeInput);
    if (!deliveryAccepted) return false;

    // Keep both authored anchors and all attributes in place. This isolates
    // FormatSkeleton's source-owned link boundary check from the lower DOM
    // structure guard.
    leadingText.data = "越界";
    linkedText.data = "";
    const selection = document.getSelection();
    const range = document.createRange();
    range.setStart(leadingText, leadingText.data.length);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    element.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      data: "越界",
      inputType: "insertText",
    }));
    return true;
  });

  expect(accepted).toBe(true);
  await expect.poll(() => editor.getAttribute("data-edit-block-detail"))
    .toContain("链接边界");
  await expect(target).toHaveText("甲链接一乙链接二丙");
  await expect(target.locator('a[href="/one"]')).toHaveText("链接一");
  await expect(target.locator('a[href="/two"]')).toHaveText("链接二");
  expect(await selectionSnapshot(frame, caseId)).toMatchObject({
    collapsed: false,
    anchorOffset: 0,
    focusOffset: 4,
    direction: "forward",
    text: "甲链接一",
  });
  await expectNoCommittedEdit(page, editor);
  expect((await exportCurrentHtml(page)).equals(formatSource)).toBe(true);
});

test("computed style drift outside the replacement invalidates the whole checkpoint", async ({ page }) => {
  const { editor, frame } = await openFormatFixture(page);
  const caseId = "computed-style-guard";
  const target = await activateNativeEdit(frame, caseId);

  await setTextSelection(frame, caseId, 6, 8);
  const accepted = await target.evaluate((element) => {
    const emphasis = element.querySelector("em");
    const text = emphasis?.firstChild;
    if (!(text instanceof Text) || text.data !== "Omega") {
      throw new Error("Computed-style fixture text is missing.");
    }
    const beforeInput = new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      data: "XX",
      inputType: "insertText",
    });
    const deliveryAccepted = element.dispatchEvent(beforeInput);
    if (!deliveryAccepted) return false;

    text.data = "OXXga";
    // The class is outside the editing island, so the host MutationObserver
    // cannot mistake it for input authority. FormatSkeleton must still notice
    // that the untouched span's computed color changed.
    document.documentElement.classList.add("format-shift");
    const selection = document.getSelection();
    const range = document.createRange();
    range.setStart(text, 3);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    element.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      data: "XX",
      inputType: "insertText",
    }));
    return true;
  });

  expect(accepted).toBe(true);
  await expect.poll(() => editor.getAttribute("data-edit-block-detail"))
    .toContain("格式或网页结构");
  await expect(target).toHaveText("AlphaOmega");
  await expect(target.locator("span.guarded")).toHaveText("Alpha");
  expect(await selectionSnapshot(frame, caseId)).toMatchObject({
    collapsed: false,
    anchorOffset: 6,
    focusOffset: 8,
    direction: "forward",
    text: "me",
  });
  await expectNoCommittedEdit(page, editor);
  expect((await exportCurrentHtml(page)).equals(formatSource)).toBe(true);
});
