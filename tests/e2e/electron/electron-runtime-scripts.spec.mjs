import { expect, test } from "@playwright/test";

import { buildSourceIndex } from "../../../app/lib/source-index.js";

import {
  ECHARTS_STUB,
  currentEditorFrame,
  documentToken,
  expectCheckpointPersisted,
  loadedDiskFrame,
  managedWorkingCopyPath,
  readFileSync,
} from "./electron-native-harness.mjs";
import { withRuntimeProject } from "./electron-runtime-helpers.mjs";

test("Electron Edit executes parser-blocking, inline, defer and module programs with DOMContentLoaded and base", async () => {
  const html = `<!doctype html>
<html><head><title>Runtime compatibility</title>
  <template><base href="../inert-assets/"></template>
  <base target="_blank">
  <base href="./assets/">
  <script src="blocking.js"></script>
  <script>
    window.__runtimeOrder.push('inline');
    window.addEventListener('DOMContentLoaded', () => {
      window.__runtimeOrder.push('dom-content-loaded');
      document.body.dataset.domContentLoadedReady = 'true';
    }, { once: true });
  </script>
  <script defer src="defer.js"></script>
  <script type="module">
    window.__runtimeOrder.push('module');
    document.body.dataset.moduleReady = 'true';
  </script>
</head><body>
  <main data-native-case="scheduled-runtime"></main>
</body></html>`;
  await withRuntimeProject("pageroot-scheduled-runtime-e2e-", {
    "runtime-report.html": html,
    "assets/blocking.js": [
      "window.__runtimeOrder = ['parser-blocking'];",
      "document.documentElement.dataset.parserBlockingReady = 'true';",
    ].join("\n"),
    "assets/defer.js": [
      "window.__runtimeOrder.push('defer');",
      "document.body.dataset.deferReady = 'true';",
    ].join("\n"),
  }, async ({ page, sourcePath }) => {
    const { frame } = await loadedDiskFrame(page, sourcePath, "scheduled-runtime");
    await expect(frame.locator("html")).toHaveAttribute("data-parser-blocking-ready", "true");
    await expect(frame.locator("body")).toHaveAttribute("data-defer-ready", "true");
    await expect(frame.locator("body")).toHaveAttribute("data-module-ready", "true");
    await expect(frame.locator("body")).toHaveAttribute("data-dom-content-loaded-ready", "true");
    await expect.poll(() => frame.evaluate(() => window.__runtimeOrder)).toEqual([
      "parser-blocking",
      "inline",
      "defer",
      "module",
      "dom-content-loaded",
    ]);
    await expect(frame.locator("base")).toHaveAttribute(
      "href",
      /^pageroot-edit-runtime:\/\/[a-f0-9]{32}\/assets\/$/u,
    );
    expect(readFileSync(sourcePath, "utf8")).toBe(html);
  });
});

test("unsupported Script programs enter an explicit static Edit state", async () => {
  const html = `<!doctype html>
<html><head><title>Static fallback</title></head><body>
  <main data-native-case="static-runtime-fallback">源码仍可编辑</main>
  <script type="module">
    import { runtimeMarker } from './runtime-module.js';
    document.body.dataset.runtimeMarker = runtimeMarker;
  </script>
</body></html>`;
  await withRuntimeProject("pageroot-static-runtime-fallback-e2e-", {
    "runtime-report.html": html,
    "runtime-module.js": "export const runtimeMarker = 'executed';",
  }, async ({ page, sourcePath }) => {
    const { frame } = await loadedDiskFrame(page, sourcePath, "static-runtime-fallback");
    await expect(page.getByTestId("edit-runtime-static-fallback")).toContainText(
      "部分动态内容未运行",
    );
    await expect(page.getByTestId("edit-runtime-static-fallback")).toContainText(
      "当前已显示静态页面，仍可编辑和保存。",
    );
    await expect(page.getByRole("button", { name: "重新加载动态内容" })).toHaveCount(0);
    await expect(page.locator(".canvas-edit-surface")).toHaveAttribute(
      "data-edit-runtime-phase",
      "static-fallback",
    );
    const editor = page.getByTestId("html-canvas-editor").filter({ visible: true }).first();
    await expect(editor).toHaveAttribute("data-render-verified", "true");
    await expect(editor.locator('iframe[data-runtime-slot-role="active"]'))
      .toHaveAttribute("sandbox", "allow-same-origin");
    await expect(frame.locator("body")).not.toHaveAttribute("data-runtime-marker", "executed");
    await page.getByRole("button", { name: "关闭动态内容提示" }).click();
    await expect(page.getByTestId("edit-runtime-static-fallback")).toHaveCount(0);
    await expect(page.locator(".canvas-edit-surface")).toHaveAttribute(
      "data-edit-runtime-phase",
      "static-fallback",
    );
    expect(readFileSync(sourcePath, "utf8")).toBe(html);
  });
});

