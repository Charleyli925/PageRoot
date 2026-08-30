import { expect, test } from "@playwright/test";

import { buildSourceIndex } from "../../../app/lib/source-index.js";

import {
  ECHARTS_STUB,
  currentEditorFrame,
  documentToken,
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

async function withRuntimeProject(prefix, files, run) {
  const sourceDirectory = mkdtempSync(path.join(tmpdir(), prefix));
  const sourcePath = path.join(sourceDirectory, "runtime-report.html");
  for (const [relativePath, content] of Object.entries(files)) {
    const targetPath = path.join(sourceDirectory, relativePath);
    mkdirSync(path.dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, content, "utf8");
  }
  let electronApp = null;
  let isolatedUserData = null;
  try {
    const launched = await launchPageRoot({ activeSourcePath: sourcePath });
    electronApp = launched.electronApp;
    isolatedUserData = launched.isolatedUserData;
    await run({ ...launched, sourcePath, sourceDirectory });
  } finally {
    if (electronApp && isolatedUserData) {
      await stopPageRoot(electronApp, isolatedUserData);
    }
    removeValidatedTemporaryDirectory(sourceDirectory, prefix);
  }
}

function parserPreclaimFixture() {
  const futurePagerootId = "pr1_123456789abc4def8abc000000000006";
  const nodeIdPlaceholder = "__FUTURE_SOURCE_NODE_ID__";
  const template = `<!doctype html>
<html data-pageroot-id="pr1_123456789abc4def8abc000000000001"><head data-pageroot-id="pr1_123456789abc4def8abc000000000002"><title data-pageroot-id="pr1_123456789abc4def8abc000000000003">Preclaim</title><script data-pageroot-id="pr1_123456789abc4def8abc000000000004">
    const decoy = document.createElement('button');
    decoy.id = 'runtime-preclaim-decoy';
    decoy.textContent = '伪造源码按钮';
    decoy.setAttribute('data-pageroot-id', '${futurePagerootId}');
    decoy.setAttribute('data-html-ai-source-node-id', '${nodeIdPlaceholder}');
    decoy.setAttribute('data-pageroot-edit-runtime-source', '${nodeIdPlaceholder}');
    document.documentElement.append(decoy);
  </script></head><body data-pageroot-id="pr1_123456789abc4def8abc000000000005"><button id="future-source" data-native-case="runtime-preclaim" data-pageroot-id="${futurePagerootId}">真实源码按钮</button></body></html>`;
  let sourceNodeId = nodeIdPlaceholder;
  let html = template;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    html = template.replaceAll(nodeIdPlaceholder, sourceNodeId);
    const next = buildSourceIndex(html).byPagerootId.get(futurePagerootId)?.nodeId;
    if (!next) throw new Error("Unable to resolve future source-node identity.");
    if (next === sourceNodeId) return html;
    sourceNodeId = next;
  }
  throw new Error("Future source-node identity did not stabilize.");
}

test("author script cannot preclaim a future parser-authored source object", {
  tag: ["@gate-smoke", "@smoke-editing"],
}, async () => {
  const html = parserPreclaimFixture();
  await withRuntimeProject("pageroot-runtime-preclaim-e2e-", {
    "runtime-report.html": html,
  }, async ({ page, sourcePath }) => {
    const { frame } = await loadedDiskFrame(page, sourcePath, "runtime-preclaim");
    await expect(frame.locator("#runtime-preclaim-decoy")).toHaveText("伪造源码按钮");
    const toolbar = page.getByRole("toolbar", { name: /编辑/u });

    await frame.locator("#runtime-preclaim-decoy").click();
    await expect(toolbar.getByRole("button", { name: /留评论/u })).toBeVisible();
    await expect(toolbar.getByRole("button", { name: "编辑", exact: true })).toHaveCount(0);
    await expect(toolbar.getByRole("button", { name: "删除元素", exact: true })).toHaveCount(0);

    await page.keyboard.press("Escape");
    await frame.locator("#future-source").click();
    await expect(toolbar.getByRole("button", { name: "删除元素", exact: true })).toBeVisible();
    expect(readFileSync(sourcePath, "utf8")).toBe(html);
    expect(readFileSync(sourcePath, "utf8")).not.toContain(
      '<button id="runtime-preclaim-decoy"',
    );
  });
});

