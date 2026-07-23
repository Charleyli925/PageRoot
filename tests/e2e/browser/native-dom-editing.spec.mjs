import { expect, test } from "@playwright/test";

import {
  activateNativeEdit,
  caseSelector,
  clickTextPosition,
  documentToken,
  doubleClickRenderedText,
  dragSelection,
  exportCurrentHtml,
  fixtureBuffer,
  geometrySnapshot,
  installInputRecorder,
  keyShortcut,
  loadCaseManifest,
  loadFixture,
  nativeEditingState,
  recordedInputEvents,
  replaceUniqueBytes,
  reverseTextSelection,
  selectionSnapshot,
  setTextSelection,
} from "./pageroot-driver.mjs";

const manifest = loadCaseManifest();
const editableCases = manifest.cases.filter(({ mode }) => mode === "native-editable");
const fallbackCases = manifest.cases.filter(({ mode }) => mode !== "native-editable");

async function openMatrix(page, options) {
  await page.goto("/");
  return loadFixture(page, manifest.fixture, options);
}

async function recordedInputEventsFromIframe(iframeElement) {
  return iframeElement.evaluate(
    (element) => element.__PAGEROOT_NATIVE_QA_INPUT_EVENTS__ || [],
  );
}

const POINTER_DISABLED_FALLBACKS = new Set([
  "canvas-surface",
  "nested-iframe",
]);
const TEXT_SELECTION_FALLBACKS = new Set([
  "vertical-copy",
  "preformatted-copy",
  "atom-mixed",
  "unsafe-contenteditable-css",
]);

async function attemptFallbackDoubleClick(frame, id, { dispatch = false } = {}) {
  const target = frame.locator(caseSelector(id));
  if (!dispatch && !POINTER_DISABLED_FALLBACKS.has(id)) {
    if (TEXT_SELECTION_FALLBACKS.has(id)) {
      return doubleClickRenderedText(frame, id);
    }
    await target.dblclick();
    return target;
  }
  // PageRoot deliberately makes embedded browsing surfaces inert so a click
  // cannot run or navigate their content. Dispatch against the authored host
  // itself to exercise the exact capability branch without Playwright waiting
  // for an intentionally impossible pointer-actionability check.
  await target.dispatchEvent("dblclick", {
    bubbles: true,
    cancelable: true,
    detail: 2,
  });
  return target;
}

function expectGeometryUnchanged(before, after) {
  for (const key of ["width", "height"]) {
    expect(after.rect[key], `target rect ${key}`).toBeCloseTo(before.rect[key], 1);
  }
  if (before.parentRect && after.parentRect) {
    for (const key of ["width", "height"]) {
      expect(after.parentRect[key], `parent rect ${key}`).toBeCloseTo(before.parentRect[key], 1);
    }
    expect(
      after.rect.x - after.parentRect.x + (after.parentScroll?.left || 0),
      "target x within parent content",
    ).toBeCloseTo(
      before.rect.x - before.parentRect.x + (before.parentScroll?.left || 0),
      1,
    );
    expect(
      after.rect.y - after.parentRect.y + (after.parentScroll?.top || 0),
      "target y within parent content",
    ).toBeCloseTo(
      before.rect.y - before.parentRect.y + (before.parentScroll?.top || 0),
      1,
    );
  }
  expect(after.scroll).toEqual(before.scroll);
  const beforeStyle = { ...before.style };
  const afterStyle = { ...after.style };
  delete beforeStyle.whiteSpace;
  delete afterStyle.whiteSpace;
  expect(afterStyle).toEqual(beforeStyle);
}

