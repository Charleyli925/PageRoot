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
  <style>
    body { font: 20px/1.6 sans-serif; padding: 40px; }
    .button { display: inline-flex; align-items: center; gap: 0.4rem; }
  </style>
</head>
<body>
  <p data-native-case="exact-boundaries"><em><strong>A</strong></em>B</p>
  <p data-native-case="inline-interior"><em><strong>AB</strong></em>C</p>
  <p data-native-case="empty-wrapper">A<em><strong></strong></em>B</p>
  <p data-native-case="visible-start">
    <em>Start</em>
  </p>
  <p data-native-case="visible-end">
    <strong>End</strong>
  </p>
  <a class="button" href="#target" data-native-case="text-before-icon">开始浏览 <span aria-hidden="true">↓</span></a>
  <p data-native-case="plain-visible-end">
    Paragraph end
  </p>
  <h2 data-native-case="heading-before-inline">标题 <small>说明</small></h2>
  <p data-native-case="paragraph-before-inline">正文 <em>强调</em></p>
  <ul><li data-native-case="list-before-inline">列表 <span>状态</span></li></ul>
  <details><summary data-native-case="summary-before-inline">摘要 <span>详情</span></summary></details>
  <table><tbody><tr><td data-native-case="cell-before-inline">单元格 <span>状态</span></td></tr></tbody></table>
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

test("every exact collapsed DOM point at A/inline/B boundaries inserts with deterministic affinity", async ({ page }) => {
  const expectedInnerHtml = {
    "a-text-start": "<em><strong>XA</strong></em>B",
    "a-text-end": "<em><strong>AX</strong></em>B",
    "strong-start": "<em><strong>XA</strong></em>B",
    "strong-end": "<em><strong>AX</strong></em>B",
    "em-start": "<em><strong>XA</strong></em>B",
    "em-end": "<em><strong>AX</strong></em>B",
    "root-start": "<em><strong>XA</strong></em>B",
    "root-after-em": "<em><strong>AX</strong></em>B",
    "b-text-start": "<em><strong>AX</strong></em>B",
  };
  for (const point of boundaryPoints) {
    await test.step(point, async () => {
      const { frame } = await openFixture(page);
      const target = await attemptDirectEdit(frame, "exact-boundaries");
      await expect(target).toHaveAttribute("contenteditable", "true");
      // A document bubble listener confirms V2 owns the mutation after
      // normalizing the collapsed caret to its deterministic source side.
      await installHandledInputRecorder(frame);
      await setExactBoundaryPoint(target, point);
      await page.keyboard.insertText("X");

      const events = await handledInputEvents(frame);
      const beforeInput = events.find((event) => event.type === "beforeinput");
      expect(beforeInput).toMatchObject({
        inputType: "insertText",
        defaultPrevented: true,
      });
      expect(events.some((event) => event.type === "input")).toBe(false);
      expect(await authoredInnerHtml(target)).toBe(expectedInnerHtml[point]);
      await page.waitForTimeout(900);
      const afterCheckpoint = await authoredInnerHtml(target);
      const diagnostics = await page.getByTestId("html-canvas-editor").evaluate(
        (element) => ({
          detail: element.getAttribute("data-edit-block-detail"),
        }),
      );
      expect({ afterCheckpoint, diagnostics }).toEqual({
        afterCheckpoint: expectedInnerHtml[point],
        diagnostics: { detail: null },
      });
    });
  }
});

test("a non-collapsed replacement at the same wrapper endpoints remains native", async ({ page }) => {
  const { editor, frame } = await openFixture(page);
  const target = await attemptDirectEdit(frame, "exact-boundaries");
  await expect(target).toHaveAttribute("contenteditable", "true");
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
  expect((await exportCurrentHtml(page)).toString("utf8")).toBe(
    expected.toString("utf8"),
  );
});

