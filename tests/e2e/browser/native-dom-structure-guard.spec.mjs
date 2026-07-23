import { expect, test } from "@playwright/test";

import {
  activateNativeEdit,
  documentToken,
  exportCurrentHtml,
  keyShortcut,
  loadCaseManifest,
  loadFixture,
  replaceUniqueBytes,
  reverseTextSelection,
  selectionSnapshot,
  setTextSelection,
} from "./pageroot-driver.mjs";

const manifest = loadCaseManifest();

async function openMatrix(page) {
  await page.goto("/");
  return loadFixture(page, manifest.fixture);
}

async function expectNoSourceCommit(page, editor, source) {
  await page.waitForTimeout(850);
  expect(await editor.getAttribute("data-undo-depth")).toBe("0");
  await expect(page.locator(".round-record-counts")).toHaveText(
    "0 条评论 · 0 项直接编辑记录",
  );
  expect((await exportCurrentHtml(page)).equals(source)).toBe(true);
}

async function currentCaseHtml(editor, caseId) {
  const iframe = editor.locator('iframe[title*="HTML"]');
  const iframeHandle = await iframe.elementHandle();
  const currentFrame = await iframeHandle?.contentFrame();
  if (!currentFrame) throw new Error("Current PageRoot iframe is unavailable.");
  return currentFrame.locator(
    `[data-native-case=${JSON.stringify(caseId)}]`,
  ).innerHTML();
}

async function currentCaseAttribute(editor, caseId, name) {
  const iframe = editor.locator('iframe[title*="HTML"]');
  const iframeHandle = await iframe.elementHandle();
  const currentFrame = await iframeHandle?.contentFrame();
  if (!currentFrame) throw new Error("Current PageRoot iframe is unavailable.");
  return currentFrame.locator(
    `[data-native-case=${JSON.stringify(caseId)}]`,
  ).getAttribute(name);
}

async function expectCurrentCaseHtmlAfterDelivery(page, editor, caseId, expectedHtml) {
  // Leave one browser timer turn free before polling. Tight cross-process
  // evaluate polling can otherwise starve the controller's 0ms watchdog.
  await page.waitForTimeout(50);
  await expect.poll(() => currentCaseHtml(editor, caseId)).toBe(expectedHtml);
}

test("native text-node split and merge remain a supported text-only transaction", async ({ page }) => {
  const { editor, frame, source } = await openMatrix(page);
  const target = await activateNativeEdit(frame, "heading-inline");
  await setTextSelection(frame, "heading-inline", 0);

  await target.evaluate(async (element) => {
    const firstText = element.firstChild;
    if (!(firstText instanceof Text)) throw new Error("Fixture text node is missing.");
    element.dispatchEvent(new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      data: "原",
      inputType: "insertText",
    }));
    firstText.data = `原${firstText.data}`;
    firstText.splitText(1);
    const selection = document.getSelection();
    const range = document.createRange();
    range.setStart(element.firstChild, 1);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    element.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      data: "原",
      inputType: "insertText",
    }));
  });

  await expect.poll(() => editor.getAttribute("data-undo-depth")).toBe("1");
  expect((await exportCurrentHtml(page)).equals(replaceUniqueBytes(
    source,
    ">真实 <strong>",
    ">原真实 <strong>",
  ))).toBe(true);
});

test("a MutationObserver delivery before input waits for the final text tracker value", async ({ page }) => {
  const { editor, frame, source } = await openMatrix(page);
  const target = await activateNativeEdit(frame, "heading-inline");
  await setTextSelection(frame, "heading-inline", 0);

  await target.evaluate(async (element) => {
    const firstText = element.firstChild;
    if (!(firstText instanceof Text)) throw new Error("Fixture text node is missing.");
    element.dispatchEvent(new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      data: "粘",
      inputType: "insertFromPaste",
    }));
    firstText.data = `粘${firstText.data}`;
    // Yield to MutationObserver before dispatching the matching input event.
    await Promise.resolve();
    element.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      data: "粘",
      inputType: "insertFromPaste",
    }));
  });

  await expect.poll(() => editor.getAttribute("data-undo-depth")).toBe("1");
  expect((await exportCurrentHtml(page)).equals(replaceUniqueBytes(
    source,
    ">真实 <strong>",
    ">粘真实 <strong>",
  ))).toBe(true);
});

test("beforeinput-only illegal structure is rolled back by the delivery watchdog", async ({ page }) => {
  const { editor, frame, source } = await openMatrix(page);
  const target = await activateNativeEdit(frame, "heading-inline");
  const originalHtml = await target.innerHTML();

  await target.evaluate(async (element) => {
    element.dispatchEvent(new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      data: "unexpected",
      inputType: "insertText",
    }));
    const mark = document.createElement("mark");
    mark.textContent = "unexpected";
    element.append(mark);
    // Intentionally omit input. The 0ms watchdog must still validate/close.
  });

  await expectNoSourceCommit(page, editor, source);
  await expectCurrentCaseHtmlAfterDelivery(page, editor, "heading-inline", originalHtml);
});

test("beforeinput-only plain text never becomes a source transaction", async ({ page }) => {
  const { editor, frame, source } = await openMatrix(page);
  const target = await activateNativeEdit(frame, "heading-inline");
  const originalHtml = await target.innerHTML();
  await setTextSelection(frame, "heading-inline", 0);

  await target.evaluate((element) => {
    const firstText = element.firstChild;
    if (!(firstText instanceof Text)) throw new Error("Fixture text node is missing.");
    element.dispatchEvent(new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      data: "orphan",
      inputType: "insertText",
    }));
    firstText.data = `orphan${firstText.data}`;
    // No input means the browser never completed this candidate operation.
  });

  await expectNoSourceCommit(page, editor, source);
  await expectCurrentCaseHtmlAfterDelivery(page, editor, "heading-inline", originalHtml);
});

test("a synchronous checkpoint cannot promote text without a delivered input event", async ({ page }) => {
  const { editor, frame, source } = await openMatrix(page);
  const caseId = "heading-inline";
  const target = await activateNativeEdit(frame, caseId);
  const originalHtml = await target.innerHTML();

  await target.evaluate((element) => {
    const firstText = element.firstChild;
    if (!(firstText instanceof Text)) throw new Error("Fixture text node is missing.");
    firstText.data = `rogue${firstText.data}`;
    // Invoke PageRoot's synchronous save checkpoint in the same browser task,
    // before MutationObserver can deliver the unauthorized text mutation.
    element.dispatchEvent(new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "s",
      metaKey: true,
      ctrlKey: true,
    }));
  });

  await expectCurrentCaseHtmlAfterDelivery(page, editor, caseId, originalHtml);
  expect(await editor.getAttribute("data-undo-depth")).toBe("0");
  await expect(page.locator(".round-record-counts")).toHaveText(
    "0 条评论 · 0 项直接编辑记录",
  );
  await expect.poll(() => editor.getAttribute("data-edit-block-detail"))
    .toContain("上一次安全内容");
  expect((await exportCurrentHtml(page)).equals(source)).toBe(true);
});

test("an overlapping beforeinput cannot clear orphan-mutation evidence", async ({ page }) => {
  const { editor, frame, source } = await openMatrix(page);
  const target = await activateNativeEdit(frame, "heading-inline");
  const originalHtml = await target.innerHTML();
  await setTextSelection(frame, "heading-inline", 0);

  await target.evaluate(async (element) => {
    const firstText = element.firstChild;
    if (!(firstText instanceof Text)) throw new Error("Fixture text node is missing.");
    element.dispatchEvent(new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      data: "orphan",
      inputType: "insertText",
    }));
    firstText.data = `orphan${firstText.data}`;
    await Promise.resolve();
    // The first mutation has reached MutationObserver, but neither candidate
    // receives input. Opening the second window must retain that evidence.
    element.dispatchEvent(new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      data: "second",
      inputType: "insertText",
    }));
  });

  await expectCurrentCaseHtmlAfterDelivery(page, editor, "heading-inline", originalHtml);
  await expectNoSourceCommit(page, editor, source);
});

test("a second beforeinput cannot launder an orphan mutation through its input", async ({ page }) => {
  const { editor, frame, source } = await openMatrix(page);
  const target = await activateNativeEdit(frame, "heading-inline");
  const originalHtml = await target.innerHTML();
  await setTextSelection(frame, "heading-inline", 0);

  const secondAccepted = await target.evaluate(async (element) => {
    const firstText = element.firstChild;
    if (!(firstText instanceof Text)) throw new Error("Fixture text node is missing.");
    element.dispatchEvent(new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      data: "orphan",
      inputType: "insertText",
    }));
    firstText.data = `orphan${firstText.data}`;
    await Promise.resolve();
    const accepted = element.dispatchEvent(new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      data: "second",
      inputType: "insertText",
    }));
    if (accepted) {
      firstText.data = `second${firstText.data}`;
      element.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        data: "second",
        inputType: "insertText",
      }));
    }
    return accepted;
  });

  expect(secondAccepted).toBe(false);
  await expectCurrentCaseHtmlAfterDelivery(page, editor, "heading-inline", originalHtml);
  await expectNoSourceCommit(page, editor, source);
});

