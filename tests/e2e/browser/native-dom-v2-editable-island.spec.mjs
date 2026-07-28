import { expect, test } from "@playwright/test";

import {
  activateNativeEdit,
  exportCurrentHtml,
  loadFixture,
  replaceEditableIslandBytes,
  setTextSelection,
} from "./pageroot-driver.mjs";

const source = Buffer.from(`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <style>
    body { font: 20px/1.6 sans-serif; padding: 32px; }
    .vertical {
      writing-mode: vertical-rl;
      inline-size: 8em;
      block-size: 2em;
    }
  </style>
</head>
<body>
  <p data-native-case="plain">普通段落末尾</p>
  <p data-native-case="mixed">左<strong style="color:#c43">粗体</strong>右</p>
  <h2 data-native-case="heading">模块排序</h2>
  <a data-native-case="link" href="#safe">开始试览</a>
  <button data-native-case="button" type="button">打开原生测试</button>
  <ul><li data-native-case="list">列表项目</li></ul>
  <table><tbody><tr><td data-native-case="cell">表格单元格</td></tr></tbody></table>
  <p data-native-case="atom">图标前<svg viewBox="0 0 10 10" aria-label="圆点"><circle cx="5" cy="5" r="4"></circle></svg>图标后</p>
  <pre data-native-case="pre"><code>const value = 1;</code></pre>
  <p class="vertical" data-native-case="vertical">竖排文字</p>
  <p data-native-case="comment">甲<!-- authored boundary -->乙</p>
</body>
</html>
`, "utf8");

const editableCases = [
  { id: "plain", text: "普通段落末尾", innerHtml: "普通段落末尾" },
  {
    id: "mixed",
    text: "左粗体右",
    innerHtml: '左<strong style="color:#c43">粗体</strong>右',
  },
  { id: "heading", text: "模块排序", innerHtml: "模块排序" },
  { id: "link", text: "开始试览", innerHtml: "开始试览" },
  { id: "button", text: "打开原生测试", innerHtml: "打开原生测试" },
  { id: "list", text: "列表项目", innerHtml: "列表项目" },
  { id: "cell", text: "表格单元格", innerHtml: "表格单元格" },
  {
    id: "atom",
    text: "图标前图标后",
    innerHtml: '图标前<svg viewBox="0 0 10 10" aria-label="圆点"><circle cx="5" cy="5" r="4"></circle></svg>图标后',
  },
  { id: "pre", text: "const value = 1;", innerHtml: "<code>const value = 1;</code>" },
  { id: "vertical", text: "竖排文字", innerHtml: "竖排文字" },
  {
    id: "comment",
    text: "甲乙",
    innerHtml: "甲<!-- authored boundary -->乙",
  },
];

async function openFixture(page) {
  await page.goto("/");
  return loadFixture(page, "pageroot-v2-editable-island.html", { buffer: source });
}

async function authoredInnerHtml(target) {
  return target.evaluate((element) => {
    const clone = element.cloneNode(true);
    if (!(clone instanceof HTMLElement)) throw new Error("Expected HTMLElement.");
    clone.querySelectorAll("[data-html-ai-source-node-id]").forEach((node) => {
      node.removeAttribute("data-html-ai-source-node-id");
    });
    return clone.innerHTML;
  });
}

test("V2 editable-island census activates every safe HTML text host", async ({ page }) => {
  const { frame } = await openFixture(page);
  for (const fixtureCase of editableCases) {
    await test.step(fixtureCase.id, async () => {
      const target = await activateNativeEdit(frame, fixtureCase.id);
      await expect(target).toHaveAttribute("contenteditable", "true");
      await page.keyboard.press("Escape");
    });
  }
});

test("start, middle and end all support insert, delete and line break", async ({ page }) => {
  for (const fixtureCase of editableCases) {
    await test.step(fixtureCase.id, async () => {
      const { editor, frame } = await openFixture(page);
      const target = await activateNativeEdit(frame, fixtureCase.id);
      const positions = [
        0,
        Math.floor(fixtureCase.text.length / 2),
        fixtureCase.text.length,
      ];
      for (const [index, position] of positions.entries()) {
        const marker = `测${index}`;
        await setTextSelection(frame, fixtureCase.id, position);
        await expect(target).toHaveAttribute("contenteditable", "true");
        await page.keyboard.insertText(marker);
        await expect(target).toContainText(marker);
        await page.keyboard.press("Backspace");
        await page.keyboard.press("Backspace");
        expect(
          await editor.getAttribute("data-edit-block-detail"),
          `${fixtureCase.id}:position:${position}`,
        ).toBeNull();
      }

      await setTextSelection(
        frame,
        fixtureCase.id,
        fixtureCase.text.length,
      );
      await page.keyboard.press("Enter");
      await expect.poll(() => authoredInnerHtml(target)).toContain("<br>");
      await page.keyboard.press("Backspace");
      expect(
        await editor.getAttribute("data-edit-block-detail"),
        `${fixtureCase.id}:line-break`,
      ).toBeNull();

      await setTextSelection(
        frame,
        fixtureCase.id,
        fixtureCase.text.length,
      );
      await page.keyboard.press("Backspace");

      expect(await editor.getAttribute("data-edit-block-detail")).toBeNull();
      const lastCharacter = fixtureCase.text.at(-1);
      const lastCharacterIndex = fixtureCase.innerHtml.lastIndexOf(lastCharacter);
      const expectedInnerHtml = fixtureCase.innerHtml.slice(0, lastCharacterIndex)
        + fixtureCase.innerHtml.slice(lastCharacterIndex + lastCharacter.length);
      expect((await exportCurrentHtml(page)).toString("utf8")).toBe(
        replaceEditableIslandBytes(
          source,
          fixtureCase.id,
          expectedInnerHtml,
        ).toString("utf8"),
      );
    });
  }
});

