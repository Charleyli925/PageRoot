import { expect, test } from "@playwright/test";

import {
  activateNativeEdit,
  caseSelector,
  documentToken,
  exportCurrentHtml,
  fixtureBuffer,
  keyShortcut,
  loadFixture,
  nativeEditingState,
  requestExportCurrentHtml,
  replaceUniqueBytes,
  selectionSnapshot,
  setTextSelection,
  waitForResumedNativeSession,
  withBomAndCrLf,
} from "./pageroot-driver.mjs";

const sourceToken = "SOURCE_FIDELITY_TOKEN_001";
const redoShortcut = `${process.platform === "darwin" ? "Meta" : "Control"}+Shift+Z`;

async function openSourceFixture(page) {
  await page.goto("/");
  const source = withBomAndCrLf(fixtureBuffer("source-fidelity.html"));
  return {
    source,
    ...await loadFixture(page, "source-fidelity.html", { buffer: source }),
  };
}

async function waitForUndoDepth(editor, depth) {
  await expect.poll(() => editor.getAttribute("data-undo-depth")).toBe(String(depth));
}

async function waitForFreshDocument(frame, previousToken) {
  await expect.poll(async () => {
    try {
      return await documentToken(frame);
    } catch {
      return previousToken;
    }
  }).not.toBe(previousToken);
  return documentToken(frame);
}

test("ordinary text checkpoint preserves the live Text node, Selection and active host", async ({ page }) => {
  const { editor, frame, source } = await openSourceFixture(page);
  const caseId = "source-fidelity";
  const insertionOffset = 7;
  const inserted = "原位";
  const editedText = `${sourceToken.slice(0, insertionOffset)}${inserted}${sourceToken.slice(insertionOffset)}`;
  const target = await activateNativeEdit(frame, caseId);
  const initialDocument = await documentToken(frame);

  await setTextSelection(frame, caseId, insertionOffset);
  await target.evaluate((host) => {
    const selection = document.getSelection();
    if (!selection?.anchorNode) throw new Error("Expected a native caret before checkpoint.");
    window.__PAGEROOT_HISTORY_FENCE_LIVE_IDENTITY__ = {
      document,
      host,
      selection,
      anchorNode: selection.anchorNode,
      activeElement: document.activeElement,
    };
  });

  await page.keyboard.insertText(inserted);
  await waitForUndoDepth(editor, 1);

  expect(await documentToken(frame)).toBe(initialDocument);
  expect(await target.evaluate((host) => {
    const before = window.__PAGEROOT_HISTORY_FENCE_LIVE_IDENTITY__;
    const selection = document.getSelection();
    return {
      sameDocument: before.document === document,
      sameHost: before.host === host,
      sameSelection: before.selection === selection,
      sameTextNode: before.anchorNode === selection?.anchorNode,
      sameActiveElement: before.activeElement === document.activeElement,
      activeIsHost: document.activeElement === host,
    };
  })).toEqual({
    sameDocument: true,
    sameHost: true,
    sameSelection: true,
    sameTextNode: true,
    sameActiveElement: true,
    activeIsHost: true,
  });
  expect(await selectionSnapshot(frame, caseId)).toMatchObject({
    collapsed: true,
    anchorOffset: insertionOffset + inserted.length,
    focusOffset: insertionOffset + inserted.length,
  });

  // A later out-of-band mutation must restore the post-checkpoint snapshot,
  // including its middle caret. This catches a lease handoff that advances the
  // controller before the outer active lease and silently snapshots the end.
  await target.evaluate(() => {
    const text = window.__PAGEROOT_HISTORY_FENCE_LIVE_IDENTITY__?.anchorNode;
    if (!(text instanceof Text)) throw new Error("Expected source-fidelity text node.");
    text.insertData(0, "非法漂移");
  });
  await expect(target).toHaveText(editedText);
  expect(await selectionSnapshot(frame, caseId)).toMatchObject({
    collapsed: true,
    anchorOffset: insertionOffset + inserted.length,
    focusOffset: insertionOffset + inserted.length,
  });
  expect(await editor.getAttribute("data-undo-depth")).toBe("1");

  await page.keyboard.insertText("次");
  await waitForUndoDepth(editor, 2);
  const twiceEditedText = `${editedText.slice(0, insertionOffset + inserted.length)}次${editedText.slice(insertionOffset + inserted.length)}`;
  await expect(target).toHaveText(twiceEditedText);

  // Blur after a revision advance must retire the current session rather than
  // comparing against the initial lease captured when editing started.
  await page.getByRole("button", { name: "项目", exact: true }).focus();
  await expect.poll(() => target.getAttribute("contenteditable")).toBeNull();
  expect((await exportCurrentHtml(page)).equals(replaceUniqueBytes(
    source,
    sourceToken,
    twiceEditedText,
  ))).toBe(true);
});