test("static fallback can reload dynamic content and dismiss itself after success", async () => {
  const html = `<!doctype html>
<html><head><title>Runtime retry</title></head><body>
  <main data-native-case="runtime-retry">动态内容重试</main>
  <script>
    parent.__PAGEROOT_RUNTIME_RETRY_COUNT__ =
      (parent.__PAGEROOT_RUNTIME_RETRY_COUNT__ || 0) + 1;
    if (parent.__PAGEROOT_RUNTIME_RETRY_COUNT__ === 1) {
      throw new Error('synthetic first activation failure');
    }
    document.body.dataset.runtimeRetryReady = 'true';
  </script>
</body></html>`;

  await withRuntimeProject("pageroot-runtime-retry-e2e-", {
    "runtime-report.html": html,
  }, async ({ page, sourcePath }) => {
    await expect(page.getByTestId("edit-runtime-static-fallback")).toContainText(
      "部分动态内容未更新",
    );
    await expect(page.locator(".canvas-edit-surface")).toHaveAttribute(
      "data-edit-runtime-phase",
      "static-fallback",
    );
    const editor = page.getByTestId("html-canvas-editor").filter({ visible: true }).first();
    await expect(editor.locator('iframe[data-runtime-slot-role="active"]')).toBeVisible();
    await expect(editor).toHaveAttribute("data-render-verified", "true");
    const workingCopyPath = await managedWorkingCopyPath(page, sourcePath);
    let frame = await currentEditorFrame(page);
    const retryTarget = frame.locator('[data-native-case="runtime-retry"]');
    await retryTarget.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const eventInit = {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + Math.max(1, rect.width / 2),
        clientY: rect.top + Math.max(1, rect.height / 2),
      };
      element.dispatchEvent(new MouseEvent("click", { ...eventInit, detail: 1 }));
      element.dispatchEvent(new MouseEvent("dblclick", { ...eventInit, detail: 2 }));
    });
    await expect(retryTarget).toHaveAttribute("contenteditable", "true");
    await retryTarget.press("End");
    const revisionBeforeEdit = Number(await page.locator("[data-persist-state]").first()
      .getAttribute("data-persisted-revision"));
    await page.keyboard.insertText(" 已保存的新文字");
    await page.keyboard.press("Escape");
    await expectCheckpointPersisted(page, revisionBeforeEdit);
    await expect.poll(() => readFileSync(workingCopyPath, "utf8"))
      .toContain("已保存的新文字");
    const latestWorkingSource = readFileSync(workingCopyPath, "utf8");
    const latestWorkingHash = buildSourceIndex(latestWorkingSource).sourceSha256;
    await page.evaluate(() => {
      window.__PAGEROOT_RUNTIME_RETRY_SLOT_TRANSITIONS__ = [];
      window.__PAGEROOT_RUNTIME_RETRY_SLOT_OBSERVER__?.disconnect();
      const observer = new MutationObserver((records) => {
        for (const record of records) {
          if (!(record.target instanceof HTMLIFrameElement)) continue;
          window.__PAGEROOT_RUNTIME_RETRY_SLOT_TRANSITIONS__.push({
            slot: record.target.getAttribute("data-runtime-slot"),
            attribute: record.attributeName,
            previous: record.oldValue,
            current: record.target.getAttribute(record.attributeName),
            role: record.target.getAttribute("data-runtime-slot-role"),
            sandbox: record.target.getAttribute("sandbox"),
          });
        }
      });
      observer.observe(document.body, {
        attributes: true,
        attributeOldValue: true,
        subtree: true,
        attributeFilter: ["data-runtime-slot-role", "sandbox"],
      });
      window.__PAGEROOT_RUNTIME_RETRY_SLOT_OBSERVER__ = observer;
    });
    await page.getByRole("button", { name: "重新加载动态内容" }).click();
    ({ frame } = await loadedDiskFrame(page, sourcePath, "runtime-retry"));
    await expect.poll(() => page.locator(".canvas-edit-surface").getAttribute(
      "data-edit-runtime-phase",
    ), { timeout: 12_000 }).toBe("settled");
    await expect(page.getByTestId("edit-runtime-static-fallback")).toHaveCount(0);
    await expect(frame.locator("body")).toHaveAttribute("data-runtime-retry-ready", "true");
    await expect.poll(() => page.evaluate(() => (
      window.__PAGEROOT_RUNTIME_RETRY_COUNT__ || 0
    ))).toBe(2);
    const slotTransitions = await page.evaluate(() => {
      window.__PAGEROOT_RUNTIME_RETRY_SLOT_OBSERVER__?.disconnect();
      return window.__PAGEROOT_RUNTIME_RETRY_SLOT_TRANSITIONS__ || [];
    });
    expect(slotTransitions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        attribute: "data-runtime-slot-role",
        previous: "inactive",
        role: "candidate",
        sandbox: expect.stringContaining("allow-scripts"),
      }),
    ]));
    await expect(frame.locator('[data-native-case="runtime-retry"]')).toHaveText(
      "动态内容重试 已保存的新文字",
    );
    await expect(editor).toHaveAttribute(
      "data-runtime-last-known-good-source-revision",
      latestWorkingHash,
    );
  });
});