test("a strict text-node interior offset remains a native source-exact edit", async ({ page }) => {
  const { frame } = await openFixture(page);
  const target = await attemptDirectEdit(frame, "inline-interior");
  await expect(target).toHaveAttribute("contenteditable", "true");
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

test("visible paragraph start and end preserve authored indentation while accepting text", async ({ page }) => {
  const { frame } = await openFixture(page);
  const startTarget = await attemptDirectEdit(frame, "visible-start");
  await startTarget.evaluate((element) => {
    const text = element.querySelector("em")?.firstChild;
    if (!(text instanceof Text)) throw new Error("Visible-start text is missing.");
    const range = document.createRange();
    range.setStart(text, 0);
    range.collapse(true);
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await page.keyboard.insertText("首");
  await expect(startTarget).toContainText("首Start");

  const endTarget = await attemptDirectEdit(frame, "visible-end");
  await endTarget.evaluate((element) => {
    const text = element.querySelector("strong")?.firstChild;
    if (!(text instanceof Text)) throw new Error("Visible-end text is missing.");
    const range = document.createRange();
    range.setStart(text, text.data.length);
    range.collapse(true);
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await page.keyboard.insertText("尾");
  await expect(endTarget).toContainText("End尾");

  const expected = Buffer.from(source.toString("utf8")
    .replace("<em>Start</em>", "<em>首Start</em>")
    .replace("<strong>End</strong>", "<strong>End尾</strong>"), "utf8");
  expect((await exportCurrentHtml(page)).toString("utf8")).toBe(
    expected.toString("utf8"),
  );
});

test("a visual text end before collapsed whitespace and an inline icon accepts text", async ({ page }) => {
  const { frame } = await openFixture(page);
  const target = await attemptDirectEdit(frame, "text-before-icon");
  await expect(target).toHaveAttribute(
    "contenteditable",
    /^(?:plaintext-only|true)$/u,
  );
  await installHandledInputRecorder(frame);
  await target.evaluate((element) => {
    const text = element.firstChild;
    if (!(text instanceof Text)) throw new Error("Button label text is missing.");
    const visibleEnd = text.data.indexOf(" ");
    if (visibleEnd <= 0) throw new Error("Button label has no collapsed gap before its icon.");
    element.focus({ preventScroll: true });
    const range = document.createRange();
    range.setStart(text, visibleEnd);
    range.collapse(true);
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });

  await page.keyboard.insertText("X");

  const beforeInput = (await handledInputEvents(frame)).find(
    (event) => event.type === "beforeinput",
  );
  expect(beforeInput).toMatchObject({
    inputType: "insertText",
    defaultPrevented: true,
  });
  expect(await authoredInnerHtml(target)).toBe(
    '开始浏览X <span aria-hidden="true">↓</span>',
  );
  await page.waitForTimeout(900);
  expect(await authoredInnerHtml(target)).toBe(
    '开始浏览X <span aria-hidden="true">↓</span>',
  );
  expect(await page.getByTestId("html-canvas-editor").getAttribute(
    "data-edit-block-detail",
  )).toBeNull();
  const expected = Buffer.from(source.toString("utf8").replace(
    '开始浏览 <span aria-hidden="true">↓</span>',
    '开始浏览X <span aria-hidden="true">↓</span>',
  ), "utf8");
  expect((await exportCurrentHtml(page)).equals(expected)).toBe(true);
});

test("common editable host types accept text before a collapsed inline gap", async ({ page }) => {
  const cases = [
    {
      id: "heading-before-inline",
      before: "标题 <small>说明</small>",
      after: "标题X <small>说明</small>",
    },
    {
      id: "paragraph-before-inline",
      before: "正文 <em>强调</em>",
      after: "正文X <em>强调</em>",
    },
    {
      id: "list-before-inline",
      before: "列表 <span>状态</span>",
      after: "列表X <span>状态</span>",
    },
    {
      id: "summary-before-inline",
      before: "摘要 <span>详情</span>",
      after: "摘要X <span>详情</span>",
    },
    {
      id: "cell-before-inline",
      before: "单元格 <span>状态</span>",
      after: "单元格X <span>状态</span>",
    },
  ];
  for (const fixtureCase of cases) {
    await test.step(fixtureCase.id, async () => {
      const { frame } = await openFixture(page);
      const target = await attemptDirectEdit(frame, fixtureCase.id);
      await expect(target).toHaveAttribute(
        "contenteditable",
        /^(?:plaintext-only|true)$/u,
      );
      await target.evaluate((element) => {
        const text = element.firstChild;
        if (!(text instanceof Text)) throw new Error("Leading host text is missing.");
        const visibleEnd = text.data.indexOf(" ");
        if (visibleEnd <= 0) throw new Error("Host has no collapsed inline gap.");
        element.focus({ preventScroll: true });
        const range = document.createRange();
        range.setStart(text, visibleEnd);
        range.collapse(true);
        const selection = document.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      });
      await page.keyboard.insertText("X");
      await page.waitForTimeout(900);
      expect(await authoredInnerHtml(target)).toBe(fixtureCase.after);
      expect(await page.getByTestId("html-canvas-editor").getAttribute(
        "data-edit-block-detail",
      )).toBeNull();
      const expected = Buffer.from(source.toString("utf8").replace(
        fixtureCase.before,
        fixtureCase.after,
      ), "utf8");
      expect((await exportCurrentHtml(page)).equals(expected)).toBe(true);
    });
  }
});

test("an IME delivery at a plain visual paragraph end stays before authored indentation", async ({ page }) => {
  const { frame } = await openFixture(page);
  const target = await attemptDirectEdit(frame, "plain-visible-end");
  await expect(target).toHaveAttribute(
    "contenteditable",
    /^(?:plaintext-only|true)$/u,
  );

  const result = await target.evaluate((element) => {
    const text = element.firstChild;
    if (!(text instanceof Text)) throw new Error("Paragraph text is missing.");
    const marker = "Paragraph end";
    const visibleEnd = text.data.indexOf(marker) + marker.length;
    element.focus({ preventScroll: true });
    const selection = document.getSelection();
    const initialRange = document.createRange();
    initialRange.setStart(text, visibleEnd);
    initialRange.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(initialRange);

    element.dispatchEvent(new CompositionEvent("compositionstart", {
      bubbles: true,
      data: "",
    }));
    const accepted = element.dispatchEvent(new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      data: "你",
      inputType: "insertCompositionText",
      isComposing: true,
    }));

    // Model Chromium placing marked text after the visually collapsed source
    // indentation even though the user's caret is before it.
    text.data = `${text.data}你`;
    const deliveryRange = document.createRange();
    deliveryRange.setStart(text, text.data.length);
    deliveryRange.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(deliveryRange);
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
    return accepted;
  });

  expect(result).toBe(true);
  await page.waitForTimeout(900);
  expect(await authoredInnerHtml(target)).toBe(
    "\n    Paragraph end你\n  ",
  );
  expect(await page.getByTestId("html-canvas-editor").getAttribute(
    "data-edit-block-detail",
  )).toBeNull();
  const expected = Buffer.from(source.toString("utf8").replace(
    "Paragraph end",
    "Paragraph end你",
  ), "utf8");
  expect((await exportCurrentHtml(page)).equals(expected)).toBe(true);
});

test("an empty transparent wrapper remains intact while its left boundary accepts text", async ({ page }) => {
  const { frame } = await openFixture(page);
  const target = await attemptDirectEdit(frame, "empty-wrapper");

  await expect(target).toHaveAttribute("contenteditable", "true");
  expect(await authoredInnerHtml(target)).toBe("A<em><strong></strong></em>B");

  await target.evaluate((element) => {
    const strong = element.querySelector("strong");
    if (!strong) throw new Error("Empty inline wrapper is missing.");
    element.focus({ preventScroll: true });
    const range = document.createRange();
    range.setStart(strong, 0);
    range.collapse(true);
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await page.keyboard.insertText("可编辑");

  expect(await target.textContent()).toBe("A可编辑B");
  expect(await authoredInnerHtml(target)).toBe(
    "A可编辑<em><strong></strong></em>B",
  );
  const expected = Buffer.from(source.toString("utf8").replace(
    "A<em><strong></strong></em>B",
    "A可编辑<em><strong></strong></em>B",
  ), "utf8");
  expect((await exportCurrentHtml(page)).equals(expected)).toBe(true);
});

test("an IME boundary epoch canonicalizes a wrong-side delivery into the left style", async ({ page }) => {
  const { frame } = await openFixture(page);
  const target = await attemptDirectEdit(frame, "exact-boundaries");
  await expect(target).toHaveAttribute("contenteditable", "true");
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

    // PageRoot normalized this A/B boundary to the left (A). Reproduce a
    // hostile platform delivery that nevertheless lands in the right text.
    trailingText.data = "你B";
    const selection = document.getSelection();
    const range = document.createRange();
    range.setStart(trailingText, 1);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
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

    return {
      firstBeforeInputAccepted,
      htmlAfterCompositionTail,
    };
  });
  await waitForFramePaint(frame);
  // Cross the normal source-checkpoint window so a blocked late tail cannot
  // pass merely because the assertion raced a deferred commit.
  await page.waitForTimeout(850);

  expect(result).toMatchObject({
    firstBeforeInputAccepted: true,
  });
  expect(result.htmlAfterCompositionTail).toContain("你");
  expect(await authoredInnerHtml(target)).toBe("<em><strong>A你</strong></em>B");

  const preventedBeforeInputs = (await handledInputEvents(frame)).filter(
    (event) => event.type === "beforeinput" && event.defaultPrevented,
  );
  expect(preventedBeforeInputs).toHaveLength(0);
  await expect(page.locator(".round-record-counts")).toHaveText(
    "0 条评论 · 1 项直接编辑记录",
  );
  const expected = Buffer.from(source.toString("utf8").replace(
    "<strong>A</strong>",
    "<strong>A你</strong>",
  ), "utf8");
  expect((await exportCurrentHtml(page)).equals(expected)).toBe(true);
});
