import { expect, test } from "@playwright/test";

import {
  doubleClickRenderedText,
  exportCurrentHtml,
  loadFixture,
  waitForFramePaint,
} from "./pageroot-driver.mjs";

const source = Buffer.from(`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <style>body { font: 20px/1.6 sans-serif; padding: 40px; }</style>
</head>
<body>
  <p data-native-case="exact-boundaries"><em><strong>A</strong></em>B</p>
  <p data-native-case="inline-interior"><em><strong>AB</strong></em>C</p>
  <p data-native-case="empty-wrapper">A<em><strong></strong></em>B</p>
</body>
</html>
`, "utf8");

const boundaryPoints = [
  "a-text-start",
  "a-text-end",
  "strong-start",
  "strong-end",
  "em-start",
  "em-end",
  "root-start",
  "root-after-em",
  "b-text-start",
];

async function openFixture(page) {
  await page.goto("/");
  return loadFixture(page, "source-fidelity.html", { buffer: source });
}

async function attemptDirectEdit(frame, id) {
  return doubleClickRenderedText(frame, id);
}

async function setExactBoundaryPoint(target, point) {
  await target.evaluate((element, placement) => {
    const emphasis = element.querySelector("em");
    const strong = emphasis?.querySelector("strong");
    const aText = strong?.firstChild;
    const bText = element.lastChild;
    if (
      !emphasis
      || !strong
      || !(aText instanceof Text)
      || !(bText instanceof Text)
    ) throw new Error("Exact inline-boundary fixture is incomplete.");

    const positions = {
      "a-text-start": [aText, 0],
      "a-text-end": [aText, aText.data.length],
      "strong-start": [strong, 0],
      "strong-end": [strong, strong.childNodes.length],
      "em-start": [emphasis, 0],
      "em-end": [emphasis, emphasis.childNodes.length],
      "root-start": [element, 0],
      "root-after-em": [element, 1],
      "b-text-start": [bText, 0],
    };
    const position = positions[placement];
    if (!position) throw new Error(`Unknown inline-boundary point: ${placement}`);

    element.focus({ preventScroll: true });
    const range = document.createRange();
    range.setStart(position[0], position[1]);
    range.collapse(true);
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, point);
}

async function authoredInnerHtml(target) {
  return target.evaluate((element) => {
    const clone = element.cloneNode(true);
    if (!(clone instanceof HTMLElement)) throw new Error("Expected an HTML element clone.");
    clone.querySelectorAll("[data-html-ai-source-node-id]").forEach((node) => {
      node.removeAttribute("data-html-ai-source-node-id");
    });
    return clone.innerHTML;
  });
}

async function installHandledInputRecorder(frame) {
  const iframe = await frame.frameElement();
  await iframe.evaluate((frameElement) => {
    frameElement.__PAGEROOT_BOUNDARY_HANDLED_INPUT_EVENTS__ = [];
    for (const type of ["beforeinput", "input"]) {
      frameElement.contentDocument.addEventListener(type, (event) => {
        frameElement.__PAGEROOT_BOUNDARY_HANDLED_INPUT_EVENTS__.push({
          type: event.type,
          inputType: event.inputType || null,
          defaultPrevented: event.defaultPrevented,
        });
      });
    }
  });
}

async function handledInputEvents(frame) {
  const iframe = await frame.frameElement();
  return iframe.evaluate(
    (frameElement) => frameElement.__PAGEROOT_BOUNDARY_HANDLED_INPUT_EVENTS__ || [],
  );
}

test("every exact collapsed DOM point at A/inline/B boundaries is blocked", async ({ page }) => {
  const { frame } = await openFixture(page);
  const target = await attemptDirectEdit(frame, "exact-boundaries");
  await expect(target).toHaveAttribute("contenteditable", "plaintext-only");
  // A document bubble listener runs after NativeEditingController's target
  // listener and therefore observes the final preventDefault state, unlike
  // the shared document capture recorder.
  await installHandledInputRecorder(frame);

  for (const point of boundaryPoints) {
    await test.step(point, async () => {
      const eventCount = (await handledInputEvents(frame)).length;
      await setExactBoundaryPoint(target, point);
      await page.keyboard.insertText("X");

      const events = (await handledInputEvents(frame)).slice(eventCount);
      const beforeInput = events.find((event) => event.type === "beforeinput");
      expect(beforeInput).toMatchObject({
        inputType: "insertText",
        defaultPrevented: true,
      });
      expect(events.some((event) => event.type === "input")).toBe(false);
      expect(await authoredInnerHtml(target)).toBe("<em><strong>A</strong></em>B");
    });
  }

  expect((await exportCurrentHtml(page)).equals(source)).toBe(true);
});

test("a non-collapsed replacement at the same wrapper endpoints remains native", async ({ page }) => {
  const { editor, frame } = await openFixture(page);
  const target = await attemptDirectEdit(frame, "exact-boundaries");
  await expect(target).toHaveAttribute("contenteditable", "plaintext-only");
  await target.evaluate((element) => {
    const text = element.querySelector("strong")?.firstChild;
    if (!(text instanceof Text)) throw new Error("Inline replacement text is missing.");
    element.focus({ preventScroll: true });
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, text.data.length);
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });

  await page.keyboard.insertText("X");

  await expect(target).toHaveText("XB");
  expect(await authoredInnerHtml(target)).toBe("<em><strong>X</strong></em>B");
  expect(await editor.getAttribute("data-edit-block-detail")).toBeNull();
  const expected = Buffer.from(source.toString("utf8").replace(
    "<strong>A</strong>",
    "<strong>X</strong>",
  ), "utf8");
  expect((await exportCurrentHtml(page)).equals(expected)).toBe(true);
});

