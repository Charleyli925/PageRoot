import { expect, test } from "@playwright/test";

import {
  activateNativeEdit,
  caseSelector,
  keyShortcut,
  loadCaseManifest,
  loadFixture,
  nativeEditingState,
  replaceUniqueBytes,
  reverseTextSelection,
  selectionSnapshot,
  setTextSelection,
} from "./pageroot-driver.mjs";

const manifest = loadCaseManifest();
const redoShortcut = `${process.platform === "darwin" ? "Meta" : "Control"}+Shift+Z`;

async function openMatrix(page) {
  await page.goto("/");
  return loadFixture(page, manifest.fixture);
}

async function waitForCommittedEdit(editor) {
  await expect.poll(() => editor.getAttribute("data-undo-depth")).toBe("1");
}

async function waitForNativeSession(frame, caseId) {
  await expect.poll(() => nativeEditingState(frame, caseId)).toMatchObject({
    targetIsActive: true,
    contenteditable: "plaintext-only",
    selectionInside: true,
  });
}

async function exportCurrentHtmlPreservingFocus(page, frame, caseId) {
  const exportButton = page.getByRole("button", { name: "导出 HTML 副本", exact: true });
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    exportButton.evaluate((button) => button.click()),
  ]);
  const stream = await download.createReadStream();
  if (!stream) throw new Error("Export download did not expose a readable stream.");
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  await waitForNativeSession(frame, caseId);
  return Buffer.concat(chunks);
}

test("plain insertion undo restores the transaction-start caret and redo restores the after caret", async ({ page }) => {
  const { editor, frame } = await openMatrix(page);
  const caseId = "grid-card";
  const start = 14;
  const inserted = "原位";
  const original = await frame.locator(caseSelector(caseId)).textContent();

  await activateNativeEdit(frame, caseId);
  await setTextSelection(frame, caseId, start);
  await page.keyboard.insertText(inserted);
  await waitForCommittedEdit(editor);
  await waitForNativeSession(frame, caseId);
  expect(await selectionSnapshot(frame, caseId)).toMatchObject({
    collapsed: true,
    anchorOffset: start + inserted.length,
    focusOffset: start + inserted.length,
  });

  await page.keyboard.press(keyShortcut("Z"));
  await expect.poll(() => frame.locator(caseSelector(caseId)).textContent()).toBe(original);
  await waitForNativeSession(frame, caseId);
  expect(await selectionSnapshot(frame, caseId)).toMatchObject({
    collapsed: true,
    anchorOffset: start,
    focusOffset: start,
  });

  await page.keyboard.press(redoShortcut);
  await expect.poll(() => frame.locator(caseSelector(caseId)).textContent())
    .toBe(`${original.slice(0, start)}${inserted}${original.slice(start)}`);
  await waitForNativeSession(frame, caseId);
  expect(await selectionSnapshot(frame, caseId)).toMatchObject({
    collapsed: true,
    anchorOffset: start + inserted.length,
    focusOffset: start + inserted.length,
  });
});

test("replacement undo restores the exact backward range and redo restores the collapsed after caret", async ({ page }) => {
  const { editor, frame } = await openMatrix(page);
  const caseId = "paragraph-entities";
  const start = 3;
  const end = 16;
  const inserted = "替换完成";
  const original = await frame.locator(caseSelector(caseId)).textContent();

  await activateNativeEdit(frame, caseId);
  await reverseTextSelection(frame, caseId, start, end);
  expect(await selectionSnapshot(frame, caseId)).toMatchObject({
    collapsed: false,
    anchorOffset: end,
    focusOffset: start,
    direction: "backward",
  });
  await page.keyboard.insertText(inserted);
  await waitForCommittedEdit(editor);
  await waitForNativeSession(frame, caseId);

  await page.keyboard.press(keyShortcut("Z"));
  await expect.poll(() => frame.locator(caseSelector(caseId)).textContent()).toBe(original);
  await waitForNativeSession(frame, caseId);
  expect(await selectionSnapshot(frame, caseId)).toMatchObject({
    collapsed: false,
    anchorOffset: end,
    focusOffset: start,
    direction: "backward",
  });

  await page.keyboard.press(redoShortcut);
  await expect.poll(() => frame.locator(caseSelector(caseId)).textContent())
    .toBe(`${original.slice(0, start)}${inserted}${original.slice(end)}`);
  await waitForNativeSession(frame, caseId);
  expect(await selectionSnapshot(frame, caseId)).toMatchObject({
    collapsed: true,
    anchorOffset: start + inserted.length,
    focusOffset: start + inserted.length,
  });
});