test("a synchronous Escape checkpoint cannot commit beforeinput-only text", async ({ page }) => {
  const { editor, frame, source } = await openMatrix(page);
  const target = await activateNativeEdit(frame, "heading-inline");
  const originalHtml = await target.innerHTML();
  await setTextSelection(frame, "heading-inline", 0);

  await target.evaluate((element) => {
    const firstText = element.firstChild;
    if (!(firstText instanceof Text)) throw new Error("Fixture text node is missing.");
    element.dispatchEvent(new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      data: "orphan",
      inputType: "insertText",
    }));
    firstText.data = `orphan${firstText.data}`;
    element.dispatchEvent(new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Escape",
    }));
  });

  await expectCurrentCaseHtmlAfterDelivery(page, editor, "heading-inline", originalHtml);
  await expectNoSourceCommit(page, editor, source);
});

test("a microtask mutation after expected normalization preserves the delivered deletion", async ({ page }) => {
  const { editor, frame, source } = await openMatrix(page);
  const caseId = "heading-inline";
  const target = await activateNativeEdit(frame, caseId);
  const originalText = await target.textContent();
  await setTextSelection(frame, caseId, 0, originalText.length);

  await target.evaluate(async (element) => {
    element.dispatchEvent(new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      data: null,
      inputType: "deleteContentBackward",
    }));
    element.replaceChildren(document.createElement("br"));
    element.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      data: null,
      inputType: "deleteContentBackward",
    }));
    await Promise.resolve();
    const mark = document.createElement("mark");
    mark.textContent = "late drift";
    element.append(mark);
  }).catch((error) => {
    if (!/execution context was destroyed/iu.test(String(error))) throw error;
  });

  await expectCurrentCaseHtmlAfterDelivery(page, editor, caseId, "");
  await expect.poll(() => editor.getAttribute("data-undo-depth")).toBe("1");
  const exported = await exportCurrentHtml(page);
  expect(exported.includes(Buffer.from("late drift", "utf8"))).toBe(false);
  expect(exported.equals(replaceUniqueBytes(
    source,
    ">真实 <strong>DOM</strong> 光标要像 <em>Word</em> 一样自然&nbsp;🙂</h1>",
    "></h1>",
  ))).toBe(true);
});

test("a characterData microtask cannot erase the already delivered transaction", async ({ page }) => {
  const { editor, frame, source } = await openMatrix(page);
  const caseId = "heading-inline";
  const target = await activateNativeEdit(frame, caseId);
  const originalHtml = await target.innerHTML();
  await setTextSelection(frame, caseId, 0);

  await target.evaluate(async (element) => {
    const firstText = element.firstChild;
    if (!(firstText instanceof Text)) throw new Error("Fixture text node is missing.");
    element.dispatchEvent(new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      data: "先",
      inputType: "insertText",
    }));
    firstText.data = `先${firstText.data}`;
    element.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      data: "先",
      inputType: "insertText",
    }));
    await Promise.resolve();
    firstText.data = `后${firstText.data}`;
  }).catch((error) => {
    if (!/execution context was destroyed/iu.test(String(error))) throw error;
  });

  await expectCurrentCaseHtmlAfterDelivery(
    page,
    editor,
    caseId,
    `先${originalHtml}`,
  );
  await expect.poll(() => editor.getAttribute("data-undo-depth")).toBe("1");
  expect((await exportCurrentHtml(page)).equals(replaceUniqueBytes(
    source,
    ">真实 <strong>",
    ">先真实 <strong>",
  ))).toBe(true);
});

test("input without a matching beforeinput candidate is rolled back", async ({ page }) => {
  const { editor, frame, source } = await openMatrix(page);
  const caseId = "heading-inline";
  const target = await activateNativeEdit(frame, caseId);
  const originalHtml = await target.innerHTML();

  await target.evaluate((element) => {
    const firstText = element.firstChild;
    if (!(firstText instanceof Text)) throw new Error("Fixture text node is missing.");
    firstText.data = `orphan${firstText.data}`;
    element.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      data: "orphan",
      inputType: "insertText",
    }));
  });

  await expectCurrentCaseHtmlAfterDelivery(page, editor, caseId, originalHtml);
  await expectNoSourceCommit(page, editor, source);
});

test("a mismatched inputType cannot complete another beforeinput candidate", async ({ page }) => {
  const { editor, frame, source } = await openMatrix(page);
  const caseId = "heading-inline";
  const target = await activateNativeEdit(frame, caseId);
  const originalHtml = await target.innerHTML();

  await target.evaluate((element) => {
    const firstText = element.firstChild;
    if (!(firstText instanceof Text)) throw new Error("Fixture text node is missing.");
    element.dispatchEvent(new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      data: "x",
      inputType: "insertText",
    }));
    firstText.data = `x${firstText.data}`;
    element.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      data: null,
      inputType: "deleteByCut",
    }));
  });

  await expectNoSourceCommit(page, editor, source);
  await expectCurrentCaseHtmlAfterDelivery(page, editor, caseId, originalHtml);
});

test("a mismatched input restores only its gesture and preserves earlier delivered text", async ({ page }) => {
  const { editor, frame, source } = await openMatrix(page);
  const caseId = "list-item";
  const target = await activateNativeEdit(frame, caseId);
  const originalText = await target.textContent();
  await setTextSelection(frame, caseId, 0);
  await page.keyboard.insertText("A");
  await expect(target).toHaveText(`A${originalText}`);
  expect(await editor.getAttribute("data-undo-depth")).toBe("0");
  await setTextSelection(frame, caseId, 1);

  await target.evaluate((element) => {
    const text = element.firstChild;
    if (!(text instanceof Text)) throw new Error("List item text is missing.");
    element.dispatchEvent(new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      data: "x",
      inputType: "insertText",
    }));
    text.insertData(1, "x");
    element.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      data: null,
      inputType: "deleteByCut",
    }));
  });

  await expect(target).toHaveText(`A${originalText}`);
  expect(await selectionSnapshot(frame, caseId)).toMatchObject({
    collapsed: true,
    anchorOffset: 1,
    focusOffset: 1,
  });
  await expect.poll(() => editor.getAttribute("data-undo-depth")).toBe("1");
  expect((await exportCurrentHtml(page)).equals(replaceUniqueBytes(
    source,
    `>${originalText}</li>`,
    `>A${originalText}</li>`,
  ))).toBe(true);
});

test("compositionend without compositionstart cannot accept DOM text", async ({ page }) => {
  const { editor, frame, source } = await openMatrix(page);
  const caseId = "heading-inline";
  const target = await activateNativeEdit(frame, caseId);
  const originalHtml = await target.innerHTML();

  await target.evaluate((element) => {
    const firstText = element.firstChild;
    if (!(firstText instanceof Text)) throw new Error("Fixture text node is missing.");
    firstText.data = `orphan${firstText.data}`;
    element.dispatchEvent(new CompositionEvent("compositionend", {
      bubbles: true,
      data: "orphan",
    }));
  });

  await expectCurrentCaseHtmlAfterDelivery(page, editor, caseId, originalHtml);
  await expectNoSourceCommit(page, editor, source);
});

test("an unfinished ordinary mutation cannot be laundered by composition", async ({ page }) => {
  const { editor, frame, source } = await openMatrix(page);
  const caseId = "heading-inline";
  const target = await activateNativeEdit(frame, caseId);
  await setTextSelection(frame, caseId, 0);

  await target.evaluate(async (element) => {
    const firstText = element.firstChild;
    if (!(firstText instanceof Text)) throw new Error("Fixture text node is missing.");
    element.dispatchEvent(new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      data: "orphan",
      inputType: "insertText",
    }));
    firstText.data = `orphan${firstText.data}`;
    await Promise.resolve();
    element.dispatchEvent(new CompositionEvent("compositionstart", {
      bubbles: true,
      data: "组",
    }));
    const liveText = element.firstChild;
    if (!(liveText instanceof Text)) throw new Error("Restored text node is missing.");
    element.dispatchEvent(new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      data: "组",
      inputType: "insertCompositionText",
      isComposing: true,
    }));
    liveText.data = `组${liveText.data}`;
    element.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      data: "组",
      inputType: "insertCompositionText",
      isComposing: true,
    }));
    element.dispatchEvent(new CompositionEvent("compositionend", {
      bubbles: true,
      data: "组",
    }));
  });

  await expect.poll(() => editor.getAttribute("data-undo-depth")).toBe("1");
  const exported = await exportCurrentHtml(page);
  expect(exported.includes(Buffer.from("orphan", "utf8"))).toBe(false);
  expect(exported.equals(replaceUniqueBytes(
    source,
    ">真实 <strong>",
    ">组真实 <strong>",
  ))).toBe(true);
});

test("delivered input cannot alter controller-owned host attributes", async ({ page }) => {
  const { editor, frame, source } = await openMatrix(page);
  const caseId = "heading-inline";
  const target = await activateNativeEdit(frame, caseId);
  const originalHtml = await target.innerHTML();

  await target.evaluate((element) => {
    const firstText = element.firstChild;
    if (!(firstText instanceof Text)) throw new Error("Fixture text node is missing.");
    element.dispatchEvent(new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      data: "x",
      inputType: "insertText",
    }));
    firstText.data = `x${firstText.data}`;
    element.setAttribute("contenteditable", "false");
    element.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      data: "x",
      inputType: "insertText",
    }));
  });

  await expectCurrentCaseHtmlAfterDelivery(page, editor, caseId, originalHtml);
  await expect.poll(() => currentCaseAttribute(
    editor,
    caseId,
    "contenteditable",
  )).toBe("plaintext-only");
  await expectNoSourceCommit(page, editor, source);
});