test("a failed source-id rebind rolls back metadata before canonical island restart", async ({ page }) => {
  const { editor, frame, source } = await openSourceFixture(page);
  const caseId = "source-fidelity";
  const insertionOffset = 6;
  const target = await activateNativeEdit(frame, caseId);

  await setTextSelection(frame, caseId, insertionOffset);
  await target.evaluate(() => {
    const attributeName = "data-html-ai-source-node-id";
    const prototype = Element.prototype;
    const originalGetAttribute = prototype.getAttribute;
    const originalSetAttribute = prototype.setAttribute;
    let sourceIdWriteObserved = false;
    let failNextSourceIdRead = true;
    prototype.setAttribute = function patchedSetAttribute(name, value) {
      if (name === attributeName) sourceIdWriteObserved = true;
      return originalSetAttribute.call(this, name, value);
    };
    prototype.getAttribute = function patchedGetAttribute(name) {
      if (
        name === attributeName
        && sourceIdWriteObserved
        && failNextSourceIdRead
      ) {
        failNextSourceIdRead = false;
        prototype.getAttribute = originalGetAttribute;
        prototype.setAttribute = originalSetAttribute;
        return null;
      }
      return originalGetAttribute.call(this, name);
    };
  });

  await page.keyboard.insertText("甲");
  await waitForUndoDepth(editor, 1);
  await waitForResumedNativeSession(frame, caseId);
  await expect(target).toHaveText(
    `${sourceToken.slice(0, insertionOffset)}甲${sourceToken.slice(insertionOffset)}`,
  );
  expect(await selectionSnapshot(frame, caseId)).toMatchObject({
    collapsed: true,
    anchorOffset: insertionOffset + 1,
    focusOffset: insertionOffset + 1,
  });

  await page.keyboard.insertText("乙");
  await waitForUndoDepth(editor, 2);
  const expectedText = `${sourceToken.slice(0, insertionOffset)}甲乙${sourceToken.slice(insertionOffset)}`;
  await expect(target).toHaveText(expectedText);
  expect((await exportCurrentHtml(page)).equals(replaceUniqueBytes(
    source,
    sourceToken,
    expectedText,
  ))).toBe(true);
});