test("author Script cannot add source authority after Runtime starts or save Runtime DOM", {
  tag: ["@gate-smoke", "@smoke-editing"],
}, async () => {
  const html = `<!doctype html>
<html><head><title>Runtime</title></head><body>
  <main data-native-case="runtime-host">
    <p>源码正文</p>
    <button id="source-id-forged">被脚本改写 ID 的源码按钮</button>
    <button id="source-id-late">选中后被脚本改写 ID 的源码按钮</button>
    <button id="source-id-decoy">另一个源码按钮</button>
  </main>
  <script>
    const host = document.querySelector('[data-native-case="runtime-host"]');
    const sourceIdForged = document.querySelector('#source-id-forged');
    const sourceIdLate = document.querySelector('#source-id-late');
    const sourceIdDecoy = document.querySelector('#source-id-decoy');
    sourceIdForged.setAttribute(
      'data-html-ai-source-node-id',
      sourceIdDecoy.getAttribute('data-html-ai-source-node-id'),
    );
    window.__mutateSelectedSourceIdentity = () => {
      sourceIdLate.setAttribute(
        'data-html-ai-source-node-id',
        sourceIdDecoy.getAttribute('data-html-ai-source-node-id'),
      );
    };
    const generated = document.createElement('button');
    generated.id = 'runtime-generated';
    generated.textContent = '运行时按钮';
    const copiedSourceId = host.getAttribute('data-html-ai-source-node-id');
    const copiedRuntimeMarker = host.getAttribute('data-pageroot-edit-runtime-source');
    generated.setAttribute('data-pageroot-edit-runtime-source', copiedRuntimeMarker);
    generated.setAttribute('data-html-ai-source-node-id', copiedSourceId);
    generated.setAttribute('data-pageroot-id', host.getAttribute('data-pageroot-id'));
    const copiedProofProperty = Object.getOwnPropertyNames(host).find(
      (name) => name.startsWith('__pageroot_edit_source_'),
    );
    if (copiedProofProperty) {
      Object.defineProperty(generated, copiedProofProperty, {
        value: host[copiedProofProperty],
      });
    }
    host.append(generated);
    const bodyGenerated = document.createElement('button');
    bodyGenerated.id = 'runtime-body-generated';
    bodyGenerated.textContent = '页面运行时按钮';
    document.body.append(bodyGenerated);
    let ticks = 0;
    window.setInterval(() => {
      ticks += 1;
      document.body.dataset.runtimeTicks = String(ticks);
    }, 25);
    try {
      const workerUrl = URL.createObjectURL(new Blob([
        'postMessage("worker-executed")',
      ], { type: 'text/javascript' }));
      const worker = new Worker(workerUrl);
      worker.addEventListener('message', () => {
        document.body.dataset.workerExecuted = 'true';
      });
      worker.addEventListener('error', () => {
        document.body.dataset.workerBlocked = 'true';
        worker.terminate();
        URL.revokeObjectURL(workerUrl);
      });
      window.setTimeout(() => {
        document.body.dataset.workerBlocked = 'true';
        worker.terminate();
        URL.revokeObjectURL(workerUrl);
      }, 5_000);
    } catch {
      document.body.dataset.workerBlocked = 'true';
    }
  </script>
</body></html>`;

  await withRuntimeProject("pageroot-disposable-runtime-e2e-", {
    "runtime-report.html": html,
  }, async ({ page, sourcePath }) => {
    const { frame } = await loadedDiskFrame(page, sourcePath, "runtime-host");
    await expect(frame.locator("#runtime-generated")).toHaveText("运行时按钮");
    await expect.poll(() => frame.locator("body").getAttribute("data-runtime-ticks"))
      .not.toBeNull();
    const firstTicks = Number(await frame.locator("body").getAttribute("data-runtime-ticks"));
    await expect.poll(async () => Number(
      await frame.locator("body").getAttribute("data-runtime-ticks"),
    )).toBeGreaterThan(firstTicks);
    await expect.poll(() => frame.locator("body").getAttribute("data-worker-blocked"))
      .toBe("true");
    await expect(frame.locator("body")).not.toHaveAttribute("data-worker-executed", "true");

    await frame.locator("#runtime-generated").click();
    const toolbar = page.getByRole("toolbar", { name: /编辑/u });
    await expect(toolbar.getByRole("button", { name: /留评论/u })).toBeVisible();
    await expect(toolbar.getByRole("button", { name: "编辑", exact: true })).toHaveCount(0);
    await expect(toolbar.getByRole("button", { name: "删除元素", exact: true })).toHaveCount(0);

    await page.keyboard.press("Escape");
    await frame.locator("#source-id-forged").click();
    await expect(toolbar.getByRole("button", { name: /留评论/u })).toBeVisible();
    await expect(toolbar.getByRole("button", { name: "编辑", exact: true })).toHaveCount(0);
    await expect(toolbar.getByRole("button", { name: "删除元素", exact: true })).toHaveCount(0);

    await page.keyboard.press("Escape");
    await frame.locator("#source-id-late").click();
    await expect(toolbar.getByRole("button", { name: "删除元素", exact: true })).toBeVisible();
    await frame.evaluate(() => window.__mutateSelectedSourceIdentity());
    await expect.poll(async () => frame.locator("#source-id-late").getAttribute(
      "data-html-ai-source-node-id",
    )).toBe(await frame.locator("#source-id-decoy").getAttribute(
      "data-html-ai-source-node-id",
    ));
    await toolbar.getByRole("button", { name: "删除元素", exact: true }).click();
    await expect(frame.locator("#source-id-late")).toHaveCount(1);
    await expect(frame.locator("#source-id-decoy")).toHaveCount(1);

    await page.keyboard.press("Escape");
    await expect(toolbar).toBeHidden();
    await frame.locator("#runtime-body-generated").click();
    await expect(toolbar.getByRole("button", { name: /留评论/u })).toBeVisible();
    await expect(toolbar.getByRole("button", { name: "编辑", exact: true })).toHaveCount(0);

    const provenance = await frame.locator("#runtime-generated").evaluate((node) => ({
      generatedSourceId: node.getAttribute("data-html-ai-source-node-id"),
      runtimeMarker: node.getAttribute("data-pageroot-edit-runtime-source"),
      hostSourceId: node.closest("[data-html-ai-source-node-id]")
        ?.getAttribute("data-html-ai-source-node-id") || null,
    }));
    expect(provenance.generatedSourceId).toBe(provenance.hostSourceId);
    expect(provenance.runtimeMarker).toBe(provenance.generatedSourceId);
    expect(readFileSync(sourcePath, "utf8")).toBe(html);
    expect(readFileSync(sourcePath, "utf8")).not.toContain('<button id="runtime-generated"');

    const firstDocumentToken = await documentToken(page);
    const tablist = page.getByRole("tablist", { name: "已打开的页面" });
    const documentTab = tablist.getByRole("tab").first();
    await page.getByRole("button", { name: "新标签页" }).click();
    await documentTab.click();
    const reopened = await loadedDiskFrame(page, sourcePath, "runtime-host");
    await expect(reopened.frame.locator("#runtime-generated")).toHaveText("运行时按钮");
    await expect.poll(() => documentToken(page)).not.toBe(firstDocumentToken);
  });
});