test("a stale no-DOM candidate cannot authorize later wrapper removal", async ({ page }) => {
  const { editor, frame, source } = await openMatrix(page);
  const caseId = "heading-inline";
  const target = await activateNativeEdit(frame, caseId);
  const originalHtml = await target.innerHTML();
  await setTextSelection(frame, caseId, 3, 6);

  await target.evaluate((element) => {
    element.dispatchEvent(new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      data: null,
      inputType: "deleteContentBackward",
    }));
    const strong = element.querySelector("strong");
    const strongText = strong?.firstChild;
    if (!(strong instanceof HTMLElement) || !(strongText instanceof Text)) {
      throw new Error("Fixture strong text is missing.");
    }
    const selection = document.getSelection();
    const range = document.createRange();
    range.setStart(strongText, 0);
    range.setEnd(strongText, 1);
    selection.removeAllRanges();
    selection.addRange(range);
    element.dispatchEvent(new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      data: "X",
      inputType: "insertText",
    }));
    strong.replaceWith(document.createTextNode("X"));
    element.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      data: "X",
      inputType: "insertText",
    }));
  });

  await expectCurrentCaseHtmlAfterDelivery(page, editor, caseId, originalHtml);
  await expectNoSourceCommit(page, editor, source);
});

test("a no-DOM candidate preserves an earlier delivered transaction start", async ({ page }) => {
  const { editor, frame, source } = await openMatrix(page);
  const caseId = "heading-inline";
  const target = await activateNativeEdit(frame, caseId);
  const originalText = await target.textContent();
  await setTextSelection(frame, caseId, originalText.length);
  await page.keyboard.insertText("尾");
  await setTextSelection(frame, caseId, 0, 2);
  await target.dispatchEvent("beforeinput", {
    bubbles: true,
    cancelable: true,
    data: null,
    inputType: "deleteContentBackward",
  });
  await page.waitForTimeout(50);

  await expect.poll(() => editor.getAttribute("data-undo-depth")).toBe("1");
  await page.keyboard.press(keyShortcut("Z"));
  await expect.poll(async () => (
    await selectionSnapshot(frame, caseId)
  ).anchorOffset).toBe(originalText.length);
  expect((await exportCurrentHtml(page)).equals(source)).toBe(true);
});

test("an element inserted during composition is rolled back before checkpoint", async ({ page }) => {
  const { editor, frame, source } = await openMatrix(page);
  const target = await activateNativeEdit(frame, "heading-inline");
  const originalHtml = await target.innerHTML();

  await target.evaluate((element) => {
    element.dispatchEvent(new CompositionEvent("compositionstart", {
      bubbles: true,
      data: "raw",
    }));
    const mark = document.createElement("mark");
    mark.textContent = "unexpected";
    element.append(mark);
    element.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      data: "raw",
      inputType: "insertCompositionText",
      isComposing: true,
    }));
    element.dispatchEvent(new CompositionEvent("compositionend", {
      bubbles: true,
      data: "raw",
    }));
  });

  await expect(target).toHaveJSProperty("innerHTML", originalHtml);
  await expectNoSourceCommit(page, editor, source);
});

test("Apple Pinyin temporary i wrapper is canonicalized back to authored em", async ({ page }) => {
  const { editor, frame, source } = await openMatrix(page);
  const caseId = "heading-inline";
  const target = await activateNativeEdit(frame, caseId);
  const originalText = await target.textContent();
  const wordStart = originalText.indexOf("Word");
  expect(wordStart).toBeGreaterThanOrEqual(0);
  await setTextSelection(frame, caseId, wordStart, wordStart + 4);

  await target.evaluate((element) => {
    const dispatchCompositionInput = (data) => {
      element.dispatchEvent(new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: false,
        data,
        inputType: "insertCompositionText",
        isComposing: true,
      }));
      element.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        data,
        inputType: "insertCompositionText",
        isComposing: true,
      }));
    };
    const authoredEm = element.querySelector("em");
    if (!(authoredEm instanceof HTMLElement)) {
      throw new Error("Authored em wrapper is missing.");
    }
    element.dispatchEvent(new CompositionEvent("compositionstart", {
      bubbles: true,
      data: "Word",
    }));
    authoredEm.textContent = "n";
    dispatchCompositionInput("n");
    authoredEm.textContent = "ni";
    dispatchCompositionInput("ni");
    const temporaryItalic = document.createElement("i");
    temporaryItalic.textContent = "ni h";
    authoredEm.replaceWith(temporaryItalic);
    dispatchCompositionInput("ni h");
    temporaryItalic.textContent = "ni hao";
    dispatchCompositionInput("ni hao");
    temporaryItalic.textContent = "你好";
    dispatchCompositionInput("你好");
    element.dispatchEvent(new CompositionEvent("compositionend", {
      bubbles: true,
      data: "你好",
    }));
  });

  await page.waitForTimeout(100);
  expect(await editor.getAttribute("data-edit-block-detail")).toBeNull();
  await expect.poll(() => editor.getAttribute("data-undo-depth")).toBe("1");
  await expect.poll(() => currentCaseHtml(editor, caseId)).toContain("<em");
  expect(await currentCaseHtml(editor, caseId)).toContain(">你好</em>");
  expect(await currentCaseHtml(editor, caseId)).not.toContain("<i>");
  expect((await exportCurrentHtml(page)).equals(replaceUniqueBytes(
    source,
    "<em>Word</em>",
    "<em>你好</em>",
  ))).toBe(true);

  await page.keyboard.press(keyShortcut("Z"));
  await expect.poll(() => editor.getAttribute("data-undo-depth")).toBe("0");
  expect((await exportCurrentHtml(page)).equals(source)).toBe(true);
  await page.getByRole("button", { name: /\u91cd\u505a\u4e0a\u4e00\u6b21\u64a4\u9500/u }).click();
  await expect.poll(() => editor.getAttribute("data-undo-depth")).toBe("1");
  expect((await exportCurrentHtml(page)).equals(replaceUniqueBytes(
    source,
    "<em>Word</em>",
    "<em>你好</em>",
  ))).toBe(true);
});

test("canonical island replacement failure reloads the committed IME patch without rebasing provisional DOM", async ({ page }) => {
  const { editor, frame, source } = await openMatrix(page);
  const caseId = "heading-inline";
  const initialDocumentToken = await documentToken(frame);
  const target = await activateNativeEdit(frame, caseId);
  const originalText = await target.textContent();
  const wordStart = originalText.indexOf("Word");
  expect(wordStart).toBeGreaterThanOrEqual(0);
  await setTextSelection(frame, caseId, wordStart, wordStart + 4);

  await target.evaluate((element) => {
    const authoredEm = element.querySelector("em");
    if (!(authoredEm instanceof HTMLElement)) {
      throw new Error("Authored em wrapper is missing.");
    }
    const marker = "__PAGEROOT_QA_CANONICAL_RECONCILE_FAILURE__";
    window.top[marker] = { attempts: 0 };
    const originalReplaceChild = Node.prototype.replaceChild;
    Node.prototype.replaceChild = function patchedReplaceChild(newChild, oldChild) {
      const diagnostics = window.top[marker];
      const isCanonicalReconcile = oldChild === element
        && element.querySelector(":scope > i")?.textContent === "你好"
        && newChild instanceof HTMLElement
        && newChild.querySelector(":scope > em")?.textContent === "你好";
      if (isCanonicalReconcile) {
        diagnostics.attempts += 1;
        // Fail exactly the source-authority reconcile. Restore the prototype
        // first so session disposal can safely restore its own snapshot.
        Node.prototype.replaceChild = originalReplaceChild;
        throw new Error("Forced canonical reconcile failure.");
      }
      return originalReplaceChild.call(this, newChild, oldChild);
    };

    const dispatchCompositionInput = (data) => {
      element.dispatchEvent(new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: false,
        data,
        inputType: "insertCompositionText",
        isComposing: true,
      }));
      element.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        data,
        inputType: "insertCompositionText",
        isComposing: true,
      }));
    };
    element.dispatchEvent(new CompositionEvent("compositionstart", {
      bubbles: true,
      data: "Word",
    }));
    const temporaryItalic = document.createElement("i");
    temporaryItalic.textContent = "你好";
    authoredEm.replaceWith(temporaryItalic);
    dispatchCompositionInput("你好");
    element.dispatchEvent(new CompositionEvent("compositionend", {
      bubbles: true,
      data: "你好",
    }));
  });

  await expect.poll(() => page.evaluate(() => (
    window.__PAGEROOT_QA_CANONICAL_RECONCILE_FAILURE__?.attempts ?? 0
  ))).toBe(1);
  await expect.poll(() => editor.getAttribute("data-undo-depth")).toBe("1");
  await expect(page.locator(".round-record-counts")).toHaveText(
    "0 条评论 · 1 项直接编辑记录",
  );
  await expect.poll(async () => {
    const iframeHandle = await editor.locator('iframe[title*="HTML"]').elementHandle();
    const currentFrame = await iframeHandle?.contentFrame();
    if (!currentFrame) return initialDocumentToken;
    try {
      return await documentToken(currentFrame);
    } catch {
      return initialDocumentToken;
    }
  }).not.toBe(initialDocumentToken);
  await expect.poll(() => currentCaseHtml(editor, caseId)).toContain(
    "<em data-html-ai-source-node-id=",
  );
  expect(await currentCaseHtml(editor, caseId)).toContain(">你好</em>");
  expect(await currentCaseHtml(editor, caseId)).not.toContain("<i>");
  expect((await exportCurrentHtml(page)).equals(replaceUniqueBytes(
    source,
    "<em>Word</em>",
    "<em>你好</em>",
  ))).toBe(true);
  await page.evaluate(() => {
    delete window.__PAGEROOT_QA_CANONICAL_RECONCILE_FAILURE__;
  });
});