test.describe("authored DOM native editing contract", () => {
  for (const contractCase of editableCases) {
    test(`${contractCase.id} activates the authored node without layout drift`, async ({ page }) => {
      const { frame } = await openMatrix(page);
      const beforeGeometry = await geometrySnapshot(frame, contractCase.id);
      const beforeDocument = await documentToken(frame);

      await activateNativeEdit(frame, contractCase.id);

      const state = await nativeEditingState(frame, contractCase.id);
      expect(state).toMatchObject({
        targetIsActive: true,
        isContentEditable: true,
        activeCase: contractCase.id,
        activeIsLegacySurface: false,
        legacySurfaceCount: 0,
        authoredNodeHidden: false,
        selectionInside: true,
      });
      expect(["plaintext-only", "true"]).toContain(state.contenteditable);
      if (contractCase.hostMode) {
        expect(state.contenteditable).toBe(contractCase.hostMode);
      }
      expect(await documentToken(frame)).toBe(beforeDocument);
      expectGeometryUnchanged(beforeGeometry, await geometrySnapshot(frame, contractCase.id));
    });
  }

  test("caret, arrow keys, Home/End and Shift selection use browser Selection", async ({ page }) => {
    const { frame } = await openMatrix(page);
    await activateNativeEdit(frame, "paragraph-entities");

    await setTextSelection(frame, "paragraph-entities", 4);
    const initial = await selectionSnapshot(frame, "paragraph-entities");
    expect(initial).toMatchObject({ collapsed: true, anchorOffset: 4, focusOffset: 4 });

    await page.keyboard.press("ArrowRight");
    expect(await selectionSnapshot(frame, "paragraph-entities")).toMatchObject({
      collapsed: true,
      anchorOffset: 5,
      focusOffset: 5,
    });

    await page.keyboard.press("ArrowLeft");
    expect(await selectionSnapshot(frame, "paragraph-entities")).toMatchObject({
      collapsed: true,
      anchorOffset: 4,
      focusOffset: 4,
    });

    await page.keyboard.press("Shift+ArrowRight");
    await page.keyboard.press("Shift+ArrowRight");
    const extended = await selectionSnapshot(frame, "paragraph-entities");
    expect(extended.collapsed).toBe(false);
    expect(extended.text.length).toBeGreaterThanOrEqual(2);

    const lineStartKey = process.platform === "darwin" ? "Meta+ArrowLeft" : "Home";
    const lineEndKey = process.platform === "darwin" ? "Meta+ArrowRight" : "End";
    await page.keyboard.press(lineStartKey);
    const home = await selectionSnapshot(frame, "paragraph-entities");
    await page.keyboard.press(lineEndKey);
    const end = await selectionSnapshot(frame, "paragraph-entities");
    expect(home.collapsed).toBe(true);
    expect(end.collapsed).toBe(true);
    expect(end.focusOffset).toBeGreaterThan(home.focusOffset);
    if (process.platform === "darwin") {
      // Home/End are browser scroll keys on macOS, not text-boundary keys.
      await page.keyboard.press("Home");
      await page.keyboard.press("End");
      expect((await selectionSnapshot(frame, "paragraph-entities")).activeCase)
        .toBe("paragraph-entities");
    }
  });

  test("mouse clicks place a collapsed caret at the start, middle and end", async ({ page }) => {
    const { frame } = await openMatrix(page);
    await activateNativeEdit(frame, "list-item");
    const start = await clickTextPosition(frame, "list-item", "start");
    const middle = await clickTextPosition(frame, "list-item", "middle");
    const end = await clickTextPosition(frame, "list-item", "end");

    expect(start.collapsed && middle.collapsed && end.collapsed).toBe(true);
    expect(middle.focusOffset).toBeGreaterThan(start.focusOffset);
    expect(end.focusOffset).toBeGreaterThan(middle.focusOffset);
  });

  test("ArrowDown and ArrowUp move the real caret between visual lines", async ({ page }) => {
    const { frame } = await openMatrix(page);
    await activateNativeEdit(frame, "hard-break");
    await setTextSelection(frame, "hard-break", 2);
    const firstLine = await selectionSnapshot(frame, "hard-break");

    await page.keyboard.press("ArrowDown");
    const secondLine = await selectionSnapshot(frame, "hard-break");
    expect(secondLine.collapsed).toBe(true);
    expect(secondLine.rect.y).toBeGreaterThan(firstLine.rect.y);

    await page.keyboard.press("ArrowUp");
    const returned = await selectionSnapshot(frame, "hard-break");
    expect(returned.collapsed).toBe(true);
    expect(returned.rect.y).toBeLessThan(secondLine.rect.y);
  });

  test("platform word-navigation and Shift extension remain browser-native", async ({ page }) => {
    const { frame } = await openMatrix(page);
    await activateNativeEdit(frame, "flex-copy");
    const text = await frame.locator(caseSelector("flex-copy")).textContent() || "";
    const wordStart = text.indexOf("flex");
    expect(wordStart).toBeGreaterThanOrEqual(0);
    await setTextSelection(frame, "flex-copy", wordStart);
    const modifier = process.platform === "darwin" ? "Alt" : "Control";
    await page.keyboard.press(`${modifier}+ArrowRight`);
    const moved = await selectionSnapshot(frame, "flex-copy");
    expect(moved.collapsed).toBe(true);
    expect(moved.focusOffset).toBeGreaterThan(wordStart);

    await page.keyboard.press(`Shift+${modifier}+ArrowRight`);
    const extended = await selectionSnapshot(frame, "flex-copy");
    expect(extended.collapsed).toBe(false);
    expect(extended.text.length).toBeGreaterThan(0);
  });

  test("forward and reverse mouse drags preserve Selection direction", async ({ page }) => {
    const { frame } = await openMatrix(page);
    await activateNativeEdit(frame, "flex-copy");

    const forward = await dragSelection(page, frame, "flex-copy", { from: 0.12, to: 0.76 });
    expect(forward.collapsed).toBe(false);
    expect(forward.text.trim().length).toBeGreaterThan(1);

    // Clicking and dragging inside an existing selection starts native
    // drag-and-drop, so collapse it before exercising the opposite gesture.
    await setTextSelection(frame, "flex-copy", 0);
    const reverse = await dragSelection(page, frame, "flex-copy", { from: 0.76, to: 0.12 });
    expect(reverse.collapsed).toBe(false);
    expect(reverse.text.trim().length).toBeGreaterThan(1);
    expect(reverse.direction).toBe("backward");
  });

  test("programmatic backward Selection remains backward through an edit session", async ({ page }) => {
    const { frame } = await openMatrix(page);
    await activateNativeEdit(frame, "heading-inline");
    await reverseTextSelection(frame, "heading-inline", 0, 6);
    const selection = await selectionSnapshot(frame, "heading-inline");
    expect(selection.text.length).toBeGreaterThan(0);
    expect(selection.direction).toBe("backward");
  });

  test("activation never overwrites a newer Selection on the next frame", async ({ page }) => {
    const { frame } = await openMatrix(page);
    const target = frame.locator(caseSelector("heading-inline"));

    await target.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      element.dispatchEvent(new MouseEvent("dblclick", {
        bubbles: true,
        cancelable: true,
        detail: 2,
        view: window,
        clientX: rect.left + rect.width * 0.72,
        clientY: rect.top + rect.height / 2,
      }));
      if (element.getAttribute("contenteditable") !== "plaintext-only") {
        throw new Error("Native editing did not activate synchronously.");
      }

      const points = [];
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let logicalOffset = 0;
      let current = walker.nextNode();
      while (current) {
        const length = current.data.length;
        points.push({ node: current, start: logicalOffset, end: logicalOffset + length });
        logicalOffset += length;
        current = walker.nextNode();
      }
      const pointFor = (offset) => {
        const point = points.find(({ start, end }) => offset >= start && offset <= end)
          || points.at(-1);
        if (!point) throw new Error("Editable text node is missing.");
        return { node: point.node, offset: Math.max(0, Math.min(offset - point.start, point.node.data.length)) };
      };
      const start = pointFor(2);
      const end = pointFor(15);
      const range = document.createRange();
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);
      const selection = document.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    });

    await page.waitForTimeout(50);
    const afterFrame = await selectionSnapshot(frame, "heading-inline");
    expect(afterFrame).toMatchObject({
      anchorOffset: 2,
      focusOffset: 15,
      collapsed: false,
      activeCase: "heading-inline",
    });
    expect(afterFrame.text.length).toBeGreaterThan(0);
  });

  test("triple click selects an authored block without moving Selection to a mirror", async ({ page }) => {
    const { frame } = await openMatrix(page);
    const target = await activateNativeEdit(frame, "grid-card");
    await target.click({ clickCount: 3 });
    const selection = await selectionSnapshot(frame, "grid-card");
    expect(selection.collapsed).toBe(false);
    expect(selection.text.trim().length).toBeGreaterThan(4);
    expect(selection.activeCase).toBe("grid-card");
  });

  test("insert, replace, Backspace and Delete expose uncancelled beforeinput", async ({ page }) => {
    const { frame } = await openMatrix(page);
    await activateNativeEdit(frame, "grid-card");
    await installInputRecorder(frame);

    await setTextSelection(frame, "grid-card", 0, 2);
    await page.keyboard.insertText("网格");
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Delete");

    const events = await recordedInputEvents(frame);
    const beforeInputs = events.filter(({ type }) => type === "beforeinput");
    expect(beforeInputs.map(({ inputType }) => inputType)).toEqual(expect.arrayContaining([
      "insertText",
      "deleteContentBackward",
      "deleteContentForward",
    ]));
    expect(beforeInputs.every(({ defaultPrevented }) => !defaultPrevented)).toBe(true);
    expect(events.some(({ type, targetCase }) => type === "input" && targetCase === "grid-card")).toBe(true);
    expect(events.map(({ sequence }) => sequence)).toEqual(
      events.map((_, index) => index + 1),
    );
    expect(events.some(({ type, key }) => type === "keydown" && key === "Backspace"))
      .toBe(true);
    expect(events.some(({ type, key }) => type === "keyup" && key === "Delete"))
      .toBe(true);
    expect(events.some(({ type }) => type === "mutation")).toBe(true);
    expect(beforeInputs.every((event) => (
      typeof event.cancelable === "boolean"
      && typeof event.isTrusted === "boolean"
      && typeof event.innerHTML === "string"
      && typeof event.textContent === "string"
      && event.selection
      && typeof event.selection.anchor === "number"
      && typeof event.selection.focus === "number"
    ))).toBe(true);
  });

  test("export synchronously includes the latest delivered native input", async ({ page }) => {
    const { frame, source } = await openMatrix(page);
    await activateNativeEdit(frame, "heading-inline");
    await setTextSelection(frame, "heading-inline", 0);
    await page.keyboard.insertText("即刻");

    const expected = replaceUniqueBytes(
      source,
      ">真实 <strong>",
      ">即刻真实 <strong>",
    );
    expect((await exportCurrentHtml(page)).equals(expected)).toBe(true);
  });

  for (const id of [
    "standalone-span",
    "standalone-strong",
    "standalone-time",
    "standalone-label",
    "standalone-output",
    "standalone-link",
    "standalone-summary",
    "custom-element",
    "transition-sensitive-copy",
    "pseudo-content",
  ]) {
    test(`${id} commits a local source patch and undo restores exact bytes`, async ({ page }) => {
      const { editor, frame, source } = await openMatrix(page);
      const originalText = await frame.locator(caseSelector(id)).textContent() || "";
      const marker = "验";
      await activateNativeEdit(frame, id);
      await setTextSelection(frame, id, 0);
      await page.keyboard.insertText(marker);
      await expect.poll(() => editor.getAttribute("data-undo-depth")).toBe("1");
      const expected = replaceUniqueBytes(source, `>${originalText}`, `>${marker}${originalText}`);
      expect((await exportCurrentHtml(page)).equals(expected)).toBe(true);

      await page.keyboard.press(keyShortcut("Z"));
      await expect.poll(() => editor.getAttribute("data-undo-depth")).toBe("0");
      expect((await exportCurrentHtml(page)).equals(source)).toBe(true);
    });
  }

  test("editing link and summary labels suppresses their native actions", async ({ page }) => {
    const { frame } = await openMatrix(page);
    await activateNativeEdit(frame, "standalone-link");
    expect(await frame.evaluate(() => location.hash)).toBe("");
    await page.keyboard.press("Escape");

    const detailsOpenBefore = await frame.locator(caseSelector("standalone-summary"))
      .evaluate((summary) => summary.parentElement?.hasAttribute("open"));
    await activateNativeEdit(frame, "standalone-summary");
    const detailsOpenAfter = await frame.locator(caseSelector("standalone-summary"))
      .evaluate((summary) => summary.parentElement?.hasAttribute("open"));
    expect(detailsOpenBefore).toBe(true);
    expect(detailsOpenAfter).toBe(true);
  });

  test("Enter stays blocked for complex break content while Shift+Enter commits one source-owned hard break", async ({ page }) => {
    const { editor, frame, source } = await openMatrix(page);
    await activateNativeEdit(frame, "hard-break");
    await installInputRecorder(frame);
    await setTextSelection(frame, "hard-break", 3);
    const target = frame.locator(caseSelector("hard-break"));
    const beforeHtml = await target.innerHTML();
    const beforeSelection = await selectionSnapshot(frame, "hard-break");
    const iframe = await frame.frameElement();
    await iframe.evaluate((frameElement) => {
      const host = frameElement.contentDocument.querySelector('[data-native-case="hard-break"]');
      frameElement.__PAGEROOT_STRUCTURAL_BEFOREINPUT__ = [];
      host.addEventListener("beforeinput", (event) => {
        frameElement.__PAGEROOT_STRUCTURAL_BEFOREINPUT__.push({
          inputType: event.inputType,
          defaultPrevented: event.defaultPrevented,
        });
      });
    });
    await page.keyboard.press("Enter");
    expect(await target.innerHTML()).toBe(beforeHtml);
    expect(await selectionSnapshot(frame, "hard-break")).toMatchObject({
      collapsed: beforeSelection.collapsed,
      anchorOffset: beforeSelection.anchorOffset,
      focusOffset: beforeSelection.focusOffset,
      activeCase: "hard-break",
    });

    await page.keyboard.press("Shift+Enter");

    const beforeInputs = (await recordedInputEvents(frame))
      .filter(({ type }) => type === "beforeinput");
    const structuralInputTypes = beforeInputs.map(({ inputType }) => inputType);
    expect(structuralInputTypes).toHaveLength(2);
    expect(structuralInputTypes.every((inputType) => (
      inputType === "insertParagraph" || inputType === "insertLineBreak"
    ))).toBe(true);
    const structuralEvents = await iframe.evaluate(
      (frameElement) => frameElement.__PAGEROOT_STRUCTURAL_BEFOREINPUT__,
    );
    expect(structuralEvents.map(({ inputType }) => inputType)).toEqual(structuralInputTypes);
    expect(structuralEvents.every(({ defaultPrevented }) => defaultPrevented)).toBe(true);
    expect(await selectionSnapshot(frame, "hard-break")).toMatchObject({
      collapsed: true,
      // DOM Range.toString() does not count <br>; the controller's logical
      // Selection is 4 and sits after the new break, while this helper reports
      // the three visible characters before it.
      anchorOffset: 3,
      focusOffset: 3,
      activeCase: "hard-break",
    });
    await expect.poll(() => editor.getAttribute("data-undo-depth")).toBe("1");
    const expected = replaceUniqueBytes(
      source,
      ">第一行保留原位。<br>",
      ">第一行<br>保留原位。<br>",
    );
    expect((await exportCurrentHtml(page)).equals(expected)).toBe(true);

    await page.keyboard.press(keyShortcut("Z"));
    await expect.poll(() => editor.getAttribute("data-undo-depth")).toBe("0");
    expect((await exportCurrentHtml(page)).equals(source)).toBe(true);
  });

  test("Enter splits one simple list item, resumes in the new item, and round-trips undo/redo", async ({ page }) => {
    const { editor, frame, source } = await openMatrix(page);
    const caseId = "list-item";
    const originalText = "列表项中的文字保持项目符号和缩进。";
    const firstText = "列表项中的";
    const secondText = "文字保持项目符号和缩进。";
    const startTag = `<li data-native-case="list-item" data-native-mode="native-editable">`;
    const originalSource = `${startTag}${originalText}</li>`;
    const splitSource = `${startTag}${firstText}</li>${startTag}${secondText}</li>`;

    await activateNativeEdit(frame, caseId);
    await setTextSelection(frame, caseId, firstText.length);
    const initialDocument = await documentToken(frame);
    await page.keyboard.press("Enter");

    await expect.poll(() => editor.getAttribute("data-undo-depth")).toBe("1");
    await expect.poll(() => frame.locator(caseSelector(caseId)).count()).toBe(2);
    await expect.poll(() => documentToken(frame)).not.toBe(initialDocument);
    expect((await exportCurrentHtml(page)).equals(
      replaceUniqueBytes(source, originalSource, splitSource),
    )).toBe(true);
    await expect.poll(() => frame.evaluate((id) => {
      const items = [...document.querySelectorAll(`[data-native-case=${JSON.stringify(id)}]`)];
      const active = document.activeElement;
      const selection = document.getSelection();
      return {
        activeIndex: items.indexOf(active),
        contenteditable: active?.getAttribute("contenteditable"),
        collapsed: selection?.isCollapsed,
        offset: selection?.focusOffset,
      };
    }, caseId)).toMatchObject({
      activeIndex: 1,
      contenteditable: "plaintext-only",
      collapsed: true,
      offset: 0,
    });

    await page.keyboard.insertText("续");
    await expect.poll(() => editor.getAttribute("data-undo-depth")).toBe("2");
    const typedSource = splitSource.replace(`>${secondText}`, `>续${secondText}`);
    expect((await exportCurrentHtml(page)).equals(
      replaceUniqueBytes(source, originalSource, typedSource),
    )).toBe(true);

    await page.keyboard.press(keyShortcut("Z"));
    await expect.poll(() => editor.getAttribute("data-undo-depth")).toBe("1");
    expect((await exportCurrentHtml(page)).equals(
      replaceUniqueBytes(source, originalSource, splitSource),
    )).toBe(true);
    await page.keyboard.press(keyShortcut("Z"));
    await expect.poll(() => editor.getAttribute("data-undo-depth")).toBe("0");
    await expect.poll(() => frame.locator(caseSelector(caseId)).count()).toBe(1);
    expect((await exportCurrentHtml(page)).equals(source)).toBe(true);

    await page.keyboard.press(
      `${process.platform === "darwin" ? "Meta" : "Control"}+Shift+Z`,
    );
    await expect.poll(() => editor.getAttribute("data-undo-depth")).toBe("1");
    await expect.poll(() => frame.locator(caseSelector(caseId)).count()).toBe(2);
    expect((await exportCurrentHtml(page)).equals(
      replaceUniqueBytes(source, originalSource, splitSource),
    )).toBe(true);
    await expect.poll(() => frame.evaluate((id) => {
      const items = [...document.querySelectorAll(`[data-native-case=${JSON.stringify(id)}]`)];
      return {
        activeIndex: items.indexOf(document.activeElement),
        contenteditable: document.activeElement?.getAttribute("contenteditable"),
      };
    }, caseId)).toEqual({
      activeIndex: 1,
      contenteditable: "plaintext-only",
    });
  });

  test("Enter splits one simple paragraph and preserves its visual attributes", async ({ page }) => {
    const { editor, frame, source } = await openMatrix(page);
    const caseId = "flex-copy";
    const firstText = "这个 flex item";
    const secondText = " 可以伸缩，进入编辑前后 gap、baseline 和折行都必须不变。";
    const startTag = `<p data-native-case="flex-copy" data-native-mode="native-editable">`;
    const originalSource = `${startTag}${firstText}${secondText}</p>`;
    const splitSource = `${startTag}${firstText}</p>${startTag}${secondText}</p>`;

    await activateNativeEdit(frame, caseId);
    await setTextSelection(frame, caseId, firstText.length);
    await page.keyboard.press("Enter");

    await expect.poll(() => editor.getAttribute("data-undo-depth")).toBe("1");
    await expect.poll(() => frame.locator(caseSelector(caseId)).count()).toBe(2);
    expect((await exportCurrentHtml(page)).equals(
      replaceUniqueBytes(source, originalSource, splitSource),
    )).toBe(true);
    await expect.poll(() => frame.evaluate((id) => {
      const blocks = [...document.querySelectorAll(`[data-native-case=${JSON.stringify(id)}]`)];
      return {
        activeIndex: blocks.indexOf(document.activeElement),
        tagName: document.activeElement?.tagName,
        editableModeSupported: ["plaintext-only", "true"].includes(
          document.activeElement?.getAttribute("contenteditable"),
        ),
      };
    }, caseId)).toEqual({
      activeIndex: 1,
      tagName: "P",
      editableModeSupported: true,
    });

    await page.keyboard.press(keyShortcut("Z"));
    await expect.poll(() => editor.getAttribute("data-undo-depth")).toBe("0");
    await expect.poll(() => frame.locator(caseSelector(caseId)).count()).toBe(1);
    expect((await exportCurrentHtml(page)).equals(source)).toBe(true);
  });

  test("replacement can cross nested inline wrappers without losing the caret", async ({ page }) => {
    const { editor, frame, source } = await openMatrix(page);
    const target = frame.locator(caseSelector("heading-inline"));
    const originalText = await target.textContent();
    await activateNativeEdit(frame, "heading-inline");
    await setTextSelection(frame, "heading-inline", 2, 15);
    await page.keyboard.insertText("跨行内替换");

    const text = await target.textContent();
    expect(text).toContain("跨行内替换");
    const selection = await selectionSnapshot(frame, "heading-inline");
    expect(selection.collapsed).toBe(true);
    expect(selection.activeCase).toBe("heading-inline");

    await expect.poll(() => editor.getAttribute("data-undo-depth")).toBe("1");
    const expected = replaceUniqueBytes(
      source,
      ">真实 <strong>DOM</strong> 光标要像 <em>Word</em> 一样自然&nbsp;🙂</h1>",
      ">真实跨行内替换<em>d</em> 一样自然&nbsp;🙂</h1>",
    );
    expect((await exportCurrentHtml(page)).equals(expected)).toBe(true);

    const undoRun = await openMatrix(page);
    const undoTarget = undoRun.frame.locator(caseSelector("heading-inline"));
    await activateNativeEdit(undoRun.frame, "heading-inline");
    await setTextSelection(undoRun.frame, "heading-inline", 2, 15);
    await page.keyboard.insertText("跨行内替换");
    await expect.poll(() => undoRun.editor.getAttribute("data-undo-depth")).toBe("1");
    await page.keyboard.press(keyShortcut("Z"));
    await page.waitForTimeout(150);
    expect(
      await undoTarget.textContent(),
      `undo edit block: ${await undoRun.editor.getAttribute("data-edit-block-detail")}`,
    ).toBe(originalText);
    expect((await exportCurrentHtml(page)).equals(undoRun.source)).toBe(true);

    const redoRun = await openMatrix(page);
    const redoTarget = redoRun.frame.locator(caseSelector("heading-inline"));
    await activateNativeEdit(redoRun.frame, "heading-inline");
    await setTextSelection(redoRun.frame, "heading-inline", 2, 15);
    await page.waitForTimeout(50);
    expect(await selectionSnapshot(redoRun.frame, "heading-inline")).toMatchObject({
      anchorOffset: 2,
      focusOffset: 15,
      collapsed: false,
    });
    await page.keyboard.insertText("跨行内替换");
    await expect.poll(() => redoRun.editor.getAttribute("data-undo-depth")).toBe("1");
    await page.keyboard.press(keyShortcut("Z"));
    await expect.poll(() => redoTarget.textContent()).toBe(originalText);
    expect(await redoRun.editor.getAttribute("data-redo-depth")).toBe("1");
    await page.keyboard.press(`${process.platform === "darwin" ? "Meta" : "Control"}+Shift+Z`);
    await expect.poll(() => redoTarget.textContent()).toContain("跨行内替换");
    expect(await redoRun.editor.getAttribute("data-undo-depth")).toBe("1");
    expect(await redoRun.editor.getAttribute("data-redo-depth")).toBe("0");
    expect((await exportCurrentHtml(page)).equals(expected)).toBe(true);
  });

  test("replacement from an exact wrapper boundary follows native ownership and remains byte-reversible", async ({ page }) => {
    const { editor, frame, source } = await openMatrix(page);
    const target = frame.locator(caseSelector("heading-inline"));
    const originalText = await target.textContent();
    await activateNativeEdit(frame, "heading-inline");
    await setTextSelection(frame, "heading-inline", 3, 9);
    await page.keyboard.insertText("Electron原位");

    expect(await target.textContent()).toContain("Electron原位");
    await expect.poll(() => editor.getAttribute("data-undo-depth")).toBe("1");
    const expected = replaceUniqueBytes(
      source,
      ">真实 <strong>DOM</strong> 光标要像 <em>Word</em> 一样自然&nbsp;🙂</h1>",
      ">真实 Electron原位要像 <em>Word</em> 一样自然&nbsp;🙂</h1>",
    );
    expect((await exportCurrentHtml(page)).equals(expected)).toBe(true);

    await page.keyboard.press(keyShortcut("Z"));
    await expect.poll(() => target.textContent()).toBe(originalText);
    expect((await exportCurrentHtml(page)).equals(source)).toBe(true);
  });

  test("a replacement ending at an inline-wrapper boundary shifts later ownership safely", async ({ page }) => {
    const { editor, frame, source } = await openMatrix(page);
    const caseId = "heading-inline";
    const target = await activateNativeEdit(frame, caseId);
    await setTextSelection(frame, caseId, 0, 3);
    await page.keyboard.insertText("更长前缀");

    await expect.poll(() => editor.getAttribute("data-undo-depth")).toBe("1");
    await expect(target.locator("strong")).toHaveText("DOM");
    expect((await exportCurrentHtml(page)).equals(replaceUniqueBytes(
      source,
      ">真实 <strong>DOM</strong>",
      ">更长前缀<strong>DOM</strong>",
    ))).toBe(true);
  });

  test("Backspace deletes an emoji as one grapheme", async ({ page }) => {
    const { frame } = await openMatrix(page);
    await activateNativeEdit(frame, "heading-inline");
    const original = await frame.locator(caseSelector("heading-inline")).textContent();
    expect(Array.from(original).at(-1)).toBe("🙂");
    await setTextSelection(frame, "heading-inline", original.length);
    await page.keyboard.press("Backspace");
    const next = await frame.locator(caseSelector("heading-inline")).textContent();
    expect(next).toBe(Array.from(original).slice(0, -1).join(""));
    expect(next).not.toContain("�");
  });

  test("Backspace deletes combining-mark and ZWJ text as whole grapheme clusters", async ({ page }) => {
    const { editor, frame, source } = await openMatrix(page);
    const caseId = "heading-inline";
    const target = await activateNativeEdit(frame, caseId);
    const original = await target.textContent();
    const clusters = ["e\u0301", "👩‍💻"];

    for (const cluster of clusters) {
      await setTextSelection(frame, caseId, (await target.textContent()).length);
      await page.keyboard.insertText(cluster);
      await expect(target).toHaveText(`${original}${cluster}`);
      await page.keyboard.press("Backspace");
      await expect(target).toHaveText(original);
      expect(await target.textContent()).not.toContain("�");

      await setTextSelection(frame, caseId, original.length);
      await page.keyboard.insertText(cluster);
      await setTextSelection(frame, caseId, original.length);
      await page.keyboard.press("Delete");
      await expect(target).toHaveText(original);
      expect(await target.textContent()).not.toContain("�");
    }
    await page.waitForTimeout(850);
    expect(await editor.getAttribute("data-undo-depth")).toBe("0");
    expect((await exportCurrentHtml(page)).equals(source)).toBe(true);
  });

  for (const {
    name,
    cluster,
    markup,
  } of [
    {
      name: "combining-mark",
      cluster: "e\u0301",
      markup: "边界 <span>e</span>\u0301 结束",
    },
    {
      name: "ZWJ",
      cluster: "👩‍💻",
      markup: "边界 <span>👩</span>\u200d<span>💻</span> 结束",
    },
  ]) {
    for (const key of ["Backspace", "Delete"]) {
      test(`${key} fails closed when a ${name} grapheme crosses authored inline boundaries`, async ({ page }) => {
        const baseSource = fixtureBuffer(manifest.fixture);
        const source = replaceUniqueBytes(
          baseSource,
          ">真实 <strong>DOM</strong> 光标要像 <em>Word</em> 一样自然&nbsp;🙂</h1>",
          `>${markup}</h1>`,
        );
        const { editor, frame } = await openMatrix(page, { buffer: source });
        const caseId = "heading-inline";
        const target = await activateNativeEdit(frame, caseId);
        const text = await target.textContent();
        const clusterStart = text.indexOf(cluster);
        expect(clusterStart).toBeGreaterThanOrEqual(0);
        const caret = key === "Backspace"
          ? clusterStart + cluster.length
          : clusterStart;
        await setTextSelection(frame, caseId, caret);
        const beforeSelection = await selectionSnapshot(frame, caseId);
        await page.keyboard.press(key);

        await expect(target).toHaveText(text);
        expect(await selectionSnapshot(frame, caseId)).toMatchObject({
          anchorOffset: beforeSelection.anchorOffset,
          focusOffset: beforeSelection.focusOffset,
          collapsed: true,
          activeCase: caseId,
        });
        await page.waitForTimeout(850);
        expect(await editor.getAttribute("data-undo-depth")).toBe("0");
        expect((await exportCurrentHtml(page)).equals(source)).toBe(true);
        expect(await target.textContent()).not.toContain("�");
      });
    }
  }

  test("plain-text clipboard paste and cut stay in the authored host", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const { frame } = await openMatrix(page);
    await activateNativeEdit(frame, "table-cell");
    await installInputRecorder(frame);

    await setTextSelection(frame, "table-cell", 0, 4);
    await page.evaluate(() => navigator.clipboard.writeText("粘贴的纯文本"));
    await page.keyboard.press(keyShortcut("V"));
    expect(await frame.locator(caseSelector("table-cell")).textContent()).toContain("粘贴的纯文本");

    await setTextSelection(frame, "table-cell", 0, 3);
    await page.keyboard.press(keyShortcut("X"));
    const events = await recordedInputEvents(frame);
    expect(events.some(({ type, inputType }) => type === "beforeinput" && inputType === "insertFromPaste")).toBe(true);
    expect(events.some(({ type }) => type === "cut")).toBe(true);
  });

  test("multi-line clipboard text is stripped to text and committed as generated hard breaks", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const { editor, frame, source } = await openMatrix(page);
    await activateNativeEdit(frame, "hard-break");
    await setTextSelection(frame, "hard-break", 2);
    const target = frame.locator(caseSelector("hard-break"));
    await page.evaluate(() => navigator.clipboard.writeText(
      "<b>粘贴第一行</b>\n粘贴第二行",
    ));
    await page.keyboard.press(keyShortcut("V"));
    await expect.poll(() => editor.getAttribute("data-undo-depth")).toBe("1");
    await expect(target).toContainText("<b>粘贴第一行</b>");
    expect(await target.locator("b").count()).toBe(0);
    expect(await target.locator("br").count()).toBe(2);
    expect(await selectionSnapshot(frame, "hard-break")).toMatchObject({
      collapsed: true,
      activeCase: "hard-break",
    });
    expect((await nativeEditingState(frame, "hard-break")).targetIsActive).toBe(true);
    const expected = replaceUniqueBytes(
      source,
      ">第一行保留原位。<br>",
      ">第一&lt;b>粘贴第一行&lt;/b><br>粘贴第二行行保留原位。<br>",
    );
    expect((await exportCurrentHtml(page)).equals(expected)).toBe(true);

    await page.keyboard.press(keyShortcut("Z"));
    await expect.poll(() => editor.getAttribute("data-undo-depth")).toBe("0");
    expect((await exportCurrentHtml(page)).equals(source)).toBe(true);
  });

  for (const key of ["Backspace", "Delete"]) {
    test(`${key} deletes exactly the adjacent authored hard break and undo restores it`, async ({ page }) => {
      const { editor, frame, source } = await openMatrix(page);
      const target = await activateNativeEdit(frame, "hard-break");
      if (key === "Backspace") {
        await target.evaluate((host) => {
          const hardBreak = host.querySelector("br");
          if (!hardBreak?.parentNode) throw new Error("Expected an authored hard break.");
          const childIndex = [...hardBreak.parentNode.childNodes].indexOf(hardBreak);
          const range = document.createRange();
          range.setStart(hardBreak.parentNode, childIndex + 1);
          range.collapse(true);
          const selection = document.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
        });
      } else {
        await setTextSelection(frame, "hard-break", 8);
      }
      await page.keyboard.press(key);

      await expect.poll(() => editor.getAttribute("data-undo-depth")).toBe("1");
      const expected = replaceUniqueBytes(
        source,
        "第一行保留原位。<br>第二行",
        "第一行保留原位。第二行",
      );
      expect((await exportCurrentHtml(page)).equals(expected)).toBe(true);
      expect(await selectionSnapshot(frame, "hard-break")).toMatchObject({
        collapsed: true,
        anchorOffset: 8,
        focusOffset: 8,
        activeCase: "hard-break",
      });

      await page.keyboard.press(keyShortcut("Z"));
      await expect.poll(() => editor.getAttribute("data-undo-depth")).toBe("0");
      expect((await exportCurrentHtml(page)).equals(source)).toBe(true);
    });
  }

  test("controlled contenteditable preserves collapsed layout and owns paste as plain text", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const { editor, frame, source } = await openMatrix(page);
    const caseId = "collapsed-whitespace-copy";
    const target = await activateNativeEdit(frame, caseId);
    await expect(target).toHaveAttribute("contenteditable", "true");
    await expect(editor).toHaveAttribute("data-native-host-mode", "true");

    await setTextSelection(frame, caseId, 0, 4);
    await page.evaluate(() => navigator.clipboard.writeText("<b>只作为文字</b>"));
    await page.keyboard.press(keyShortcut("V"));
    await expect.poll(() => target.textContent()).toContain("<b>只作为文字</b>");
    expect(await target.locator("b").count()).toBe(0);

    await page.waitForTimeout(850);
    const afterPaste = await exportCurrentHtml(page);
    expect(afterPaste.toString("utf8")).toContain("&lt;b>只作为文字&lt;/b>");
    const acceptedHtml = await target.innerHTML();

    await setTextSelection(frame, caseId, 1);
    await target.evaluate((element) => {
      element.ownerDocument.execCommand(
        "insertHTML",
        false,
        '<strong data-browser-structure="true">BAD_STRUCTURE</strong>',
      );
    });
    await expect.poll(() => target.innerHTML()).toBe(acceptedHtml);
    expect((await exportCurrentHtml(page)).equals(afterPaste)).toBe(true);

    await page.keyboard.press(keyShortcut("Z"));
    await expect.poll(() => target.textContent()).not.toContain("<b>只作为文字</b>");
    await expect.poll(async () => (await exportCurrentHtml(page)).equals(source)).toBe(true);
  });

  test("display contents enters through observer guard, accepts delivered input, and rolls back orphan mutation", async ({ page }) => {
    const { editor, frame } = await openMatrix(page);
    const caseId = "display-contents-copy";
    const target = await activateNativeEdit(frame, caseId);
    await expect(editor).toHaveAttribute(
      "data-native-event-delivery-mode",
      "observer-guarded",
    );
    const beforeText = await target.textContent();

    await target.evaluate((element) => {
      const wrapperText = element.querySelector("strong")?.firstChild;
      if (!(wrapperText instanceof Text)) throw new Error("Missing display contents text.");
      wrapperText.data = `ORPHAN_${wrapperText.data}`;
    });
    await expect.poll(() => target.textContent()).toBe(beforeText);

    await installInputRecorder(frame);
    await setTextSelection(frame, caseId, 0);
    await page.keyboard.insertText("安全");
    await expect.poll(() => target.textContent()).toBe(`安全${beforeText}`);
    const events = await recordedInputEvents(frame);
    expect(events.some(({ type }) => type === "beforeinput")).toBe(true);
    expect(events.some(({ type }) => type === "input")).toBe(true);
  });

  test("Chromium IME composition commits one final authored-DOM value", async ({ page }) => {
    const { frame } = await openMatrix(page);
    await activateNativeEdit(frame, "list-item");
    await installInputRecorder(frame);
    await setTextSelection(frame, "list-item", 0, 3);

    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.imeSetComposition", {
      text: "pinyin",
      selectionStart: 6,
      selectionEnd: 6,
    });
    await cdp.send("Input.insertText", { text: "拼音" });

    const text = await frame.locator(caseSelector("list-item")).textContent();
    expect(text).toContain("拼音");
    expect(text).not.toContain("pinyin");
    const events = await recordedInputEvents(frame);
    expect(events.some(({ type }) => type === "compositionstart")).toBe(true);
    expect(events.some(({ type }) => type === "compositionupdate")).toBe(true);
    expect(events.some(({ type }) => type === "compositionend")).toBe(true);
  });

  test("Escape cancels a composition replacement and restores its original selection", async ({ page }) => {
    const { editor, frame, source } = await openMatrix(page);
    const caseId = "heading-inline";
    const target = await activateNativeEdit(frame, caseId);
    const originalHtml = await target.innerHTML();
    const originalText = await target.textContent();
    await installInputRecorder(frame);
    await reverseTextSelection(frame, caseId, 0, 2);
    const originalSelection = await selectionSnapshot(frame, caseId);
    const saveIndicator = page.locator(".save-indicator");
    const originalRevision = await saveIndicator.getAttribute("data-edit-revision");
    const originalRenderedSha = await saveIndicator.getAttribute("data-rendered-sha256");

    const cdp = await page.context().newCDPSession(page);
    try {
      await cdp.send("Input.imeSetComposition", {
        text: "shuru",
        selectionStart: 5,
        selectionEnd: 5,
      });
      await expect(target).toContainText("shuru");
      await cdp.send("Input.imeSetComposition", {
        text: "",
        selectionStart: 0,
        selectionEnd: 0,
      });
    } finally {
      await cdp.detach();
    }

    await expect.poll(() => target.textContent()).toBe(originalText);
    // Wait past the debounced source checkpoint: a transient rollback that is
    // later committed as a deletion is still a failed cancellation.
    await page.waitForTimeout(850);
    await expect(target).toHaveJSProperty("innerHTML", originalHtml);
    expect(await selectionSnapshot(frame, caseId)).toMatchObject({
      collapsed: false,
      anchorOffset: originalSelection.anchorOffset,
      focusOffset: originalSelection.focusOffset,
      direction: originalSelection.direction,
      text: originalSelection.text,
    });
    expect(await nativeEditingState(frame, caseId)).toMatchObject({
      targetIsActive: true,
      contenteditable: "plaintext-only",
    });
    expect(await editor.getAttribute("data-undo-depth")).toBe("0");
    expect(await editor.getAttribute("data-redo-depth")).toBe("0");
    expect(await saveIndicator.getAttribute("data-edit-revision")).toBe(originalRevision);
    expect(await saveIndicator.getAttribute("data-rendered-sha256")).toBe(originalRenderedSha);
    await expect(page.locator(".round-record-counts")).toHaveText(
      "0 条评论 · 0 项直接编辑记录",
    );
    const events = await recordedInputEvents(frame);
    expect(events.filter(({ type, data }) => type === "compositionend" && data === ""))
      .toHaveLength(1);

    // A later ordinary input owns only its new collapsed range. It may append
    // Z, but it cannot inherit or hide the cancelled selection deletion.
    await setTextSelection(frame, caseId, originalText.length);
    await page.keyboard.insertText("Z");
    await expect(target).toHaveText(`${originalText}Z`);
    await expect.poll(() => editor.getAttribute("data-undo-depth")).toBe("1");
    await expect(page.locator(".round-record-counts")).toHaveText(
      "0 条评论 · 1 项直接编辑记录",
    );
    const expected = replaceUniqueBytes(
      source,
      "&nbsp;🙂</h1>",
      "&nbsp;🙂Z</h1>",
    );
    expect((await exportCurrentHtml(page)).equals(expected)).toBe(true);
  });

  test("composition cancellation preserves a preceding uncheckpointed edit", async ({ page }) => {
    const { editor, frame, source } = await openMatrix(page);
    const caseId = "heading-inline";
    const target = await activateNativeEdit(frame, caseId);
    const originalText = await target.textContent();
    await setTextSelection(frame, caseId, originalText.length);
    await page.keyboard.insertText("A");
    await expect(target).toHaveText(`${originalText}A`);
    await reverseTextSelection(frame, caseId, 0, 2);
    const preCompositionSelection = await selectionSnapshot(frame, caseId);

    const cdp = await page.context().newCDPSession(page);
    try {
      await cdp.send("Input.imeSetComposition", {
        text: "draft",
        selectionStart: 5,
        selectionEnd: 5,
      });
      await cdp.send("Input.imeSetComposition", {
        text: "",
        selectionStart: 0,
        selectionEnd: 0,
      });
    } finally {
      await cdp.detach();
    }

    await expect(target).toHaveText(`${originalText}A`);
    expect(await selectionSnapshot(frame, caseId)).toMatchObject({
      anchorOffset: preCompositionSelection.anchorOffset,
      focusOffset: preCompositionSelection.focusOffset,
      direction: preCompositionSelection.direction,
      text: preCompositionSelection.text,
    });
    await expect.poll(() => editor.getAttribute("data-undo-depth")).toBe("1");
    await expect(page.locator(".round-record-counts")).toHaveText(
      "0 条评论 · 1 项直接编辑记录",
    );
    const expected = replaceUniqueBytes(
      source,
      "&nbsp;🙂</h1>",
      "&nbsp;🙂A</h1>",
    );
    expect((await exportCurrentHtml(page)).equals(expected)).toBe(true);
  });

  test("a trailing Escape after empty compositionend does not exit edit mode", async ({ page }) => {
    const { editor, frame, source } = await openMatrix(page);
    const caseId = "heading-inline";
    const target = await activateNativeEdit(frame, caseId);
    const originalText = await target.textContent();
    await reverseTextSelection(frame, caseId, 0, 2);

    const escapePrevented = await target.evaluate((element) => {
      const firstText = element.firstChild;
      if (!(firstText instanceof Text)) throw new Error("Fixture text node is missing.");
      element.dispatchEvent(new CompositionEvent("compositionstart", {
        bubbles: true,
        data: "",
      }));
      firstText.data = `draft${firstText.data.slice(2)}`;
      element.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        data: "draft",
        inputType: "insertCompositionText",
        isComposing: true,
      }));
      element.dispatchEvent(new CompositionEvent("compositionend", {
        bubbles: true,
        data: "",
      }));
      const escape = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Escape",
      });
      element.dispatchEvent(escape);
      return escape.defaultPrevented;
    });

    expect(escapePrevented).toBe(true);
    await page.waitForTimeout(100);
    await expect(target).toHaveText(originalText);
    expect(await nativeEditingState(frame, caseId)).toMatchObject({
      targetIsActive: true,
      contenteditable: "plaintext-only",
    });
    expect(await editor.getAttribute("data-undo-depth")).toBe("0");
    // Once the same-task guard has expired, a new deliberate Escape is a real
    // PageRoot command even though the composition-delivery tombstone remains.
    await target.press("Escape");
    await expect.poll(() => target.getAttribute("contenteditable")).toBeNull();
    expect((await exportCurrentHtml(page)).equals(source)).toBe(true);
  });

  test("an event-driven composition tombstone rejects a delayed empty delivery", async ({ page }) => {
    const { editor, frame, source } = await openMatrix(page);
    const caseId = "heading-inline";
    const target = await activateNativeEdit(frame, caseId);
    const originalText = await target.textContent();
    await reverseTextSelection(frame, caseId, 0, 2);

    await target.evaluate((element) => {
      const firstText = element.firstChild;
      if (!(firstText instanceof Text)) throw new Error("Fixture text node is missing.");
      element.dispatchEvent(new CompositionEvent("compositionstart", {
        bubbles: true,
        data: "",
      }));
      element.dispatchEvent(new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        data: "draft",
        inputType: "insertCompositionText",
        isComposing: true,
      }));
      firstText.data = `draft${firstText.data.slice(2)}`;
      element.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        data: "draft",
        inputType: "insertCompositionText",
        isComposing: true,
      }));
      element.dispatchEvent(new CompositionEvent("compositionend", {
        bubbles: true,
        data: "",
      }));
    });

    // This is deliberately longer than the former 50 ms heuristic. The
    // cancellation epoch remains authoritative until a real new input starts.
    await page.waitForTimeout(120);

    await target.evaluate(async (element) => {
      const restoredText = element.firstChild;
      if (!(restoredText instanceof Text)) throw new Error("Restored text node is missing.");
      element.dispatchEvent(new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: false,
        data: "",
        inputType: "insertCompositionText",
      }));
      restoredText.data = restoredText.data.slice(2);
      // Let MutationObserver deliver before the matching empty input. Both
      // delivery orders belong to the cancelled composition epoch.
      await Promise.resolve();
      element.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        data: null,
        inputType: "insertCompositionText",
      }));
    });

    await page.waitForTimeout(100);
    await expect(target).toHaveText(originalText);
    expect(await editor.getAttribute("data-undo-depth")).toBe("0");
    await setTextSelection(frame, caseId, originalText.length);
    await page.keyboard.insertText("Z");
    await expect.poll(() => editor.getAttribute("data-undo-depth")).toBe("1");
    const expected = replaceUniqueBytes(
      source,
      "&nbsp;🙂</h1>",
      "&nbsp;🙂Z</h1>",
    );
    expect((await exportCurrentHtml(page)).equals(expected)).toBe(true);
  });

  test("same-task focus loss after cancellation keeps the pre-composition dirty edit", async ({ page }) => {
    const { editor, frame, source } = await openMatrix(page);
    const caseId = "heading-inline";
    const target = await activateNativeEdit(frame, caseId);
    const originalText = await target.textContent();
    await setTextSelection(frame, caseId, originalText.length);
    await page.keyboard.insertText("A");
    await reverseTextSelection(frame, caseId, 0, 2);

    await target.evaluate((element) => {
      const firstText = element.firstChild;
      if (!(firstText instanceof Text)) throw new Error("Fixture text node is missing.");
      element.dispatchEvent(new CompositionEvent("compositionstart", {
        bubbles: true,
        data: "",
      }));
      firstText.data = `draft${firstText.data.slice(2)}`;
      element.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        data: "draft",
        inputType: "insertCompositionText",
        isComposing: true,
      }));
      element.dispatchEvent(new CompositionEvent("compositionend", {
        bubbles: true,
        data: "",
      }));
      const outerButton = Array.from(parent.document.querySelectorAll("button"))
        .find((button) => button.textContent?.trim() === "项目文件");
      if (!(outerButton instanceof parent.HTMLButtonElement)) {
        throw new Error("Outer project files button is missing.");
      }
      outerButton.focus();
    });

    await expect.poll(() => target.getAttribute("contenteditable")).toBeNull();
    await expect(target).toHaveText(`${originalText}A`);
    await expect.poll(() => editor.getAttribute("data-undo-depth")).toBe("1");
    await expect(page.locator(".round-record-counts")).toHaveText(
      "0 条评论 · 1 项直接编辑记录",
    );
    const expected = replaceUniqueBytes(
      source,
      "&nbsp;🙂</h1>",
      "&nbsp;🙂A</h1>",
    );
    expect((await exportCurrentHtml(page)).equals(expected)).toBe(true);
  });

  test("same-task focus loss after non-empty composition restores only that composition", async ({ page }) => {
    const { editor, frame, source } = await openMatrix(page);
    const caseId = "heading-inline";
    const target = await activateNativeEdit(frame, caseId);
    const originalText = await target.textContent();
    await setTextSelection(frame, caseId, originalText.length);
    await page.keyboard.insertText("A");
    await reverseTextSelection(frame, caseId, 0, 2);

    await target.evaluate((element) => {
      const firstText = element.firstChild;
      if (!(firstText instanceof Text)) throw new Error("Fixture text node is missing.");
      element.dispatchEvent(new CompositionEvent("compositionstart", {
        bubbles: true,
        data: "",
      }));
      firstText.data = `确认${firstText.data.slice(2)}`;
      element.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        data: "确认",
        inputType: "insertCompositionText",
        isComposing: true,
      }));
      element.dispatchEvent(new CompositionEvent("compositionend", {
        bubbles: true,
        data: "确认",
      }));
      const outerButton = Array.from(parent.document.querySelectorAll("button"))
        .find((button) => button.textContent?.trim() === "项目文件");
      if (!(outerButton instanceof parent.HTMLButtonElement)) {
        throw new Error("Outer project files button is missing.");
      }
      outerButton.focus();
    });

    await expect.poll(() => target.getAttribute("contenteditable")).toBeNull();
    await expect(target).toHaveText(`${originalText}A`);
    await expect.poll(() => editor.getAttribute("data-undo-depth")).toBe("1");
    await expect(page.locator(".round-record-counts")).toHaveText(
      "0 条评论 · 1 项直接编辑记录",
    );
    const expected = replaceUniqueBytes(
      source,
      "&nbsp;🙂</h1>",
      "&nbsp;🙂A</h1>",
    );
    expect((await exportCurrentHtml(page)).equals(expected)).toBe(true);
  });

  test("toolbar pointer interaction cannot commit an intermediate IME draft", async ({ page }) => {
    const { editor, frame, source } = await openMatrix(page);
    await activateNativeEdit(frame, "heading-inline");
    await installInputRecorder(frame);
    const recorderIframe = await frame.frameElement();
    const initialDocument = await documentToken(frame);
    await setTextSelection(frame, "heading-inline", 0, 2);

    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.imeSetComposition", {
      text: "gongju",
      selectionStart: 6,
      selectionEnd: 6,
    });
    await expect(frame.locator(caseSelector("heading-inline"))).toContainText("gongju");

    // Click the toolbar padding, not a command. The toolbar is outside the
    // authored iframe, so an uncancelled pointer default would blur the edit
    // host and make macOS/Chromium expose this pinyin as committed text.
    const toolbar = page.getByRole("toolbar", { name: /编辑/ });
    await toolbar.click({ position: { x: 2, y: 2 } });
    const commentButton = toolbar.getByRole("button", { name: /留评论/ });
    await expect(commentButton).toBeEnabled();
    await commentButton.click();
    await expect(page.getByRole("region", { name: "添加评论" })).toHaveCount(0);

    expect(await nativeEditingState(frame, "heading-inline")).toMatchObject({
      targetIsActive: true,
      contenteditable: "plaintext-only",
    });
    let events = await recordedInputEventsFromIframe(recorderIframe);
    expect(events.filter(({ type }) => type === "compositionend")).toHaveLength(0);
    expect(await editor.getAttribute("data-undo-depth")).toBe("0");
    expect(await editor.getAttribute("data-redo-depth")).toBe("0");

    await cdp.send("Input.insertText", { text: "工具" });
    await expect(frame.locator(caseSelector("heading-inline"))).toContainText("工具");
    await expect.poll(() => editor.getAttribute("data-undo-depth")).toBe("1");
    await expect.poll(() => documentToken(frame)).not.toBe(initialDocument);

    events = await recordedInputEventsFromIframe(recorderIframe);
    expect(events.filter(({ type }) => type === "compositionend")).toHaveLength(1);
    await expect(page.getByRole("region", { name: "添加评论" })).toHaveCount(1);
    const exported = await exportCurrentHtml(page);
    expect(exported.equals(replaceUniqueBytes(
      source,
      ">真实 <strong>",
      ">工具 <strong>",
    ))).toBe(true);
    expect(exported.includes(Buffer.from("gongju", "utf8"))).toBe(false);
  });

  test("outer PageRoot pointer actions stay inert until IME composition finishes", async ({ page }) => {
    const { editor, frame, source } = await openMatrix(page);
    await activateNativeEdit(frame, "heading-inline");
    await installInputRecorder(frame);
    const recorderIframe = await frame.frameElement();
    await setTextSelection(frame, "heading-inline", 0, 2);
    const saveIndicator = page.locator(".save-indicator");
    const initialRevision = await saveIndicator.getAttribute("data-edit-revision");
    const initialRenderedSha = await saveIndicator.getAttribute("data-rendered-sha256");

    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.imeSetComposition", {
      text: "xiangmu",
      selectionStart: 7,
      selectionEnd: 7,
    });
    await expect(frame.locator(caseSelector("heading-inline"))).toContainText("xiangmu");

    // This button belongs to PageRoot's parent document. Its complete pointer
    // gesture must be inert while the iframe still owns an unconfirmed IME
    // candidate; checking only click-time is too late on macOS/Chromium.
    await page.getByRole("button", { name: "项目文件", exact: true }).click();

    await expect(page.locator("aside.side-drawer")).not.toHaveClass(/\bopen\b/u);
    expect(await nativeEditingState(frame, "heading-inline")).toMatchObject({
      targetIsActive: true,
      contenteditable: "plaintext-only",
    });
    let events = await recordedInputEventsFromIframe(recorderIframe);
    expect(events.filter(({ type }) => type === "compositionend")).toHaveLength(0);
    expect(await editor.getAttribute("data-undo-depth")).toBe("0");
    expect(await editor.getAttribute("data-redo-depth")).toBe("0");
    expect(await saveIndicator.getAttribute("data-edit-revision")).toBe(initialRevision);
    expect(await saveIndicator.getAttribute("data-rendered-sha256")).toBe(initialRenderedSha);
    await expect(page.locator(".round-record-counts")).toHaveText(
      "0 条评论 · 0 项直接编辑记录",
    );

    await cdp.send("Input.insertText", { text: "项目" });
    await expect(frame.locator(caseSelector("heading-inline"))).toContainText("项目");
    await expect.poll(() => editor.getAttribute("data-undo-depth")).toBe("1");
    await expect(page.locator(".round-record-counts")).toHaveText(
      "0 条评论 · 1 项直接编辑记录",
    );
    await expect(page.locator("aside.side-drawer")).toHaveClass(/\bopen\b/u);

    events = await recordedInputEventsFromIframe(recorderIframe);
    expect(events.filter(({ type }) => type === "compositionend")).toHaveLength(1);
    await page
      .getByRole("complementary", { name: "项目文件" })
      .getByRole("button", { name: "关闭", exact: true })
      .click();
    await expect(page.locator("aside.side-drawer")).not.toHaveClass(/\bopen\b/u);
    const exported = await exportCurrentHtml(page);
    expect(exported.equals(replaceUniqueBytes(
      source,
      ">真实 <strong>",
      ">项目 <strong>",
    ))).toBe(true);
    expect(exported.includes(Buffer.from("xiangmu", "utf8"))).toBe(false);
  });

  test("focus loss during an unconfirmed composition rolls back without a patch", async ({ page }) => {
    const { editor, frame, source } = await openMatrix(page);
    const target = await activateNativeEdit(frame, "heading-inline");
    await setTextSelection(frame, "heading-inline", 0, 2);
    const initialText = await target.textContent();
    const saveIndicator = page.locator(".save-indicator");
    const initialRenderedSha = await saveIndicator.getAttribute("data-rendered-sha256");
    const initialRevision = await saveIndicator.getAttribute("data-edit-revision");

    // Keep compositionend and focusout in the same browser task. This models
    // the forced ordering Chromium uses when script or browser chrome moves
    // focus without a cancellable PageRoot pointer gesture.
    await target.evaluate((element) => {
      const firstText = element.firstChild;
      if (!(firstText instanceof Text)) throw new Error("Fixture text node is missing.");
      element.dispatchEvent(new CompositionEvent("compositionstart", {
        bubbles: true,
        data: "真实",
      }));
      firstText.data = firstText.data.replace(/^真实/u, "blurraw");
      element.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        data: "blurraw",
        inputType: "insertCompositionText",
        isComposing: true,
      }));
      element.dispatchEvent(new CompositionEvent("compositionend", {
        bubbles: true,
        data: "blurraw",
      }));
      const outerButton = Array.from(parent.document.querySelectorAll("button"))
        .find((button) => button.textContent?.trim() === "项目文件");
      if (!(outerButton instanceof parent.HTMLButtonElement)) {
        throw new Error("Outer project files button is missing.");
      }
      outerButton.focus();
    });
    await expect.poll(() => target.getAttribute("contenteditable")).toBeNull();

    expect(await target.textContent()).toBe(initialText);
    expect((await exportCurrentHtml(page)).equals(source)).toBe(true);
    expect(await editor.getAttribute("data-undo-depth")).toBe("0");
    expect(await editor.getAttribute("data-redo-depth")).toBe("0");
    expect(await saveIndicator.getAttribute("data-edit-revision")).toBe(initialRevision);
    expect(await saveIndicator.getAttribute("data-rendered-sha256")).toBe(initialRenderedSha);
    await expect(page.locator(".round-record-counts")).toHaveText(
      "0 条评论 · 0 项直接编辑记录",
    );
  });

  test("window blur without compositionend cannot strand the edit session", async ({ page }) => {
    const { editor, frame } = await openMatrix(page);
    const target = await activateNativeEdit(frame, "heading-inline");
    await setTextSelection(frame, "heading-inline", 0, 2);
    const initialText = await target.textContent();
    const saveIndicator = page.locator(".save-indicator");
    const initialRenderedSha = await saveIndicator.getAttribute("data-rendered-sha256");

    await target.evaluate((element) => {
      const firstText = element.firstChild;
      if (!(firstText instanceof Text)) throw new Error("Fixture text node is missing.");
      element.dispatchEvent(new CompositionEvent("compositionstart", {
        bubbles: true,
        data: "真实",
      }));
      firstText.data = firstText.data.replace(/^真实/u, "strandedraw");
      element.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        data: "strandedraw",
        inputType: "insertCompositionText",
        isComposing: true,
      }));
      window.dispatchEvent(new Event("blur"));
    });

    expect(await target.textContent()).toBe(initialText);
    expect(await target.getAttribute("contenteditable")).toBe("plaintext-only");
    expect(await editor.getAttribute("data-undo-depth")).toBe("0");
    expect(await editor.getAttribute("data-redo-depth")).toBe("0");
    expect(await saveIndicator.getAttribute("data-rendered-sha256")).toBe(initialRenderedSha);

    // The fail-closed window blur explicitly leaves composing state. A later
    // ordinary PageRoot click must therefore follow the established contract:
    // finish the clean session and execute its business action.
    await page.getByRole("button", { name: "项目文件", exact: true }).click();
    await expect(page.locator("aside.side-drawer")).toHaveClass(/\bopen\b/u);
    await expect.poll(() => target.getAttribute("contenteditable")).toBeNull();
    expect(await editor.getAttribute("data-undo-depth")).toBe("0");
    expect(await editor.getAttribute("data-redo-depth")).toBe("0");
    expect(await saveIndicator.getAttribute("data-rendered-sha256")).toBe(initialRenderedSha);
  });

  test("toolbar style restart preserves the native selection and accepts the next safe edit", async ({ page }) => {
    const { editor, frame } = await openMatrix(page);
    const target = await activateNativeEdit(frame, "heading-inline");
    const originalText = await target.textContent();
    await setTextSelection(frame, "heading-inline", 3, 9);
    const before = await selectionSnapshot(frame, "heading-inline");
    expect(before.collapsed).toBe(false);

    await page.getByRole("button", { name: "加粗", exact: true }).click();
    await expect.poll(() => editor.getAttribute("data-undo-depth")).toBe("1");

    const after = await selectionSnapshot(frame, "heading-inline");
    expect(after.text).toBe(before.text);
    expect(await nativeEditingState(frame, "heading-inline")).toMatchObject({
      contenteditable: "plaintext-only",
      legacySurfaceCount: 0,
    });

    // The restored cross-format Selection is verified above. Continue from a
    // single-format caret so this release gate proves the restarted session is
    // live without silently broadening the browser formatting-carrier trust
    // boundary (the mixed-format replacement is covered by the fail-closed
    // regression below and recorded as LT-001).
    await setTextSelection(frame, "heading-inline", originalText.length);
    await page.keyboard.insertText("尾");
    await expect.poll(() => editor.getAttribute("data-undo-depth")).toBe("2");
    const expectedText = `${originalText}尾`;
    await expect(target).toHaveText(expectedText);
    const forwardBytes = await exportCurrentHtml(page);
    expect(forwardBytes.includes(Buffer.from("尾", "utf8"))).toBe(true);
    await expect.poll(() => nativeEditingState(frame, "heading-inline")).toMatchObject({
      targetIsActive: true,
      contenteditable: "plaintext-only",
    });

    await page.keyboard.press(keyShortcut("Z"));
    await expect.poll(() => editor.getAttribute("data-undo-depth")).toBe("1");
    await page.keyboard.press(`${process.platform === "darwin" ? "Meta" : "Control"}+Shift+Z`);
    await expect.poll(() => editor.getAttribute("data-undo-depth")).toBe("2");
    await expect.poll(() => nativeEditingState(frame, "heading-inline")).toMatchObject({
      targetIsActive: true,
      contenteditable: "plaintext-only",
    });
    expect((await exportCurrentHtml(page)).equals(forwardBytes)).toBe(true);
  });

  for (const {
    shortcut,
    property,
    value,
  } of [
    { shortcut: "B", property: "font-weight", value: "700" },
    { shortcut: "I", property: "font-style", value: "italic" },
    { shortcut: "U", property: "text-decoration-line", value: "underline" },
  ]) {
    test(`${keyShortcut(shortcut)} formats the selected source range without browser tags`, async ({ page }) => {
      const { editor, frame, source } = await openMatrix(page);
      const caseId = "list-item";
      await activateNativeEdit(frame, caseId);
      await setTextSelection(frame, caseId, 0, 3);
      await page.keyboard.press(keyShortcut(shortcut));

      await expect.poll(() => editor.getAttribute("data-undo-depth")).toBe("1");
      expect(await selectionSnapshot(frame, caseId)).toMatchObject({
        text: "列表项",
        collapsed: false,
        activeCase: caseId,
      });
      const target = frame.locator(caseSelector(caseId));
      expect(await target.locator("b, i, u").count()).toBe(0);
      const exported = (await exportCurrentHtml(page)).toString("utf8");
      expect(exported).toContain(
        `<span style="all: unset; display: inline !important; ${property}: ${value}">列表项</span>`,
      );

      await page.keyboard.press(keyShortcut("Z"));
      await expect.poll(() => editor.getAttribute("data-undo-depth")).toBe("0");
      expect((await exportCurrentHtml(page)).equals(source)).toBe(true);
    });
  }

  test("a mixed-format replacement after toolbar restart fails closed without corrupting source history", async ({ page }) => {
    const { editor, frame, source } = await openMatrix(page);
    const caseId = "heading-inline";
    const target = await activateNativeEdit(frame, caseId);
    const originalText = await target.textContent();
    const saveIndicator = page.locator(".save-indicator");

    await setTextSelection(frame, caseId, 3, 9);
    await page.getByRole("button", { name: "加粗", exact: true }).click();
    await expect.poll(() => editor.getAttribute("data-undo-depth")).toBe("1");
    const styledRevision = await saveIndicator.getAttribute("data-edit-revision");
    const styledSha = await saveIndicator.getAttribute("data-rendered-sha256");

    await page.keyboard.insertText("替代");
    await expect(target).toHaveText(originalText);
    await expect.poll(() => editor.getAttribute("data-undo-depth")).toBe("1");
    expect(await editor.getAttribute("data-redo-depth")).toBe("0");
    expect(await saveIndicator.getAttribute("data-edit-revision")).toBe(styledRevision);
    expect(await saveIndicator.getAttribute("data-rendered-sha256")).toBe(styledSha);
    const rollbackNotice = page.locator('[role="status"]').filter({
      hasText: /已恢复输入前的文字|没有完整确认/u,
    }).first();
    await expect(rollbackNotice).toBeVisible();

    const exported = await exportCurrentHtml(page);
    expect(exported.includes(Buffer.from("替代", "utf8"))).toBe(false);
    expect(exported.equals(source)).toBe(false);
  });

  test("Escape and an explicit outside interaction end the edit session", async ({ page }) => {
    const { frame } = await openMatrix(page);
    await activateNativeEdit(frame, "heading-inline");
    await page.keyboard.press("Escape");
    await expect.poll(() => frame.locator(caseSelector("heading-inline")).getAttribute("contenteditable"))
      .toBeNull();

    await activateNativeEdit(frame, "heading-inline");
    await page.getByRole("button", { name: "项目文件", exact: true }).click();
    await expect.poll(() => frame.locator(caseSelector("heading-inline")).getAttribute("contenteditable"))
      .toBeNull();
  });
});