test("a strict text-node interior offset remains a native source-exact edit", async ({ page }) => {
  const { frame } = await openFixture(page);
  const target = await attemptDirectEdit(frame, "inline-interior");
  await expect(target).toHaveAttribute("contenteditable", "plaintext-only");
  await target.evaluate((element) => {
    const text = element.querySelector("strong")?.firstChild;
    if (!(text instanceof Text)) throw new Error("Inline interior text is missing.");
    element.focus({ preventScroll: true });
    const range = document.createRange();
    range.setStart(text, 1);
    range.collapse(true);
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });

  await page.keyboard.insertText("X");

  await expect(target).toHaveText("AXBC");
  expect(await authoredInnerHtml(target)).toBe("<em><strong>AXB</strong></em>C");
  const expected = Buffer.from(source.toString("utf8").replace(
    "<strong>AB</strong>",
    "<strong>AXB</strong>",
  ), "utf8");
  expect((await exportCurrentHtml(page)).equals(expected)).toBe(true);
});

test("an empty transparent wrapper rejects the whole direct-edit island", async ({ page }) => {
  const { frame } = await openFixture(page);
  const target = await attemptDirectEdit(frame, "empty-wrapper");

  await expect(page.locator('[role="status"], [role="alert"]').filter({
    hasText: /空的排版元素/,
  }).first()).toBeVisible();
  expect(await target.getAttribute("contenteditable")).toBeNull();
  expect(await target.evaluate((element) => element.isContentEditable)).toBe(false);
  expect(await authoredInnerHtml(target)).toBe("A<em><strong></strong></em>B");

  await page.keyboard.insertText("不应写入");

  expect(await target.textContent()).toBe("AB");
  expect((await exportCurrentHtml(page)).equals(source)).toBe(true);
});

test("the first IME beforeinput cancels the boundary epoch and restores hostile late tails", async ({ page }) => {
  const { frame } = await openFixture(page);
  const target = await attemptDirectEdit(frame, "exact-boundaries");
  await expect(target).toHaveAttribute("contenteditable", "plaintext-only");
  await setExactBoundaryPoint(target, "b-text-start");
  await installHandledInputRecorder(frame);

  const result = await target.evaluate((element) => {
    const strongText = element.querySelector("strong")?.firstChild;
    const trailingText = element.lastChild;
    if (!(strongText instanceof Text) || !(trailingText instanceof Text)) {
      throw new Error("Exact inline-boundary text nodes are missing.");
    }

    element.dispatchEvent(new CompositionEvent("compositionstart", {
      bubbles: true,
      data: "",
    }));
    const firstBeforeInputAccepted = element.dispatchEvent(new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      data: "你",
      inputType: "insertCompositionText",
      isComposing: true,
    }));

    // Synthetic beforeinput never performs the browser's default mutation.
    // Reproduce a hostile platform tail explicitly: Chromium caret gravity may
    // append the marked text to A even though Selection was at B@0.
    strongText.data = "A你";
    element.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      data: "你",
      inputType: "insertCompositionText",
      isComposing: true,
    }));
    const htmlAfterCompositionTail = element.innerHTML;

    element.dispatchEvent(new CompositionEvent("compositionend", {
      bubbles: true,
      data: "你",
    }));
    const terminalBeforeInputAccepted = element.dispatchEvent(new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      data: "你",
      inputType: "insertText",
      isComposing: false,
    }));
    const terminalTrailingText = element.lastChild;
    if (!(terminalTrailingText instanceof Text)) {
      throw new Error("Restored terminal text node is missing.");
    }
    terminalTrailingText.data = "你B";
    element.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      data: "你",
      inputType: "insertText",
      isComposing: false,
    }));
    const htmlAfterTerminalTail = element.innerHTML;

    return {
      firstBeforeInputAccepted,
      terminalBeforeInputAccepted,
      htmlAfterCompositionTail,
      htmlAfterTerminalTail,
    };
  });
  await waitForFramePaint(frame);
  // Cross the normal source-checkpoint window so a blocked late tail cannot
  // pass merely because the assertion raced a deferred commit.
  await page.waitForTimeout(850);

  expect(result).toMatchObject({
    firstBeforeInputAccepted: false,
    terminalBeforeInputAccepted: false,
  });
  expect(result.htmlAfterCompositionTail).not.toContain("你");
  expect(result.htmlAfterTerminalTail).not.toContain("你");
  expect(await authoredInnerHtml(target)).toBe("<em><strong>A</strong></em>B");

  const preventedBeforeInputs = (await handledInputEvents(frame)).filter(
    (event) => event.type === "beforeinput" && event.defaultPrevented,
  );
  expect(preventedBeforeInputs).toHaveLength(2);
  expect(preventedBeforeInputs.map((event) => event.inputType)).toEqual([
    "insertCompositionText",
    "insertText",
  ]);
  await expect(page.locator(".round-record-counts")).toHaveText(
    "0 条评论 · 0 项直接编辑记录",
  );
  expect((await exportCurrentHtml(page)).equals(source)).toBe(true);
});