test("a final composition input after non-empty compositionend stays in one epoch", async ({ page }) => {
  const { editor, frame, source } = await openMatrix(page);
  const caseId = "heading-inline";
  const target = await activateNativeEdit(frame, caseId);
  const originalText = await target.textContent();
  const wordStart = originalText.indexOf("Word");
  await setTextSelection(frame, caseId, wordStart, wordStart + 4);

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
    element.dispatchEvent(new CompositionEvent("compositionend", {
      bubbles: true,
      data: "你好",
    }));
    element.dispatchEvent(new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: false,
      data: "你好",
      inputType: "insertText",
    }));
    element.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      data: "你好",
      inputType: "insertText",
    }));
  });

  await expect.poll(() => editor.getAttribute("data-undo-depth")).toBe("1");
  expect(await currentCaseHtml(editor, caseId)).toContain(">你好</em>");
  expect(await currentCaseHtml(editor, caseId)).not.toContain("<i>");
  expect((await exportCurrentHtml(page)).equals(replaceUniqueBytes(
    source,
    "<em>Word</em>",
    "<em>你好</em>",
  ))).toBe(true);
});

for (const compositionEndData of ["", "你好"]) {
  test(`terminal beforeinput survives ${compositionEndData ? "non-empty" : "empty"} compositionend before its DOM/input delivery`, async ({ page }) => {
    const { editor, frame, source } = await openMatrix(page);
    const caseId = "heading-inline";
    const target = await activateNativeEdit(frame, caseId);
    const originalText = await target.textContent();
    const wordStart = originalText.indexOf("Word");
    await setTextSelection(frame, caseId, wordStart, wordStart + 4);

    await target.evaluate(async (element, endData) => {
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
      element.dispatchEvent(new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: false,
        data: "你好",
        inputType: "insertText",
        isComposing: false,
      }));
      element.dispatchEvent(new CompositionEvent("compositionend", {
        bubbles: true,
        data: endData,
      }));
      // Exercise MutationObserver delivery between compositionend and the
      // browser's final DOM/input pair without yielding to the 0ms watchdog.
      await Promise.resolve();
      const liveItalic = element.querySelector("i");
      if (!(liveItalic instanceof HTMLElement)) {
        throw new Error("Terminal beforeinput was destructively restored before input.");
      }
      liveItalic.textContent = "你好";
      element.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        data: "你好",
        inputType: "insertText",
        isComposing: false,
      }));
    }, compositionEndData);

    await expect.poll(() => editor.getAttribute("data-undo-depth")).toBe("1");
    expect(await currentCaseHtml(editor, caseId)).toContain(">你好</em>");
    expect(await currentCaseHtml(editor, caseId)).not.toContain("<i>");
    expect((await exportCurrentHtml(page)).equals(replaceUniqueBytes(
      source,
      "<em>Word</em>",
      "<em>你好</em>",
    ))).toBe(true);
  });
}

test("non-empty compositionend remains committed when its announced input tail is omitted", async ({ page }) => {
  const { editor, frame, source } = await openMatrix(page);
  const caseId = "heading-inline";
  const target = await activateNativeEdit(frame, caseId);
  const originalText = await target.textContent();
  const wordStart = originalText.indexOf("Word");
  await setTextSelection(frame, caseId, wordStart, wordStart + 4);

  await target.evaluate((element) => {
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
    element.dispatchEvent(new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: false,
      data: "你好",
      inputType: "insertText",
      isComposing: false,
    }));
    temporaryItalic.textContent = "你好";
    element.dispatchEvent(new CompositionEvent("compositionend", {
      bubbles: true,
      data: "你好",
    }));
    // The non-empty end plus exact frozen-selection text is authoritative.
    // Some engines omit a separate final input tail entirely.
  });

  await page.waitForTimeout(150);
  await expect.poll(() => editor.getAttribute("data-undo-depth")).toBe("1");
  expect(await currentCaseHtml(editor, caseId)).toContain(">你好</em>");
  expect(await currentCaseHtml(editor, caseId)).not.toContain("<i>");
  expect((await exportCurrentHtml(page)).equals(replaceUniqueBytes(
    source,
    "<em>Word</em>",
    "<em>你好</em>",
  ))).toBe(true);
});

test("one export shortcut inside the optional terminal grace completes exactly once", async ({ page }) => {
  const { editor, frame, source } = await openMatrix(page);
  const caseId = "heading-inline";
  const target = await activateNativeEdit(frame, caseId);
  const originalText = await target.textContent();
  const wordStart = originalText.indexOf("Word");
  await setTextSelection(frame, caseId, wordStart, wordStart + 4);

  let downloadCount = 0;
  page.on("download", () => {
    downloadCount += 1;
  });
  const downloadPromise = page.waitForEvent("download");
  await target.evaluate((element) => {
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
    element.dispatchEvent(new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: false,
      data: "你好",
      inputType: "insertText",
      isComposing: false,
    }));
    temporaryItalic.textContent = "你好";
    element.dispatchEvent(new CompositionEvent("compositionend", {
      bubbles: true,
      data: "你好",
    }));

    // Dispatch in the same task as compositionend, before the optional terminal
    // delivery timer can expire. The command must remain queued until that
    // exact epoch clears, then cross one fence and download once.
    window.parent.dispatchEvent(new window.parent.KeyboardEvent("keydown", {
      key: "E",
      metaKey: true,
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    }));
  });

  const download = await downloadPromise;
  const stream = await download.createReadStream();
  if (!stream) throw new Error("Export download did not expose a readable stream.");
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const exported = Buffer.concat(chunks);
  const expected = replaceUniqueBytes(
    source,
    "<em>Word</em>",
    "<em>你好</em>",
  );

  await page.waitForTimeout(150);
  expect(downloadCount).toBe(1);
  expect(exported.equals(expected)).toBe(true);
  expect(await editor.getAttribute("data-undo-depth")).toBe("1");
  expect(await currentCaseHtml(editor, caseId)).toContain(">你好</em>");
  expect(await currentCaseHtml(editor, caseId)).not.toContain("<i>");
});

for (const barrier of ["immediate", "stable"]) {
  test(`a ${barrier} second composition retires an earlier DOM-only provisional epoch`, async ({ page }) => {
    const { editor, frame, source } = await openMatrix(page);
    const caseId = "heading-inline";
    const target = await activateNativeEdit(frame, caseId);
    const originalText = await target.textContent();
    const wordStart = originalText.indexOf("Word");
    await setTextSelection(frame, caseId, wordStart, wordStart + 4);

    const beginDomOnlyEpoch = async () => target.evaluate((element) => {
      const authoredEm = element.querySelector("em");
      if (!(authoredEm instanceof HTMLElement)) throw new Error("Authored em is missing.");
      element.dispatchEvent(new CompositionEvent("compositionstart", {
        bubbles: true,
        data: "Word",
      }));
      const provisionalItalic = document.createElement("i");
      provisionalItalic.textContent = "ni hao";
      authoredEm.replaceWith(provisionalItalic);
      // This bridge mutates DOM but emits no composition input. Empty end has
      // no commit authority and must remain provisional until explicitly used.
      element.dispatchEvent(new CompositionEvent("compositionend", {
        bubbles: true,
        data: "",
      }));
    });
    const commitSecondEpoch = async () => target.evaluate((element) => {
      const secondStart = new CompositionEvent("compositionstart", {
        bubbles: true,
        cancelable: true,
        data: "Word",
      });
      const accepted = element.dispatchEvent(secondStart);
      const restoredEm = element.querySelector("em");
      const inheritedProvisional = element.querySelector("i")?.textContent ?? null;
      if (!(restoredEm instanceof HTMLElement)) {
        return {
          accepted,
          inheritedProvisional,
          restoredText: null,
        };
      }
      const restoredText = restoredEm.textContent;
      const secondItalic = document.createElement("i");
      secondItalic.textContent = "你好";
      restoredEm.replaceWith(secondItalic);
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
      return {
        accepted,
        inheritedProvisional,
        restoredText,
      };
    });

    let secondStart;
    if (barrier === "immediate") {
      secondStart = await target.evaluate((element) => {
        const authoredEm = element.querySelector("em");
        if (!(authoredEm instanceof HTMLElement)) throw new Error("Authored em is missing.");
        element.dispatchEvent(new CompositionEvent("compositionstart", {
          bubbles: true,
          data: "Word",
        }));
        const provisionalItalic = document.createElement("i");
        provisionalItalic.textContent = "ni hao";
        authoredEm.replaceWith(provisionalItalic);
        element.dispatchEvent(new CompositionEvent("compositionend", {
          bubbles: true,
          data: "",
        }));

        const secondEvent = new CompositionEvent("compositionstart", {
          bubbles: true,
          cancelable: true,
          data: "Word",
        });
        const accepted = element.dispatchEvent(secondEvent);
        const restoredEm = element.querySelector("em");
        const inheritedProvisional = element.querySelector("i")?.textContent ?? null;
        if (!(restoredEm instanceof HTMLElement)) {
          return {
            accepted,
            inheritedProvisional,
            restoredText: null,
          };
        }
        const restoredText = restoredEm.textContent;
        const secondItalic = document.createElement("i");
        secondItalic.textContent = "你好";
        restoredEm.replaceWith(secondItalic);
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
        return {
          accepted,
          inheritedProvisional,
          restoredText,
        };
      });
    } else {
      await beginDomOnlyEpoch();
      await page.waitForTimeout(100);
      secondStart = await commitSecondEpoch();
    }

    expect(secondStart).toEqual({
      accepted: true,
      inheritedProvisional: null,
      restoredText: "Word",
    });
    await expect.poll(() => editor.getAttribute("data-undo-depth")).toBe("1");
    expect(await editor.getAttribute("data-redo-depth")).toBe("0");
    expect(await currentCaseHtml(editor, caseId)).toContain(">你好</em>");
    expect(await currentCaseHtml(editor, caseId)).not.toContain("<i>");
    expect(await currentCaseHtml(editor, caseId)).not.toContain("ni hao");
    expect((await exportCurrentHtml(page)).equals(replaceUniqueBytes(
      source,
      "<em>Word</em>",
      "<em>你好</em>",
    ))).toBe(true);
  });
}

