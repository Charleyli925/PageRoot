import { expect, test } from "@playwright/test";

import {
  activateNativeEdit,
  currentEditorFrame,
  documentToken,
  fixtureBuffer,
  loadCaseManifest,
  loadFixture,
  nativeEditingState,
  requestExportCurrentHtml,
  replaceUniqueBytes,
  selectionSnapshot,
  setTextSelection,
} from "./pageroot-driver.mjs";

const manifest = loadCaseManifest();

async function openMatrix(page) {
  await page.goto("/");
  return loadFixture(page, manifest.fixture);
}

async function activeNativeSessionSnapshot(page) {
  let lastError;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const frame = await currentEditorFrame(page);
    try {
      return await frame.evaluate(() => {
        const key = "__PAGEROOT_NATIVE_QA_DOCUMENT_TOKEN__";
        if (!window[key]) window[key] = crypto.randomUUID();
        const active = document.activeElement;
        const activeCaseId = active instanceof HTMLElement
          && active.getAttribute("contenteditable") === "true"
          && active.isContentEditable
          ? active.getAttribute("data-native-case") || null
          : null;
        return {
          activeCaseId,
          documentToken: window[key],
        };
      });
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      const frameWasReplaced = frame.isDetached()
        || /detached|Execution context was destroyed|Cannot find context/i.test(message);
      if (!frameWasReplaced) throw error;
    }
  }
  throw lastError || new Error("PageRoot edit Frame was repeatedly replaced.");
}

async function exportCurrentHtmlPreservingFocus(page) {
  const {
    activeCaseId,
    documentToken: activeDocumentToken,
  } = await activeNativeSessionSnapshot(page);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    requestExportCurrentHtml(page),
  ]);
  const stream = await download.createReadStream();
  if (!stream) throw new Error("Export download did not expose a readable stream.");
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  if (activeCaseId && activeDocumentToken) {
    await expect.poll(() => documentToken(page)).not.toBe(activeDocumentToken);
    await waitForResumedNativeSession(page, activeCaseId);
  }
  return Buffer.concat(chunks);
}

async function expectSourceBytes(page, expected) {
  expect((await exportCurrentHtmlPreservingFocus(page)).equals(expected)).toBe(true);
}

async function expectOneCommittedTransaction(page) {
  await expect(page.locator(".round-record-counts")).toHaveText(
    "0 条评论 · 1 项直接编辑记录",
  );
}

async function waitForResumedNativeSession(frameOrPage, caseId) {
  await expect.poll(() => nativeEditingState(frameOrPage, caseId)).toMatchObject({
    targetIsActive: true,
    contenteditable: "true",
    isContentEditable: true,
    activeCase: caseId,
    selectionInside: true,
  });
}

for (const terminalInputType of ["insertText", "insertFromComposition"]) {
  test(`a null-data ${terminalInputType} tail drains the accepted IME epoch without losing prior typing`, async ({ page }) => {
    const { editor, frame, source } = await openMatrix(page);
    const caseId = "list-item";
    const target = await activateNativeEdit(frame, caseId);
    const originalText = await target.textContent();

    await setTextSelection(frame, caseId, 0);
    await page.keyboard.insertText("A");
    await setTextSelection(frame, caseId, 1);

    await target.evaluate((element, tailType) => {
      const text = element.firstChild;
      if (!(text instanceof Text)) throw new Error("List item text is missing.");
      element.dispatchEvent(new CompositionEvent("compositionstart", {
        bubbles: true,
        data: "",
      }));
      text.data = `An${text.data.slice(1)}`;
      element.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        data: "n",
        inputType: "insertCompositionText",
        isComposing: true,
      }));
      element.dispatchEvent(new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: false,
        data: "你好",
        inputType: "insertText",
        isComposing: false,
      }));
      text.data = `A你好${text.data.slice(2)}`;
      element.dispatchEvent(new CompositionEvent("compositionend", {
        bubbles: true,
        data: "你好",
      }));
      const tail = new InputEvent("input", {
        bubbles: true,
        data: null,
        inputType: tailType,
        isComposing: false,
      });
      // Chromium normalizes synthetic insertFromComposition to an empty
      // inputType even though native/platform bridges can still deliver it.
      // Preserve the platform value so this regression exercises PageRoot's
      // drain lane rather than constructor normalization.
      if (tailType === "insertFromComposition" && tail.inputType !== tailType) {
        Object.defineProperty(tail, "inputType", { value: tailType });
      }
      element.dispatchEvent(tail);
    }, terminalInputType);

    await expect(target).toHaveText(`A你好${originalText}`);
    await expectOneCommittedTransaction(page);
    expect(await editor.getAttribute("data-edit-block-detail")).toBeNull();
    await expectSourceBytes(page, replaceUniqueBytes(
      source,
      `>${originalText}</li>`,
      `>A你好${originalText}</li>`,
    ));
  });
}