test("undo and redo cross fresh Document and host generations while preserving logical Selection", async ({ page }) => {
  const { editor, frame } = await openSourceFixture(page);
  const caseId = "source-fidelity";
  const insertionOffset = 8;
  const inserted = "新会话";
  const editedText = `${sourceToken.slice(0, insertionOffset)}${inserted}${sourceToken.slice(insertionOffset)}`;
  const target = await activateNativeEdit(frame, caseId);

  await setTextSelection(frame, caseId, insertionOffset);
  await page.keyboard.insertText(inserted);
  await waitForUndoDepth(editor, 1);
  const editedDocument = await documentToken(frame);
  await target.evaluate((host) => {
    host.__PAGEROOT_HISTORY_FENCE_HOST_GENERATION__ = "edited";
  });

  await page.keyboard.press(keyShortcut("Z"));
  const undoDocument = await waitForFreshDocument(frame, editedDocument);
  await expect(frame.locator(caseSelector(caseId))).toHaveText(sourceToken);
  await waitForResumedNativeSession(frame, caseId);
  expect(await frame.locator(caseSelector(caseId)).evaluate((host) => (
    host.__PAGEROOT_HISTORY_FENCE_HOST_GENERATION__
  ))).toBeUndefined();
  expect(await selectionSnapshot(frame, caseId)).toMatchObject({
    collapsed: true,
    anchorOffset: insertionOffset,
    focusOffset: insertionOffset,
  });
  await frame.locator(caseSelector(caseId)).evaluate((host) => {
    host.__PAGEROOT_HISTORY_FENCE_HOST_GENERATION__ = "undo";
  });

  await page.keyboard.press(redoShortcut);
  const redoDocument = await waitForFreshDocument(frame, undoDocument);
  expect(redoDocument).not.toBe(editedDocument);
  await expect(frame.locator(caseSelector(caseId))).toHaveText(editedText);
  await waitForResumedNativeSession(frame, caseId);
  expect(await frame.locator(caseSelector(caseId)).evaluate((host) => (
    host.__PAGEROOT_HISTORY_FENCE_HOST_GENERATION__
  ))).toBeUndefined();
  expect(await selectionSnapshot(frame, caseId)).toMatchObject({
    collapsed: true,
    anchorOffset: insertionOffset + inserted.length,
    focusOffset: insertionOffset + inserted.length,
  });
});

test("undo then redo followed by immediate export returns the exact forward bytes", async ({ page }) => {
  const { source, editor, frame } = await openSourceFixture(page);
  const caseId = "source-fidelity";
  const replacement = "立即导出_精确字节";
  const expected = replaceUniqueBytes(source, sourceToken, replacement);

  await activateNativeEdit(frame, caseId);
  await setTextSelection(frame, caseId, 0, sourceToken.length);
  await page.keyboard.insertText(replacement);
  await waitForUndoDepth(editor, 1);

  const editedDocument = await documentToken(frame);
  await page.keyboard.press(keyShortcut("Z"));
  await waitForFreshDocument(frame, editedDocument);
  await waitForResumedNativeSession(frame, caseId);

  await page.keyboard.press(redoShortcut);
  const exported = await exportCurrentHtml(page);
  expect(exported.equals(expected)).toBe(true);
});

test("late input from a retired host cannot mutate the new DOM or source revision", async ({ page }) => {
  const { source, editor, iframe, frame } = await openSourceFixture(page);
  const caseId = "source-fidelity";
  const insertionOffset = 5;

  await activateNativeEdit(frame, caseId);
  await setTextSelection(frame, caseId, insertionOffset);
  await page.keyboard.insertText("过期");
  await waitForUndoDepth(editor, 1);
  await iframe.evaluate((frameElement, selector) => {
    window.__PAGEROOT_HISTORY_FENCE_RETIRED_HOST__ =
      frameElement.contentDocument?.querySelector(selector) || null;
  }, caseSelector(caseId));

  const editedDocument = await documentToken(frame);
  await page.keyboard.press(keyShortcut("Z"));
  await waitForFreshDocument(frame, editedDocument);
  await waitForResumedNativeSession(frame, caseId);

  const retiredState = await iframe.evaluate((frameElement) => {
    const retiredHost = window.__PAGEROOT_HISTORY_FENCE_RETIRED_HOST__;
    // The retired node belongs to the previous iframe realm, so an outer-realm
    // instanceof Element check is intentionally invalid after navigation.
    if (!retiredHost || retiredHost.nodeType !== 1) {
      throw new Error("Retired host reference was lost.");
    }
    const EventConstructor = retiredHost.ownerDocument.defaultView?.InputEvent
      || frameElement.ownerDocument.defaultView.InputEvent;
    retiredHost.textContent = "STALE_HOST_MUST_NEVER_COMMIT";
    const delivered = [];
    for (const inputType of ["historyUndo", "historyRedo", "insertText"]) {
      for (const type of ["beforeinput", "input"]) {
        const event = new EventConstructor(type, {
          bubbles: true,
          cancelable: type === "beforeinput",
          data: inputType === "insertText" ? "迟到输入" : null,
          inputType,
        });
        delivered.push({ type, inputType, dispatchResult: retiredHost.dispatchEvent(event) });
      }
    }
    const state = {
      contenteditable: retiredHost.getAttribute("contenteditable"),
      editingMarker: retiredHost.getAttribute("data-html-canvas-editing"),
      delivered,
    };
    delete window.__PAGEROOT_HISTORY_FENCE_RETIRED_HOST__;
    return state;
  });
  expect(retiredState.contenteditable).toBeNull();
  expect(retiredState.editingMarker).toBeNull();
  expect(retiredState.delivered).toHaveLength(6);

  // Cover the normal checkpoint delay and any same-task browser history tail.
  await page.waitForTimeout(900);
  await expect(frame.locator(caseSelector(caseId))).toHaveText(sourceToken);
  await waitForResumedNativeSession(frame, caseId);
  expect(await editor.getAttribute("data-undo-depth")).toBe("0");
  expect(await editor.getAttribute("data-redo-depth")).toBe("1");
  expect((await exportCurrentHtml(page)).equals(source)).toBe(true);
});