test("terminal beforeinput without matching input restores only its composition epoch", async ({ page }) => {
  const { editor, frame, source } = await openMatrix(page);
  const caseId = "heading-inline";
  const target = await activateNativeEdit(frame, caseId);
  const originalHtml = await target.innerHTML();
  const originalText = await target.textContent();
  const wordStart = originalText.indexOf("Word");
  await setTextSelection(frame, caseId, wordStart, wordStart + 4);

  await target.evaluate((element) => {
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
    element.dispatchEvent(new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: false,
      data: "你好",
      inputType: "insertText",
      isComposing: false,
    }));
    element.dispatchEvent(new CompositionEvent("compositionend", {
      bubbles: true,
      data: "",
    }));
    temporaryItalic.textContent = "你好";
    // No matching input: the delivery watchdog must not promote beforeinput.
  });

  await expectCurrentCaseHtmlAfterDelivery(page, editor, caseId, originalHtml);
  await expectNoSourceCommit(page, editor, source);
});

test("a non-composing final input before empty compositionend commits the composition", async ({ page }) => {
  const { editor, frame, source } = await openMatrix(page);
  const caseId = "heading-inline";
  const target = await activateNativeEdit(frame, caseId);
  const originalText = await target.textContent();
  const wordStart = originalText.indexOf("Word");
  await setTextSelection(frame, caseId, wordStart, wordStart + 4);

  const terminalFields = await target.evaluate((element) => {
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

    const finalBeforeInput = new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: false,
      data: "你好",
      inputType: "insertText",
      isComposing: false,
    });
    element.dispatchEvent(finalBeforeInput);
    temporaryItalic.textContent = "你好";
    const finalInput = new InputEvent("input", {
      bubbles: true,
      data: "你好",
      inputType: "insertText",
      isComposing: false,
    });
    element.dispatchEvent(finalInput);
    const terminalEnd = new CompositionEvent("compositionend", {
      bubbles: true,
      data: "",
    });
    element.dispatchEvent(terminalEnd);
    return {
      beforeInput: {
        data: finalBeforeInput.data,
        inputType: finalBeforeInput.inputType,
        isComposing: finalBeforeInput.isComposing,
      },
      input: {
        data: finalInput.data,
        inputType: finalInput.inputType,
        isComposing: finalInput.isComposing,
      },
      compositionEndData: terminalEnd.data,
    };
  });

  expect(terminalFields).toEqual({
    beforeInput: { data: "你好", inputType: "insertText", isComposing: false },
    input: { data: "你好", inputType: "insertText", isComposing: false },
    compositionEndData: "",
  });
  await expect.poll(() => editor.getAttribute("data-undo-depth")).toBe("1");
  expect(await currentCaseHtml(editor, caseId)).toContain(">你好</em>");
  expect(await currentCaseHtml(editor, caseId)).not.toContain("<i>");
  expect((await exportCurrentHtml(page)).equals(replaceUniqueBytes(
    source,
    "<em>Word</em>",
    "<em>你好</em>",
  ))).toBe(true);
});

test("a non-composing raw composition update before empty compositionend still cancels", async ({ page }) => {
  const { editor, frame, source } = await openMatrix(page);
  const caseId = "heading-inline";
  const target = await activateNativeEdit(frame, caseId);
  const originalHtml = await target.innerHTML();
  const originalText = await target.textContent();
  const wordStart = originalText.indexOf("Word");
  await setTextSelection(frame, caseId, wordStart, wordStart + 4);

  await target.evaluate((element) => {
    const authoredEm = element.querySelector("em");
    if (!(authoredEm instanceof HTMLElement)) throw new Error("Authored em is missing.");
    element.dispatchEvent(new CompositionEvent("compositionstart", {
      bubbles: true,
      data: "Word",
    }));
    element.dispatchEvent(new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: false,
      data: "ni hao",
      inputType: "insertCompositionText",
      isComposing: false,
    }));
    const temporaryItalic = document.createElement("i");
    temporaryItalic.textContent = "ni hao";
    authoredEm.replaceWith(temporaryItalic);
    element.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      data: "ni hao",
      inputType: "insertCompositionText",
      isComposing: false,
    }));
    element.dispatchEvent(new CompositionEvent("compositionend", {
      bubbles: true,
      data: "",
    }));
  });

  await expect(target).toHaveJSProperty("innerHTML", originalHtml);
  await expectNoSourceCommit(page, editor, source);
});

test("a cancelled epoch's late empty input tail cannot poison the next composition epoch", async ({ page }) => {
  const { editor, frame, source } = await openMatrix(page);
  const caseId = "heading-inline";
  const target = await activateNativeEdit(frame, caseId);
  const originalText = await target.textContent();
  const wordStart = originalText.indexOf("Word");
  await setTextSelection(frame, caseId, wordStart, wordStart + 4);

  await target.evaluate((element) => {
    const firstEm = element.querySelector("em");
    if (!(firstEm instanceof HTMLElement)) throw new Error("Authored em is missing.");
    element.dispatchEvent(new CompositionEvent("compositionstart", {
      bubbles: true,
      data: "Word",
    }));
    const cancelledItalic = document.createElement("i");
    cancelledItalic.textContent = "ni";
    firstEm.replaceWith(cancelledItalic);
    element.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      data: "ni",
      inputType: "insertCompositionText",
      isComposing: true,
    }));
    element.dispatchEvent(new CompositionEvent("compositionend", {
      bubbles: true,
      data: "",
    }));

    const restoredEm = element.querySelector("em");
    if (!(restoredEm instanceof HTMLElement)) throw new Error("Cancelled epoch was not restored.");
    element.dispatchEvent(new CompositionEvent("compositionstart", {
      bubbles: true,
      data: "Word",
    }));
    // A realistic stale tail from epoch A may arrive after epoch B has begun.
    // It has no DOM mutation and must remain an inert delivery, not terminate B.
    element.dispatchEvent(new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: false,
      data: "",
      inputType: "insertCompositionText",
      isComposing: false,
    }));
    element.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      data: "",
      inputType: "insertCompositionText",
      isComposing: false,
    }));

    const committedItalic = document.createElement("i");
    committedItalic.textContent = "你好";
    restoredEm.replaceWith(committedItalic);
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

  await expect.poll(() => editor.getAttribute("data-undo-depth")).toBe("1");
  expect(await currentCaseHtml(editor, caseId)).toContain(">你好</em>");
  expect(await currentCaseHtml(editor, caseId)).not.toContain("<i>");
  expect((await exportCurrentHtml(page)).equals(replaceUniqueBytes(
    source,
    "<em>Word</em>",
    "<em>你好</em>",
  ))).toBe(true);
});

test("an empty compositionend can be completed by a later non-empty final input", async ({ page }) => {
  const { editor, frame, source } = await openMatrix(page);
  const caseId = "heading-inline";
  const target = await activateNativeEdit(frame, caseId);
  const originalText = await target.textContent();
  const wordStart = originalText.indexOf("Word");
  await setTextSelection(frame, caseId, wordStart, wordStart + 4);

  await target.evaluate((element) => {
    const authoredEm = element.querySelector("em");
    if (!(authoredEm instanceof HTMLElement)) throw new Error("Authored em is missing.");
    element.dispatchEvent(new CompositionEvent("compositionstart", {
      bubbles: true,
      data: "Word",
    }));
    const markedItalic = document.createElement("i");
    markedItalic.textContent = "ni hao";
    authoredEm.replaceWith(markedItalic);
    element.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      data: "ni hao",
      inputType: "insertCompositionText",
      isComposing: true,
    }));
    element.dispatchEvent(new CompositionEvent("compositionend", {
      bubbles: true,
      data: "",
    }));

    const restoredEm = element.querySelector("em");
    if (!(restoredEm instanceof HTMLElement)) throw new Error("Composition snapshot was not restored.");
    element.dispatchEvent(new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: false,
      data: "你好",
      inputType: "insertText",
    }));
    const finalItalic = document.createElement("i");
    finalItalic.textContent = "你好";
    restoredEm.replaceWith(finalItalic);
    element.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      data: "你好",
      inputType: "insertText",
    }));
  });

  await expect.poll(() => editor.getAttribute("data-undo-depth")).toBe("1");
  expect(await currentCaseHtml(editor, caseId)).toContain(">你好</em>");
  expect(await currentCaseHtml(editor, caseId)).not.toContain("<i>");
  expect((await exportCurrentHtml(page)).equals(replaceUniqueBytes(
    source,
    "<em>Word</em>",
    "<em>你好</em>",
  ))).toBe(true);
});

