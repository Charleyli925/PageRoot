import { expect, test } from "@playwright/test";

import {
  activateNativeEdit,
  exportCurrentHtml,
  loadFixture,
  replaceEditableIslandBytes,
  selectionSnapshot,
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
  <p class="vertical" data-native-case="vertical">Vertical 竖排文字</p>
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
  {
    id: "vertical",
    text: "Vertical 竖排文字",
    innerHtml: "Vertical 竖排文字",
  },
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

test("pre-activation runtime DOM drift never enters the source-backed island draft", async ({ page }) => {
  const { frame } = await openFixture(page);
  const previewTarget = frame.locator('[data-native-case="plain"]');
  await previewTarget.evaluate((element) => {
    const wrapper = element.ownerDocument.createElement("span");
    wrapper.className = "runtime-only";
    wrapper.style.color = "rgb(255, 0, 0)";
    wrapper.textContent = element.textContent;
    element.replaceChildren(wrapper);
  });

  const target = await activateNativeEdit(frame, "plain");
  await expect(target.locator(".runtime-only")).toHaveCount(0);
  await setTextSelection(frame, "plain", "普通段落末尾".length);
  await page.keyboard.insertText("新增");

  const expected = replaceEditableIslandBytes(
    source,
    "plain",
    "普通段落末尾新增",
  ).toString("utf8");
  await expect.poll(async () => (
    await exportCurrentHtml(page)
  ).toString("utf8")).toBe(expected);
});

test("unsupported browser rich input never gains island commit authority", async ({ page }) => {
  const { frame } = await openFixture(page);
  const target = await activateNativeEdit(frame, "plain");
  const delivery = await target.evaluate((element) => {
    const event = new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      data: "不应写入",
      inputType: "insertFromDrop",
    });
    return {
      dispatchResult: element.dispatchEvent(event),
      defaultPrevented: event.defaultPrevented,
    };
  });

  expect(delivery).toEqual({
    dispatchResult: false,
    defaultPrevented: true,
  });
  expect(await authoredInnerHtml(target)).toBe("普通段落末尾");
  expect((await exportCurrentHtml(page)).toString("utf8")).toBe(
    source.toString("utf8"),
  );
});