test("a repeated compositionend cannot rewind an accepted IME value", async ({ page }) => {
  const { editor, frame, source } = await openMatrix(page);
  const caseId = "list-item";
  const target = await activateNativeEdit(frame, caseId);
  const originalText = await target.textContent();

  await setTextSelection(frame, caseId, 0);
  await page.keyboard.insertText("A");
  await setTextSelection(frame, caseId, 1);
  await target.evaluate((element) => {
    const text = element.firstChild;
    if (!(text instanceof Text)) throw new Error("List item text is missing.");
    element.dispatchEvent(new CompositionEvent("compositionstart", {
      bubbles: true,
      data: "",
    }));
    text.data = `A你好${text.data.slice(1)}`;
    element.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      data: "你好",
      inputType: "insertCompositionText",
      isComposing: true,
    }));
    element.dispatchEvent(new CompositionEvent("compositionend", {
      bubbles: true,
      data: "你好",
    }));
    element.dispatchEvent(new CompositionEvent("compositionend", {
      bubbles: true,
      data: "你好",
    }));
    element.dispatchEvent(new CompositionEvent("compositionend", {
      bubbles: true,
      data: "",
    }));
  });

  await expect(target).toHaveText(`A你好${originalText}`);
  await expectOneCommittedTransaction(page);
  expect(await editor.getAttribute("data-edit-block-detail")).toBeNull();
  await expectSourceBytes(page, replaceUniqueBytes(
    source,
    `>${originalText}</li>`,
    `>A你好${originalText}</li>`,
  ));
});

for (const entityDeletion of [
  {
    name: "first",
    startOffset: 0,
    endOffset: 1,
    expected: ">&amp;</li>",
  },
  {
    name: "second",
    startOffset: 1,
    endOffset: 2,
    expected: ">&#38;</li>",
  },
]) {
  test(`deleting the ${entityDeletion.name} equal character preserves the other authored entity bytes`, async ({ page }) => {
    const originalFixture = fixtureBuffer(manifest.fixture);
    const authoredEntities = ">&#38;&amp;</li>";
    const customSource = replaceUniqueBytes(
      originalFixture,
      ">列表项中的文字保持项目符号和缩进。</li>",
      authoredEntities,
    );
    await page.goto("/");
    const { frame } = await loadFixture(page, manifest.fixture, {
      buffer: customSource,
    });
    const caseId = "list-item";
    const target = await activateNativeEdit(frame, caseId);
    await expect(target).toHaveText("&&");

    await setTextSelection(
      frame,
      caseId,
      entityDeletion.startOffset,
      entityDeletion.endOffset,
    );
    await page.keyboard.press("Backspace");

    await expect(target).toHaveText("&");
    await expectOneCommittedTransaction(page);
    await expectSourceBytes(page, replaceUniqueBytes(
      customSource,
      authoredEntities,
      entityDeletion.expected,
    ));

  });
}

test("composition rollback restores exact tracker pieces and preserves authored entity bytes", async ({ page }) => {
  const originalFixture = fixtureBuffer(manifest.fixture);
  const customSource = replaceUniqueBytes(
    originalFixture,
    ">列表项中的文字保持项目符号和缩进。</li>",
    ">&#38;</li>",
  );
  await page.goto("/");
  const { editor, frame } = await loadFixture(page, manifest.fixture, {
    buffer: customSource,
  });
  const caseId = "list-item";
  const target = await activateNativeEdit(frame, caseId);
  await expect(target).toHaveText("&");

  await setTextSelection(frame, caseId, 1);
  await page.keyboard.insertText("&");
  await expect(target).toHaveText("&&");
  await setTextSelection(frame, caseId, 0, 2);

  await target.evaluate((element) => {
    const text = element.firstChild;
    if (!(text instanceof Text)) throw new Error("Entity text is missing.");
    element.dispatchEvent(new CompositionEvent("compositionstart", {
      bubbles: true,
      data: "",
    }));
    text.data = "b";
    element.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      data: "b",
      inputType: "insertCompositionText",
      isComposing: true,
    }));
    element.dispatchEvent(new CompositionEvent("compositionend", {
      bubbles: true,
      data: "b",
    }));
    // A same-task window blur may follow compositionend on macOS. It restores
    // the composition-start epoch while retaining the earlier accepted '&'.
    window.dispatchEvent(new Event("blur"));
  });

  await expect(target).toHaveText("&&");
  await expectOneCommittedTransaction(page);
  expect(await editor.getAttribute("data-edit-block-detail")).toBeNull();
  await expectSourceBytes(page, replaceUniqueBytes(
    customSource,
    ">&#38;</li>",
    ">&#38;&amp;</li>",
  ));
});

