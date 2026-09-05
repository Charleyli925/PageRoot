import { expect, test } from "@playwright/test";

import {
  activateNativeEdit,
  closePageRootGracefully,
  currentEditorFrame,
  documentToken,
  ECHARTS_STUB,
  expectCheckpointPersisted,
  keyShortcut,
  launchPageRoot,
  loadedDiskFrame,
  managedWorkingCopyPath,
  mkdirSync,
  mkdtempSync,
  path,
  readFileSync,
  removeValidatedTemporaryDirectory,
  stopPageRoot,
  tmpdir,
  writeFileSync,
} from "./electron-native-harness.mjs";

async function withRuntimeProject(prefix, files, run, launchOptions = {}) {
  const sourceDirectory = mkdtempSync(path.join(tmpdir(), prefix));
  const sourcePath = path.join(sourceDirectory, "runtime-report.html");
  for (const [relativePath, content] of Object.entries(files)) {
    const targetPath = path.join(sourceDirectory, relativePath);
    mkdirSync(path.dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, content, "utf8");
  }
  const session = {
    electronApp: null,
    page: null,
    isolatedUserData: null,
  };
  try {
    Object.assign(session, await launchPageRoot({
      activeSourcePath: sourcePath,
      ...launchOptions,
    }));
    await run({
      get page() {
        return session.page;
      },
      get electronApp() {
        return session.electronApp;
      },
      sourcePath,
      isolatedUserData: session.isolatedUserData,
      relaunch: async () => {
        if (!session.electronApp || !session.page) {
          throw new Error("PageRoot session is not running.");
        }
        const closedApp = session.electronApp;
        const closedPage = session.page;
        session.electronApp = null;
        session.page = null;
        let closedProcess = null;
        try {
          closedProcess = closedApp.process();
        } catch {
          closedProcess = null;
        }
        await closePageRootGracefully(closedApp, closedPage);
        if (closedProcess && closedProcess.exitCode == null && !closedProcess.killed) {
          await Promise.race([
            new Promise((resolve) => closedProcess.once("exit", resolve)),
            new Promise((resolve) => {
              setTimeout(resolve, 15_000);
            }),
          ]);
        }
        Object.assign(session, await launchPageRoot({
          isolatedUserData: session.isolatedUserData,
        }));
        return session;
      },
    });
  } finally {
    if (session.electronApp && session.isolatedUserData) {
      try {
        await stopPageRoot(session.electronApp, session.isolatedUserData);
      } catch {
        removeValidatedTemporaryDirectory(session.isolatedUserData, "pageroot-native-e2e-");
      }
    } else if (session.isolatedUserData) {
      removeValidatedTemporaryDirectory(session.isolatedUserData, "pageroot-native-e2e-");
    }
    removeValidatedTemporaryDirectory(sourceDirectory, prefix);
  }
}

async function enableContinuityProbe(page) {
  await expect.poll(() => page.evaluate(() => ({
    editor: Boolean(document.querySelector('[data-testid="html-canvas-editor"]')),
    enable: typeof window.__PAGEROOT_ENABLE_RUNTIME_CONTINUITY__,
  })), { timeout: 30_000 }).toEqual({
    editor: true,
    enable: "function",
  });
  await page.evaluate(() => window.__PAGEROOT_ENABLE_RUNTIME_CONTINUITY__());
}

async function continuitySummary(page) {
  return page.evaluate(() => window.__PAGEROOT_SUMMARIZE_RUNTIME_CONTINUITY__());
}