test("Edit frame navigation blocks location.assign and location.replace", async () => {
  const html = `<!doctype html>
<html><head><title>Navigation</title></head><body>
  <main data-native-case="runtime-navigation">页面保持在原文档</main>
  <script>
    window.__attemptAssignNavigation = () => {
      document.body.dataset.assignAttempted = 'true';
      location.assign(new URL('/navigation-assign', document.baseURI).href);
    };
    window.__attemptReplaceNavigation = () => {
      document.body.dataset.replaceAttempted = 'true';
      location.replace(new URL('/navigation-replace', document.baseURI).href);
    };
  </script>
</body></html>`;
  await withRuntimeProject("pageroot-runtime-navigation-e2e-", {
    "runtime-report.html": html,
  }, async ({ page, sourcePath }) => {
    const { frame } = await loadedDiskFrame(page, sourcePath, "runtime-navigation");
    await frame.evaluate(() => window.__attemptAssignNavigation());
    await expect(frame.locator("body")).toHaveAttribute("data-assign-attempted", "true");
    await expect(frame.locator('[data-native-case="runtime-navigation"]')).toHaveText(
      "页面保持在原文档",
    );
    await frame.evaluate(() => window.__attemptReplaceNavigation());
    await expect(frame.locator("body")).toHaveAttribute("data-replace-attempted", "true");
    await expect(frame.locator('[data-native-case="runtime-navigation"]')).toHaveText(
      "页面保持在原文档",
    );
    expect(readFileSync(sourcePath, "utf8")).toBe(html);
  });
});

