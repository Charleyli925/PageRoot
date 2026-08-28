import { expect, test } from "@playwright/test";
import {
  ECHARTS_STUB,
  activateNativeEdit,
  addCanvasComment,
  assertFrozenRuntimeRetained,
  caseSelector,
  currentEditorFrame,
  documentToken,
  fixtureBuffer,
  launchPageRoot,
  loadedDiskFrame,
  managedWorkingCopyPath,
  mkdtempSync,
  path,
  readFileSync,
  removeIsolatedUserData,
  removeValidatedTemporaryDirectory,
  setTextSelection,
  sha256,
  stopPageRoot,
  tmpdir,
  workspaceContainsDraftComment,
  writeFileSync,
} from "./electron-native-harness.mjs";

test("Electron keeps bounded visuals in first Edit and full interaction in Preview", {
  tag: ["@gate-smoke","@smoke-editing"],
}, async () => {
  const sourceDirectory = mkdtempSync(
    path.join(tmpdir(), "pageroot-preview-source-e2e-"),
  );
  const sourcePath = path.join(sourceDirectory, "interactive-report.html");
  const runtimePath = path.join(sourceDirectory, "runtime.js");
  writeFileSync(
    sourcePath,
    `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    .panel { display: none; }
    .panel.active { display: block; }
    .runtime-scaled-frame {
      position: relative;
      width: 420px;
      height: 220px;
      overflow: hidden;
    }
    #runtime-scaled {
      position: absolute;
      top: 8px;
      left: 8px;
      transform: scale(1.25);
      transform-origin: top left;
    }
  </style>
</head>
<body>
  <nav>
    <button id="tab-one" class="tab active" aria-selected="true">第一页</button>
    <button id="tab-two" class="tab" aria-selected="false">第二页</button>
  </nav>
  <section id="panel-one" class="panel active">
    <p>第一页正文</p>
    <div id="runtime-canvas" data-native-case="runtime-visual-host" style="width: 32px; height: 16px"></div>
    <div
      id="runtime-svg"
      style="width: 40px; height: 20px; padding: 7px; border: 3px solid #0f172a; transform: translate(13px, 7px) scale(1.25); transform-origin: top left"
    ></div>
    <div id="runtime-delayed" style="width: 32px; height: 16px"></div>
    <canvas id="direct-runtime-canvas" width="36" height="18"></canvas>
    <svg id="direct-runtime-svg" width="44" height="22"></svg>
    <table><tbody id="runtime-table"></tbody></table>
    <div class="runtime-scaled-frame" id="runtime-scaled-frame">
      <div id="runtime-scaled"></div>
    </div>
  </section>
  <section id="panel-two" class="panel">
    <p data-native-case="preview-tab-copy" data-native-mode="native-editable">第二页可编辑正文</p>
    <svg id="static-chart" viewBox="0 0 10 10"><circle cx="5" cy="5" r="3"></circle></svg>
  </section>
  <script src="file://${runtimePath}"></script>
</body>
</html>`,
    "utf8",
  );
  writeFileSync(
    runtimePath,
    `(() => {
  const tabs = [
    ["tab-one", "panel-one"],
    ["tab-two", "panel-two"],
  ];
  for (const [tabId, panelId] of tabs) {
    document.getElementById(tabId).addEventListener("click", () => {
      for (const [otherTabId, otherPanelId] of tabs) {
        const active = otherTabId === tabId;
        document.getElementById(otherTabId).classList.toggle("active", active);
        document.getElementById(otherTabId).setAttribute("aria-selected", String(active));
        document.getElementById(otherPanelId).classList.toggle("active", active);
      }
    });
  }
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 16;
  canvas.dataset.drawn = "true";
  document.getElementById("runtime-canvas").append(canvas);
  canvas.getContext("2d").fillRect(0, 0, 16, 8);
  document.getElementById("runtime-table").innerHTML =
    '<tr data-runtime-row><td>动态行一</td></tr><tr data-runtime-row><td>动态行二</td></tr>';
  const runtimeSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  runtimeSvg.setAttribute("data-runtime-chart", "true");
  runtimeSvg.setAttribute("width", "40");
  runtimeSvg.setAttribute("height", "20");
  runtimeSvg.innerHTML = '<rect width="40" height="20" fill="#2563eb"></rect>';
  document.getElementById("runtime-svg").append(runtimeSvg);
  const directCanvas = document.getElementById("direct-runtime-canvas");
  directCanvas.width = 800;
  directCanvas.height = 400;
  directCanvas.getContext("2d").fillRect(0, 0, 400, 200);
  const directSvg = document.getElementById("direct-runtime-svg");
  directSvg.setAttribute("width", "700");
  directSvg.setAttribute("height", "350");
  directSvg.innerHTML =
    '<rect width="700" height="350" fill="#7c3aed"></rect>';
  const scaledHost = document.getElementById("runtime-scaled");
  const scaledPanel = document.createElement("div");
  scaledPanel.dataset.runtimeScaled = "true";
  scaledPanel.style.cssText =
    "width:800px;height:360px;background:linear-gradient(90deg,#2563eb,#7c3aed)";
  scaledHost.append(scaledPanel);
  const fitScaledPanel = () => {
    const frame = document.getElementById("runtime-scaled-frame");
    const scale = Math.min(
      (frame.clientWidth - 16) / 800,
      (frame.clientHeight - 16) / 360,
    );
    scaledHost.style.transform = "scale(" + scale + ")";
  };
  window.addEventListener("resize", fitScaledPanel);
  fitScaledPanel();
  window.addEventListener("load", () => {
    window.setTimeout(() => {
      const delayedCanvas = document.createElement("canvas");
      delayedCanvas.width = 32;
      delayedCanvas.height = 16;
      delayedCanvas.getContext("2d").fillRect(0, 0, 16, 8);
      document.getElementById("runtime-delayed").append(delayedCanvas);
    }, 350);
  }, { once: true });
  document.body.dataset.runtimeReady = "true";
})();`,
    "utf8",
  );
  writeFileSync(
    sourcePath,
    readFileSync(sourcePath, "utf8").replace(
      `<script src="file://${runtimePath}"></script>`,
      `<script>${readFileSync(runtimePath, "utf8")}</script>`,
    ),
    "utf8",
  );
  const originalSource = readFileSync(sourcePath);

  let electronApp = null;
  let isolatedUserData = null;
  try {
    const launched = await launchPageRoot({ activeSourcePath: sourcePath });
    electronApp = launched.electronApp;
    isolatedUserData = launched.isolatedUserData;
    const { frame: editFrame } = await loadedDiskFrame(
      launched.page,
      sourcePath,
      "preview-tab-copy",
    );

    await expect(editFrame.locator("#runtime-canvas canvas")).toHaveCount(1);
    await expect(editFrame.locator("#runtime-svg svg")).toHaveCount(1);
    await expect(editFrame.locator("[data-runtime-row]")).toHaveCount(2);
    await expect(editFrame.locator("#direct-runtime-svg rect")).toHaveCount(1);
    await expect(editFrame.locator("[data-pageroot-readonly-visual]")).toHaveCount(0);
    await expect(editFrame.locator("html"))
      .toHaveAttribute("data-pageroot-edit-runtime-frozen", "true");
    await expect(launched.page.locator("[data-runtime-bootstrap-count=\"1\"]"))
      .toHaveCount(1);
    expect(readFileSync(sourcePath)).toEqual(originalSource);

    await launched.page.getByRole("button", {
      name: "预览",
      exact: true,
    }).click();
    const previewIframe = launched.page.locator(
      'iframe[title="HTML 交互预览"]',
    );
    await expect(previewIframe).toBeVisible();
    await expect.poll(() => launched.page.frames().some(
      (frame) => /^pageroot-preview:/u.test(frame.url()),
    ), {
      message: "PageRoot Electron should expose its interactive preview frame.",
    }).toBe(true);
    const previewFrame = launched.page.frames().find(
      (frame) => /^pageroot-preview:/u.test(frame.url()),
    );
    if (!previewFrame) {
      throw new Error("PageRoot Electron did not expose its interactive preview frame.");
    }
    await previewFrame.waitForFunction(
      () => document.body.dataset.runtimeReady === "true",
    );
    expect(previewFrame.url()).toMatch(/^pageroot-preview:/u);
    expect(await previewFrame.evaluate(() => ({
      projects: typeof window.htmlAIProjects,
      preview: typeof window.htmlAIPreview,
      runtime: typeof window.htmlAIRuntime,
    }))).toEqual({
      projects: "undefined",
      preview: "undefined",
      runtime: "undefined",
    });
    await expect(previewFrame.locator("#runtime-canvas canvas"))
      .toHaveAttribute("data-drawn", "true");
    await expect(previewFrame.locator("[data-runtime-chart]")).toHaveCount(1);

    await previewFrame.locator("#tab-two").click();
    await expect(previewFrame.locator("#panel-two")).toBeVisible();
    await expect(previewFrame.locator("#panel-one")).toBeHidden();

    await launched.page.getByRole("button", {
      name: "编辑",
      exact: true,
    }).click();
    await expect(launched.page.getByRole("button", {
      name: "编辑",
      exact: true,
    })).toHaveAttribute("aria-pressed", "true");
    const resumedEditFrame = await currentEditorFrame(launched.page);
    await expect(resumedEditFrame.locator("#panel-two")).toBeVisible();
    await expect(resumedEditFrame.locator("#panel-two")).toHaveClass(/active/u);
    await expect(resumedEditFrame.locator("#panel-one")).toBeHidden();
    await expect(resumedEditFrame.locator("#static-chart")).toBeVisible();
    await expect(resumedEditFrame.locator("#runtime-canvas canvas")).toHaveCount(1);
    await expect(resumedEditFrame.locator("#runtime-svg svg")).toHaveCount(1);
    await expect(resumedEditFrame.locator("[data-runtime-chart]")).toHaveCount(1);
    await expect(resumedEditFrame.locator("[data-pageroot-readonly-visual]")).toHaveCount(0);
    await expect(launched.page.locator("[data-runtime-bootstrap-count=\"1\"]"))
      .toHaveCount(1);
    expect(readFileSync(sourcePath)).toEqual(originalSource);

    await activateNativeEdit(resumedEditFrame, "preview-tab-copy");
    await expect(resumedEditFrame.locator(caseSelector("preview-tab-copy")))
      .toHaveAttribute("contenteditable", "true");
    await setTextSelection(resumedEditFrame, "preview-tab-copy", 0);
    await launched.page.keyboard.insertText("原位");
    await expect.poll(() => resumedEditFrame.locator(
      caseSelector("preview-tab-copy"),
    ).textContent()).toContain("原位");
    const managedSourcePath = await managedWorkingCopyPath(launched.page, sourcePath);
    await expect.poll(() => readFileSync(managedSourcePath, "utf8"))
      .toContain("原位");
    expect(readFileSync(sourcePath, "utf8")).not.toContain("原位");
    expect(readFileSync(sourcePath)).toEqual(originalSource);
  } finally {
    if (electronApp && isolatedUserData) {
      await stopPageRoot(electronApp, isolatedUserData);
    }
    removeValidatedTemporaryDirectory(
      sourceDirectory,
      "pageroot-preview-source-e2e-",
    );
  }
});