test("same-value insertText after the composition guard is a new edit, not a late IME tail", async ({ page }) => {
  const { frame, source } = await openMatrix(page);
  const caseId = "list-item";
  const target = await activateNativeEdit(frame, caseId);
  const originalText = await target.textContent();
  const firstCompositionText = `a${originalText}`;
  const expectedText = `aa${originalText}`;
  const expectedSource = replaceUniqueBytes(
    source,
    `>${originalText}</li>`,
    `>${expectedText}</li>`,
  );

  await setTextSelection(frame, caseId, 0);
  await target.evaluate((element) => {
    window.__PAGEROOT_SAME_VALUE_COMPOSITION_HOST__ = element;
    const firstText = element.firstChild;
    if (!(firstText instanceof Text)) throw new Error("List item text is missing.");
    element.dispatchEvent(new CompositionEvent("compositionstart", {
      bubbles: true,
      data: "",
    }));
    firstText.insertData(0, "a");
    const selection = document.getSelection();
    const range = document.createRange();
    range.setStart(firstText, 1);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    element.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      data: "a",
      inputType: "insertCompositionText",
      isComposing: true,
    }));
    element.dispatchEvent(new CompositionEvent("compositionend", {
      bubbles: true,
      data: "a",
    }));
  });

  // Every composition-derived commit crosses a hard DOM generation before a
  // generic insertText can be accepted. The composition and the later ordinary
  // keystroke are therefore deliberately two forward source transactions.
  await expectOneCommittedTransaction(page);
  await expect(target).toHaveText(firstCompositionText);
  expect(await target.evaluate((element) => {
    const replaced = window.__PAGEROOT_SAME_VALUE_COMPOSITION_HOST__ !== element;
    delete window.__PAGEROOT_SAME_VALUE_COMPOSITION_HOST__;
    return replaced;
  })).toBe(true);
  expect(await selectionSnapshot(frame, caseId)).toMatchObject({
    collapsed: true,
    anchorOffset: 1,
    focusOffset: 1,
  });

  const secondAccepted = await target.evaluate((element) => {
    const firstText = element.firstChild;
    if (!(firstText instanceof Text)) throw new Error("List item text is missing.");
    const beforeInput = new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      data: "a",
      inputType: "insertText",
      isComposing: false,
    });
    const accepted = element.dispatchEvent(beforeInput);
    if (!accepted) return false;
    firstText.insertData(1, "a");
    const selection = document.getSelection();
    const range = document.createRange();
    range.setStart(firstText, 2);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    element.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      data: "a",
      inputType: "insertText",
      isComposing: false,
    }));
    return true;
  });

  expect(secondAccepted).toBe(true);
  await expect(page.locator(".round-record-counts")).toHaveText(
    "0 条评论 · 2 项直接编辑记录",
  );
  await expect(target).toHaveText(expectedText);
  expect(await selectionSnapshot(frame, caseId)).toMatchObject({
    collapsed: true,
    anchorOffset: 2,
    focusOffset: 2,
  });
  await expectSourceBytes(page, expectedSource);

});