test("shared-prefix IME commit uses the frozen selection instead of a minimal diff", async ({ page }) => {
  const { editor, frame, source } = await openMatrix(page);
  const caseId = "heading-inline";
  const target = await activateNativeEdit(frame, caseId);
  const originalText = await target.textContent();
  const wordStart = originalText.indexOf("Word");
  await setTextSelection(frame, caseId, wordStart, wordStart + 4);

  await target.evaluate((element) => {
    const authoredEm = element.querySelector("em");
    if (!(authoredEm instanceof HTMLElement)) throw new Error("Authored em is missing.");
    element.dispatchEvent(new CompositionEvent("compositionstart", {
      bubbles: true,
      data: "Word",
    }));
    const temporaryItalic = document.createElement("i");
    temporaryItalic.textContent = "World";
    authoredEm.replaceWith(temporaryItalic);
    element.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      data: "World",
      inputType: "insertCompositionText",
      isComposing: true,
    }));
    element.dispatchEvent(new CompositionEvent("compositionend", {
      bubbles: true,
      data: "World",
    }));
  });

  await expect.poll(() => editor.getAttribute("data-undo-depth")).toBe("1");
  expect(await currentCaseHtml(editor, caseId)).toContain(">World</em>");
  expect((await exportCurrentHtml(page)).equals(replaceUniqueBytes(
    source,
    "<em>Word</em>",
    "<em>World</em>",
  ))).toBe(true);
});

for (const temporaryTree of ["span", "nested-i-span"]) {
  test(`safe ${temporaryTree} composition wrapper is temporary and canonical`, async ({ page }) => {
    const { editor, frame, source } = await openMatrix(page);
    const caseId = "heading-inline";
    const target = await activateNativeEdit(frame, caseId);
    const originalText = await target.textContent();
    const wordStart = originalText.indexOf("Word");
    await setTextSelection(frame, caseId, wordStart, wordStart + 4);

    await target.evaluate((element, tree) => {
      const authoredEm = element.querySelector("em");
      if (!(authoredEm instanceof HTMLElement)) throw new Error("Authored em is missing.");
      element.dispatchEvent(new CompositionEvent("compositionstart", {
        bubbles: true,
        data: "Word",
      }));
      const outer = document.createElement(tree === "span" ? "span" : "i");
      if (tree === "span") {
        outer.textContent = "你好";
      } else {
        const inner = document.createElement("span");
        inner.textContent = "你好";
        outer.append(inner);
      }
      authoredEm.replaceWith(outer);
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
    }, temporaryTree);

    await expect.poll(() => editor.getAttribute("data-undo-depth")).toBe("1");
    expect(await currentCaseHtml(editor, caseId)).toContain(">你好</em>");
    expect(await currentCaseHtml(editor, caseId)).not.toMatch(/<(?:i|span)>/u);
    expect((await exportCurrentHtml(page)).equals(replaceUniqueBytes(
      source,
      "<em>Word</em>",
      "<em>你好</em>",
    ))).toBe(true);
  });
}

test("a second input is blocked until provisional IME DOM is canonicalized", async ({ page }) => {
  const { editor, frame, source } = await openMatrix(page);
  const caseId = "heading-inline";
  const target = await activateNativeEdit(frame, caseId);
  const originalText = await target.textContent();
  const wordStart = originalText.indexOf("Word");
  await setTextSelection(frame, caseId, wordStart, wordStart + 4);

  const secondInputPrevented = await target.evaluate((element) => {
    const authoredEm = element.querySelector("em");
    if (!(authoredEm instanceof HTMLElement)) throw new Error("Authored em is missing.");
    element.dispatchEvent(new CompositionEvent("compositionstart", {
      bubbles: true,
      data: "Word",
    }));
    const temporaryItalic = document.createElement("i");
    temporaryItalic.textContent = "你好";
    authoredEm.replaceWith(temporaryItalic);
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
    const nextBeforeInput = new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      data: "X",
      inputType: "insertText",
    });
    element.dispatchEvent(nextBeforeInput);
    return nextBeforeInput.defaultPrevented;
  });

  expect(secondInputPrevented).toBe(true);
  await expect.poll(() => editor.getAttribute("data-undo-depth")).toBe("1");
  expect(await currentCaseHtml(editor, caseId)).toContain(">你好</em>");
  expect((await exportCurrentHtml(page)).equals(replaceUniqueBytes(
    source,
    "<em>Word</em>",
    "<em>你好</em>",
  ))).toBe(true);
});

for (const unsafeTree of ["svg", "comment", "empty-wrapper"]) {
  test(`unsafe ${unsafeTree} composition tree is rejected as a whole`, async ({ page }) => {
    const { editor, frame, source } = await openMatrix(page);
    const caseId = "heading-inline";
    const target = await activateNativeEdit(frame, caseId);
    const originalHtml = await target.innerHTML();
    const originalText = await target.textContent();
    const wordStart = originalText.indexOf("Word");
    await setTextSelection(frame, caseId, wordStart, wordStart + 4);

    await target.evaluate((element, tree) => {
      const authoredEm = element.querySelector("em");
      if (!(authoredEm instanceof HTMLElement)) throw new Error("Authored em is missing.");
      element.dispatchEvent(new CompositionEvent("compositionstart", {
        bubbles: true,
        data: "Word",
      }));
      if (tree === "svg") {
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
        text.textContent = "你好";
        svg.append(text);
        authoredEm.replaceWith(svg);
      } else if (tree === "comment") {
        const italic = document.createElement("i");
        italic.append(document.createTextNode("你好"), document.createComment("temporary"));
        authoredEm.replaceWith(italic);
      } else {
        const emptyItalic = document.createElement("i");
        authoredEm.replaceWith(emptyItalic, document.createTextNode("你好"));
      }
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
    }, unsafeTree);

    await expect(target).toHaveJSProperty("innerHTML", originalHtml);
    await expectNoSourceCommit(page, editor, source);
  });
}