test("Electron Edit does not execute an inline authored runtime script", async () => {
  const sourceDirectory = mkdtempSync(
    path.join(tmpdir(), "pageroot-inline-handler-source-e2e-"),
  );
  const sourcePath = path.join(sourceDirectory, "inline-handler-report.html");
  const source = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>Inline handler runtime visual</title></head>
<body onload="const c=document.createElement('canvas');c.width=120;c.height=30;c.getContext('2d').fillRect(0,0,120,30);document.querySelector('div').append(c)">
  <main><div data-native-case="inline-handler-runtime" style="width: 120px; height: 30px"></div></main>
</body>
</html>`;
  writeFileSync(sourcePath, source, "utf8");

  let electronApp = null;
  let isolatedUserData = null;
  try {
    const launched = await launchPageRoot({ activeSourcePath: sourcePath });
    electronApp = launched.electronApp;
    isolatedUserData = launched.isolatedUserData;
    const { frame: editFrame } = await loadedDiskFrame(
      launched.page,
      sourcePath,
      "inline-handler-runtime",
    );
    await expect(editFrame.locator(
      '[data-native-case="inline-handler-runtime"] canvas',
    )).toHaveCount(0);
    await expect(editFrame.locator("[data-pageroot-readonly-visual]")).toHaveCount(0);
    expect(readFileSync(sourcePath, "utf8")).toBe(source);
  } finally {
    if (electronApp && isolatedUserData) {
      await stopPageRoot(electronApp, isolatedUserData);
    }
    removeValidatedTemporaryDirectory(
      sourceDirectory,
      "pageroot-inline-handler-source-e2e-",
    );
  }
});

test("Electron edit Canvas keeps root scrolling in the shared stage across a scrollbar threshold", {
  tag: ["@gate-smoke","@smoke-editing"],
}, async () => {
  test.setTimeout(90_000);
  const sourceDirectory = mkdtempSync(path.join(tmpdir(), "pageroot-native-source-e2e-"));
  const sourcePath = path.join(sourceDirectory, "iframe-root-scroll-feedback.html");
  const original = fixtureBuffer("iframe-root-scroll-feedback.html");
  writeFileSync(sourcePath, original);

  const isolatedUserData = mkdtempSync(path.join(tmpdir(), "pageroot-native-e2e-"));
  let electronApp = null;
  try {
    const launched = await launchPageRoot({
      isolatedUserData,
      activeSourcePath: sourcePath,
    });
    electronApp = launched.electronApp;
    const { editor } = await loadedDiskFrame(
      launched.page,
      sourcePath,
      "iframe-root-scroll-feedback",
    );
    const iframe = editor.locator('iframe[title*="HTML"]');
    const mainRendererUrl = launched.page.url();

    const waitForAnimationFrames = (count) => launched.page.evaluate(
      (frameCount) => new Promise((resolve) => {
        let remaining = frameCount;
        const nextFrame = () => {
          remaining -= 1;
          if (remaining <= 0) {
            resolve();
            return;
          }
          requestAnimationFrame(nextFrame);
        };
        requestAnimationFrame(nextFrame);
      }),
      count,
    );
    const resizeMainWindow = async (width, height = 960) => {
      await electronApp.evaluate(
        ({ BrowserWindow }, { rendererUrl, nextWidth, nextHeight }) => {
          const mainWindow = BrowserWindow.getAllWindows().find((candidate) => (
            candidate.webContents.getURL() === rendererUrl
          ));
          if (!mainWindow) {
            throw new Error("PageRoot main BrowserWindow is unavailable for scrollbar feedback.");
          }
          mainWindow.setContentSize(nextWidth, nextHeight);
        },
        {
          rendererUrl: mainRendererUrl,
          nextWidth: width,
          nextHeight: height,
        },
      );
      await expect.poll(async () => electronApp.evaluate(
        ({ BrowserWindow }, rendererUrl) => {
          const mainWindow = BrowserWindow.getAllWindows().find((candidate) => (
            candidate.webContents.getURL() === rendererUrl
          ));
          return mainWindow?.getContentSize() || null;
        },
        mainRendererUrl,
      )).toEqual([width, height]);
      await waitForAnimationFrames(4);
    };
    const rootMetrics = () => iframe.evaluate((frameElement) => {
      const documentNode = frameElement.contentDocument;
      const frameWindow = frameElement.contentWindow;
      if (!documentNode?.body || !frameWindow) {
        throw new Error("Iframe document is unavailable for scrollbar feedback metrics.");
      }
      const root = documentNode.documentElement;
      const body = documentNode.body;
      return {
        iframeWidth: frameElement.clientWidth,
        iframeHeight: frameElement.clientHeight,
        generation: frameElement.getAttribute("data-frame-generation"),
        rootClientWidth: root.clientWidth,
        viewportWidth: frameWindow.innerWidth,
        rootOverflowY: getComputedStyle(root).overflowY,
        bodyOverflowY: getComputedStyle(body).overflowY,
        rootScrollY: frameWindow.scrollY,
        naturalContentHeight: Math.ceil(Math.max(
          root.getBoundingClientRect().height,
          body.getBoundingClientRect().height,
        )),
      };
    });
    const resizeForIframeWidth = async (targetWidth) => {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const metrics = await rootMetrics();
        if (metrics.iframeWidth === targetWidth) return metrics;
        const pageWidth = await launched.page.evaluate(() => (
          document.documentElement.clientWidth
        ));
        await resizeMainWindow(Math.max(
          1_100,
          Math.round(pageWidth + targetWidth - metrics.iframeWidth),
        ));
      }
      throw new Error(`Could not reach iframe width ${targetWidth}px for scrollbar feedback.`);
    };

    await iframe.evaluate((frameElement) => {
      window.__PAGEROOT_SCROLLBAR_FEEDBACK_DOCUMENT__ = frameElement.contentDocument;
      window.__PAGEROOT_SCROLLBAR_FEEDBACK_GENERATION__ =
        frameElement.getAttribute("data-frame-generation");
    });

    await resizeForIframeWidth(899);
    const thresholdMetrics = await resizeForIframeWidth(900);
    expect(thresholdMetrics.iframeWidth).toBe(900);
    await expect.poll(async () => {
      const metrics = await rootMetrics();
      return (
        metrics.rootOverflowY === "hidden"
        && metrics.bodyOverflowY === "hidden"
        && metrics.rootClientWidth === metrics.viewportWidth
        && metrics.iframeHeight >= metrics.naturalContentHeight
      );
    }).toBe(true);

    const stableSamples = await iframe.evaluate(async (frameElement) => {
      const samples = [];
      for (let index = 0; index < 120; index += 1) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const documentNode = frameElement.contentDocument;
        const frameWindow = frameElement.contentWindow;
        if (!documentNode?.body || !frameWindow) {
          throw new Error("Iframe document was replaced during scrollbar sampling.");
        }
        samples.push({
          iframeHeight: frameElement.clientHeight,
          rootClientWidth: documentNode.documentElement.clientWidth,
          viewportWidth: frameWindow.innerWidth,
          rootScrollY: frameWindow.scrollY,
        });
      }
      return samples;
    });
    expect(new Set(stableSamples.map((sample) => sample.iframeHeight)).size).toBe(1);
    expect(stableSamples.every((sample) => (
      sample.rootClientWidth === sample.viewportWidth && sample.rootScrollY === 0
    ))).toBe(true);

    const nestedScroll = await iframe.evaluate((frameElement) => {
      const frameWindow = frameElement.contentWindow;
      const nested = frameElement.contentDocument?.getElementById("nested-scroll-probe");
      if (!frameWindow || !(nested instanceof frameWindow.HTMLElement)) {
        throw new Error("Nested authored scroll probe is missing.");
      }
      nested.scrollTop = 48;
      return {
        overflowY: getComputedStyle(nested).overflowY,
        scrollTop: nested.scrollTop,
      };
    });
    expect(nestedScroll.overflowY).toBe("auto");
    expect(nestedScroll.scrollTop).toBeGreaterThan(0);

    const reviewStage = launched.page.locator(".review-scroll-stage");
    await reviewStage.evaluate((element) => {
      element.scrollTop = 0;
    });
    const iframeBox = await iframe.boundingBox();
    if (!iframeBox) throw new Error("Iframe is not visible for shared-stage wheel routing.");
    await launched.page.mouse.move(
      iframeBox.x + Math.min(120, iframeBox.width / 2),
      iframeBox.y + Math.min(120, iframeBox.height / 2),
    );
    await launched.page.mouse.wheel(0, 720);
    await expect.poll(() => reviewStage.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0);
    expect((await rootMetrics()).rootScrollY).toBe(0);

    await resizeForIframeWidth(901);
    await waitForAnimationFrames(8);
    expect(await iframe.evaluate((frameElement) => (
      frameElement.contentDocument
        === window.__PAGEROOT_SCROLLBAR_FEEDBACK_DOCUMENT__
      && frameElement.getAttribute("data-frame-generation")
        === window.__PAGEROOT_SCROLLBAR_FEEDBACK_GENERATION__
    ))).toBe(true);
    expect(readFileSync(sourcePath).equals(original)).toBe(true);
  } finally {
    if (electronApp) await stopPageRoot(electronApp, isolatedUserData, { cleanup: false });
    removeIsolatedUserData(isolatedUserData);
    removeValidatedTemporaryDirectory(
      sourceDirectory,
      "pageroot-native-source-e2e-",
    );
  }
});

test("Electron Edit preserves imported source-relative ECharts assets and native source editing", {
  tag: ["@gate-smoke","@smoke-editing"],
}, async () => {
  const sourceDirectory = mkdtempSync(
    path.join(tmpdir(), "pageroot-edit-runtime-source-e2e-"),
  );
  const sourcePath = path.join(sourceDirectory, "echarts-runtime-report.html");
  const runtimeScriptPath = path.join(sourceDirectory, "echarts.js");
  const source = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>One-shot ECharts Edit runtime</title><link rel="stylesheet" href="echarts-runtime.css"></head>
<body>
  <main id="chart-host" data-native-case="runtime-chart" style="width: 640px; height: 360px"></main>
  <p class="runtime-resource-probe" data-native-case="runtime-editable">静态来源文字保持可编辑。</p>
  <script src="echarts.js"></script>
  <script>
    window.__PAGEROOT_ECHARTS_AUTHOR_EXECUTIONS__ = (window.__PAGEROOT_ECHARTS_AUTHOR_EXECUTIONS__ || 0) + 1;
    const chart = window.echarts.init(document.querySelector("#chart-host"));
    chart.setOption({ series: [] });
  </script>
</body>
</html>`;
  const sourceSha256 = sha256(source);
  writeFileSync(runtimeScriptPath, `window.echarts = {
  init(host) {
    host.style.userSelect = "none";
    host.style.webkitTapHighlightColor = "rgba(0, 0, 0, 0)";
    host.style.position = "relative";
    host.style.transform = "scale(0.75)";
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 360;
    canvas.dataset.echartsRuntime = "true";
    const context = canvas.getContext("2d");
    context.fillStyle = "rgb(1, 2, 3)";
    context.fillRect(0, 0, 640, 360);
    host.append(canvas);
    return { setOption() { window.__PAGEROOT_ECHARTS_AUTHOR_SETTLED__ = true; } };
  }
};`, "utf8");
  writeFileSync(
    path.join(sourceDirectory, "echarts-runtime.css"),
    ".runtime-resource-probe { color: rgb(1, 2, 3); }",
    "utf8",
  );
  writeFileSync(sourcePath, source, "utf8");

  let electronApp = null;
  let isolatedUserData = null;
  try {
    const launched = await launchPageRoot({ activeSourcePath: sourcePath });
    electronApp = launched.electronApp;
    isolatedUserData = launched.isolatedUserData;
    const { frame } = await loadedDiskFrame(
      launched.page,
      sourcePath,
      "runtime-editable",
    );
    const activeProject = await launched.page.evaluate(() => (
      window.htmlAIProjects?.getActiveProject()
    ));
    if (typeof activeProject?.sourcePath !== "string") {
      throw new Error("The imported managed Working Copy did not become active.");
    }
    const managedSourcePath = activeProject.sourcePath;
    expect(managedSourcePath).not.toBe(sourcePath);
    expect(activeProject.html).toBe(source);
    await expect.poll(() => frame.evaluate(() => ({
      rendererAuthorExecutions: window.__PAGEROOT_ECHARTS_AUTHOR_EXECUTIONS__ || 0,
      chartCount: document.querySelectorAll("#chart-host canvas[data-echarts-runtime=true]").length,
      frozenSnapshotCount: document.querySelectorAll(
        "#chart-host img[data-pageroot-edit-runtime-snapshot]",
      ).length,
      dataImagePngCount: document.querySelectorAll('img[src^="data:image/png"]').length,
      bootstrapCount: document.querySelectorAll("[data-pageroot-edit-runtime-bootstrap]").length,
      staticScripts: document.querySelectorAll('script[type="application/x-html-canvas-disabled"]').length,
      stubScripts: document.querySelectorAll(
        'script[type="application/x-pageroot-edit-runtime-source"]',
      ).length,
      frozen: document.documentElement.getAttribute("data-pageroot-edit-runtime-frozen"),
      base: document.baseURI,
      stylesheetColor: getComputedStyle(document.querySelector(".runtime-resource-probe")).color,
      hostInlineStyle: document.querySelector("#chart-host").getAttribute("style"),
    })), { timeout: 6_000 }).toMatchObject({
      rendererAuthorExecutions: 1,
      chartCount: 1,
      frozenSnapshotCount: 0,
      dataImagePngCount: 0,
      bootstrapCount: 1,
      staticScripts: 0,
      stubScripts: 2,
      frozen: "true",
      base: expect.stringMatching(/^pageroot-edit-runtime:/u),
      stylesheetColor: "rgb(1, 2, 3)",
      hostInlineStyle: expect.stringMatching(
        /(?=.*user-select: none)(?=.*transform: scale\(0\.75\))/u,
      ),
    });
    await expect(launched.page.locator(".save-status")).toHaveText("已安全保存");
    const renderState = await launched.page.locator(".save-status").evaluate((element) => ({
      canvasGeneration: element.getAttribute("data-canvas-generation"),
      renderGeneration: element.getAttribute("data-render-generation"),
      renderedSha256: element.getAttribute("data-rendered-sha256"),
    }));
    expect(renderState.canvasGeneration).toEqual(expect.any(String));
    expect(renderState.renderGeneration).toBe(renderState.canvasGeneration);
    expect(renderState.renderedSha256).toBe(sourceSha256);
    await expect(launched.page.locator("[data-runtime-bootstrap-count=\"1\"]")).toHaveCount(1);
    expect(sha256(readFileSync(sourcePath, "utf8"))).toBe(sourceSha256);
    const runtimeDocument = await documentToken(frame);
    const replay = await launched.page.evaluate(async () => {
      const host = document.querySelector("main.workbench");
      const fiberKey = host && Object.getOwnPropertyNames(host).find((key) => (
        key.startsWith("__reactFiber$")
      ));
      const seed = fiberKey ? host?.[fiberKey] : null;
      const visited = new Set();
      const stack = seed ? [seed] : [];
      let runtime = null;
      while (stack.length && visited.size < 12_000) {
        const fiber = stack.pop();
        if (!fiber || visited.has(fiber)) continue;
        visited.add(fiber);
        for (let hook = fiber.memoizedState; hook; hook = hook.next) {
          const candidate = hook.memoizedState?.editRuntime;
          if (candidate?.grant?.hosts?.length) runtime = candidate;
        }
        if (runtime) break;
        if (fiber.return) stack.push(fiber.return);
        if (fiber.child) stack.push(fiber.child);
        if (fiber.sibling) stack.push(fiber.sibling);
      }
      const active = await window.htmlAIProjects?.getActiveProject?.();
      if (!runtime?.grant?.hosts?.length || !active?.html || !window.htmlAIEditRuntime) {
        return { state: "setup-failed" };
      }
      try {
        await window.htmlAIEditRuntime.prepare({
          contractVersion: 1,
          requestId: "edit-runtime-replay-fence-0001",
          sourceSha256: runtime.sourceSha256,
          html: active.html,
          hosts: runtime.grant.hosts,
          canvasGeneration: runtime.canvasGeneration,
        });
        return { state: "resolved" };
      } catch (cause) {
        return {
          state: "rejected",
          message: String(cause?.message || cause),
        };
      }
    });
    expect(replay).toMatchObject({
      state: "rejected",
      message: "当前画布的运行时准备已经完成。",
    });
    await expect(launched.page.locator("[data-runtime-bootstrap-count=\"1\"]")).toHaveCount(1);
    expect(await documentToken(launched.page)).toBe(runtimeDocument);
    const runtimeCanvasState = await launched.page.locator("[data-persist-state]").first().evaluate(
      (element) => ({
        canvasGeneration: element.getAttribute("data-canvas-generation"),
        editRevision: element.getAttribute("data-edit-revision"),
        persistedRevision: element.getAttribute("data-persisted-revision"),
      }),
    );

    await addCanvasComment(
      launched.page,
      frame,
      "runtime-editable",
      "运行时图表旁的原生评论。",
    );
    expect({
      document: await documentToken(launched.page),
      canvas: await launched.page.locator("[data-persist-state]").first().evaluate(
        (element) => ({
          canvasGeneration: element.getAttribute("data-canvas-generation"),
          editRevision: element.getAttribute("data-edit-revision"),
          persistedRevision: element.getAttribute("data-persisted-revision"),
        }),
      ),
    }).toEqual({ document: runtimeDocument, canvas: runtimeCanvasState });

    const editable = await activateNativeEdit(frame, "runtime-editable");
    await expect(editable).toHaveAttribute("contenteditable", "true");
    await setTextSelection(frame, "runtime-editable", 0);
    await launched.page.keyboard.insertText("原位");
    await expect.poll(() => readFileSync(managedSourcePath, "utf8"))
      .toContain("原位静态来源文字保持可编辑。");
    expect(sha256(readFileSync(sourcePath, "utf8"))).toBe(sourceSha256);
    expect(readFileSync(sourcePath, "utf8")).toBe(source);
    await launched.page.keyboard.press(process.platform === "darwin" ? "Meta+S" : "Control+S");
    await expect(launched.page.locator(".save-status")).toHaveText("已安全保存");
    await expect(launched.page.locator("[data-runtime-bootstrap-count=\"1\"]")).toHaveCount(1);
    expect(await documentToken(launched.page)).toBe(runtimeDocument);
    expect(frame.isDetached()).toBe(false);
    expect(await frame.evaluate(() => ({
      rendererAuthorExecutions: window.__PAGEROOT_ECHARTS_AUTHOR_EXECUTIONS__,
      chartCount: document.querySelectorAll("#chart-host canvas[data-echarts-runtime=true]").length,
      frozenSnapshotCount: document.querySelectorAll(
        "#chart-host img[data-pageroot-edit-runtime-snapshot]",
      ).length,
      dataImagePngCount: document.querySelectorAll('img[src^="data:image/png"]').length,
    }))).toEqual({
      rendererAuthorExecutions: 1,
      chartCount: 1,
      frozenSnapshotCount: 0,
      dataImagePngCount: 0,
    });
    expect(readFileSync(managedSourcePath, "utf8")).not.toMatch(
      /data-pageroot-edit-runtime|data-echarts-runtime/u,
    );

    await launched.page.keyboard.press("Escape");
    await expect.poll(async () => (
      await frame.locator(caseSelector("runtime-editable")).getAttribute("contenteditable")
    )).not.toBe("true");
    await launched.page.keyboard.press(process.platform === "darwin" ? "Meta+S" : "Control+S");
    await expect(launched.page.locator(".save-status")).toHaveText("已安全保存");
    await expect(launched.page.locator("[data-runtime-bootstrap-count=\"1\"]")).toHaveCount(1);
    expect(await documentToken(launched.page)).toBe(runtimeDocument);
    expect(frame.isDetached()).toBe(false);

    await addCanvasComment(
      launched.page,
      frame,
      "runtime-editable",
      "结束编辑后的精确定位评论。",
    );
    await launched.page.keyboard.press(process.platform === "darwin" ? "Meta+S" : "Control+S");
    await expect(launched.page.locator(".save-status")).toHaveText("已安全保存");
    await expect(launched.page.locator("[data-runtime-bootstrap-count=\"1\"]")).toHaveCount(1);
    expect(await documentToken(launched.page)).toBe(runtimeDocument);
    expect(frame.isDetached()).toBe(false);
    expect(await frame.evaluate(() => ({
      rendererAuthorExecutions: window.__PAGEROOT_ECHARTS_AUTHOR_EXECUTIONS__,
      chartCount: document.querySelectorAll("#chart-host canvas[data-echarts-runtime=true]").length,
      frozenSnapshotCount: document.querySelectorAll(
        "#chart-host img[data-pageroot-edit-runtime-snapshot]",
      ).length,
      dataImagePngCount: document.querySelectorAll('img[src^="data:image/png"]').length,
    }))).toEqual({
      rendererAuthorExecutions: 1,
      chartCount: 1,
      frozenSnapshotCount: 0,
      dataImagePngCount: 0,
    });
    expect(workspaceContainsDraftComment(
      launched.workspace,
      "结束编辑后的精确定位评论。",
    )).toBe(true);
  } finally {
    if (electronApp && isolatedUserData) {
      await stopPageRoot(electronApp, isolatedUserData);
    }
    removeValidatedTemporaryDirectory(
      sourceDirectory,
      "pageroot-edit-runtime-source-e2e-",
    );
  }
});