test("an empty root remains an active editable baseline for the first following character", async ({ page }) => {
  const { frame, source } = await openMatrix(page);
  const caseId = "list-item";
  const target = await activateNativeEdit(frame, caseId);
  const originalText = await target.textContent();
  const emptySource = replaceUniqueBytes(
    source,
    `>${originalText}</li>`,
    "></li>",
  );
  const firstCharacterSource = replaceUniqueBytes(emptySource, "></li>", ">A</li>");

  await setTextSelection(frame, caseId, 0, originalText.length);
  await page.keyboard.press("Backspace");
  await expect(target).toHaveText("");
  expect(await target.evaluate((element) => ({
    active: document.activeElement === element,
    contenteditable: element.getAttribute("contenteditable"),
    logicalChildCount: Array.from(element.childNodes).filter((node) => (
      node.nodeType !== Node.TEXT_NODE || node.textContent !== ""
    )).length,
  }))).toEqual({
    active: true,
    contenteditable: "true",
    logicalChildCount: 0,
  });
  expect(await selectionSnapshot(frame, caseId)).toMatchObject({
    collapsed: true,
    anchorOffset: 0,
    focusOffset: 0,
  });
  await expectSourceBytes(page, emptySource);

  // The first checkpoint rebases the live session to an empty authored root.
  // Its root-container caret must remain a valid beforeinput intent for the
  // first character rather than being treated as an unmapped DOM point.
  expect(await target.evaluate((element) => document.activeElement === element)).toBe(true);
  await page.keyboard.insertText("A");

  await expect(page.locator(".round-record-counts")).toHaveText(
    "0 条评论 · 2 项直接编辑记录",
  );
  await expect(target).toHaveText("A");
  expect(await selectionSnapshot(frame, caseId)).toMatchObject({
    collapsed: true,
    anchorOffset: 1,
    focusOffset: 1,
  });
  await expectSourceBytes(page, firstCharacterSource);

});

test("a canonical cross-strong replacement can be followed by another native transaction", async ({ page }) => {
  const { frame, source } = await openMatrix(page);
  const caseId = "heading-inline";
  const target = await activateNativeEdit(frame, caseId);
  const originalText = await target.textContent();
  const selectionStart = 2;
  const selectionEnd = 7;
  const expectedText = `${originalText.slice(0, selectionStart)}跨X${originalText.slice(selectionEnd)}`;
  const firstExpectedText = `${originalText.slice(0, selectionStart)}跨${originalText.slice(selectionEnd)}`;
  const expectedSource = replaceUniqueBytes(
    source,
    ">\u771f\u5b9e <strong>DOM</strong> \u5149\u6807\u8981\u50cf <em>Word</em> \u4e00\u6837\u81ea\u7136&nbsp;\ud83d\ude42</h1>",
    ">\u771f\u5b9e\u8de8X\u5149\u6807\u8981\u50cf <em>Word</em> \u4e00\u6837\u81ea\u7136&nbsp;\ud83d\ude42</h1>",
  );

  await setTextSelection(frame, caseId, selectionStart, selectionEnd);
  expect(await selectionSnapshot(frame, caseId)).toMatchObject({
    collapsed: false,
    anchorOffset: selectionStart,
    focusOffset: selectionEnd,
    direction: "forward",
    text: " DOM ",
  });
  await page.keyboard.insertText("跨");
  // Removing the fully selected authored wrapper requires immediate canonical
  // island replacement. That source-authority boundary intentionally closes
  // the first source transaction before the next character is accepted.
  await expect(target).toHaveText(firstExpectedText);
  expect(await selectionSnapshot(frame, caseId)).toMatchObject({
    collapsed: true,
    anchorOffset: 3,
    focusOffset: 3,
  });

  // The fresh canonical session must accept the next character normally.
  await page.keyboard.insertText("X");

  await expect(page.locator(".round-record-counts")).toHaveText(
    "0 条评论 · 2 项直接编辑记录",
  );
  await expect(target).toHaveText(expectedText);
  expect(await selectionSnapshot(frame, caseId)).toMatchObject({
    collapsed: true,
    anchorOffset: 4,
    focusOffset: 4,
  });
  await expectSourceBytes(page, expectedSource);

});