test("Electron Edit renders a source-relative ECharts page in the editable iframe", {
  tag: ["@gate-smoke", "@smoke-editing"],
}, async () => {
  const html = `<!doctype html>
<html><head><title>Runtime</title></head><body>
  <main id="chart" data-native-case="echarts-runtime" style="width:320px;height:180px"></main>
  <script src="echarts.js"></script>
  <script>
    const chart = document.querySelector('#chart');
    echarts.init(chart).setOption({series:[{type:'bar',data:[1,2,3]}]});
    const runtimeOverlay = document.createElement('div');
    runtimeOverlay.id = 'runtime-chart-overlay';
    runtimeOverlay.style.cssText = 'position:absolute;inset:0;z-index:2;cursor:crosshair';
    chart.append(runtimeOverlay);
  </script>
</body></html>`;
  await withRuntimeProject("pageroot-echarts-runtime-e2e-", {
    "runtime-report.html": html,
    "echarts.js": ECHARTS_STUB,
  }, async ({ page, sourcePath }) => {
    const { frame } = await loadedDiskFrame(page, sourcePath, "echarts-runtime");
    await expect(frame.locator("#chart canvas")).toHaveCount(1);
    await expect(frame.locator("#runtime-chart-overlay")).toBeVisible();
    await frame.locator("#runtime-chart-overlay").hover();
    await expect.poll(() => frame.locator("html").getAttribute("data-html-canvas-pointer"))
      .toBeNull();
    await expect.poll(() => frame.locator("#runtime-chart-overlay").evaluate(
      (element) => getComputedStyle(element).cursor,
    )).toBe("crosshair");
    await expect(frame.locator("[data-pageroot-edit-runtime-bootstrap]")).toHaveCount(1);
    await expect(frame.locator("[data-pageroot-edit-runtime-frozen]")).toHaveCount(0);
    expect(readFileSync(sourcePath, "utf8")).toBe(html);
    const firstDocumentToken = await documentToken(page);
    const tabs = page.getByRole("tablist", { name: "已打开的页面" });
    const documentTab = tabs.getByRole("tab").first();
    await page.getByRole("button", { name: "新标签页" }).click();
    await documentTab.click();
    const reopened = await loadedDiskFrame(page, sourcePath, "echarts-runtime");
    await expect(reopened.frame.locator("#chart canvas")).toHaveCount(1);
    await expect.poll(() => documentToken(page)).not.toBe(firstDocumentToken);
    expect(readFileSync(sourcePath, "utf8")).toBe(html);
  });
});

test("author async scripts settle without blocking deferred DOMContentLoaded", {
  tag: ["@gate-smoke", "@smoke-editing"],
}, async () => {
  const html = `<!doctype html>
<html><head><title>Async Runtime</title></head><body data-native-case="runtime-async-dcl">
  <script>
    document.addEventListener('DOMContentLoaded', () => {
      document.body.dataset.asyncLoadedAtDcl = String(Boolean(window.__asyncProbeLoaded));
    }, { once: true });
  </script>
  <script async src="async-probe.js"></script>
</body></html>`;
  await withRuntimeProject("pageroot-runtime-async-dcl-e2e-", {
    "runtime-report.html": html,
    "async-probe.js": "window.__asyncProbeLoaded = true;",
  }, async ({ page, sourcePath }) => {
    const { frame } = await loadedDiskFrame(page, sourcePath, "runtime-async-dcl");
    await expect(frame.locator("body")).toHaveAttribute("data-async-loaded-at-dcl", "false");
    await expect.poll(() => frame.evaluate(() => window.__asyncProbeLoaded)).toBe(true);
    await expect(page.getByTestId("edit-runtime-static-fallback")).toHaveCount(0);
    expect(readFileSync(sourcePath, "utf8")).toBe(html);
  });
});