test("Electron Edit renders CDN ECharts from the bundled 5.5.0 library without a fixed settle", {
  tag: ["@gate-smoke", "@smoke-editing"],
}, async () => {
  const sourceDirectory = mkdtempSync(
    path.join(tmpdir(), "pageroot-bundled-echarts-runtime-e2e-"),
  );
  const sourcePath = path.join(sourceDirectory, "bundled-echarts-report.html");
  const source = `<!doctype html>
<html><head><meta charset="utf-8"><title>Bundled ECharts</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/echarts/5.5.0/echarts.min.js"></script>
</head><body>
<main id="chart-host" style="width:640px;height:360px"></main>
<p data-native-case="bundled-echarts-copy">内置图表库旁的正文。</p>
<script>
window.__PAGEROOT_BUNDLED_ECHARTS_EXECUTIONS__ =
  (window.__PAGEROOT_BUNDLED_ECHARTS_EXECUTIONS__ || 0) + 1;
const chart = echarts.init(document.getElementById("chart-host"));
chart.setOption({
  xAxis:{type:"category",data:["A","B","C"]},
  yAxis:{type:"value"},
  series:[{type:"bar",data:[3,7,5]}]
});
</script></body></html>`;
  writeFileSync(sourcePath, source, "utf8");
  let electronApp = null;
  let isolatedUserData = null;
  try {
    const launched = await launchPageRoot({ activeSourcePath: sourcePath });
    electronApp = launched.electronApp;
    isolatedUserData = launched.isolatedUserData;
    const { frame } = await loadedDiskFrame(
      launched.page,
      sourcePath,
      "bundled-echarts-copy",
    );
    await expect(frame.locator("#chart-host canvas")).toHaveCount(1);
    expect(await frame.evaluate(() => (
      window.__PAGEROOT_BUNDLED_ECHARTS_EXECUTIONS__
    ))).toBe(1);
    await expect(launched.page.getByTestId("html-canvas-editor").filter({ visible: true }))
      .toHaveAttribute("data-runtime-library-origins", /bundled/u);
    expect(await launched.page.evaluate(() => (
      performance.getEntriesByName("pageroot:canvas:render-verified", "mark")
        .at(-1)?.detail?.content
    ))).toBe("runtime-complete");
    expect(sha256(readFileSync(sourcePath, "utf8"))).toBe(sha256(source));
  } finally {
    if (electronApp && isolatedUserData) {
      await stopPageRoot(electronApp, isolatedUserData);
    }
    removeValidatedTemporaryDirectory(
      sourceDirectory,
      "pageroot-bundled-echarts-runtime-e2e-",
    );
  }
});