test("composition temporary wrapper cannot cover text outside its frozen selection", async ({ page }) => {
  const { editor, frame, source } = await openMatrix(page);
  const caseId = "heading-inline";
  const target = await activateNativeEdit(frame, caseId);
  const originalHtml = await target.innerHTML();
  const originalText = await target.textContent();
  const wordStart = originalText.indexOf("Word");
  await setTextSelection(frame, caseId, wordStart, wordStart + 4);

  await target.evaluate((element) => {
    const authoredEm = element.querySelector("em");
    if (!(authoredEm instanceof HTMLElement) || !(authoredEm.nextSibling instanceof Text)) {
      throw new Error("Fixture wrapper boundary is missing.");
    }
    element.dispatchEvent(new CompositionEvent("compositionstart", {
      bubbles: true,
      data: "Word",
    }));
    const temporaryItalic = document.createElement("i");
    temporaryItalic.textContent = "你好 ";
    authoredEm.nextSibling.data = authoredEm.nextSibling.data.slice(1);
    authoredEm.replaceWith(temporaryItalic);
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

  await expect(target).toHaveJSProperty("innerHTML", originalHtml);
  await expectNoSourceCommit(page, editor, source);
});

test("composition temporary wrapper with attributes is never canonicalized", async ({ page }) => {
  const { editor, frame, source } = await openMatrix(page);
  const caseId = "heading-inline";
  const target = await activateNativeEdit(frame, caseId);
  const originalHtml = await target.innerHTML();
  const originalText = await target.textContent();
  const wordStart = originalText.indexOf("Word");
  await setTextSelection(frame, caseId, wordStart, wordStart + 4);

  await target.evaluate((element) => {
    const authoredEm = element.querySelector("em");
    if (!(authoredEm instanceof HTMLElement)) throw new Error("Authored em is missing.");
    element.dispatchEvent(new CompositionEvent("compositionstart", {
      bubbles: true,
      data: "Word",
    }));
    const temporaryItalic = document.createElement("i");
    temporaryItalic.className = "author-controlled";
    temporaryItalic.textContent = "你好";
    authoredEm.replaceWith(temporaryItalic);
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

  await expect(target).toHaveJSProperty("innerHTML", originalHtml);
  await expectNoSourceCommit(page, editor, source);
});

test("Escape cancels an Apple Pinyin temporary wrapper and restores the authored selection", async ({ page }) => {
  const { editor, frame, source } = await openMatrix(page);
  const caseId = "heading-inline";
  const target = await activateNativeEdit(frame, caseId);
  const originalHtml = await target.innerHTML();
  const originalText = await target.textContent();
  const wordStart = originalText.indexOf("Word");
  expect(wordStart).toBeGreaterThanOrEqual(0);
  await setTextSelection(frame, caseId, wordStart, wordStart + 4);
  const originalSelection = await selectionSnapshot(frame, caseId);

  await target.evaluate((element) => {
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
    element.dispatchEvent(new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Escape",
    }));
    // macOS/Chromium may remove the marked subtree before delivering the
    // empty compositionend. PageRoot must restore the composition-start DOM
    // and Selection rather than accepting this as a deletion.
    temporaryItalic.remove();
    element.dispatchEvent(new CompositionEvent("compositionend", {
      bubbles: true,
      data: "",
    }));
  });

  await page.waitForTimeout(100);
  await expect(target).toHaveJSProperty("innerHTML", originalHtml);
  expect(await selectionSnapshot(frame, caseId)).toMatchObject({
    collapsed: false,
    anchorOffset: originalSelection.anchorOffset,
    focusOffset: originalSelection.focusOffset,
    direction: originalSelection.direction,
    text: "Word",
  });
  expect(await editor.getAttribute("data-undo-depth")).toBe("0");
  expect(await editor.getAttribute("data-redo-depth")).toBe("0");
  expect(await editor.getAttribute("data-edit-block-detail")).toBeNull();
  expect((await exportCurrentHtml(page)).equals(source)).toBe(true);
});

test("a backward complete-word composition commits through a temporary wrapper", async ({ page }) => {
  const { editor, frame, source } = await openMatrix(page);
  const caseId = "heading-inline";
  const target = await activateNativeEdit(frame, caseId);
  const originalText = await target.textContent();
  const wordStart = originalText.indexOf("Word");
  expect(wordStart).toBeGreaterThanOrEqual(0);
  await reverseTextSelection(frame, caseId, wordStart, wordStart + 4);
  expect(await selectionSnapshot(frame, caseId)).toMatchObject({
    anchorOffset: wordStart + 4,
    focusOffset: wordStart,
    direction: "backward",
    text: "Word",
  });

  await target.evaluate((element) => {
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
    temporaryItalic.textContent = "你好";
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

  await expect.poll(() => editor.getAttribute("data-undo-depth")).toBe("1");
  expect(await currentCaseHtml(editor, caseId)).toContain(">你好</em>");
  expect(await currentCaseHtml(editor, caseId)).not.toContain("<i>");
  expect(await editor.getAttribute("data-edit-block-detail")).toBeNull();
  expect((await exportCurrentHtml(page)).equals(replaceUniqueBytes(
    source,
    "<em>Word</em>",
    "<em>你好</em>",
  ))).toBe(true);
});

test("a collapsed caret inside em commits composition and lands after the inserted text", async ({ page }) => {
  const { editor, frame, source } = await openMatrix(page);
  const caseId = "heading-inline";
  const target = await activateNativeEdit(frame, caseId);
  const originalText = await target.textContent();
  const wordStart = originalText.indexOf("Word");
  expect(wordStart).toBeGreaterThanOrEqual(0);
  const insertionOffset = wordStart + 2;
  await setTextSelection(frame, caseId, insertionOffset);

  await target.evaluate((element) => {
    const authoredEm = element.querySelector("em");
    const authoredText = authoredEm?.firstChild;
    if (!(authoredEm instanceof HTMLElement) || !(authoredText instanceof Text)) {
      throw new Error("Authored em text is missing.");
    }
    element.dispatchEvent(new CompositionEvent("compositionstart", {
      bubbles: true,
      data: "",
    }));
    authoredText.data = "Woni haord";
    element.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      data: "ni hao",
      inputType: "insertCompositionText",
      isComposing: true,
    }));
    authoredText.data = "Wo你好rd";
    const selection = document.getSelection();
    const range = document.createRange();
    range.setStart(authoredText, 4);
    range.collapse(true);
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

  await expect.poll(() => editor.getAttribute("data-undo-depth")).toBe("1");
  expect(await currentCaseHtml(editor, caseId)).toContain(">Wo你好rd</em>");
  expect(await selectionSnapshot(frame, caseId)).toMatchObject({
    collapsed: true,
    anchorOffset: insertionOffset + 2,
    focusOffset: insertionOffset + 2,
  });
  expect(await editor.getAttribute("data-edit-block-detail")).toBeNull();
  expect((await exportCurrentHtml(page)).equals(replaceUniqueBytes(
    source,
    "<em>Word</em>",
    "<em>Wo你好rd</em>",
  ))).toBe(true);
});

test("focusout rolls back a temporary composition wrapper without losing prior dirty text", async ({ page }) => {
  const { editor, frame, source } = await openMatrix(page);
  const caseId = "heading-inline";
  const target = await activateNativeEdit(frame, caseId);
  const originalText = await target.textContent();
  const wordStart = originalText.indexOf("Word");
  await setTextSelection(frame, caseId, originalText.length);
  await page.keyboard.insertText("A");
  await setTextSelection(frame, caseId, wordStart, wordStart + 4);

  await target.evaluate((element) => {
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
    const outerButton = Array.from(parent.document.querySelectorAll("button"))
      .find((button) => button.textContent?.trim() === "项目");
    if (!(outerButton instanceof parent.HTMLButtonElement)) {
      throw new Error("Outer project button is missing.");
    }
    outerButton.focus();
  });

  await expect.poll(() => target.getAttribute("contenteditable")).toBeNull();
  await expect(target).toHaveText(`${originalText}A`);
  expect(await target.innerHTML()).toContain(">Word</em>");
  expect(await target.innerHTML()).not.toContain("<i>");
  await expect.poll(() => editor.getAttribute("data-undo-depth")).toBe("1");
  expect(await editor.getAttribute("data-edit-block-detail")).toBeNull();
  expect((await exportCurrentHtml(page)).equals(replaceUniqueBytes(
    source,
    "&nbsp;🙂</h1>",
    "&nbsp;🙂A</h1>",
  ))).toBe(true);
});

test("window blur rolls back a temporary composition wrapper without losing prior dirty text", async ({ page }) => {
  const { editor, frame, source } = await openMatrix(page);
  const caseId = "heading-inline";
  const target = await activateNativeEdit(frame, caseId);
  const originalText = await target.textContent();
  const wordStart = originalText.indexOf("Word");
  await setTextSelection(frame, caseId, originalText.length);
  await page.keyboard.insertText("A");
  await setTextSelection(frame, caseId, wordStart, wordStart + 4);

  await target.evaluate((element) => {
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
    window.dispatchEvent(new Event("blur"));
  });

  await expect(target).toHaveText(`${originalText}A`);
  expect(await target.innerHTML()).toContain(">Word</em>");
  expect(await target.innerHTML()).not.toContain("<i>");
  expect(await target.getAttribute("contenteditable")).toBe("plaintext-only");
  await expect.poll(() => editor.getAttribute("data-undo-depth")).toBe("1");
  expect(await editor.getAttribute("data-edit-block-detail")).toBeNull();
  expect((await exportCurrentHtml(page)).equals(replaceUniqueBytes(
    source,
    "&nbsp;🙂</h1>",
    "&nbsp;🙂A</h1>",
  ))).toBe(true);
});

test("a real text replacement cannot hide ownership drift outside its range", async ({ page }) => {
  const { editor, frame, source } = await openMatrix(page);
  const caseId = "heading-inline";
  const target = await activateNativeEdit(frame, caseId);
  const originalHtml = await target.innerHTML();
  const originalText = await target.textContent();
  await setTextSelection(frame, caseId, originalText.length);

  await target.evaluate((element) => {
    element.dispatchEvent(new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      data: "X",
      inputType: "insertText",
    }));
    const strong = element.querySelector("strong");
    const strongText = strong?.firstChild;
    const lastText = element.lastChild;
    if (!(strong instanceof HTMLElement) || !(strongText instanceof Text) || !(lastText instanceof Text)) {
      throw new Error("Fixture text ownership nodes are missing.");
    }
    strong.after(strongText);
    lastText.data += "X";
    element.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      data: "X",
      inputType: "insertText",
    }));
  });

  await expect(target).toHaveJSProperty("innerHTML", originalHtml);
  await expectNoSourceCommit(page, editor, source);
});

test("replacing an authored inline element is rolled back even when text is unchanged", async ({ page }) => {
  const { editor, frame, source } = await openMatrix(page);
  const target = await activateNativeEdit(frame, "heading-inline");
  const originalHtml = await target.innerHTML();

  await target.evaluate((element) => {
    element.dispatchEvent(new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      data: null,
      inputType: "deleteContentForward",
    }));
    const strong = element.querySelector("strong");
    if (!strong) throw new Error("Fixture inline element is missing.");
    const replacement = document.createElement("b");
    replacement.textContent = strong.textContent;
    strong.replaceWith(replacement);
    element.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      data: null,
      inputType: "deleteContentForward",
    }));
  });

  await expect(target).toHaveJSProperty("innerHTML", originalHtml);
  await expectNoSourceCommit(page, editor, source);
});

test("a managed-name attribute added to a descendant is still unauthorized drift", async ({ page }) => {
  const { editor, frame, source } = await openMatrix(page);
  const target = await activateNativeEdit(frame, "heading-inline");
  const originalHtml = await target.innerHTML();

  await target.evaluate((element) => {
    element.dispatchEvent(new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      data: "x",
      inputType: "insertText",
    }));
    const strong = element.querySelector("strong");
    if (!strong) throw new Error("Fixture inline element is missing.");
    strong.setAttribute("role", "button");
    element.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      data: "x",
      inputType: "insertText",
    }));
  });

  await expect(target).toHaveJSProperty("innerHTML", originalHtml);
  await expectNoSourceCommit(page, editor, source);
});