test("Electron Edit renders the reviewed ECharts 5.4.3 URL immediately with packaged compatible bytes", {
  tag: ["@gate-smoke", "@smoke-editing"],
}, async () => {
  const html = `<!doctype html>
<html><head><title>Compatible Runtime</title></head><body>
  <main id="chart" data-native-case="echarts-compatible-runtime" style="width:320px;height:180px"></main>
  <script src="https://cdn.jsdelivr.net/npm/echarts@5.4.3/dist/echarts.min.js"></script>
  <script>
    echarts.init(document.querySelector('#chart')).setOption({
      animation: false,
      xAxis: { type: 'category', data: ['A', 'B', 'C'] },
      yAxis: { type: 'value' },
      series: [{ type: 'bar', data: [1, 2, 3] }],
    });
  </script>
</body></html>`;
  await withRuntimeProject("pageroot-echarts-compatible-e2e-", {
    "runtime-report.html": html,
  }, async ({ page, sourcePath }) => {
    const { frame } = await loadedDiskFrame(
      page,
      sourcePath,
      "echarts-compatible-runtime",
    );
    await expect(frame.locator("#chart canvas")).toHaveCount(1);
    await expect(page.getByTestId("html-canvas-editor")).toHaveAttribute(
      "data-runtime-library-origins",
      /bundled-compatible/u,
    );
    await expect(page.getByTestId("edit-runtime-static-fallback")).toHaveCount(0);
    expect(readFileSync(sourcePath, "utf8")).toBe(html);
  });
});

test("compatible ECharts activation failure recovers exactly once with exact 5.4.3 bytes", {
  tag: ["@gate-smoke", "@smoke-editing"],
}, async () => {
  const html = `<!doctype html>
<html><head><title>Exact Runtime Recovery</title></head><body>
  <main id="chart" data-native-case="echarts-exact-recovery" style="width:320px;height:180px"></main>
  <script src="https://cdn.jsdelivr.net/npm/echarts@5.4.3/dist/echarts.min.js"></script>
  <script>
    const activations = window.parent.__PAGEROOT_ECHARTS_EXACT_RECOVERY__ || [];
    activations.push(echarts.version);
    window.parent.__PAGEROOT_ECHARTS_EXACT_RECOVERY__ = activations;
    document.addEventListener('DOMContentLoaded', () => {
      if (echarts.version !== '5.4.3') {
        throw new Error('compatible ECharts must not become activation-ready: ' + echarts.version);
      }
      echarts.init(document.querySelector('#chart')).setOption({
        animation: false,
        xAxis: { type: 'category', data: ['A', 'B', 'C'] },
        yAxis: { type: 'value' },
        series: [{ type: 'bar', data: [1, 2, 3] }],
      });
    }, { once: true });
  </script>
</body></html>`;
  await withRuntimeProject("pageroot-echarts-exact-recovery-e2e-", {
    "runtime-report.html": html,
  }, async ({ page, sourcePath }) => {
    const { frame } = await loadedDiskFrame(
      page,
      sourcePath,
      "echarts-exact-recovery",
    );
    await expect(frame.locator("#chart canvas")).toHaveCount(1);
    await expect.poll(() => page.evaluate(() => (
      window.__PAGEROOT_ECHARTS_EXACT_RECOVERY__ || []
    ))).toEqual(["5.6.0", "5.4.3"]);
    await expect(page.getByTestId("html-canvas-editor")).toHaveAttribute(
      "data-runtime-library-origins",
      /(?:network|disk-cache)/u,
    );
    await expect(page.getByTestId("html-canvas-editor")).not.toHaveAttribute(
      "data-runtime-library-origins",
      /bundled-compatible/u,
    );
    await expect(page.getByTestId("edit-runtime-static-fallback")).toHaveCount(0);
    await expect(page.locator(".canvas-edit-surface")).not.toHaveAttribute(
      "data-edit-runtime-phase",
      "static-fallback",
    );
    expect(readFileSync(sourcePath, "utf8")).toBe(html);
  });
});