test("Electron Edit completes bounded Canvas and empty-SVG author paint without source leakage", {
  tag: ["@gate-smoke", "@smoke-editing"],
}, async () => {
  const sourceDirectory = mkdtempSync(
    path.join(tmpdir(), "pageroot-custom-visual-runtime-e2e-"),
  );
  const sourcePath = path.join(sourceDirectory, "custom-visual-runtime.html");
  const source = `<!doctype html>
<html><head><meta charset="utf-8"><title>Custom visual runtime</title></head>
<body>
  <button id="theme-toggle" aria-pressed="false">Theme</button>
  <canvas id="custom-canvas" width="240" height="120">Canvas fallback text</canvas>
  <svg id="custom-svg" style="width:240px;height:120px"></svg>
  <p data-native-case="custom-runtime-editable">自定义图表旁的正文仍可编辑。</p>
  <script>
    window.__PAGEROOT_CUSTOM_VISUAL_EXECUTIONS__ =
      (window.__PAGEROOT_CUSTOM_VISUAL_EXECUTIONS__ || 0) + 1;
    document.documentElement.dataset.theme = "dark";
    document.body.style.background = "rgb(1, 2, 3)";
    document.getElementById("theme-toggle").setAttribute("aria-pressed", "true");
    const canvas = document.getElementById("custom-canvas");
    canvas.width = 480;
    canvas.height = 240;
    const context = canvas.getContext("2d");
    context.fillStyle = "rgb(37, 99, 235)";
    context.fillRect(0, 0, 180, 90);
    const svg = document.getElementById("custom-svg");
    svg.setAttribute("viewBox", "0 0 240 120");
    svg.setAttribute("preserveAspectRatio", "none");
    svg.innerHTML = '<rect width="240" height="120" fill="#7c3aed"></rect>';
  </script>
</body></html>`;
  const sourceSha256 = sha256(source);
  writeFileSync(sourcePath, source, "utf8");

  let electronApp = null;
  let isolatedUserData = null;
  try {
    const launched = await launchPageRoot({ activeSourcePath: sourcePath });
    electronApp = launched.electronApp;
    isolatedUserData = launched.isolatedUserData;
    const { frame } = await loadedDiskFrame(
      launched.page,
      sourcePath,
      "custom-runtime-editable",
    );

    await expect.poll(() => frame.evaluate(() => {
      const canvas = document.getElementById("custom-canvas");
      const context = canvas?.getContext("2d", { willReadFrequently: true });
      const pixel = context?.getImageData(20, 20, 1, 1).data || [];
      const svg = document.getElementById("custom-svg");
      return {
        executions: window.__PAGEROOT_CUSTOM_VISUAL_EXECUTIONS__ || 0,
        canvasPixel: Array.from(pixel),
        canvasSize: [canvas?.width, canvas?.height],
        rootTheme: document.documentElement.getAttribute("data-theme"),
        bodyStyle: document.body.getAttribute("style"),
        themePressed: document.getElementById("theme-toggle")?.getAttribute("aria-pressed"),
        svgRuntimeRects: svg?.querySelectorAll(
          ':scope > svg[data-pageroot-edit-runtime-owned="runtime-svg-surface"] rect',
        ).length || 0,
        outerViewBox: svg?.getAttribute("viewBox"),
        innerViewBox: svg?.querySelector(":scope > svg")?.getAttribute("viewBox"),
        frozen: document.documentElement.getAttribute("data-pageroot-edit-runtime-frozen"),
        snapshots: document.querySelectorAll(
          "img[data-pageroot-edit-runtime-snapshot], img[src^='data:image/png']",
        ).length,
      };
    }), { timeout: 6_000 }).toEqual({
      executions: 1,
      canvasPixel: [37, 99, 235, 255],
      canvasSize: [480, 240],
      rootTheme: null,
      bodyStyle: null,
      themePressed: "false",
      svgRuntimeRects: 1,
      outerViewBox: null,
      innerViewBox: "0 0 240 120",
      frozen: "true",
      snapshots: 0,
    });
    await expect(launched.page.locator("[data-runtime-bootstrap-count=\"1\"]"))
      .toHaveCount(1);
    await expect(launched.page.getByTestId("html-canvas-editor"))
      .toHaveAttribute("data-render-verified", "true");
    expect(await launched.page.evaluate(() => performance.getEntriesByName(
      "pageroot:canvas:render-verified",
    ).at(-1)?.detail?.content)).toBe("runtime-complete");
    expect(sha256(readFileSync(sourcePath, "utf8"))).toBe(sourceSha256);

    const managedSourcePath = await managedWorkingCopyPath(launched.page, sourcePath);
    await activateNativeEdit(frame, "custom-runtime-editable");
    await setTextSelection(frame, "custom-runtime-editable", 0);
    await launched.page.keyboard.insertText("原位");
    await expect.poll(() => readFileSync(managedSourcePath, "utf8"))
      .toContain("原位自定义图表旁的正文仍可编辑。");
    expect(readFileSync(managedSourcePath, "utf8")).not.toMatch(
      /data-pageroot-edit-runtime|runtime-svg-surface/u,
    );
    expect(sha256(readFileSync(sourcePath, "utf8"))).toBe(sourceSha256);
  } finally {
    if (electronApp && isolatedUserData) {
      await stopPageRoot(electronApp, isolatedUserData);
    }
    removeValidatedTemporaryDirectory(
      sourceDirectory,
      "pageroot-custom-visual-runtime-e2e-",
    );
  }
});