test("paste is plain text, multiline paste becomes br, and cut stays local", async ({ page }) => {
  const { frame } = await openFixture(page);
  const target = await activateNativeEdit(frame, "plain");
  await setTextSelection(frame, "plain", 0, "普通段落".length);

  await target.evaluate((element) => {
    const clipboard = new DataTransfer();
    clipboard.setData("text/plain", "第一行\n第二行");
    clipboard.setData("text/html", "<img src=x onerror=alert(1)><b>不应保留</b>");
    element.dispatchEvent(new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData: clipboard,
    }));
  });

  expect(await authoredInnerHtml(target)).toBe("第一行<br>第二行末尾");
  await setTextSelection(frame, "plain", 0, "第一行".length);
  await page.keyboard.press(process.platform === "darwin" ? "Meta+x" : "Control+x");
  await expect(target).toHaveText("第二行末尾");
  expect(await target.locator("img, b").count()).toBe(0);
});

test("toolbar formatting, protected atoms, comments and link identity stay safe", async ({ page }) => {
  const { frame } = await openFixture(page);
  const mixed = await activateNativeEdit(frame, "mixed");
  await setTextSelection(frame, "mixed", 0, 1);
  await page.keyboard.press("Meta+b");
  await expect.poll(() => authoredInnerHtml(mixed)).toMatch(/font-weight:\s*700/u);

  const atom = await activateNativeEdit(frame, "atom");
  await setTextSelection(frame, "atom", "图标前".length);
  await page.keyboard.insertText("新增");
  expect(await atom.locator("svg[viewBox='0 0 10 10'] circle").count()).toBe(1);

  const comment = await activateNativeEdit(frame, "comment");
  await setTextSelection(frame, "comment", 1);
  await page.keyboard.insertText("新增");
  expect(await authoredInnerHtml(comment)).toContain(
    "<!-- authored boundary -->",
  );

  const link = await activateNativeEdit(frame, "link");
  await setTextSelection(frame, "link", "开始试览".length);
  await page.keyboard.insertText("V2");
  await expect(link).toHaveAttribute("href", "#safe");
});

test("IME confirmation replays at the frozen left-style caret", async ({ page }) => {
  const { frame } = await openFixture(page);
  const target = await activateNativeEdit(frame, "mixed");
  await target.evaluate((element) => {
    const strongText = element.querySelector("strong")?.firstChild;
    const trailingText = element.lastChild;
    if (!(strongText instanceof Text) || !(trailingText instanceof Text)) {
      throw new Error("Mixed-style fixture is incomplete.");
    }
    element.focus({ preventScroll: true });
    const selection = document.getSelection();
    const range = document.createRange();
    range.setStart(trailingText, 0);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    element.dispatchEvent(new CompositionEvent("compositionstart", {
      bubbles: true,
      data: "",
    }));
    trailingText.data = `你${trailingText.data}`;
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

  expect(await authoredInnerHtml(target)).toBe(
    '左<strong style="color:#c43">粗体你</strong>右',
  );
});

test("out-of-band mutation restores the last safe draft and reports in the viewport", async ({ page }) => {
  const { editor, frame } = await openFixture(page);
  const target = await activateNativeEdit(frame, "plain");
  await setTextSelection(frame, "plain", "普通".length);
  await page.keyboard.insertText("安全");
  await target.evaluate((element) => element.append("越权"));

  await expect(target).not.toContainText("越权");
  await expect(target).toContainText("安全");
  await expect.poll(() => editor.getAttribute("data-edit-block-detail")).toContain(
    "编辑之外",
  );
  const feedback = page.locator('[role="alert"], [role="status"]').filter({
    hasText: /页面内容没有改变|暂时不能直接编辑/u,
  }).first();
  await expect(feedback).toBeVisible();
  expect(await feedback.evaluate((element) => (
    getComputedStyle(element).position
  ))).toBe("fixed");
});