test.describe("fallback capability contract", () => {
  test("real double-clicks on iframe and canvas surfaces never edit nearby text", async ({ page }) => {
    const { editor, iframe, frame } = await openMatrix(page);
    for (const id of ["canvas-surface", "nested-iframe"]) {
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      const media = frame.locator(caseSelector(id));
      await media.scrollIntoViewIfNeeded();
      const frameBox = await iframe.boundingBox();
      const mediaRect = await media.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      });
      if (!frameBox) throw new Error("The PageRoot editing iframe has no visible box.");
      await page.mouse.dblclick(
        frameBox.x + mediaRect.x + mediaRect.width / 2,
        frameBox.y + mediaRect.y + mediaRect.height / 2,
      );
      expect(await frame.locator('[contenteditable="plaintext-only"]').count(), id).toBe(0);
      expect(await frame.evaluate(() => document.getSelection()?.toString() || ""), id).toBe("");
      await expect.poll(() => editor.getAttribute("data-native-start-status"), {
        message: `${id} must stop at the direct text hit gate`,
      }).toBe("direct-text-hit-required");
    }
  });

  for (const contractCase of fallbackCases) {
    test(`${contractCase.id} fails closed as ${contractCase.mode}`, async ({ page }) => {
      const { frame } = await openMatrix(page);
      const target = frame.locator(caseSelector(contractCase.id));
      const beforeText = await target.textContent();

      await attemptFallbackDoubleClick(frame, contractCase.id);

      const state = await target.evaluate((element) => ({
        selfEditable: Boolean(element.isContentEditable),
        authoredEditableCount: document.querySelectorAll("[data-html-canvas-native-editing]").length,
        legacySurfaceCount: document.querySelectorAll("[data-html-canvas-text-flow-surface]").length,
        selectedText: document.getSelection()?.toString() || "",
      }));
      expect(state.selfEditable).toBe(false);
      expect(state.authoredEditableCount).toBe(0);
      expect(state.legacySurfaceCount).toBe(0);

      await page.keyboard.insertText("SHOULD_NOT_EDIT");
      expect(await target.textContent()).toBe(beforeText);
      await expect(page.getByRole("button", { name: /留评论|评论/ }).first()).toBeVisible();
      if (contractCase.mode === "select-comment" && beforeText.trim()) {
        expect(state.selectedText.trim().length).toBeGreaterThan(0);
      }
    });
  }

  test("unsupported direct editing explains the comment path without source jargon", async ({ page }) => {
    const { frame } = await openMatrix(page);
    await frame.locator(caseSelector("unsafe-contenteditable-css")).dblclick();

    const notice = page.locator('[role="status"], [role="alert"]').filter({
      hasText: /复杂|暂不支持|评论/,
    }).first();
    await expect(notice).toBeVisible();
    await expect(notice).toContainText(/评论/);
    await expect(notice).not.toContainText(/SourcePatch|source range|原 HTML 没有变化|源码映射/i);
  });

  test("all fallback attempts leave the exported source byte-identical", async ({ page }) => {
    const { frame, source } = await openMatrix(page);
    for (const contractCase of fallbackCases) {
      // This is a source-integrity oracle, not a repeated pointer-actionability
      // test. DOM dispatch also avoids an already-open toolbar covering the
      // next matrix cell while preserving the exact capability handler path.
      await attemptFallbackDoubleClick(frame, contractCase.id, { dispatch: true });
      await page.keyboard.insertText("SHOULD_NOT_EDIT");
    }
    const exported = await exportCurrentHtml(page);
    expect(exported.equals(source)).toBe(true);
  });
});