test("Electron Edit keeps frozen one-shot iframe through structural line-break and sibling reorder", {
  tag: ["@gate-smoke","@smoke-editing"],
}, async () => {
  const sourceDirectory = mkdtempSync(
    path.join(tmpdir(), "pageroot-edit-runtime-structure-e2e-"),
  );
  const sourcePath = path.join(sourceDirectory, "echarts-structure.html");
  const editableText = "静态来源文字保持可编辑。";
  const siblingText = "第二段可移动。";
  const source = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>One-shot structural Edit runtime</title></head>
<body>
  <p data-native-case="runtime-editable">${editableText}</p>
  <p data-native-case="runtime-sibling">${siblingText}</p>
  <main id="chart-host" data-native-case="runtime-chart" style="width: 640px; height: 360px"></main>
  <script src="echarts.js"></script>
  <script>
    window.__PAGEROOT_ECHARTS_AUTHOR_EXECUTIONS__ = (window.__PAGEROOT_ECHARTS_AUTHOR_EXECUTIONS__ || 0) + 1;
    const chart = window.echarts.init(document.querySelector("#chart-host"));
    chart.setOption({ series: [] });
  </script>
</body>
</html>`;
  writeFileSync(path.join(sourceDirectory, "echarts.js"), ECHARTS_STUB, "utf8");
  writeFileSync(sourcePath, source, "utf8");

  let electronApp = null;
  let isolatedUserData = null;
  try {
    const launched = await launchPageRoot({ activeSourcePath: sourcePath });
    electronApp = launched.electronApp;
    isolatedUserData = launched.isolatedUserData;
    const { frame } = await loadedDiskFrame(
      launched.page,
      sourcePath,
      "runtime-editable",
    );
    const activeProject = await launched.page.evaluate(() => (
      window.htmlAIProjects?.getActiveProject()
    ));
    if (typeof activeProject?.sourcePath !== "string") {
      throw new Error("The imported managed Working Copy did not become active.");
    }
    const managedSourcePath = activeProject.sourcePath;
    await expect.poll(() => frame.evaluate(() => ({
      rendererAuthorExecutions: window.__PAGEROOT_ECHARTS_AUTHOR_EXECUTIONS__ || 0,
      chartCount: document.querySelectorAll("#chart-host canvas[data-echarts-runtime=true]").length,
      frozen: document.documentElement.getAttribute("data-pageroot-edit-runtime-frozen"),
      bootstrapCount: document.querySelectorAll("[data-pageroot-edit-runtime-bootstrap]").length,
    })), { timeout: 6_000 }).toMatchObject({
      rendererAuthorExecutions: 1,
      chartCount: 1,
      frozen: "true",
      bootstrapCount: 1,
    });
    await expect(launched.page.locator(".save-status")).toHaveText("已安全保存");
    const baseline = {
      document: await documentToken(launched.page),
      canvasGeneration: await launched.page.locator("[data-persist-state]").first()
        .evaluate((element) => element.getAttribute("data-canvas-generation")),
    };

    const editable = await activateNativeEdit(frame, "runtime-editable");
    await expect(editable).toHaveAttribute("contenteditable", "true");
    await setTextSelection(frame, "runtime-editable", editableText.length);
    await launched.page.keyboard.press("Enter");
    await expect.poll(() => editable.evaluate((element) => element.innerHTML))
      .toContain("<br>");
    await launched.page.keyboard.press("Escape");
    await expect.poll(async () => (
      frame.isDetached()
        ? "detached"
        : await frame.locator(caseSelector("runtime-editable")).getAttribute("contenteditable")
    )).not.toBe("true");
    await expect(launched.page.locator(".save-status")).toHaveText("已安全保存");
    await assertFrozenRuntimeRetained(launched.page, frame, baseline);
    expect(readFileSync(managedSourcePath, "utf8")).toMatch(/<br\s*\/?>/u);

    await frame.locator(caseSelector("runtime-editable")).click();
    const moveDown = launched.page.getByRole("button", { name: "下移" });
    await expect(moveDown).toBeEnabled();
    await moveDown.click();
    await expect.poll(() => readFileSync(managedSourcePath, "utf8")).toMatch(
      new RegExp(`${siblingText}[\\s\\S]*${editableText}`, "u"),
    );
    await expect(launched.page.locator(".save-status")).toHaveText("已安全保存");
    await assertFrozenRuntimeRetained(launched.page, frame, baseline);
    expect(readFileSync(managedSourcePath, "utf8")).not.toMatch(
      /data-pageroot-edit-runtime|data-echarts-runtime/u,
    );
  } finally {
    if (electronApp && isolatedUserData) {
      await stopPageRoot(electronApp, isolatedUserData);
    }
    removeValidatedTemporaryDirectory(
      sourceDirectory,
      "pageroot-edit-runtime-structure-e2e-",
    );
  }
});

test("Electron Edit keeps frozen author canvas when unused empty hosts have no paint", async () => {
  const sourceDirectory = mkdtempSync(
    path.join(tmpdir(), "pageroot-edit-runtime-unused-host-e2e-"),
  );
  const sourcePath = path.join(sourceDirectory, "echarts-unused-host.html");
  const runtimeScriptPath = path.join(sourceDirectory, "echarts.js");
  const source = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>Unused empty host Edit runtime</title></head>
<body>
  <main id="chart-host" data-native-case="runtime-chart" style="width: 640px; height: 360px"></main>
  <div id="data-table"></div>
  <p class="runtime-resource-probe" data-native-case="runtime-unused-host">静态来源文字保持可编辑。</p>
  <script src="echarts.js"></script>
  <script>
    window.__PAGEROOT_ECHARTS_AUTHOR_EXECUTIONS__ = (window.__PAGEROOT_ECHARTS_AUTHOR_EXECUTIONS__ || 0) + 1;
    const chart = window.echarts.init(document.querySelector("#chart-host"));
    chart.setOption({ series: [] });
  </script>
</body>
</html>`;
  writeFileSync(runtimeScriptPath, `window.echarts = {
  init(host) {
    host.style.userSelect = "none";
    host.style.webkitTapHighlightColor = "rgba(0, 0, 0, 0)";
    host.style.position = "relative";
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 360;
    canvas.dataset.echartsRuntime = "true";
    host.append(canvas);
    return { setOption() { window.__PAGEROOT_ECHARTS_AUTHOR_SETTLED__ = true; } };
  }
};`, "utf8");
  writeFileSync(sourcePath, source, "utf8");

  let electronApp = null;
  let isolatedUserData = null;
  try {
    const launched = await launchPageRoot({ activeSourcePath: sourcePath });
    electronApp = launched.electronApp;
    isolatedUserData = launched.isolatedUserData;
    const { frame } = await loadedDiskFrame(
      launched.page,
      sourcePath,
      "runtime-unused-host",
    );
    await expect.poll(() => frame.evaluate(() => ({
      rendererAuthorExecutions: window.__PAGEROOT_ECHARTS_AUTHOR_EXECUTIONS__ || 0,
      chartCount: document.querySelectorAll("#chart-host canvas[data-echarts-runtime=true]").length,
      unusedHostPaint: document.querySelectorAll("#data-table canvas, #data-table svg").length,
      frozenSnapshotCount: document.querySelectorAll(
        "img[data-pageroot-edit-runtime-snapshot]",
      ).length,
      dataImagePngCount: document.querySelectorAll('img[src^="data:image/png"]').length,
      bootstrapCount: document.querySelectorAll("[data-pageroot-edit-runtime-bootstrap]").length,
      hostCount: document.querySelectorAll("[data-pageroot-edit-runtime-host]").length,
      frozen: document.documentElement.getAttribute("data-pageroot-edit-runtime-frozen"),
      resultState: JSON.parse(
        document.documentElement.getAttribute("data-pageroot-edit-runtime-result") || "null",
      )?.state || null,
      base: document.baseURI,
    })), { timeout: 6_000 }).toMatchObject({
      rendererAuthorExecutions: 1,
      chartCount: 1,
      unusedHostPaint: 0,
      frozenSnapshotCount: 0,
      dataImagePngCount: 0,
      bootstrapCount: 1,
      hostCount: 2,
      frozen: "true",
      resultState: "frozen",
      base: expect.stringMatching(/^pageroot-edit-runtime:/u),
    });
    await expect(launched.page.locator("[data-runtime-bootstrap-count=\"1\"]")).toHaveCount(1);
  } finally {
    if (electronApp && isolatedUserData) {
      await stopPageRoot(electronApp, isolatedUserData);
    }
    removeValidatedTemporaryDirectory(
      sourceDirectory,
      "pageroot-edit-runtime-unused-host-e2e-",
    );
  }
});