test("a length-changing prefix edit and temporary-wrapper IME commit share one exact transaction", async ({ page }) => {
  const { frame, source } = await openMatrix(page);
  const caseId = "heading-inline";
  const target = await activateNativeEdit(frame, caseId);
  const originalText = await target.textContent();
  const originalWordStart = originalText.indexOf("Word");
  const expectedText = `A${originalText.replace("Word", "你好")}`;
  const expectedSource = replaceUniqueBytes(
    replaceUniqueBytes(source, ">真实 <strong>", ">A真实 <strong>"),
    "<em>Word</em>",
    "<em>你好</em>",
  );

  expect(originalWordStart).toBeGreaterThanOrEqual(0);
  await setTextSelection(frame, caseId, 0);
  await page.keyboard.insertText("A");

  const currentWordStart = originalWordStart + 1;
  await setTextSelection(frame, caseId, currentWordStart, currentWordStart + 4);
  await target.evaluate((element) => {
    const authoredEm = element.querySelector("em");
    if (!(authoredEm instanceof HTMLElement)) throw new Error("Authored em is missing.");
    element.dispatchEvent(new CompositionEvent("compositionstart", {
      bubbles: true,
      data: "Word",
    }));
    const temporaryItalic = document.createElement("i");
    temporaryItalic.textContent = "你好";
    authoredEm.replaceWith(temporaryItalic);
    const selection = document.getSelection();
    const range = document.createRange();
    range.selectNodeContents(temporaryItalic);
    range.collapse(false);
    selection?.removeAllRanges();
    selection?.addRange(range);
    element.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      data: "你好",
      inputType: "insertCompositionText",
      isComposing: true,
    }));
    element.dispatchEvent(new CompositionEvent("compositionend", {
      bubbles: true,
      data: "你好",
    }));
  });

  await expectOneCommittedTransaction(page);
  await expect(target).toHaveText(expectedText);
  await expect(target.locator("em")).toHaveText("你好");
  expect(await target.locator("i").count()).toBe(0);
  expect(await selectionSnapshot(frame, caseId)).toMatchObject({
    collapsed: true,
    anchorOffset: currentWordStart + 2,
    focusOffset: currentWordStart + 2,
  });
  await expectSourceBytes(page, expectedSource);

});

test("a partial inline edit cannot move the unselected remainder outside its authored wrapper", async ({ page }) => {
  const { frame, source } = await openMatrix(page);
  const caseId = "heading-inline";
  const target = await activateNativeEdit(frame, caseId);
  const originalHtml = await target.innerHTML();
  const originalText = await target.textContent();
  const wordStart = originalText.indexOf("Word");

  expect(wordStart).toBeGreaterThanOrEqual(0);
  await setTextSelection(frame, caseId, wordStart, wordStart + 1);
  const delivery = await target.evaluate((element) => {
    const authoredEm = element.querySelector("em");
    const authoredWord = authoredEm?.firstChild;
    if (
      !(authoredEm instanceof HTMLElement)
      || !(authoredWord instanceof Text)
      || authoredWord.data !== "Word"
    ) throw new Error("Authored Word text is missing.");

    const beforeInput = new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      data: "X",
      inputType: "insertText",
    });
    const accepted = element.dispatchEvent(beforeInput);
    if (!accepted) return { accepted, innerHtmlAfterInput: element.innerHTML };

    // Only W is selected and authorized. Keep the global text edit itself
    // plausible (Word -> Xord), but illicitly move the untouched "ord" text
    // outside its authored em identity.
    authoredWord.data = "X";
    authoredEm.after(document.createTextNode("ord"));
    const selection = document.getSelection();
    const range = document.createRange();
    range.setStart(authoredWord, 1);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    element.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      data: "X",
      inputType: "insertText",
    }));
    return { accepted, innerHtmlAfterInput: element.innerHTML };
  });

  expect(delivery.accepted).toBe(true);
  // handleInput owns the fail-closed boundary: restoration must be complete
  // before the first input handler returns, not deferred to MutationObserver
  // delivery or the 700ms source checkpoint.
  expect(delivery.innerHtmlAfterInput).toBe(originalHtml);
  await expect(target).toHaveText(originalText);
  await expect(target.locator("em")).toHaveText("Word");
  expect(await selectionSnapshot(frame, caseId)).toMatchObject({
    collapsed: false,
    anchorOffset: wordStart,
    focusOffset: wordStart + 1,
    direction: "forward",
    text: "W",
  });

  await page.waitForTimeout(850);
  await expect(page.locator(".round-record-counts")).toHaveText(
    "0 条评论 · 0 项直接编辑记录",
  );
  await expectSourceBytes(page, source);
});