test("moving unchanged text outside its authored wrapper is rolled back", async ({ page }) => {
  const { editor, frame, source } = await openMatrix(page);
  const target = await activateNativeEdit(frame, "heading-inline");
  const originalHtml = await target.innerHTML();

  await target.evaluate((element) => {
    element.dispatchEvent(new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      data: null,
      inputType: "deleteContentForward",
    }));
    const strong = element.querySelector("strong");
    const text = strong?.firstChild;
    if (!(strong instanceof HTMLElement) || !(text instanceof Text)) {
      throw new Error("Fixture inline text is missing.");
    }
    strong.after(text);
    element.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      data: null,
      inputType: "deleteContentForward",
    }));
  });

  await expect(target).toHaveJSProperty("innerHTML", originalHtml);
  await expectNoSourceCommit(page, editor, source);
});

test("same-text replacement cannot erase a wrapper without a SourcePatch replacement", async ({ page }) => {
  const { editor, frame, source } = await openMatrix(page);
  const target = await activateNativeEdit(frame, "heading-inline");
  const originalHtml = await target.innerHTML();
  await setTextSelection(frame, "heading-inline", 2, 7);
  await page.keyboard.insertText(" DOM ");

  await expect(target).toHaveJSProperty("innerHTML", originalHtml);
  await expectNoSourceCommit(page, editor, source);
});

test("an explicit full wrapper selection may remove that wrapper despite shared text", async ({ page }) => {
  const { editor, frame, source } = await openMatrix(page);
  const caseId = "heading-inline";
  const target = await activateNativeEdit(frame, caseId);
  const originalText = await target.textContent();
  await setTextSelection(frame, caseId, 2, 7);
  await page.keyboard.insertText(" D ");

  await expect.poll(() => editor.getAttribute("data-undo-depth")).toBe("1");
  await expect(target).toHaveText(`${originalText.slice(0, 2)} D ${originalText.slice(7)}`);
  await expect(target.locator("strong")).toHaveCount(0);
  expect((await exportCurrentHtml(page)).equals(replaceUniqueBytes(
    source,
    ">真实 <strong>DOM</strong> 光标要像 <em>Word</em> 一样自然&nbsp;🙂</h1>",
    ">真实 D 光标要像 <em>Word</em> 一样自然&nbsp;🙂</h1>",
  ))).toBe(true);
});

test("a later cross-wrapper gesture is proved by its own intent before one checkpoint", async ({ page }) => {
  const { editor, frame, source } = await openMatrix(page);
  const caseId = "heading-inline";
  const target = await activateNativeEdit(frame, caseId);
  const originalText = await target.textContent();

  await setTextSelection(frame, caseId, originalText.length - 2, originalText.length);
  await page.keyboard.insertText("尾");
  expect(await editor.getAttribute("data-undo-depth")).toBe("0");
  await setTextSelection(frame, caseId, 2, 15);
  await page.keyboard.insertText("跨行内替换");

  await expect.poll(() => editor.getAttribute("data-undo-depth")).toBe("1");
  await expect(target).toHaveText(/跨行内替换.*尾$/u);
  const expectedCrossWrapper = replaceUniqueBytes(
    source,
    ">真实 <strong>DOM</strong> 光标要像 <em>Word</em> 一样自然&nbsp;🙂</h1>",
    ">真实跨行内替换<em>d</em> 一样自然&nbsp;🙂</h1>",
  );
  expect((await exportCurrentHtml(page)).equals(replaceUniqueBytes(
    expectedCrossWrapper,
    "&nbsp;🙂</h1>",
    "&nbsp;尾</h1>",
  ))).toBe(true);
});

test("Chromium's sole empty-host placeholder br is normalized, not treated as authored markup", async ({ page }) => {
  const { editor, frame, source } = await openMatrix(page);
  const caseId = "list-item";
  const target = await activateNativeEdit(frame, caseId);
  const originalText = await target.textContent();
  await setTextSelection(frame, caseId, 0, originalText.length);
  await page.keyboard.press("Backspace");

  await expect.poll(() => editor.getAttribute("data-undo-depth")).toBe("1");
  await expect(target).toHaveText("");
  expect((await exportCurrentHtml(page)).equals(replaceUniqueBytes(
    source,
    `>${originalText}</li>`,
    "></li>",
  ))).toBe(true);
});

test("deleting a whole host may normalize Chromium's br after disposable wrappers are proved", async ({ page }) => {
  const { editor, frame, source } = await openMatrix(page);
  const caseId = "heading-inline";
  const target = await activateNativeEdit(frame, caseId);
  const originalText = await target.textContent();
  await setTextSelection(frame, caseId, 0, originalText.length);
  await page.keyboard.press("Backspace");

  await expect.poll(() => editor.getAttribute("data-undo-depth")).toBe("1");
  await expect(target).toHaveText("");
  expect((await exportCurrentHtml(page)).equals(replaceUniqueBytes(
    source,
    ">真实 <strong>DOM</strong> 光标要像 <em>Word</em> 一样自然&nbsp;🙂</h1>",
    "></h1>",
  ))).toBe(true);
});

test("structure validation stays linear across one thousand inline nodes", async ({ page }) => {
  const spans = Array.from({ length: 1_000 }, (_, index) => (
    `<span>${index % 10}</span>`
  )).join("");
  const source = Buffer.from(
    `<!doctype html><html><head><meta charset="utf-8"><title>Linear structure guard</title><style>p{max-width:800px}span{display:inline-block}</style></head><body><p data-native-case="linear-structure" data-native-mode="native-editable">XX${spans}</p></body></html>`,
    "utf8",
  );
  await page.goto("/");
  const { editor, frame } = await loadFixture(page, manifest.fixture, { buffer: source });
  const caseId = "linear-structure";
  // Target the root-owned prefix so this regression isolates Controller work,
  // rather than the separate nested-inline hit-testing path.
  const target = await activateNativeEdit(frame, caseId, { x: 1, y: 1 });
  await setTextSelection(frame, caseId, 1);

  await target.evaluate(() => {
    const descriptor = Object.getOwnPropertyDescriptor(Node.prototype, "childNodes");
    if (!descriptor?.get || !descriptor.configurable) {
      throw new Error("Node.childNodes cannot be instrumented in this browser.");
    }
    window.__PAGEROOT_CHILD_NODES_DESCRIPTOR__ = descriptor;
    window.__PAGEROOT_CHILD_NODES_READS__ = 0;
    if (!PerformanceObserver.supportedEntryTypes.includes("longtask")) {
      throw new Error("Long Tasks API is unavailable in this browser.");
    }
    window.__PAGEROOT_LONG_TASKS__ = [];
    window.__PAGEROOT_LONG_TASK_START__ = performance.now();
    window.__PAGEROOT_LONG_TASK_OBSERVER__ = new PerformanceObserver((list) => {
      window.__PAGEROOT_LONG_TASKS__.push(...list.getEntries().map((entry) => ({
        duration: entry.duration,
        startTime: entry.startTime,
      })));
    });
    window.__PAGEROOT_LONG_TASK_OBSERVER__.observe({ type: "longtask" });
    Object.defineProperty(Node.prototype, "childNodes", {
      ...descriptor,
      get() {
        window.__PAGEROOT_CHILD_NODES_READS__ += 1;
        return descriptor.get.call(this);
      },
    });
  });

  let childNodesReads;
  let longTasks;
  try {
    await page.keyboard.insertText("尾");
    await page.waitForTimeout(100);
    ({ childNodesReads, longTasks } = await target.evaluate(() => {
      const reads = window.__PAGEROOT_CHILD_NODES_READS__;
      const start = window.__PAGEROOT_LONG_TASK_START__;
      const observedLongTasks = window.__PAGEROOT_LONG_TASKS__.filter((entry) => (
        entry.startTime >= start
      ));
      window.__PAGEROOT_LONG_TASK_OBSERVER__?.disconnect();
      const descriptor = window.__PAGEROOT_CHILD_NODES_DESCRIPTOR__;
      if (descriptor) Object.defineProperty(Node.prototype, "childNodes", descriptor);
      delete window.__PAGEROOT_CHILD_NODES_DESCRIPTOR__;
      delete window.__PAGEROOT_CHILD_NODES_READS__;
      delete window.__PAGEROOT_LONG_TASK_OBSERVER__;
      delete window.__PAGEROOT_LONG_TASKS__;
      delete window.__PAGEROOT_LONG_TASK_START__;
      return { childNodesReads: reads, longTasks: observedLongTasks };
    }));
  } finally {
    await target.evaluate(() => {
      window.__PAGEROOT_LONG_TASK_OBSERVER__?.disconnect();
      const descriptor = window.__PAGEROOT_CHILD_NODES_DESCRIPTOR__;
      if (descriptor) Object.defineProperty(Node.prototype, "childNodes", descriptor);
      delete window.__PAGEROOT_CHILD_NODES_DESCRIPTOR__;
      delete window.__PAGEROOT_CHILD_NODES_READS__;
      delete window.__PAGEROOT_LONG_TASK_OBSERVER__;
      delete window.__PAGEROOT_LONG_TASKS__;
      delete window.__PAGEROOT_LONG_TASK_START__;
    }).catch(() => {});
  }

  expect(childNodesReads).toBeGreaterThan(1_000);
  expect(childNodesReads).toBeLessThan(15_000);
  expect(longTasks).toEqual([]);
  await expect.poll(() => editor.getAttribute("data-undo-depth")).toBe("1");
  await expect(target).toHaveText(/^X\u5c3eX0/u);
  expect((await exportCurrentHtml(page)).equals(replaceUniqueBytes(
    source,
    ">XX<span>0</span>",
    ">X尾X<span>0</span>",
  ))).toBe(true);
});