test("Electron Edit drains MessageChannel callbacks before accepting the frozen iframe", {
  tag: ["@gate-smoke","@smoke-editing"],
}, async () => {
  const sourceDirectory = mkdtempSync(
    path.join(tmpdir(), "pageroot-edit-runtime-message-channel-e2e-"),
  );
  const sourcePath = path.join(sourceDirectory, "echarts-message-channel.html");
  const probeText = "冻结后源码文字不得被端口改写。";
  const source = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>One-shot MessageChannel freeze</title></head>
<body>
  <p data-native-case="runtime-message-probe">${probeText}</p>
  <main id="chart-host" data-native-case="runtime-chart" style="width: 640px; height: 360px"></main>
  <script src="echarts.js"></script>
  <script>
    window.__PAGEROOT_ECHARTS_AUTHOR_EXECUTIONS__ = (window.__PAGEROOT_ECHARTS_AUTHOR_EXECUTIONS__ || 0) + 1;
    const chart = window.echarts.init(document.querySelector("#chart-host"));
    chart.setOption({ series: [] });
    const probe = document.querySelector("[data-native-case=runtime-message-probe]");
    const channel = new MessageChannel();
    channel.port2.onmessage = () => {
      if (document.documentElement.getAttribute("data-pageroot-edit-runtime-frozen") === "true") {
        probe.textContent = ["端口在冻结后", "改写了源码文字"].join("");
        return;
      }
      channel.port1.postMessage("ping");
    };
    channel.port1.postMessage("start");
  </script>
</body>
</html>`;
  writeFileSync(path.join(sourceDirectory, "echarts.js"), ECHARTS_STUB, "utf8");
  writeFileSync(sourcePath, source, "utf8");

  let electronApp = null;
  let isolatedUserData = null;
  try {
    const launched = await launchPageRoot({ activeSourcePath: sourcePath });
    electronApp = launched.electronApp;
    isolatedUserData = launched.isolatedUserData;
    const { frame } = await loadedDiskFrame(
      launched.page,
      sourcePath,
      "runtime-message-probe",
    );
    const activeProject = await launched.page.evaluate(() => (
      window.htmlAIProjects?.getActiveProject()
    ));
    if (typeof activeProject?.sourcePath !== "string") {
      throw new Error("The imported managed Working Copy did not become active.");
    }
    await expect.poll(() => frame.evaluate(() => ({
      rendererAuthorExecutions: window.__PAGEROOT_ECHARTS_AUTHOR_EXECUTIONS__ || 0,
      chartCount: document.querySelectorAll("#chart-host canvas[data-echarts-runtime=true]").length,
      frozen: document.documentElement.getAttribute("data-pageroot-edit-runtime-frozen"),
      probe: document.querySelector("[data-native-case=runtime-message-probe]")?.textContent || "",
    })), { timeout: 6_000 }).toMatchObject({
      rendererAuthorExecutions: 1,
      chartCount: 1,
      frozen: "true",
      probe: probeText,
    });
    await launched.page.waitForTimeout(800);
    expect(await frame.evaluate(() => (
      document.querySelector("[data-native-case=runtime-message-probe]")?.textContent || ""
    ))).toBe(probeText);
    const savedSource = readFileSync(activeProject.sourcePath, "utf8");
    expect(savedSource).toContain(`data-native-case="runtime-message-probe">${probeText}</p>`);
    expect(savedSource).not.toContain("端口在冻结后改写了源码文字");
    expect(frame.isDetached()).toBe(false);
    await expect(launched.page.locator("[data-runtime-bootstrap-count=\"1\"]")).toHaveCount(1);
  } finally {
    if (electronApp && isolatedUserData) {
      await stopPageRoot(electronApp, isolatedUserData);
    }
    removeValidatedTemporaryDirectory(
      sourceDirectory,
      "pageroot-edit-runtime-message-channel-e2e-",
    );
  }
});

test("Electron Edit keeps frozen author canvas beside an authored inline PNG", {
  tag: ["@gate-smoke","@smoke-editing"],
}, async () => {
  const sourceDirectory = mkdtempSync(
    path.join(tmpdir(), "pageroot-edit-runtime-authored-png-e2e-"),
  );
  const sourcePath = path.join(sourceDirectory, "echarts-authored-png.html");
  const authoredPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const source = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>One-shot authored PNG Edit runtime</title></head>
<body>
  <img data-native-case="runtime-authored-png" alt="logo" src="${authoredPng}">
  <main id="chart-host" data-native-case="runtime-chart" style="width: 640px; height: 360px"></main>
  <p data-native-case="runtime-png-editable">静态来源文字保持可编辑。</p>
  <script src="echarts.js"></script>
  <script>
    window.__PAGEROOT_ECHARTS_AUTHOR_EXECUTIONS__ = (window.__PAGEROOT_ECHARTS_AUTHOR_EXECUTIONS__ || 0) + 1;
    const chart = window.echarts.init(document.querySelector("#chart-host"));
    chart.setOption({ series: [] });
  </script>
</body>
</html>`;
  writeFileSync(path.join(sourceDirectory, "echarts.js"), ECHARTS_STUB, "utf8");
  writeFileSync(sourcePath, source, "utf8");

  let electronApp = null;
  let isolatedUserData = null;
  try {
    const launched = await launchPageRoot({ activeSourcePath: sourcePath });
    electronApp = launched.electronApp;
    isolatedUserData = launched.isolatedUserData;
    const { frame } = await loadedDiskFrame(
      launched.page,
      sourcePath,
      "runtime-png-editable",
    );
    await expect.poll(() => frame.evaluate(() => ({
      rendererAuthorExecutions: window.__PAGEROOT_ECHARTS_AUTHOR_EXECUTIONS__ || 0,
      chartCount: document.querySelectorAll("#chart-host canvas[data-echarts-runtime=true]").length,
      frozenSnapshotCount: document.querySelectorAll(
        "img[data-pageroot-edit-runtime-snapshot]",
      ).length,
      authoredPngCount: document.querySelectorAll(
        "img[data-native-case=runtime-authored-png]",
      ).length,
      dataImagePngCount: document.querySelectorAll('img[src^="data:image/png"]').length,
      frozen: document.documentElement.getAttribute("data-pageroot-edit-runtime-frozen"),
      resultState: JSON.parse(
        document.documentElement.getAttribute("data-pageroot-edit-runtime-result") || "null",
      )?.state || null,
    })), { timeout: 6_000 }).toMatchObject({
      rendererAuthorExecutions: 1,
      chartCount: 1,
      frozenSnapshotCount: 0,
      authoredPngCount: 1,
      dataImagePngCount: 1,
      frozen: "true",
      resultState: "frozen",
    });
    await expect(launched.page.locator("[data-runtime-bootstrap-count=\"1\"]")).toHaveCount(1);
    expect(frame.isDetached()).toBe(false);
  } finally {
    if (electronApp && isolatedUserData) {
      await stopPageRoot(electronApp, isolatedUserData);
    }
    removeValidatedTemporaryDirectory(
      sourceDirectory,
      "pageroot-edit-runtime-authored-png-e2e-",
    );
  }
});