test("export fences the document, resumes a new native session, and accepts the next input", async ({ page }) => {
  const { source, editor, frame } = await openSourceFixture(page);
  const caseId = "source-fidelity";
  const replacement = "第一次";
  const suffix = "继续";
  const firstExpected = replaceUniqueBytes(source, sourceToken, replacement);
  const continuedText = `${replacement.slice(0, 1)}${suffix}${replacement.slice(1)}`;
  const secondExpected = replaceUniqueBytes(source, sourceToken, continuedText);

  await activateNativeEdit(frame, caseId);
  await setTextSelection(frame, caseId, 0, sourceToken.length);
  await page.keyboard.insertText(replacement);
  await waitForUndoDepth(editor, 1);
  const beforeExportDocument = await documentToken(frame);

  expect((await exportCurrentHtml(page)).equals(firstExpected)).toBe(true);
  await waitForFreshDocument(frame, beforeExportDocument);
  await waitForResumedNativeSession(frame, caseId);
  expect(await selectionSnapshot(frame, caseId)).toMatchObject({
    collapsed: true,
    anchorOffset: replacement.length,
    focusOffset: replacement.length,
  });

  // The restored caret is at the end of an authored inline wrapper, which is
  // deliberately fail-closed because browser caret gravity is ambiguous
  // there. Move one character inside the same Text node to prove the resumed
  // session accepts the next ordinary input.
  await setTextSelection(frame, caseId, 1);
  await page.keyboard.insertText(suffix);
  await expect(frame.locator(caseSelector(caseId))).toHaveText(continuedText);
  expect((await exportCurrentHtml(page)).equals(secondExpected)).toBe(true);
});

test("save and export remount after their native sessions have already been disposed", async ({ page }) => {
  const { source, editor, frame } = await openSourceFixture(page);
  const caseId = "source-fidelity";
  const insertionOffset = 6;
  const inserted = "失焦";
  const expected = replaceUniqueBytes(
    source,
    sourceToken,
    `${sourceToken.slice(0, insertionOffset)}${inserted}${sourceToken.slice(insertionOffset)}`,
  );

  await activateNativeEdit(frame, caseId);
  await setTextSelection(frame, caseId, insertionOffset);
  await page.keyboard.insertText(inserted);
  await waitForUndoDepth(editor, 1);
  const editedDocument = await documentToken(frame);

  // Select a different authored element so finishNativeEditing() removes
  // contenteditable and disposes the controller before Export is requested.
  await frame.locator("body").dispatchEvent("click", {
    bubbles: true,
    cancelable: true,
  });
  await expect.poll(() => nativeEditingState(frame, caseId)).toMatchObject({
    targetIsActive: false,
    contenteditable: null,
    isContentEditable: false,
  });

  await page.keyboard.press(keyShortcut("S"));
  const savedDocument = await waitForFreshDocument(frame, editedDocument);
  expect(savedDocument).not.toBe(editedDocument);
  await expect(frame.locator(caseSelector(caseId))).toHaveText(
    `${sourceToken.slice(0, insertionOffset)}${inserted}${sourceToken.slice(insertionOffset)}`,
  );

  // A new native session makes the fresh browsing context history-dirty even
  // when the user exits without another source mutation. Export must still
  // fence that Chromium history before returning the current exact bytes.
  await activateNativeEdit(frame, caseId);
  await setTextSelection(frame, caseId, insertionOffset + inserted.length);
  const reenteredDocument = await documentToken(frame);
  expect(reenteredDocument).toBe(savedDocument);
  await frame.locator("body").dispatchEvent("click", {
    bubbles: true,
    cancelable: true,
  });
  await expect.poll(() => nativeEditingState(frame, caseId)).toMatchObject({
    targetIsActive: false,
    contenteditable: null,
    isContentEditable: false,
  });

  const exported = await exportCurrentHtml(page);
  expect(exported.equals(expected)).toBe(true);
  const exportedDocument = await waitForFreshDocument(frame, reenteredDocument);
  expect(exportedDocument).not.toBe(reenteredDocument);
});