async function enterNativeEdit(page, frame, caseId, { scrollTop = 480 } = {}) {
  const reviewStage = page.locator(".review-scroll-stage");
  const target = frame.locator(`[data-native-case="${caseId}"]`);
  await target.click();
  await reviewStage.evaluate((element, nextTop) => {
    element.scrollTop = nextTop;
  }, scrollTop);
  await expect.poll(() => reviewStage.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(400);
  await activateNativeEdit(frame, caseId);
  await expect(target).toHaveAttribute("contenteditable", /^(?:true|plaintext-only)$/u);
  await target.press("End");
  return { reviewStage, target };
}

const STATIC_PAGE = `<!doctype html>
<html><head><title>Static continuity</title></head><body>
  <div aria-hidden="true" style="height:850px"></div>
  <main>
    <p data-native-case="continuity-static">静态页连续编辑不得替换 Runtime 文档。</p>
  </main>
  <div aria-hidden="true" style="height:1800px"></div>
</body></html>`;

const NESTED_SCROLL_PAGE = `<!doctype html>
<html><head><title>Nested scroll continuity</title></head><body>
  <div aria-hidden="true" style="height:850px"></div>
  <main>
    <div style="height:280px;overflow:auto;border:1px solid #ccc">
      <p data-native-case="continuity-nested">嵌套滚动页输入时评论栏宽度必须保持。</p>
      <div aria-hidden="true" style="height:1400px"></div>
    </div>
  </main>
  <div aria-hidden="true" style="height:1800px"></div>
</body></html>`;

const CHART_PAGE = `<!doctype html>
<html><head><title>Chart continuity</title></head><body>
  <div aria-hidden="true" style="height:850px"></div>
  <main>
    <p data-native-case="continuity-blank-caret">图表页空行必须落到对应 br，而不是最近文本。</p>
    <div id="chart" style="width:320px;height:180px"></div>
  </main>
  <div aria-hidden="true" style="height:1800px"></div>
  <script src="echarts.js"></script>
  <script>
    echarts.init(document.querySelector('#chart')).setOption({series:[{type:'bar',data:[1,2,3]}]});
  </script>
</body></html>`;

test("continuous editing keeps the Runtime document through type, Enter, style and save", {
  tag: ["@gate-smoke", "@smoke-editing"],
}, async () => {
  const typed = `CONTINUITY_TRANSACTION_MARKER_${"x".repeat(68)}`;
  await withRuntimeProject("pageroot-continuity-static-e2e-", {
    "runtime-report.html": STATIC_PAGE,
  }, async ({ page, sourcePath, relaunch }) => {
    let { frame } = await loadedDiskFrame(page, sourcePath, "continuity-static");
    const { target } = await enterNativeEdit(page, frame, "continuity-static");
    await enableContinuityProbe(page);
    const beforeDocument = await documentToken(page);
    const beforeGeneration = await page.getByTestId("html-canvas-editor")
      .locator('iframe:not([data-frame-role])')
      .getAttribute("data-frame-generation");

    await page.keyboard.insertText(typed);
    await expect(target).toContainText(typed);
    for (let index = 0; index < 20; index += 1) {
      await target.press("Enter");
    }
    await expect(target.locator(":scope > br")).toHaveCount(20);
    await target.evaluate((element) => {
      const node = Array.from(element.childNodes).find(
        (child) => child.nodeType === Node.TEXT_NODE && child.textContent?.includes("静态页连续编辑"),
      );
      if (!(node instanceof Text)) throw new Error("Original continuity sentence is missing.");
      const range = document.createRange();
      range.setStart(node, 0);
      range.setEnd(node, Math.min(4, node.data.length));
      const selection = document.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    });
    const toolbar = page.getByTestId("html-canvas-editor").getByRole("toolbar");
    await toolbar.getByRole("button", { name: "加粗", exact: true }).click();
    const workingCopyPath = await managedWorkingCopyPath(page, sourcePath);
    await expect.poll(() => readFileSync(workingCopyPath, "utf8"))
      .toMatch(/font-weight:\s*700/u);
    await expectCheckpointPersisted(page, 0);
    await page.keyboard.press(keyShortcut("S"));
    await expect.poll(() => documentToken(page)).toBe(beforeDocument);
    await expect(page.getByTestId("html-canvas-editor")
      .locator('iframe:not([data-frame-role])'))
      .toHaveAttribute("data-frame-generation", beforeGeneration);
    await expect(target).toHaveAttribute("contenteditable", /^(?:true|plaintext-only)$/u);
    const duringEdit = await continuitySummary(page);
    expect(duringEdit.frameCreated).toBe(0);
    expect(duringEdit.candidateCreated).toBe(0);

    const saved = readFileSync(workingCopyPath, "utf8");
    expect(saved).toContain(typed);
    expect(saved).toMatch(/font-weight:\s*700/u);
    const reopened = await relaunch();
    frame = (await loadedDiskFrame(reopened.page, workingCopyPath, "continuity-static")).frame;
    await expect(frame.locator('[data-native-case="continuity-static"]'))
      .toContainText(typed);
    expect(readFileSync(workingCopyPath, "utf8")).toContain(typed);
  });
});

test("continuous editing on a Script page keeps the Runtime document", {
  tag: ["@gate-smoke", "@smoke-editing"],
}, async () => {
  const typed = "DYNAMIC_CONTINUITY_MARKER";
  await withRuntimeProject("pageroot-continuity-dynamic-e2e-", {
    "runtime-report.html": CHART_PAGE,
    "echarts.js": ECHARTS_STUB,
  }, async ({ page, sourcePath }) => {
    const { frame } = await loadedDiskFrame(page, sourcePath, "continuity-blank-caret");
    await expect(frame.locator("#chart canvas")).toHaveCount(1);
    const { target } = await enterNativeEdit(page, frame, "continuity-blank-caret");
    await enableContinuityProbe(page);
    const beforeDocument = await documentToken(page);
    const beforeGeneration = await page.getByTestId("html-canvas-editor")
      .locator('iframe:not([data-frame-role])')
      .getAttribute("data-frame-generation");
    for (const character of typed) {
      await page.keyboard.insertText(character);
    }
    await expect(target).toContainText(typed);
    await expect.poll(() => documentToken(page)).toBe(beforeDocument);
    await expect(page.getByTestId("html-canvas-editor")
      .locator('iframe:not([data-frame-role])'))
      .toHaveAttribute("data-frame-generation", beforeGeneration);
    const duringEdit = await continuitySummary(page);
    expect(duringEdit.frameCreated).toBe(0);
    expect(duringEdit.candidateCreated).toBe(0);
    expect(duringEdit.unexpectedCandidate).toBe(false);
  });
});

test("comment rail and canvas width stay visually continuous while typing in a nested scroller", {
  tag: ["@gate-smoke", "@smoke-editing"],
}, async () => {
  await withRuntimeProject("pageroot-continuity-nested-e2e-", {
    "runtime-report.html": NESTED_SCROLL_PAGE,
  }, async ({ page, sourcePath }) => {
    const { frame } = await loadedDiskFrame(page, sourcePath, "continuity-nested");
    const rail = page.locator(".review-scroll-stage > .comments-panel.comment-rail");
    await expect(rail).toBeVisible();
    const { target } = await enterNativeEdit(page, frame, "continuity-nested");
    await enableContinuityProbe(page);
    await expect.poll(() => page.evaluate(() => (
      window.__PAGEROOT_READ_RUNTIME_CONTINUITY__?.()?.samples.length || 0
    ))).toBeGreaterThan(0);
    await page.keyboard.insertText("宽度连续");
    for (let index = 0; index < 8; index += 1) {
      await target.press("Enter");
    }
    await page.waitForFunction(() => {
      const samples = window.__PAGEROOT_READ_RUNTIME_CONTINUITY__?.()?.samples || [];
      if (samples.length < 2) return false;
      return samples.at(-1).t - samples[0].t >= 500;
    });
    const summary = await continuitySummary(page);
    expect(summary.maxCanvasWidthDelta).toBeLessThanOrEqual(4);
    expect(summary.railDisappeared).toBe(false);
    expect(summary.jumpedToTop).toBe(false);
    expect(summary.missingVisibleFrame).toBe(false);
    expect(summary.frameCreated).toBe(0);
    expect(summary.candidateCreated).toBe(0);
    await expect(rail).toBeVisible();
  });
});

test("double-clicking the sixth blank line after a Runtime refresh places the caret on that br", {
  tag: ["@gate-smoke", "@smoke-editing"],
}, async () => {
  const marker = "SIXTH_BLANK_LINE_MARKER";
  await withRuntimeProject("pageroot-continuity-blank-e2e-", {
    "runtime-report.html": CHART_PAGE,
    "echarts.js": ECHARTS_STUB,
  }, async ({ page, sourcePath }) => {
    let { frame } = await loadedDiskFrame(page, sourcePath, "continuity-blank-caret");
    await expect(frame.locator("#chart canvas")).toHaveCount(1);
    let { target } = await enterNativeEdit(page, frame, "continuity-blank-caret");
    await enableContinuityProbe(page);
    for (let index = 0; index < 8; index += 1) {
      await target.press("Enter");
    }
    await expect(target.locator(":scope > br")).toHaveCount(8);
    const duringEdit = await continuitySummary(page);
    expect(duringEdit.frameCreated).toBe(0);
    expect(duringEdit.candidateCreated).toBe(0);
    const beforeDocument = await documentToken(page);
    const beforeGeneration = await page.getByTestId("html-canvas-editor")
      .locator('iframe:not([data-frame-role])')
      .getAttribute("data-frame-generation");

    await page.keyboard.press("Escape");
    await expect(target).not.toHaveAttribute("contenteditable", /^(?:true|plaintext-only)$/u);
    await expect.poll(async () => {
      const generation = await page.getByTestId("html-canvas-editor")
        .locator('iframe:not([data-frame-role])')
        .getAttribute("data-frame-generation");
      const token = await documentToken(page);
      const summary = await continuitySummary(page);
      return generation !== beforeGeneration
        || token !== beforeDocument
        || summary.frameCreated > 0
        || summary.framePromoted > 0;
    }).toBe(true);
    await expect.poll(() => page.locator(".canvas-edit-surface")
      .getAttribute("data-edit-runtime-outcome")).toBe("ready");
    frame = await currentEditorFrame(page);
    target = frame.locator('[data-native-case="continuity-blank-caret"]');
    await expect(target.locator(":scope > br")).toHaveCount(8);
    const sixthBreak = await target.evaluate((element) => {
      const breaks = [...element.querySelectorAll(":scope > br")];
      if (breaks.length < 6) {
        throw new Error(`Need six blank lines, found ${breaks.length}.`);
      }
      const br = breaks[5];
      const range = document.createRange();
      range.setStartBefore(br);
      range.setEndAfter(br);
      const glyph = range.getBoundingClientRect();
      const host = element.getBoundingClientRect();
      const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight) || 24;
      const fallbackY = lineHeight * 5 + lineHeight / 2;
      return {
        x: glyph.width >= 1 ? glyph.left - host.left + Math.max(4, glyph.width / 2) : 8,
        y: glyph.height >= 1 ? glyph.top - host.top + Math.max(2, glyph.height / 2) : fallbackY,
      };
    });
    await target.dblclick({ position: sixthBreak });
    await expect(target).toHaveAttribute("contenteditable", /^(?:true|plaintext-only)$/u);
    await page.keyboard.insertText(marker);
    await expect(target).toContainText(marker);
    const workingCopyPath = await managedWorkingCopyPath(page, sourcePath);
    await expect.poll(() => readFileSync(workingCopyPath, "utf8")).toContain(marker);
    const inner = readFileSync(workingCopyPath, "utf8").match(
      /data-native-case="continuity-blank-caret"[^>]*>([\s\S]*?)<\/p>/u,
    )?.[1] ?? "";
    expect(inner).toContain(marker);
    expect(inner).not.toMatch(/^\s*SIXTH_BLANK_LINE_MARKER/u);
    expect(inner).not.toMatch(/对应 br，而不是最近文本。SIXTH_BLANK_LINE_MARKER/u);
    const beforeMarker = inner.slice(0, inner.indexOf(marker));
    expect((beforeMarker.match(/<br\b/giu) || []).length).toBe(5);
  });
});