test("Electron Edit rejects unsafe ECharts host styling without persisting it", {
  tag: ["@gate-smoke","@smoke-editing"],
}, async () => {
  const sourceDirectory = mkdtempSync(
    path.join(tmpdir(), "pageroot-edit-runtime-rejection-source-e2e-"),
  );
  const sourcePath = path.join(sourceDirectory, "echarts-runtime-rejection.html");
  const runtimeScriptPath = path.join(sourceDirectory, "echarts.js");
  const source = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>Rejected ECharts Edit runtime</title></head>
<body>
  <main id="chart-host" style="width: 640px; height: 360px"></main>
  <p data-native-case="runtime-rejected-editable">静态来源文字保持可编辑。</p>
  <script src="echarts.js"></script>
  <script>
    const chart = window.echarts.init(document.querySelector("#chart-host"));
    chart.setOption({ series: [] });
  </script>
</body>
</html>`;
  const sourceSha256 = sha256(source);
  writeFileSync(runtimeScriptPath, `window.echarts = {
  init(host) {
    host.style.position = "fixed";
    const canvas = document.createElement("canvas");
    canvas.dataset.echartsRuntime = "unsafe";
    host.append(canvas);
    return { setOption() {} };
  }
};`, "utf8");
  writeFileSync(sourcePath, source, "utf8");

  let electronApp = null;
  let isolatedUserData = null;
  try {
    const launched = await launchPageRoot({ activeSourcePath: sourcePath });
    electronApp = launched.electronApp;
    isolatedUserData = launched.isolatedUserData;
    await loadedDiskFrame(
      launched.page,
      sourcePath,
      "runtime-rejected-editable",
    );
    // A rejected one-shot frame is replaced by the ordinary static frame; wait
    // beyond the fixed runtime deadline before reading the current iframe.
    await launched.page.waitForTimeout(4_500);
    const frame = await currentEditorFrame(launched.page);
    await expect.poll(() => frame.evaluate(() => ({
      frozen: document.documentElement.getAttribute("data-pageroot-edit-runtime-frozen"),
      result: document.documentElement.getAttribute("data-pageroot-edit-runtime-result"),
      bootstrapCount: document.querySelectorAll("[data-pageroot-edit-runtime-bootstrap]").length,
      runtimeMarkerCount: [...document.querySelectorAll("*")].filter((element) => (
        [...element.attributes].some((attribute) => (
          attribute.name.startsWith("data-pageroot-edit-runtime")
        ))
      )).length,
      canvasCount: document.querySelectorAll("#chart-host canvas").length,
      runtimeCanvasCount: document.querySelectorAll("canvas[data-echarts-runtime]").length,
      hostStyle: document.querySelector("#chart-host").getAttribute("style"),
    })), { timeout: 2_000 }).toMatchObject({
      frozen: null,
      result: null,
      bootstrapCount: 0,
      runtimeMarkerCount: 0,
      canvasCount: 0,
      runtimeCanvasCount: 0,
      hostStyle: expect.stringMatching(/width:\s*640px.*height:\s*360px/u),
    });
    await expect(launched.page.locator(".save-status")).toHaveText("已安全保存");
    expect(sha256(readFileSync(sourcePath, "utf8"))).toBe(sourceSha256);
    expect(readFileSync(sourcePath, "utf8")).toBe(source);
  } finally {
    if (electronApp && isolatedUserData) {
      await stopPageRoot(electronApp, isolatedUserData);
    }
    removeValidatedTemporaryDirectory(
      sourceDirectory,
      "pageroot-edit-runtime-rejection-source-e2e-",
    );
  }
});

test("Electron Edit records same-origin parent access as an accepted direct-runtime risk", async () => {
  const sourceDirectory = mkdtempSync(
    path.join(tmpdir(), "pageroot-edit-runtime-parent-escape-e2e-"),
  );
  const sourcePath = path.join(sourceDirectory, "echarts-runtime-parent-escape.html");
  const runtimeScriptPath = path.join(sourceDirectory, "echarts.js");
  const source = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>Isolated ECharts runtime</title></head>
<body>
  <main id="chart-host" style="width: 320px; height: 120px"></main>
  <p data-native-case="runtime-isolated-editable">静态来源文字保持可编辑。</p>
  <script src="echarts.js"></script>
  <script>
    const chart = window.echarts.init(document.querySelector("#chart-host"));
    chart.setOption({ series: [] });
  </script>
</body>
</html>`;
  const sourceSha256 = sha256(source);
  writeFileSync(runtimeScriptPath, `window.echarts = {
  init(host) {
    window.parent.document.documentElement.setAttribute("data-pageroot-author-escape", "true");
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 120;
    canvas.dataset.echartsRuntime = "parent-escape";
    host.append(canvas);
    return { setOption() {} };
  }
};`, "utf8");
  writeFileSync(sourcePath, source, "utf8");

  let electronApp = null;
  let isolatedUserData = null;
  try {
    const launched = await launchPageRoot({ activeSourcePath: sourcePath });
    electronApp = launched.electronApp;
    isolatedUserData = launched.isolatedUserData;
    await loadedDiskFrame(
      launched.page,
      sourcePath,
      "runtime-isolated-editable",
    );
    // Direct one-shot Edit runs in the final visible iframe. Same-origin
    // window.parent access is a known, accepted product risk (ADR 0025) and
    // is not a screenshot-fallback gate. The source file still must not
    // persist runtime descendants or PNG substitutes.
    await launched.page.waitForTimeout(4_500);
    const frame = await currentEditorFrame(launched.page);
    await expect.poll(() => frame.evaluate(() => ({
      runtimeCanvasCount: document.querySelectorAll("canvas[data-echarts-runtime]").length,
      snapshotCount: document.querySelectorAll(
        "img[data-pageroot-edit-runtime-snapshot]",
      ).length,
      dataImagePngCount: document.querySelectorAll('img[src^="data:image/png"]').length,
      frozen: document.documentElement.getAttribute("data-pageroot-edit-runtime-frozen"),
    })), { timeout: 2_000 }).toMatchObject({
      runtimeCanvasCount: 1,
      snapshotCount: 0,
      dataImagePngCount: 0,
      frozen: "true",
    });
    await expect(launched.page.locator(".save-status")).toHaveText("已安全保存");
    const editable = await activateNativeEdit(frame, "runtime-isolated-editable");
    await expect(editable).toHaveAttribute("contenteditable", "true");
    expect(sha256(readFileSync(sourcePath, "utf8"))).toBe(sourceSha256);
    expect(readFileSync(sourcePath, "utf8")).toBe(source);
  } finally {
    if (electronApp && isolatedUserData) {
      await stopPageRoot(electronApp, isolatedUserData);
    }
    removeValidatedTemporaryDirectory(
      sourceDirectory,
      "pageroot-edit-runtime-parent-escape-e2e-",
    );
  }
});