test("undo and export fence fail closed during composition without retiring the session", async ({ page }) => {
  const { editor, frame } = await openSourceFixture(page);
  const caseId = "source-fidelity";
  const insertionOffset = 4;
  const target = await activateNativeEdit(frame, caseId);

  await setTextSelection(frame, caseId, insertionOffset);
  await page.keyboard.insertText("已");
  await waitForUndoDepth(editor, 1);
  // Start the composition from a newly fenced canonical session. This keeps a
  // real undo entry available while removing any browser-native history or
  // transient reconcile flag left by the setup keystroke itself.
  const setupDocument = await documentToken(frame);
  await exportCurrentHtml(page);
  await waitForFreshDocument(frame, setupDocument);
  await waitForResumedNativeSession(frame, caseId);
  await setTextSelection(frame, caseId, insertionOffset + 1);
  const composingDocument = await documentToken(frame);
  await target.evaluate((host) => {
    window.__PAGEROOT_HISTORY_FENCE_COMPOSITION_IDENTITY__ = { document, host };
  });

  let downloadCount = 0;
  page.on("download", () => {
    downloadCount += 1;
  });
  try {
    const undoWasIntercepted = await target.evaluate((host, isMac) => {
      host.dispatchEvent(new CompositionEvent("compositionstart", {
        bubbles: true,
        data: "draft",
      }));
      const undoEvent = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "z",
        code: "KeyZ",
        metaKey: isMac,
        ctrlKey: !isMac,
      });
      host.dispatchEvent(undoEvent);
      return undoEvent.defaultPrevented;
    }, process.platform === "darwin");
    expect(undoWasIntercepted).toBe(true);
    await page.waitForTimeout(100);
    expect(await documentToken(frame)).toBe(composingDocument);
    expect(await editor.getAttribute("data-undo-depth")).toBe("1");
    expect(await editor.getAttribute("data-redo-depth")).toBe("0");
    expect(await target.evaluate((host) => {
      const before = window.__PAGEROOT_HISTORY_FENCE_COMPOSITION_IDENTITY__;
      return before.document === document
        && before.host === host
        && document.activeElement === host
        && host.getAttribute("contenteditable") === "plaintext-only";
    })).toBe(true);

    await requestExportCurrentHtml(page);
    // The outer composition guard may reject the shortcut before React invokes
    // the fence, while a direct fence invocation rejects captureCheckpoint as
    // composing. Both observable paths must be fail-closed: no download, no
    // document generation advance, and no session retirement.
    await page.waitForTimeout(200);
    expect(downloadCount).toBe(0);
    expect(await documentToken(frame)).toBe(composingDocument);
    expect(await target.evaluate((host) => {
      const before = window.__PAGEROOT_HISTORY_FENCE_COMPOSITION_IDENTITY__;
      return before.document === document
        && before.host === host
        && document.activeElement === host
        && host.getAttribute("contenteditable") === "plaintext-only";
    })).toBe(true);
  } finally {
    await target.evaluate((host) => {
      host.dispatchEvent(new CompositionEvent("compositionend", {
        bubbles: true,
        data: "",
      }));
    }).catch(() => undefined);
  }
});