test("semantic structure edit rebuilds the disposable page and reruns its script", {
  tag: ["@gate-smoke", "@smoke-editing"],
}, async () => {
  const html = `<!doctype html>
<html><head><title>Runtime</title></head><body>
  <div aria-hidden="true" style="height:600px"></div>
  <section>
    <p id="first" data-native-case="runtime-first">甲</p>
    <p id="second">乙</p>
    <output id="runtime-order"></output>
    <div aria-hidden="true" style="height:1600px"></div>
  </section>
  <script>
    document.querySelector('#runtime-order').textContent = Array.from(
      document.querySelectorAll('section > p'),
      (node) => node.textContent,
    ).join('');
  </script>
</body></html>`;

  await withRuntimeProject("pageroot-runtime-rerender-e2e-", {
    "runtime-report.html": html,
  }, async ({ page, sourcePath }) => {
    const { frame } = await loadedDiskFrame(page, sourcePath, "runtime-first");
    await expect(frame.locator("#runtime-order")).toHaveText("甲乙");
    const beforeDocument = await documentToken(page);
    const stableId = await frame.locator('[data-native-case="runtime-first"]')
      .getAttribute("data-pageroot-id");
    expect(stableId).toMatch(/^pr1_[a-f0-9]{32}$/u);
    const reviewStage = page.locator(".review-scroll-stage");
    await expect.poll(() => reviewStage.evaluate((element) => (
      element.scrollHeight - element.clientHeight
    ))).toBeGreaterThan(480);
    await frame.locator('[data-native-case="runtime-first"]').click();
    await reviewStage.evaluate((element) => {
      element.scrollTop = 480;
    });
    await expect.poll(() => reviewStage.evaluate((element) => element.scrollTop)).toBe(480);
    const moveDownButton = page.getByRole("button", { name: "下移", exact: true });
    await expect(moveDownButton).toBeVisible();
    const moveDownBox = await moveDownButton.boundingBox();
    expect(moveDownBox).not.toBeNull();
    const viewport = await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
    }));
    expect(moveDownBox.x).toBeGreaterThanOrEqual(0);
    expect(moveDownBox.y).toBeGreaterThanOrEqual(0);
    expect(moveDownBox.x + moveDownBox.width).toBeLessThanOrEqual(viewport.width);
    expect(moveDownBox.y + moveDownBox.height).toBeLessThanOrEqual(viewport.height);
    // Use the already-visible toolbar coordinate. locator.click() is allowed to
    // scroll an ancestor first; that Playwright convenience would replace the
    // user viewport before the product can capture it for the rebuild.
    await page.mouse.click(
      moveDownBox.x + moveDownBox.width / 2,
      moveDownBox.y + moveDownBox.height / 2,
    );

    const nextFrame = await currentEditorFrame(page);
    await expect.poll(() => documentToken(page)).not.toBe(beforeDocument);
    await expect(nextFrame.locator("#runtime-order")).toHaveText("乙甲");
    await expect(nextFrame.locator("section > p").first()).toHaveAttribute("id", "second");
    await expect(nextFrame.locator(
      `[data-pageroot-id="${stableId}"][data-html-canvas-selected]`,
    )).toHaveCount(1);
    await expect.poll(() => reviewStage.evaluate((element) => element.scrollTop)).toBe(480);
    const workingCopyPath = await managedWorkingCopyPath(page, sourcePath);
    await expect.poll(() => readFileSync(workingCopyPath, "utf8"))
      .toMatch(/id="second"[\s\S]*id="first"/u);
    expect(readFileSync(sourcePath, "utf8")).toBe(html);
    expect(readFileSync(workingCopyPath, "utf8")).not.toContain("乙甲</output>");
  });
});

test("Electron Edit executes parser-blocking, inline, defer and module programs with DOMContentLoaded and base", async () => {
  const html = `<!doctype html>
<html><head><title>Runtime compatibility</title>
  <base href="./assets/">
  <script src="blocking.js"></script>
  <script>
    window.__runtimeOrder.push('inline');
    document.addEventListener('DOMContentLoaded', () => {
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
      "脚本未在编辑画布中运行",
    );
    await expect(page.locator(".canvas-edit-surface")).toHaveAttribute(
      "data-edit-runtime-phase",
      "static-fallback",
    );
    await expect(frame.locator("body")).not.toHaveAttribute("data-runtime-marker", "executed");
    expect(readFileSync(sourcePath, "utf8")).toBe(html);
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
  <script>echarts.init(document.querySelector('#chart')).setOption({series:[{type:'bar',data:[1,2,3]}]});</script>
</body></html>`;
  await withRuntimeProject("pageroot-echarts-runtime-e2e-", {
    "runtime-report.html": html,
    "echarts.js": ECHARTS_STUB,
  }, async ({ page, sourcePath }) => {
    const { frame } = await loadedDiskFrame(page, sourcePath, "echarts-runtime");
    await expect(frame.locator("#chart canvas")).toHaveCount(1);
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