test("Electron edit mode reveals safe semantic content without changing disk bytes", {
  tag: ["@gate-smoke","@smoke-editing"],
}, async () => {
  const sourceDirectory = mkdtempSync(
    path.join(tmpdir(), "pageroot-presentation-source-e2e-"),
  );
  const sourcePath = path.join(sourceDirectory, "presentation-actions.html");
  const original = fixtureBuffer("presentation-actions.html");
  writeFileSync(sourcePath, original);

  let electronApp = null;
  let isolatedUserData = null;
  try {
    const launched = await launchPageRoot({ activeSourcePath: sourcePath });
    electronApp = launched.electronApp;
    isolatedUserData = launched.isolatedUserData;
    const { editor, frame } = await loadedDiskFrame(
      launched.page,
      sourcePath,
      "presentation-root",
    );

    await frame.locator(caseSelector("details-tab")).click();
    await editor.getByRole("button", {
      name: "切换到此页签",
      exact: true,
    }).click();
    await expect(frame.locator(caseSelector("overview-panel"))).toBeHidden();
    await expect(frame.locator(caseSelector("details-panel"))).toBeVisible();

    await frame.locator(caseSelector("native-summary")).click({
      modifiers: ["Alt"],
    });
    await expect(frame.locator(caseSelector("native-details")))
      .toHaveAttribute("open", "");

    await frame.locator(caseSelector("more-toggle")).click({
      modifiers: ["Alt"],
    });
    await expect(frame.locator(caseSelector("more-toggle")))
      .toHaveAttribute("aria-expanded", "true");
    await expect(frame.locator(caseSelector("more-content"))).toBeVisible();

    expect(await frame.evaluate(() => ({
      authorAction: document.documentElement.dataset.authorAction ?? null,
      authorScriptRan: document.documentElement.dataset.authorScriptRan ?? null,
    }))).toEqual({
      authorAction: null,
      authorScriptRan: null,
    });
    expect(readFileSync(sourcePath).equals(original)).toBe(true);
  } finally {
    if (electronApp && isolatedUserData) {
      await stopPageRoot(electronApp, isolatedUserData);
    }
    removeValidatedTemporaryDirectory(
      sourceDirectory,
      "pageroot-presentation-source-e2e-",
    );
  }
});