test("formatting refuses selections that cross immutable atoms or comments", async ({ page }) => {
  for (const fixtureCase of editableCases.filter(({ id }) => (
    id === "atom" || id === "comment"
  ))) {
    await test.step(fixtureCase.id, async () => {
      const { editor, frame } = await openFixture(page);
      const target = await activateNativeEdit(frame, fixtureCase.id);
      await setTextSelection(
        frame,
        fixtureCase.id,
        0,
        fixtureCase.text.length,
      );
      const boldButton = page.getByRole("button", { name: "加粗", exact: true });
      if (fixtureCase.id === "atom") {
        // The source projection rejects structural atoms before a formatting
        // command can be created, so the toolbar must remain unavailable.
        await expect(boldButton).toBeDisabled();
      } else {
        // Comments are intentionally absent from the logical text map. The
        // controller therefore owns the final immutable-structure check.
        await expect(boldButton).toBeEnabled();
        await boldButton.click();
        await expect.poll(
          () => editor.getAttribute("data-edit-block-detail"),
        ).toContain("当前选区无法安全应用这个文字格式");
      }

      expect(await authoredInnerHtml(target)).toBe(fixtureCase.innerHtml);
      expect((await exportCurrentHtml(page)).toString("utf8")).toBe(
        source.toString("utf8"),
      );
      await page.keyboard.press("Escape");
    });
  }
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

test("toolbar formatting restores one logical range across button and input focus", async ({ page }) => {
  const { editor, frame } = await openFixture(page);
  const target = await activateNativeEdit(frame, "plain");
  await setTextSelection(frame, "plain", 0, 2);
  const before = await selectionSnapshot(frame, "plain");
  expect(before.text).toBe("普通");

  const toolbar = editor.getByRole("toolbar");
  const bold = toolbar.getByRole("button", { name: "加粗", exact: true });
  await expect(bold).toBeEnabled();
  const boldBox = await bold.boundingBox();
  if (!boldBox) throw new Error("Bold toolbar button is not measurable.");
  await page.mouse.move(
    boldBox.x + boldBox.width / 2,
    boldBox.y + boldBox.height / 2,
  );
  await page.mouse.down();
  await frame.evaluate(() => {
    const target = document.querySelector('[data-native-case="plain"][contenteditable]');
    const text = target
      ? document.createTreeWalker(target, NodeFilter.SHOW_TEXT).nextNode()
      : null;
    if (!(text instanceof Text)) throw new Error("Plain text fixture is incomplete.");
    const selection = document.getSelection();
    const range = document.createRange();
    range.setStart(text, 1);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await page.mouse.up();
  await expect.poll(() => authoredInnerHtml(target)).toContain("font-weight: 700");
  expect((await selectionSnapshot(frame, "plain")).text).toBe("普通");

  await toolbar.getByText("样式与间距", { exact: true }).click();
  const fontSize = toolbar.getByLabel("字号（像素）");
  await fontSize.fill("28");
  await expect.poll(() => authoredInnerHtml(target)).toContain("font-size: 28px");
  expect((await selectionSnapshot(frame, "plain")).text).toBe("普通");
});

test("a collapsed iframe Selection still lets consecutive color commands use the saved lease", async ({ page }) => {
  const { editor, frame } = await openFixture(page);
  const target = await activateNativeEdit(frame, "plain");
  await setTextSelection(frame, "plain", 0, 2);
  const toolbar = editor.getByRole("toolbar");
  await toolbar.getByText("样式与间距", { exact: true }).click();
  const color = toolbar.getByLabel("文字颜色");
  await frame.evaluate(() => {
    const target = document.querySelector('[data-native-case="plain"][contenteditable]');
    const text = target
      ? document.createTreeWalker(target, NodeFilter.SHOW_TEXT).nextNode()
      : null;
    if (!(text instanceof Text)) throw new Error("Plain text fixture is incomplete.");
    const selection = document.getSelection();
    const range = document.createRange();
    range.setStart(text, 1);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  const setColor = async (value) => color.evaluate((element, nextValue) => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(element, nextValue);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);

  await setColor("#123456");
  await expect.poll(() => authoredInnerHtml(target)).toContain("color: rgb(18, 52, 86)");
  await frame.evaluate(() => {
    const target = document.querySelector('[data-native-case="plain"][contenteditable]');
    const text = target
      ? document.createTreeWalker(target, NodeFilter.SHOW_TEXT).nextNode()
      : null;
    if (!(text instanceof Text)) throw new Error("Plain text fixture is incomplete.");
    const selection = document.getSelection();
    const range = document.createRange();
    range.setStart(text, 1);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await setColor("#654321");
  await expect.poll(() => authoredInnerHtml(target)).toContain("color: rgb(101, 67, 33)");
  expect((await selectionSnapshot(frame, "plain")).text).toBe("普通");
});

test("a new host selection supersedes the retained toolbar range", async ({ page }) => {
  const { frame } = await openFixture(page);
  const target = await activateNativeEdit(frame, "plain");
  await setTextSelection(frame, "plain", 0, 2);

  const toolbar = page.getByTestId("html-canvas-editor")
    .filter({ visible: true })
    .first()
    .getByRole("toolbar");
  await toolbar.getByText("样式与间距", { exact: true }).click();
  await target.click({ position: { x: 8, y: 8 } });
  await setTextSelection(frame, "plain", 2, 4);
  await toolbar.getByText("样式与间距", { exact: true }).click();

  const color = toolbar.getByLabel("文字颜色");
  const setter = async (value) => color.evaluate((element, nextValue) => {
    const nativeSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    nativeSetter?.call(element, nextValue);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
  await setter("#123456");

  await expect.poll(() => authoredInnerHtml(target)).toContain(
    '<span style="color: rgb(18, 52, 86);">段落</span>',
  );
  expect((await selectionSnapshot(frame, "plain")).text).toBe("段落");
});

test("IME confirmation replays at the frozen left-style caret", {
  tag: ["@gate-smoke","@smoke-editing"],
}, async ({ page }) => {
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

test("out-of-band mutation restores the last safe draft without an edit-blocked notice", {
  tag: ["@gate-smoke", "@smoke-editing"],
}, async ({ page }) => {
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
  });
  await expect(feedback).toHaveCount(0);
});