test("IME undo restores the pre-composition caret and redo restores the committed caret", async ({ page }) => {
  const { editor, frame } = await openMatrix(page);
  const caseId = "list-item";
  const start = 6;
  const committedText = "拼音";
  const original = await frame.locator(caseSelector(caseId)).textContent();

  await activateNativeEdit(frame, caseId);
  await setTextSelection(frame, caseId, start);
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send("Input.imeSetComposition", {
      text: "pinyin",
      selectionStart: 6,
      selectionEnd: 6,
    });
    await cdp.send("Input.insertText", { text: committedText });
  } finally {
    await cdp.detach();
  }
  await waitForCommittedEdit(editor);
  await waitForNativeSession(frame, caseId);
  expect(await selectionSnapshot(frame, caseId)).toMatchObject({
    collapsed: true,
    anchorOffset: start + committedText.length,
    focusOffset: start + committedText.length,
  });

  await page.keyboard.press(keyShortcut("Z"));
  await expect.poll(() => frame.locator(caseSelector(caseId)).textContent()).toBe(original);
  await waitForNativeSession(frame, caseId);
  expect(await selectionSnapshot(frame, caseId)).toMatchObject({
    collapsed: true,
    anchorOffset: start,
    focusOffset: start,
  });

  await page.keyboard.press(redoShortcut);
  await expect.poll(() => frame.locator(caseSelector(caseId)).textContent())
    .toBe(`${original.slice(0, start)}${committedText}${original.slice(start)}`);
  await waitForNativeSession(frame, caseId);
  expect(await selectionSnapshot(frame, caseId)).toMatchObject({
    collapsed: true,
    anchorOffset: start + committedText.length,
    focusOffset: start + committedText.length,
  });
});

test("temporary IME wrapper preserves a backward authored selection through undo and redo", async ({ page }) => {
  const { editor, frame, source } = await openMatrix(page);
  const caseId = "heading-inline";
  const committedText = "你好";
  const target = await activateNativeEdit(frame, caseId);
  const originalText = await target.textContent();
  const wordStart = originalText.indexOf("Word");
  const wordEnd = wordStart + "Word".length;
  const committedCaret = wordStart + committedText.length;
  const expectedSource = replaceUniqueBytes(
    source,
    "<em>Word</em>",
    `<em>${committedText}</em>`,
  );

  expect(wordStart).toBeGreaterThanOrEqual(0);
  await expect(target.locator("em")).toHaveText("Word");
  await reverseTextSelection(frame, caseId, wordStart, wordEnd);
  expect(await selectionSnapshot(frame, caseId)).toMatchObject({
    collapsed: false,
    anchorOffset: wordEnd,
    focusOffset: wordStart,
    direction: "backward",
    text: "Word",
  });

  await target.evaluate((element, finalText) => {
    const authoredEm = element.querySelector("em");
    if (!(authoredEm instanceof HTMLElement)) throw new Error("Authored em is missing.");
    element.dispatchEvent(new CompositionEvent("compositionstart", {
      bubbles: true,
      data: "Word",
    }));

    const temporaryItalic = document.createElement("i");
    temporaryItalic.textContent = "ni hao";
    authoredEm.replaceWith(temporaryItalic);
    element.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      data: "ni hao",
      inputType: "insertCompositionText",
      isComposing: true,
    }));

    temporaryItalic.textContent = finalText;
    const selection = document.getSelection();
    const range = document.createRange();
    range.selectNodeContents(temporaryItalic);
    range.collapse(false);
    selection?.removeAllRanges();
    selection?.addRange(range);
    element.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      data: finalText,
      inputType: "insertCompositionText",
      isComposing: true,
    }));
    element.dispatchEvent(new CompositionEvent("compositionend", {
      bubbles: true,
      data: finalText,
    }));
  }, committedText);

  await waitForCommittedEdit(editor);
  await expect(target.locator("em")).toHaveText(committedText);
  await waitForNativeSession(frame, caseId);
  expect(await target.innerHTML()).not.toContain("<i>");
  expect(await editor.getAttribute("data-redo-depth")).toBe("0");
  await expect(page.locator(".round-record-counts")).toHaveText(
    "0 条评论 · 1 项直接编辑记录",
  );
  expect(await selectionSnapshot(frame, caseId)).toMatchObject({
    collapsed: true,
    anchorOffset: committedCaret,
    focusOffset: committedCaret,
  });
  expect((await exportCurrentHtmlPreservingFocus(page, frame, caseId)).equals(expectedSource)).toBe(true);

  await page.keyboard.press(keyShortcut("Z"));
  await expect(target.locator("em")).toHaveText("Word");
  await waitForNativeSession(frame, caseId);
  expect(await editor.getAttribute("data-undo-depth")).toBe("0");
  expect(await editor.getAttribute("data-redo-depth")).toBe("1");
  expect(await selectionSnapshot(frame, caseId)).toMatchObject({
    collapsed: false,
    anchorOffset: wordEnd,
    focusOffset: wordStart,
    direction: "backward",
    text: "Word",
  });
  expect((await exportCurrentHtmlPreservingFocus(page, frame, caseId)).equals(source)).toBe(true);

  await page.keyboard.press(redoShortcut);
  await expect(target.locator("em")).toHaveText(committedText);
  await waitForNativeSession(frame, caseId);
  expect(await target.innerHTML()).not.toContain("<i>");
  expect(await editor.getAttribute("data-undo-depth")).toBe("1");
  expect(await editor.getAttribute("data-redo-depth")).toBe("0");
  expect(await selectionSnapshot(frame, caseId)).toMatchObject({
    collapsed: true,
    anchorOffset: committedCaret,
    focusOffset: committedCaret,
  });
  expect((await exportCurrentHtmlPreservingFocus(page, frame, caseId)).equals(expectedSource)).toBe(true);
});