test("a complete inline replacement cannot absorb an unselected following text node", async ({ page }) => {
  const { frame, source } = await openMatrix(page);
  const caseId = "heading-inline";
  const target = await activateNativeEdit(frame, caseId);
  const originalHtml = await target.innerHTML();
  const originalText = await target.textContent();
  const wordStart = originalText.indexOf("Word");
  const wordEnd = wordStart + "Word".length;

  expect(wordStart).toBeGreaterThanOrEqual(0);
  await setTextSelection(frame, caseId, wordStart, wordEnd);
  const delivery = await target.evaluate((element) => {
    const authoredEm = element.querySelector("em");
    const authoredWord = authoredEm?.firstChild;
    const followingText = authoredEm?.nextSibling;
    if (
      !(authoredEm instanceof HTMLElement)
      || !(authoredWord instanceof Text)
      || authoredWord.data !== "Word"
      || !(followingText instanceof Text)
    ) throw new Error("Authored em boundary is missing.");

    const beforeInput = new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      data: "X",
      inputType: "insertText",
    });
    const accepted = element.dispatchEvent(beforeInput);
    if (!accepted) return { accepted, innerHtmlAfterInput: element.innerHTML };

    // Replacing all of Word authorizes the em's output interval, but not the
    // adjacent text beginning exactly at that interval's right boundary.
    // Moving the suffix into the surviving em keeps global text plausible
    // while violating authored ownership.
    authoredWord.data = "X";
    authoredEm.append(followingText);
    const selection = document.getSelection();
    const range = document.createRange();
    range.setStart(authoredWord, 1);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    element.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      data: "X",
      inputType: "insertText",
    }));
    return { accepted, innerHtmlAfterInput: element.innerHTML };
  });

  expect(delivery.accepted).toBe(true);
  expect(delivery.innerHtmlAfterInput).toBe(originalHtml);
  await expect(target).toHaveText(originalText);
  await expect(target.locator("em")).toHaveText("Word");
  expect(await selectionSnapshot(frame, caseId)).toMatchObject({
    collapsed: false,
    anchorOffset: wordStart,
    focusOffset: wordEnd,
    direction: "forward",
    text: "Word",
  });

  await page.waitForTimeout(850);
  await expect(page.locator(".round-record-counts")).toHaveText(
    "0 条评论 · 0 项直接编辑记录",
  );
  await expectSourceBytes(page, source);
});

for (const invalidComposition of ["out-of-range-terminal", "unsafe-wrapper"]) {
  test(`invalid ${invalidComposition} composition rolls back only its epoch and preserves prior dirty text`, async ({ page }) => {
    const { frame, source } = await openMatrix(page);
    const caseId = "heading-inline";
    const target = await activateNativeEdit(frame, caseId);
    const originalText = await target.textContent();
    const originalWordStart = originalText.indexOf("Word");
    const currentWordStart = originalWordStart + 1;
    const priorDirtyText = `A${originalText}`;
    const priorDirtySource = replaceUniqueBytes(
      source,
      ">真实 <strong>",
      ">A真实 <strong>",
    );

    expect(originalWordStart).toBeGreaterThanOrEqual(0);
    await setTextSelection(frame, caseId, 0);
    await page.keyboard.insertText("A");
    await setTextSelection(frame, caseId, currentWordStart, currentWordStart + 4);

    await target.evaluate((element, failureMode) => {
      const authoredEm = element.querySelector("em");
      if (!(authoredEm instanceof HTMLElement)) throw new Error("Authored em is missing.");
      element.dispatchEvent(new CompositionEvent("compositionstart", {
        bubbles: true,
        data: "Word",
      }));
      const temporaryItalic = document.createElement("i");
      temporaryItalic.textContent = failureMode === "out-of-range-terminal"
        ? "你好!"
        : "你好";
      if (failureMode === "unsafe-wrapper") {
        temporaryItalic.className = "browser-must-not-author-this";
      }
      authoredEm.replaceWith(temporaryItalic);
      const selection = document.getSelection();
      const range = document.createRange();
      range.selectNodeContents(temporaryItalic);
      range.collapse(false);
      selection?.removeAllRanges();
      selection?.addRange(range);
      element.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        data: "你好",
        inputType: "insertCompositionText",
        isComposing: true,
      }));
      element.dispatchEvent(new CompositionEvent("compositionend", {
        bubbles: true,
        data: "你好",
      }));
    }, invalidComposition);

    // A composition failure restores the epoch snapshot, not the session's
    // older source baseline. The accepted prefix remains dirty and is the only
    // change allowed to reach SourcePatch.
    await expect(target).toHaveText(priorDirtyText);
    await expect(target.locator("em")).toHaveText("Word");
    expect(await target.locator("i").count()).toBe(0);
    expect(await selectionSnapshot(frame, caseId)).toMatchObject({
      collapsed: false,
      anchorOffset: currentWordStart,
      focusOffset: currentWordStart + 4,
      direction: "forward",
      text: "Word",
    });

    await expectOneCommittedTransaction(page);
    await expectSourceBytes(page, priorDirtySource);

  });
}
