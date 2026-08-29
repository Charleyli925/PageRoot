import { expect, test } from "@playwright/test";

import {
  caseSelector,
  exportCurrentHtml,
  loadFixture,
} from "./pageroot-driver.mjs";

function computedStyleFixture() {
  return Buffer.from(`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    :root { --computed-color: rgb(18, 52, 86); }
    body { margin: 0; color: rgb(10, 20, 30); }
    .inherited-color { color: rgb(40, 50, 60); }
    [data-native-case="computed-target"] {
      font-size: 22px;
      background-color: rgb(240, 241, 242);
      padding-top: 13px;
      margin-top: 5px;
      line-height: 31px;
      font-weight: 700;
      font-style: italic;
      text-decoration-line: underline;
    }
    @media (min-width: 1px) {
      .inherited-color { color: var(--computed-color); }
    }
    .ordinary-target { color: rgb(30, 40, 50); }
    .important-target { color: rgb(160, 20, 30) !important; }
  </style>
</head>
<body>
  <main>
    <div class="inherited-color">
      <p data-native-case="computed-target" data-native-mode="native-editable">Computed style target</p>
    </div>
    <p class="ordinary-target" data-native-case="ordinary-target" data-native-mode="native-editable">Ordinary inline target</p>
    <p class="important-target" data-native-case="important-target" data-native-mode="native-editable">Important inline target</p>
    <p data-native-case="blocked-target" data-native-mode="native-editable">Blocked inline target</p>
  </main>
</body>
</html>`, "utf8");
}

async function selectTarget(page, frame, editor, caseId) {
  const target = frame.locator(caseSelector(caseId));
  await target.click({ force: true });
  await expect(target).toHaveAttribute("data-html-canvas-selected", "part");
  const toolbar = editor.getByRole("toolbar");
  await expect(toolbar).toBeVisible();
  await toolbar.getByText("样式与间距", { exact: true }).click();
  await expect(toolbar.getByLabel("字号（像素）")).toBeVisible();
  return { target, toolbar };
}

async function setColor(input, value) {
  await input.evaluate((element, nextValue) => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(element, nextValue);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}

test("computed values from rules, inheritance, variables and media feed the style controls", {
  tag: ["@gate-smoke", "@smoke-editing"],
}, async ({ page }) => {
  await page.goto("/");
  const { editor, frame } = await loadFixture(page, "computed-style.html", {
    buffer: computedStyleFixture(),
  });
  const { toolbar } = await selectTarget(page, frame, editor, "computed-target");

  await expect(toolbar.getByLabel("字号（像素）")).toHaveValue("22");
  await expect(toolbar.getByLabel("文字颜色")).toHaveValue("#123456");
  await expect(toolbar.getByLabel("元素填充色")).toHaveValue("#f0f1f2");
  await expect(toolbar.getByLabel("内边距")).toHaveValue("13");
  await expect(toolbar.getByLabel("外间距")).toHaveValue("5");
  await expect(toolbar.getByLabel("行距")).toHaveValue("31");
  await expect(toolbar.getByRole("button", { name: "加粗", exact: true }))
    .toHaveAttribute("aria-pressed", "true");
  await expect(toolbar.getByRole("button", { name: "斜体", exact: true }))
    .toHaveAttribute("aria-pressed", "true");
  await expect(toolbar.getByRole("button", { name: "下划线", exact: true }))
    .toHaveAttribute("aria-pressed", "true");
});

test("inline style verification stays local and escalates priority only when needed", {
  tag: ["@gate-smoke", "@smoke-editing"],
}, async ({ page }) => {
  await page.goto("/");
  const source = computedStyleFixture();
  const { editor, frame } = await loadFixture(page, "computed-style.html", { buffer: source });

  const ordinary = await selectTarget(page, frame, editor, "ordinary-target");
  await ordinary.toolbar.getByLabel("字号（像素）").fill("26");
  await expect.poll(async () => (
    (await exportCurrentHtml(page)).toString("utf8")
  )).toContain('font-size: 26px');
  const ordinaryHtml = (await exportCurrentHtml(page)).toString("utf8");
  expect(ordinaryHtml).not.toContain("font-size: 26px !important");

  const important = await selectTarget(page, frame, editor, "important-target");
  await setColor(important.toolbar.getByLabel("文字颜色"), "#123456");
  await expect.poll(async () => (
    (await exportCurrentHtml(page)).toString("utf8")
  )).toContain("color: #123456 !important");
});

test("a failed local override restores the target and leaves source unchanged", {
  tag: ["@gate-smoke", "@smoke-editing"],
}, async ({ page }) => {
  await page.goto("/");
  const source = computedStyleFixture();
  const { editor, frame } = await loadFixture(page, "computed-style.html", { buffer: source });
  const { target, toolbar } = await selectTarget(page, frame, editor, "blocked-target");
  const before = await target.evaluate((element) => ({
    style: element.getAttribute("style"),
    siblingCount: element.parentElement?.children.length,
  }));

  await frame.evaluate(() => {
    const original = window.getComputedStyle;
    window.getComputedStyle = (element, pseudo) => {
      const computed = original.call(window, element, pseudo);
      if (
        !pseudo
        && element instanceof HTMLElement
        && element.matches('[data-native-case="blocked-target"]')
      ) {
        return new Proxy(computed, {
          get(targetStyle, property, receiver) {
            if (property === "getPropertyValue") {
              return (name) => name === "color"
                ? "rgb(1, 2, 3)"
                : targetStyle.getPropertyValue(name);
            }
            return Reflect.get(targetStyle, property, receiver);
          },
        });
      }
      return computed;
    };
  });
  await setColor(toolbar.getByLabel("文字颜色"), "#123456");

  const message = "这个样式无法通过当前元素的局部修改可靠生效。可以把修改要求交给 Agent，由 Agent 调整页面样式结构。";
  await expect(page.getByText(message, { exact: true })).toBeVisible();
  await expect(target).toHaveAttribute("style", before.style || "");
  await expect.poll(async () => (
    (await target.evaluate((element) => element.parentElement?.children.length))
  )).toBe(before.siblingCount);
  expect((await exportCurrentHtml(page)).equals(source)).toBe(true);
});
