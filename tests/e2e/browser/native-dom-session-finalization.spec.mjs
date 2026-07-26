import { expect, test } from "@playwright/test";

import {
  activateNativeEdit,
  caseSelector,
  documentToken,
  exportCurrentHtml,
  loadFixture,
  requestExportCurrentHtml,
  replaceUniqueBytes,
  selectionSnapshot,
  setTextSelection,
  waitForResumedNativeSession,
} from "./pageroot-driver.mjs";

const sessionSource = Buffer.from(`<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>Session finalization</title></head>
<body><p data-native-case="session-copy">Alpha</p></body>
</html>
`, "utf8");

async function openSessionFixture(page) {
  await page.goto("/");
  return loadFixture(page, "source-fidelity.html", { buffer: sessionSource });
}

async function readDownload(download) {
  const stream = await download.createReadStream();
  if (!stream) throw new Error("Export download did not expose a readable stream.");
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function dispatchMissingTerminalComposition(target, {
  nextText,
  caretOffset,
}) {
  await target.evaluate((element, value) => {
    const text = element.firstChild;
    if (!(text instanceof Text)) throw new Error("Session fixture text is missing.");
    element.dispatchEvent(new CompositionEvent("compositionstart", {
      bubbles: true,
      data: "",
    }));
    text.data = value.nextText;
    const selection = document.getSelection();
    const range = document.createRange();
    range.setStart(text, value.caretOffset);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    // Deliberately omit every composition input/terminal input. Empty
    // compositionend leaves only a stable provisional DOM candidate.
    element.dispatchEvent(new CompositionEvent("compositionend", {
      bubbles: true,
      data: "",
    }));
  }, { nextText, caretOffset });
}

test("one export shortcut finalizes a stable missing-terminal composition and resumes its logical caret", async ({ page }) => {
  const { editor, frame } = await openSessionFixture(page);
  const caseId = "session-copy";
  const target = await activateNativeEdit(frame, caseId);
  const initialDocument = await documentToken(frame);
  const expectedSource = replaceUniqueBytes(sessionSource, ">Alpha</p>", ">Al你pha</p>");
  let downloadCount = 0;
  page.on("download", () => {
    downloadCount += 1;
  });

  await setTextSelection(frame, caseId, 2);
  await dispatchMissingTerminalComposition(target, {
    nextText: "Al你pha",
    caretOffset: 3,
  });

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    requestExportCurrentHtml(page),
  ]);

  expect((await readDownload(download)).equals(expectedSource)).toBe(true);
  expect(downloadCount).toBe(1);
  await expect.poll(() => editor.getAttribute("data-undo-depth")).toBe("1");
  await expect.poll(() => documentToken(page)).not.toBe(initialDocument);
  await waitForResumedNativeSession(frame, caseId);
  await expect(frame.locator(caseSelector(caseId))).toHaveText("Al你pha");
  expect(await selectionSnapshot(frame, caseId)).toMatchObject({
    collapsed: true,
    anchorOffset: 3,
    focusOffset: 3,
    activeCase: caseId,
  });
});

test("strict text wins over a missing terminal; one queued command completes and retired tails cannot revive it", async ({ page }) => {
  const { editor, iframe, frame } = await openSessionFixture(page);
  const caseId = "session-copy";
  const target = await activateNativeEdit(frame, caseId);
  const initialDocument = await documentToken(frame);
  const strictSource = replaceUniqueBytes(sessionSource, ">Alpha</p>", ">SAlpha</p>");
  let downloadCount = 0;
  page.on("download", () => {
    downloadCount += 1;
  });

  await setTextSelection(frame, caseId, 0);
  await page.keyboard.insertText("S");
  expect(await editor.getAttribute("data-undo-depth")).toBe("0");
  await setTextSelection(frame, caseId, 1);
  await dispatchMissingTerminalComposition(target, {
    nextText: "S你Alpha",
    caretOffset: 2,
  });
  await iframe.evaluate((frameElement, selector) => {
    window.__PAGEROOT_FINALIZATION_RETIRED_HOST__ =
      frameElement.contentDocument?.querySelector(selector) || null;
  }, caseSelector(caseId));

  // The click occurs while composition settlement still owns the host. The
  // first shortcut must queue, discard only provisional marked text, commit the
  // earlier strict input and then run export without asking the user to retry.
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    requestExportCurrentHtml(page),
  ]);

  expect((await readDownload(download)).equals(strictSource)).toBe(true);
  expect(downloadCount).toBe(1);
  await expect.poll(() => editor.getAttribute("data-undo-depth")).toBe("1");
  await expect.poll(() => documentToken(page)).not.toBe(initialDocument);
  await waitForResumedNativeSession(frame, caseId);
  await expect(frame.locator(caseSelector(caseId))).toHaveText("SAlpha");
  expect(await selectionSnapshot(frame, caseId)).toMatchObject({
    collapsed: true,
    anchorOffset: 1,
    focusOffset: 1,
    activeCase: caseId,
  });

  const retiredState = await iframe.evaluate((frameElement) => {
    const retiredHost = window.__PAGEROOT_FINALIZATION_RETIRED_HOST__;
    if (!retiredHost || retiredHost.nodeType !== 1) {
      throw new Error("Retired finalization host reference was lost.");
    }
    const RetiredCompositionEvent = retiredHost.ownerDocument.defaultView?.CompositionEvent
      || frameElement.ownerDocument.defaultView.CompositionEvent;
    const RetiredInputEvent = retiredHost.ownerDocument.defaultView?.InputEvent
      || frameElement.ownerDocument.defaultView.InputEvent;
    retiredHost.textContent = "STALE_TAIL_MUST_NOT_COMMIT";
    const delivered = [
      retiredHost.dispatchEvent(new RetiredInputEvent("input", {
        bubbles: true,
        data: "你",
        inputType: "insertCompositionText",
        isComposing: true,
      })),
      retiredHost.dispatchEvent(new RetiredCompositionEvent("compositionend", {
        bubbles: true,
        data: "你",
      })),
      retiredHost.dispatchEvent(new RetiredInputEvent("input", {
        bubbles: true,
        data: null,
        inputType: "insertText",
        isComposing: false,
      })),
    ];
    const state = {
      contenteditable: retiredHost.getAttribute("contenteditable"),
      editingMarker: retiredHost.getAttribute("data-html-canvas-editing"),
      delivered,
    };
    delete window.__PAGEROOT_FINALIZATION_RETIRED_HOST__;
    return state;
  });

  expect(retiredState).toEqual({
    contenteditable: null,
    editingMarker: null,
    // The Fence installs a capture guard on the retired Document. Cancelable
    // late tail events are deliberately prevented before they can reach any
    // retired controller or browser editing history.
    delivered: [false, false, false],
  });
  await page.waitForTimeout(900);
  expect(downloadCount).toBe(1);
  expect(await editor.getAttribute("data-undo-depth")).toBe("1");
  expect(await editor.getAttribute("data-redo-depth")).toBe("0");
  await expect(frame.locator(caseSelector(caseId))).toHaveText("SAlpha");
  await waitForResumedNativeSession(frame, caseId);
  expect((await exportCurrentHtml(page)).equals(strictSource)).toBe(true);
  expect(downloadCount).toBe(2);
});
