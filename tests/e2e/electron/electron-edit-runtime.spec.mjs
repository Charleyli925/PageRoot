import { expect, test } from "@playwright/test";

import { buildSourceIndex } from "../../../app/lib/source-index.js";

import {
  ECHARTS_STUB,
  clickEditHistoryMenu,
  currentEditorFrame,
  documentToken,
  expectCheckpointPersisted,
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

async function armRuntimeHandoffSamples(page) {
  await page.evaluate(() => {
    const editor = document.querySelector('[data-testid="html-canvas-editor"]');
    const oldFrame = editor?.querySelector('iframe[title*="HTML"]');
    if (!editor || !(oldFrame instanceof HTMLIFrameElement)) {
      throw new Error("The active Edit iframe was not available before the runtime handoff.");
    }
    const samples = [];
    window.__PAGEROOT_RUNTIME_HANDOFF_SAMPLES__ = samples;
    window.__PAGEROOT_RUNTIME_CANDIDATE_FRAME__ = null;
    window.__PAGEROOT_RUNTIME_CANDIDATE_FRAMES__ = Object.create(null);
    window.__PAGEROOT_RUNTIME_OLD_FRAME__ = oldFrame;
    window.__PAGEROOT_RUNTIME_HANDOFF_ACTIVE__ = true;
    const reviewStage = editor.closest(".review-scroll-stage");
    const sample = (rafSequence = null) => {
      if (!window.__PAGEROOT_RUNTIME_HANDOFF_ACTIVE__) return;
      const candidate = editor.querySelector('iframe[data-frame-role="runtime-candidate"]');
      if (candidate) {
        const generation = candidate.getAttribute("data-frame-generation");
        if (generation) {
          window.__PAGEROOT_RUNTIME_CANDIDATE_FRAMES__[generation] = candidate;
          window.__PAGEROOT_RUNTIME_CANDIDATE_FRAME__ = candidate;
        }
      }
      const candidateFrame = window.__PAGEROOT_RUNTIME_CANDIDATE_FRAME__;
      const activeFrame = Array.from(editor.querySelectorAll("iframe"))
        .find((frame) => !frame.hasAttribute("data-frame-role"));
      const activeStyle = activeFrame ? getComputedStyle(activeFrame) : null;
      const candidateStyle = candidateFrame ? getComputedStyle(candidateFrame) : null;
      const candidateGeneration = candidateFrame?.getAttribute("data-frame-generation")
        || candidate?.getAttribute("data-frame-generation")
        || null;
      const selected = activeFrame?.contentDocument
        ?.querySelector("[data-html-canvas-selected]");
      const selectedRect = selected?.getBoundingClientRect() || null;
      const activeFrameRect = activeFrame?.getBoundingClientRect() || null;
      const stageRect = reviewStage?.getBoundingClientRect() || null;
      const activeSelection = activeFrame?.contentDocument?.getSelection();
      const activeScrollingElement = activeFrame?.contentDocument?.scrollingElement;
      const sharedScrollElement = reviewStage;
      let caretOffsetY = null;
      if (activeSelection?.isCollapsed && activeSelection.focusNode) {
        try {
          const range = activeFrame.contentDocument.createRange();
          range.setStart(activeSelection.focusNode, activeSelection.focusOffset);
          range.collapse(true);
          caretOffsetY = range.getBoundingClientRect().top;
        } catch {
          caretOffsetY = null;
        }
      }
      const visibleFrames = Array.from(editor.querySelectorAll("iframe"))
        .filter((frame) => frame.isConnected && getComputedStyle(frame).visibility === "visible")
        .map((frame) => ({
          frame,
          opacity: Number(getComputedStyle(frame).opacity),
          zIndex: Number(getComputedStyle(frame).zIndex) || 0,
        }))
        .filter(({ opacity }) => opacity > 0.01)
        .sort((left, right) => right.zIndex - left.zIndex);
      const topFrame = visibleFrames[0]?.frame || null;
      const topFrameStyle = topFrame ? getComputedStyle(topFrame) : null;
      const selectionAnchorOffset = activeSelection?.anchorOffset ?? null;
      const selectionFocusOffset = activeSelection?.focusOffset ?? null;
      samples.push({
        rafSequence,
        candidateGeneration,
        candidateVisibility: candidateFrame ? candidateStyle?.visibility : null,
        candidateOpacity: candidateFrame ? candidateStyle?.opacity : null,
        candidatePointerEvents: candidateFrame ? candidateStyle?.pointerEvents : null,
        newFrameOpacity: candidateFrame ? candidateStyle?.opacity : null,
        newFramePointerEvents: candidateFrame ? candidateStyle?.pointerEvents : null,
        oldConnected: oldFrame.isConnected,
        oldGeneration: oldFrame.getAttribute("data-frame-generation"),
        oldRenderVerified: editor.getAttribute("data-render-verified"),
        oldVisibility: oldFrame.isConnected ? getComputedStyle(oldFrame).visibility : null,
        oldOpacity: oldFrame.isConnected ? getComputedStyle(oldFrame).opacity : null,
        handoffState: editor.getAttribute("data-runtime-handoff"),
        oldSelectedCount: oldFrame.contentDocument
          ?.querySelectorAll("[data-html-canvas-selected]").length || 0,
        toolbarVisible: Boolean(
          editor.querySelector('[role="toolbar"]')?.getClientRects().length,
        ),
        activeGeneration: activeFrame?.getAttribute("data-frame-generation") || null,
        activeVisibility: activeStyle?.visibility || null,
        activeOpacity: activeStyle?.opacity || null,
        activePointerEvents: activeStyle?.pointerEvents || null,
        topFrameGeneration: topFrame?.getAttribute("data-frame-generation") || null,
        topFrameIsActive: topFrame === activeFrame,
        topFrameVisibility: topFrameStyle?.visibility || null,
        topFrameOpacity: topFrameStyle?.opacity || null,
        topFramePointerEvents: topFrameStyle?.pointerEvents || null,
        iframeScrollY: activeFrame?.contentWindow?.scrollY ?? null,
        iframeScrollX: activeFrame?.contentWindow?.scrollX ?? null,
        sharedScrollTop: sharedScrollElement?.scrollTop ?? null,
        sharedScrollLeft: sharedScrollElement?.scrollLeft ?? null,
        iframeWidth: activeFrame?.clientWidth ?? null,
        iframeHeight: activeFrame?.clientHeight ?? null,
        documentClientWidth: activeScrollingElement?.clientWidth ?? null,
        documentClientHeight: activeScrollingElement?.clientHeight ?? null,
        documentScrollWidth: activeScrollingElement?.scrollWidth ?? null,
        documentScrollHeight: activeScrollingElement?.scrollHeight ?? null,
        sharedClientWidth: sharedScrollElement?.clientWidth ?? null,
        sharedClientHeight: sharedScrollElement?.clientHeight ?? null,
        sharedScrollWidth: sharedScrollElement?.scrollWidth ?? null,
        sharedScrollHeight: sharedScrollElement?.scrollHeight ?? null,
        selectedStableId: selected?.getAttribute("data-pageroot-id") || null,
        selectionStableId: selected?.getAttribute("data-pageroot-id") || null,
        viewportAnchorStableId: selected?.getAttribute("data-pageroot-id") || null,
        selectionAnchorOffset,
        selectionFocusOffset,
        selectionCollapsed: activeSelection?.isCollapsed ?? null,
        viewportAnchorOffsetY: selectedRect?.top ?? null,
        selectedTop: selectedRect?.top ?? null,
        selectedScreenTop: selectedRect && activeFrameRect
          ? activeFrameRect.top + selectedRect.top
          : null,
        selectedStageTop: selectedRect && activeFrameRect && stageRect
          ? activeFrameRect.top - stageRect.top + selectedRect.top
          : null,
        caretOffsetY,
        activeElement: activeFrame?.contentDocument?.activeElement?.getAttribute?.(
          "data-native-case",
        ) || activeFrame?.contentDocument?.activeElement?.tagName || null,
        focused: Boolean(
          activeFrame?.contentDocument?.activeElement
          && activeFrame.contentDocument.activeElement !== activeFrame.contentDocument.body,
        ),
        layoutReady: editor.getAttribute("data-runtime-layout-ready") === "true",
      });
    };
    const observer = new MutationObserver(() => sample(null));
    observer.observe(editor, { attributes: true, childList: true, subtree: true });
    window.__PAGEROOT_RUNTIME_HANDOFF_OBSERVER__ = observer;
    let animationFrame = 0;
    let rafSequence = 0;
    const sampleLoop = () => {
      rafSequence += 1;
      sample(rafSequence);
      if (window.__PAGEROOT_RUNTIME_HANDOFF_ACTIVE__) {
        animationFrame = requestAnimationFrame(sampleLoop);
      }
    };
    window.__PAGEROOT_RUNTIME_HANDOFF_ANIMATION_FRAME__ = () => cancelAnimationFrame(animationFrame);
    sampleLoop();
  });
}

async function assertRuntimeHandoff(page, {
  requireActiveChrome = false,
  expectPromotion = true,
  assertVisualContinuity = false,
  expectedFocus,
  expectedViewportSample,
} = {}) {
  await expect.poll(() => page.evaluate(() => (
    window.__PAGEROOT_RUNTIME_HANDOFF_SAMPLES__ || []
  ).some((sample) => sample.candidateGeneration))).toBe(true);
  if (expectPromotion) {
    try {
      await expect.poll(() => page.evaluate(() => (
        window.__PAGEROOT_RUNTIME_HANDOFF_SAMPLES__ || []
      ).some((sample) => (
        sample.handoffState === "active"
        && sample.activeGeneration === sample.candidateGeneration
      )))).toBe(true);
    } catch (cause) {
      const diagnostics = await page.evaluate(() => ({
        attributes: Object.fromEntries(
          Array.from(document.querySelector('[data-testid="html-canvas-editor"]')?.attributes || [])
            .filter((attribute) => attribute.name.startsWith("data-"))
            .map((attribute) => [attribute.name, attribute.value]),
        ),
        samples: window.__PAGEROOT_RUNTIME_HANDOFF_SAMPLES__ || [],
      }));
      throw new Error(`${cause.message}\nRuntime handoff diagnostics: ${JSON.stringify(diagnostics)}`);
    }
  } else {
    // A failed candidate is observed at the handoff boundary. Do not wait for
    // the runtime session's separate static-fallback policy, because that
    // would hide the old-frame rollback this assertion is meant to inspect.
    await expect.poll(() => page.evaluate(() => (
      window.__PAGEROOT_RUNTIME_HANDOFF_SAMPLES__ || []
    ).some((sample) => sample.handoffState === "preparing"))).toBe(true);
  }
  const handoffSamples = await page.evaluate(() => {
    window.__PAGEROOT_RUNTIME_HANDOFF_ACTIVE__ = false;
    window.__PAGEROOT_RUNTIME_HANDOFF_ANIMATION_FRAME__?.();
    window.__PAGEROOT_RUNTIME_HANDOFF_OBSERVER__?.disconnect();
    return window.__PAGEROOT_RUNTIME_HANDOFF_SAMPLES__ || [];
  });
  const candidateSamples = handoffSamples.filter((sample) => sample.candidateGeneration);
  expect(candidateSamples.length).toBeGreaterThan(0);
  const preparingSamples = candidateSamples.filter((sample) => sample.handoffState === "preparing");
  expect(preparingSamples.length).toBeGreaterThan(0);
  const activeFrameStayedManaged = preparingSamples.some((sample) => (
    sample.oldConnected
    && sample.oldVisibility === "visible"
    && sample.oldRenderVerified === "true"
    && sample.candidateVisibility === "visible"
    && Number(sample.candidateOpacity) === 0
    && sample.candidatePointerEvents === "none"
    && sample.oldGeneration !== sample.candidateGeneration
  ));
  if (!activeFrameStayedManaged) {
    throw new Error(`Runtime preparing samples: ${JSON.stringify(preparingSamples)}`);
  }
  if (requireActiveChrome) {
    const activeChromeStayedIntact = preparingSamples.some((sample) => (
      sample.oldSelectedCount === 1 && sample.toolbarVisible
    ));
    if (!activeChromeStayedIntact) {
      throw new Error(`Runtime preparing chrome samples: ${JSON.stringify(preparingSamples)}`);
    }
  }
  if (expectPromotion) {
    const positioningRafSamples = candidateSamples.filter((sample) => (
      Number.isInteger(sample.rafSequence)
      && sample.handoffState === "positioning"
      && sample.oldConnected
      && sample.oldVisibility === "visible"
      && Number(sample.oldOpacity) === 1
      && Number(sample.activeOpacity) === 0
      && sample.activePointerEvents === "none"
    ));
    const positioningRafSequences = new Set(
      positioningRafSamples.map((sample) => sample.rafSequence),
    );
    expect(positioningRafSequences.size).toBeGreaterThanOrEqual(2);

    const firstPreparingSample = preparingSamples.find((sample) => (
      sample.viewportAnchorStableId
      || sample.selectionStableId
      || Number.isFinite(sample.iframeScrollY)
    ));
    expect(firstPreparingSample).toBeTruthy();
    expect(firstPreparingSample.viewportAnchorStableId).toBeTruthy();
    expect(firstPreparingSample.selectionStableId).toBeTruthy();
    const handoffBaselineSample = expectedViewportSample || [...handoffSamples].reverse().find((sample) => (
      !sample.candidateGeneration
      && sample.selectionStableId === firstPreparingSample.selectionStableId
      && Number.isFinite(sample.iframeScrollY)
    )) || firstPreparingSample;
    expect(handoffBaselineSample.viewportAnchorStableId).toBeTruthy();
    expect(handoffBaselineSample.selectionStableId).toBeTruthy();

    const activeStateSamples = candidateSamples.filter((sample) => (
      sample.handoffState === "active"
    ));
    const isTopmostActiveSample = (sample) => (
      sample.activeGeneration === sample.candidateGeneration
      && sample.activeVisibility === "visible"
      && Number(sample.activeOpacity) === 1
      && sample.activePointerEvents === "auto"
      && sample.topFrameGeneration === sample.candidateGeneration
      && sample.topFrameIsActive
      && sample.topFrameVisibility === "visible"
      && Number(sample.topFrameOpacity) === 1
      && sample.topFramePointerEvents === "auto"
      && sample.layoutReady
    );
    const positionMatches = (actual, expected) => (
      Number.isFinite(expected)
        && Number.isFinite(actual)
        && Math.abs(actual - expected) <= 2
    );
    const activeViewportMatches = (sample) => {
      const focusExpectation = typeof expectedFocus === "boolean"
        ? expectedFocus
        : handoffBaselineSample.focused;
      if (
        sample.viewportAnchorStableId !== handoffBaselineSample.viewportAnchorStableId
        || sample.selectionStableId !== handoffBaselineSample.selectionStableId
        || sample.focused !== focusExpectation
      ) return false;
      if (
        focusExpectation
        && typeof expectedFocus !== "boolean"
        && sample.activeElement !== handoffBaselineSample.activeElement
      ) return false;
      if (Number.isFinite(handoffBaselineSample.selectionAnchorOffset)) {
        if (
          !positionMatches(sample.selectionAnchorOffset, handoffBaselineSample.selectionAnchorOffset)
          || !positionMatches(sample.selectionFocusOffset, handoffBaselineSample.selectionFocusOffset)
          || sample.selectionCollapsed !== handoffBaselineSample.selectionCollapsed
        ) return false;
      }
      if (Number.isFinite(handoffBaselineSample.caretOffsetY)
        && !positionMatches(sample.caretOffsetY, handoffBaselineSample.caretOffsetY)) {
        return false;
      }
      if (
        Number.isFinite(handoffBaselineSample.viewportAnchorSharedOffsetY)
        && !positionMatches(
          sample.viewportAnchorSharedOffsetY,
          handoffBaselineSample.viewportAnchorSharedOffsetY,
        )
      ) return false;
      if (
        Number.isFinite(handoffBaselineSample.selectedStageTop)
        && !positionMatches(sample.selectedStageTop, handoffBaselineSample.selectedStageTop)
      ) return false;
      if (!Number.isFinite(handoffBaselineSample.selectedStageTop)) {
        if (
          !positionMatches(sample.iframeScrollY, handoffBaselineSample.iframeScrollY)
          || !positionMatches(sample.sharedScrollTop, handoffBaselineSample.sharedScrollTop)
        ) return false;
      }
      return true;
    };
    const firstTopmostRafIndex = activeStateSamples.findIndex((sample) => (
      Number.isInteger(sample.rafSequence) && isTopmostActiveSample(sample)
    ));
    expect(firstTopmostRafIndex).toBeGreaterThanOrEqual(0);
    expect(activeStateSamples.slice(0, firstTopmostRafIndex + 1).every(
      (sample) => isTopmostActiveSample(sample) && activeViewportMatches(sample),
    )).toBe(true);
    const firstTopmostActiveSample = activeStateSamples[firstTopmostRafIndex];
    expect(firstTopmostActiveSample.viewportAnchorStableId)
      .toBe(handoffBaselineSample.viewportAnchorStableId);
    expect(firstTopmostActiveSample.selectionStableId)
      .toBe(handoffBaselineSample.selectionStableId);
    expect(firstTopmostActiveSample.layoutReady).toBe(true);
    const focusExpectation = typeof expectedFocus === "boolean"
      ? expectedFocus
      : handoffBaselineSample.focused;
    expect(firstTopmostActiveSample.focused).toBe(focusExpectation);
    if (focusExpectation && typeof expectedFocus !== "boolean") {
      expect(firstTopmostActiveSample.activeElement).toBe(handoffBaselineSample.activeElement);
    }
    if (
      Number.isFinite(handoffBaselineSample.selectionAnchorOffset)
    ) {
      expect(Number.isFinite(firstTopmostActiveSample.selectionAnchorOffset)).toBe(true);
      expect(Number.isFinite(firstTopmostActiveSample.selectionFocusOffset)).toBe(true);
      expect(Math.abs(
        firstTopmostActiveSample.selectionAnchorOffset
          - handoffBaselineSample.selectionAnchorOffset,
      )).toBeLessThanOrEqual(2);
      expect(Math.abs(
        firstTopmostActiveSample.selectionFocusOffset
          - handoffBaselineSample.selectionFocusOffset,
      )).toBeLessThanOrEqual(2);
      expect(firstTopmostActiveSample.selectionCollapsed)
        .toBe(handoffBaselineSample.selectionCollapsed);
    }
    if (
      Number.isFinite(handoffBaselineSample.caretOffsetY)
    ) {
      expect(Number.isFinite(firstTopmostActiveSample.caretOffsetY)).toBe(true);
      expect(Math.abs(
        firstTopmostActiveSample.caretOffsetY - handoffBaselineSample.caretOffsetY,
      )).toBeLessThanOrEqual(2);
    }
    if (Number.isFinite(handoffBaselineSample.viewportAnchorSharedOffsetY)) {
      expect(Number.isFinite(firstTopmostActiveSample.viewportAnchorSharedOffsetY)).toBe(true);
      expect(Math.abs(
        firstTopmostActiveSample.viewportAnchorSharedOffsetY
          - handoffBaselineSample.viewportAnchorSharedOffsetY,
      )).toBeLessThanOrEqual(2);
    }
    if (
      Number.isFinite(handoffBaselineSample.selectedStageTop)
    ) {
      expect(Number.isFinite(firstTopmostActiveSample.selectedStageTop)).toBe(true);
      expect(Math.abs(
        firstTopmostActiveSample.selectedStageTop - handoffBaselineSample.selectedStageTop,
      )).toBeLessThanOrEqual(2);
    } else {
      expect(Number.isFinite(firstTopmostActiveSample.iframeScrollY)).toBe(true);
      expect(Number.isFinite(firstTopmostActiveSample.sharedScrollTop)).toBe(true);
      expect(Math.abs(
        firstTopmostActiveSample.iframeScrollY - handoffBaselineSample.iframeScrollY,
      )).toBeLessThanOrEqual(2);
      expect(Math.abs(
        firstTopmostActiveSample.sharedScrollTop - handoffBaselineSample.sharedScrollTop,
      )).toBeLessThanOrEqual(2);
    }

    if (assertVisualContinuity) {
      if (!firstPreparingSample || !firstTopmostActiveSample) {
        throw new Error(`Runtime visual anchor samples missing: ${JSON.stringify({
          preparingSamples,
          activeStateSamples,
        })}`);
      }
      expect(Math.abs(
        firstTopmostActiveSample.selectedScreenTop - handoffBaselineSample.selectedScreenTop,
      )).toBeLessThanOrEqual(2);
    }
  }
  return handoffSamples;
}

async function assertRuntimeCandidateReused(page) {
  await expect.poll(() => page.evaluate(() => {
    const active = document.querySelector(
      '[data-testid="html-canvas-editor"] iframe[title*="HTML"]',
    );
    return Boolean(
      active
      && active.isConnected
      && active === window.__PAGEROOT_RUNTIME_CANDIDATE_FRAME__
      && active.contentDocument?.documentElement,
    );
  })).toBe(true);
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
  }, async ({ electronApp, page, sourcePath }) => {
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
    await armRuntimeHandoffSamples(page);
    await page.mouse.click(
      moveDownBox.x + moveDownBox.width / 2,
      moveDownBox.y + moveDownBox.height / 2,
    );
    await assertRuntimeHandoff(page, {
      requireActiveChrome: true,
      assertVisualContinuity: true,
    });

    await expect.poll(async () => {
      try {
        return await documentToken(page);
      } catch {
        return beforeDocument;
      }
    }).not.toBe(beforeDocument);
    await assertRuntimeCandidateReused(page);
    const nextFrame = await currentEditorFrame(page);
    await expect(nextFrame.locator("#runtime-order")).toHaveText("乙甲");
    await expect(nextFrame.locator("section > p").first()).toHaveAttribute("id", "second");
    await expect(nextFrame.locator(
      `[data-pageroot-id="${stableId}"][data-html-canvas-selected]`,
    )).toHaveCount(1);
    await expect.poll(() => reviewStage.evaluate((element) => element.scrollTop)).toBeCloseTo(518.5, 1);
    const workingCopyPath = await managedWorkingCopyPath(page, sourcePath);
    await expect.poll(() => readFileSync(workingCopyPath, "utf8"))
      .toMatch(/id="second"[\s\S]*id="first"/u);
    const moveRevision = await expectCheckpointPersisted(page, 0);

    const beforeUndoDocument = await documentToken(page);
    await armRuntimeHandoffSamples(page);
    await clickEditHistoryMenu(electronApp, page, "undo");
    await assertRuntimeHandoff(page, { assertVisualContinuity: true });
    await expect.poll(async () => {
      try {
        return await documentToken(page);
      } catch {
        return beforeUndoDocument;
      }
    }).not.toBe(beforeUndoDocument);
    await assertRuntimeCandidateReused(page);
    const undoFrame = await currentEditorFrame(page);
    await expect(undoFrame.locator("#runtime-order")).toHaveText("甲乙");
    const undoRevision = await expectCheckpointPersisted(page, moveRevision);
    expect(readFileSync(workingCopyPath, "utf8"))
      .toMatch(/id="first"[\s\S]*id="second"/u);

    const beforeRedoDocument = await documentToken(page);
    await armRuntimeHandoffSamples(page);
    await clickEditHistoryMenu(electronApp, page, "redo");
    await assertRuntimeHandoff(page, { assertVisualContinuity: true });
    await expect.poll(async () => {
      try {
        return await documentToken(page);
      } catch {
        return beforeRedoDocument;
      }
    }).not.toBe(beforeRedoDocument);
    await assertRuntimeCandidateReused(page);
    const redoFrame = await currentEditorFrame(page);
    await expect(redoFrame.locator("#runtime-order")).toHaveText("乙甲");
    await expectCheckpointPersisted(page, undoRevision);
    expect(readFileSync(workingCopyPath, "utf8"))
      .toMatch(/id="second"[\s\S]*id="first"/u);
    expect(readFileSync(sourcePath, "utf8")).toBe(html);
    expect(readFileSync(workingCopyPath, "utf8")).not.toContain("乙甲</output>");
    await reviewStage.evaluate((element) => {
      element.scrollTop = 700;
    });
    await expect.poll(() => reviewStage.evaluate((element) => element.scrollTop))
      .toBeCloseTo(700, 1);
    await page.waitForTimeout(80);
    await expect.poll(() => reviewStage.evaluate((element) => element.scrollTop))
      .toBeCloseTo(700, 1);
  });
});

test("a real user scroll during positioning becomes the latest handoff target", {
  tag: ["@gate-smoke", "@smoke-editing"],
}, async () => {
  const html = `<!doctype html>
<html><head><title>Runtime user scroll handoff</title></head><body>
  <div aria-hidden="true" style="height:600px"></div>
  <section>
    <p id="first" data-native-case="runtime-user-scroll">甲</p>
    <p id="second">乙</p>
    <output id="runtime-order"></output>
    <div aria-hidden="true" style="height:1800px"></div>
  </section>
  <script>
    document.querySelector('#runtime-order').textContent = Array.from(
      document.querySelectorAll('section > p'),
      (node) => node.textContent,
    ).join('');
  </script>
</body></html>`;

  await withRuntimeProject("pageroot-runtime-user-scroll-e2e-", {
    "runtime-report.html": html,
  }, async ({ page, sourcePath }) => {
    const { frame } = await loadedDiskFrame(page, sourcePath, "runtime-user-scroll");
    const reviewStage = page.locator(".review-scroll-stage");
    await frame.locator('[data-native-case="runtime-user-scroll"]').click();
    await reviewStage.evaluate((element) => {
      element.scrollTop = 480;
    });
    await expect.poll(() => reviewStage.evaluate((element) => element.scrollTop)).toBe(480);
    const moveDownButton = page.getByRole("button", { name: "下移", exact: true });
    await expect(moveDownButton).toBeVisible();
    const moveDownBox = await moveDownButton.boundingBox();
    expect(moveDownBox).not.toBeNull();
    const stageBox = await reviewStage.boundingBox();
    expect(stageBox).not.toBeNull();
    await armRuntimeHandoffSamples(page);
    const scrollbarX = stageBox.x + stageBox.width - 2;
    const scrollbarY = stageBox.y + stageBox.height / 2;
    // Use the already-visible toolbar coordinate so Playwright does not first
    // scroll the shared stage while locating the operation.
    await page.mouse.click(
      moveDownBox.x + moveDownBox.width / 2,
      moveDownBox.y + moveDownBox.height / 2,
    );
    await page.mouse.move(scrollbarX, scrollbarY);
    await page.mouse.wheel(0, 900);
    await expect.poll(() => reviewStage.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(700);
    const sawUserPositioning = await page.evaluate(() => {
      const samples = window.__PAGEROOT_RUNTIME_HANDOFF_SAMPLES__ || [];
      return samples.some((sample) => (
        sample.handoffState === "positioning"
        && Number(sample.sharedScrollTop) > 600
        && sample.viewportAnchorStableId
      ));
    });
    expect(sawUserPositioning).toBe(true);
    const userViewportSample = await page.evaluate(() => {
      const samples = window.__PAGEROOT_RUNTIME_HANDOFF_SAMPLES__ || [];
      return [...samples].reverse().find((sample) => (
        sample.handoffState === "positioning"
        && Number(sample.sharedScrollTop) > 600
        && sample.viewportAnchorStableId
      )) || null;
    });
    expect(userViewportSample).not.toBeNull();
    const userScrollTop = await reviewStage.evaluate((element) => element.scrollTop);
    const expectedUserViewportSample = {
      ...userViewportSample,
      sharedScrollTop: userScrollTop,
      // Assert the latest scroll and stable-ID anchor captured during the
      // wheel gesture, not an intermediate screen coordinate.
      selectedStageTop: null,
      selectedScreenTop: null,
    };
    await assertRuntimeHandoff(page, {
      requireActiveChrome: true,
      expectedViewportSample: expectedUserViewportSample,
    });
    await expect.poll(() => reviewStage.evaluate((element) => element.scrollTop))
      .toBeCloseTo(userScrollTop, 1);
    expect(userScrollTop).toBeGreaterThan(700);
  });
});

test("long-page element duplication uses the same visible runtime handoff", {
  tag: ["@gate-smoke", "@smoke-editing"],
}, async () => {
  const html = `<!doctype html>
<html><head><title>Runtime duplicate handoff</title></head><body>
  <div aria-hidden="true" style="height:900px"></div>
  <main>
    <article data-native-case="runtime-duplicate" id="duplicate-target">
      <h2>复制目标</h2>
      <p>这段内容用于验证长页面中复制元素的视觉连续性。</p>
    </article>
    <output id="duplicate-proof"></output>
  </main>
  <div aria-hidden="true" style="height:1800px"></div>
  <script>
    document.body.style.height = '0px';
    requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => {
      document.body.style.height = '';
    })));
    document.querySelector('#duplicate-proof').textContent =
      '运行时复制 ' + document.querySelectorAll('[data-native-case="runtime-duplicate"]').length;
  </script>
</body></html>`;

  await withRuntimeProject("pageroot-runtime-duplicate-e2e-", {
    "runtime-report.html": html,
  }, async ({ page, sourcePath }) => {
    let frame = (await loadedDiskFrame(page, sourcePath, "runtime-duplicate")).frame;
    await expect(frame.locator("#duplicate-proof")).toHaveText("运行时复制 1");
    const reviewStage = page.locator(".review-scroll-stage");
    await frame.locator('[data-native-case="runtime-duplicate"]').click();
    await reviewStage.evaluate((element) => {
      element.scrollTop = 480;
    });
    await expect.poll(() => reviewStage.evaluate((element) => element.scrollTop)).toBe(480);
    const duplicateButton = page.getByRole("button", { name: "复制元素", exact: true });
    await expect(duplicateButton).toBeVisible();
    const duplicateBox = await duplicateButton.boundingBox();
    expect(duplicateBox).not.toBeNull();
    await armRuntimeHandoffSamples(page);
    await page.mouse.click(
      duplicateBox.x + duplicateBox.width / 2,
      duplicateBox.y + duplicateBox.height / 2,
    );
    await assertRuntimeHandoff(page, {
      requireActiveChrome: true,
      assertVisualContinuity: true,
    });
    frame = await currentEditorFrame(page);
    await expect(frame.locator('[data-native-case="runtime-duplicate"]')).toHaveCount(2);
    await expect(frame.locator("#duplicate-proof")).toHaveText("运行时复制 2");
    const duplicateIds = await frame.locator('[data-native-case="runtime-duplicate"]')
      .evaluateAll((elements) => elements.map((element) => element.getAttribute("data-pageroot-id")));
    expect(new Set(duplicateIds).size).toBe(2);
    await expect.poll(() => reviewStage.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(400);

    const secondDuplicateButton = page.getByRole("button", { name: "复制元素", exact: true });
    await expect(secondDuplicateButton).toBeVisible();
    const secondDuplicateBox = await secondDuplicateButton.boundingBox();
    expect(secondDuplicateBox).not.toBeNull();
    await armRuntimeHandoffSamples(page);
    await page.mouse.click(
      secondDuplicateBox.x + secondDuplicateBox.width / 2,
      secondDuplicateBox.y + secondDuplicateBox.height / 2,
    );
    await assertRuntimeHandoff(page, {
      requireActiveChrome: true,
      assertVisualContinuity: true,
    });
    frame = await currentEditorFrame(page);
    await expect(frame.locator('[data-native-case="runtime-duplicate"]')).toHaveCount(3);
    await expect(frame.locator("#duplicate-proof")).toHaveText("运行时复制 3");
    const secondDuplicateIds = await frame.locator('[data-native-case="runtime-duplicate"]')
      .evaluateAll((elements) => elements.map((element) => element.getAttribute("data-pageroot-id")));
    expect(new Set(secondDuplicateIds).size).toBe(3);
    await expect.poll(() => reviewStage.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(400);
  });
});

test("long text Enter rebuilds Runtime without moving the caret or viewport", {
  tag: ["@gate-smoke", "@smoke-editing"],
}, async () => {
  const html = `<!doctype html>
<html><head><title>Runtime Enter handoff</title></head><body>
  <div aria-hidden="true" style="height:850px"></div>
  <main>
    <ol>
      <li data-native-case="runtime-enter-parent" id="enter-parent">
        长文本编辑回车需要保持原来的 Caret 和视口位置。
        <ul><li>嵌套内容仍然保持源码结构。</li></ul>
      </li>
    </ol>
    <output id="enter-proof"></output>
  </main>
  <div aria-hidden="true" style="height:1800px"></div>
  <script>
    document.querySelector('#enter-proof').textContent =
      '运行时回车 ' + document.querySelectorAll('[data-native-case="runtime-enter-parent"] br').length;
  </script>
</body></html>`;

  await withRuntimeProject("pageroot-runtime-enter-e2e-", {
    "runtime-report.html": html,
  }, async ({ page, sourcePath }) => {
    let { frame } = await loadedDiskFrame(page, sourcePath, "runtime-enter-parent");
    await expect(frame.locator("#enter-proof")).toHaveText("运行时回车 0");
    const reviewStage = page.locator(".review-scroll-stage");
    const parent = frame.locator('[data-native-case="runtime-enter-parent"]');
    await parent.click();
    await reviewStage.evaluate((element) => {
      element.scrollTop = 480;
    });
    await expect.poll(() => reviewStage.evaluate((element) => element.scrollTop)).toBe(480);
    const enterPoint = await parent.evaluate((element) => {
      const text = Array.from(element.childNodes).find(
        (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.includes("长文本编辑"),
      );
      if (!(text instanceof Text)) throw new Error("Runtime Enter fixture has no direct text node.");
      const start = text.data.indexOf("长文本编辑");
      const range = document.createRange();
      range.setStart(text, start);
      range.setEnd(text, start + 1);
      const glyph = range.getBoundingClientRect();
      const targetRect = element.getBoundingClientRect();
      return {
        x: glyph.left - targetRect.left + Math.max(1, glyph.width / 2),
        y: glyph.top - targetRect.top + Math.max(1, glyph.height / 2),
      };
    });
    await parent.dblclick({ position: enterPoint, force: true });
    await expect(parent).toHaveAttribute("contenteditable", "true");
    await parent.evaluate((element) => {
      const text = Array.from(element.childNodes).find(
        (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.includes("长文本编辑"),
      );
      if (!(text instanceof Text)) throw new Error("Runtime Enter fixture has no direct text node.");
      const range = document.createRange();
      range.setStart(text, Math.min(text.data.indexOf("长文本编辑") + 4, text.data.length));
      range.collapse(true);
      const selection = document.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      element.focus({ preventScroll: true });
    });
    await armRuntimeHandoffSamples(page);
    await parent.press("Enter");
    await expect(parent.locator(":scope > br")).toHaveCount(1);
    await assertRuntimeHandoff(page, {
      requireActiveChrome: true,
      assertVisualContinuity: true,
    });
    frame = await currentEditorFrame(page);
    await expect(frame.locator("#enter-proof")).toHaveText("运行时回车 1");
    await expect(frame.locator('[data-native-case="runtime-enter-parent"]'))
      .toHaveAttribute("contenteditable", "true");
    await expect(frame.locator(
      '[data-native-case="runtime-enter-parent"] > br[data-pageroot-id]',
    )).toHaveCount(1);
    await page.keyboard.insertText("后续输入");
    await expect(frame.locator('[data-native-case="runtime-enter-parent"]'))
      .toContainText("后续输入");
    await expect.poll(() => reviewStage.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(400);
  });
});

test("Escape commits native editing and leaves contenteditable exited", {
  tag: ["@gate-smoke", "@smoke-editing"],
}, async () => {
  const html = `<!doctype html>
<html><head><title>Runtime Escape handoff</title></head><body>
  <div aria-hidden="true" style="height:850px"></div>
  <main>
    <p data-native-case="runtime-escape-parent" id="escape-parent">
      Escape 后提交仍然保持源码文字和视口位置。
    </p>
  </main>
  <div aria-hidden="true" style="height:1800px"></div>
</body></html>`;

  await withRuntimeProject("pageroot-runtime-escape-e2e-", {
    "runtime-report.html": html,
  }, async ({ page, sourcePath }) => {
    const { frame } = await loadedDiskFrame(page, sourcePath, "runtime-escape-parent");
    const reviewStage = page.locator(".review-scroll-stage");
    const target = frame.locator('[data-native-case="runtime-escape-parent"]');
    await target.click();
    await reviewStage.evaluate((element) => {
      element.scrollTop = 480;
    });
    await expect.poll(() => reviewStage.evaluate((element) => element.scrollTop)).toBe(480);
    await target.dblclick({ force: true });
    await expect(target).toHaveAttribute("contenteditable", "true");
    await target.press("End");
    await page.keyboard.insertText(" Escape输入");
    await expect(target).toContainText("Escape输入");
    await page.keyboard.press("Escape");
    await expect(target).toContainText("Escape输入");
    await expect(target).not.toHaveAttribute("contenteditable", "true");
    await expect.poll(() => reviewStage.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(400);
  });
});

test("a failed runtime candidate leaves the old active frame managed and never ready", {
  tag: ["@gate-smoke", "@smoke-editing"],
}, async () => {
  const html = `<!doctype html>
<html><head><title>Runtime candidate failure</title></head><body>
  <section>
    <p id="first" data-native-case="runtime-candidate-failure">甲</p>
    <p id="second">乙</p>
    <button id="runtime-proof-target" type="button">运行时证明仍在</button>
    <a id="runtime-link" href="#runtime-target">运行时链接</a>
    <output id="runtime-order"></output>
  </section>
  <script>
    document.querySelector('#runtime-order').textContent = Array.from(
      document.querySelectorAll('section > p'),
      (node) => node.textContent,
    ).join('');
    if (document.querySelector('section > p')?.id === 'second') {
      const marker = document.querySelector('meta[data-html-canvas-render-verification]');
      marker?.setAttribute('data-html-canvas-render-verification', 'invalid-candidate');
      marker?.setAttribute('content', 'invalid-candidate');
    }
  </script>
</body></html>`;

  await withRuntimeProject("pageroot-runtime-candidate-failure-e2e-", {
    "runtime-report.html": html,
  }, async ({ page, sourcePath }) => {
    const { frame } = await loadedDiskFrame(
      page,
      sourcePath,
      "runtime-candidate-failure",
    );
    await frame.locator('[data-native-case="runtime-candidate-failure"]').click();
    const toolbar = page.getByRole("toolbar", { name: /编辑/u });
    await expect(toolbar).toBeVisible();
    await expect(toolbar.getByRole("button", { name: "下移", exact: true })).toBeVisible();

    await armRuntimeHandoffSamples(page);
    await toolbar.getByRole("button", { name: "下移", exact: true }).click();
    await assertRuntimeHandoff(page, {
      requireActiveChrome: true,
      expectPromotion: false,
    });

    await expect.poll(() => page.locator(".canvas-edit-surface").getAttribute(
      "data-edit-runtime-phase",
    )).toBe("running");
    const oldFrameState = await page.evaluate(() => {
      const editor = document.querySelector('[data-testid="html-canvas-editor"]');
      const oldFrame = window.__PAGEROOT_RUNTIME_OLD_FRAME__;
      return {
        connected: oldFrame?.isConnected || false,
        visibility: oldFrame?.isConnected ? getComputedStyle(oldFrame).visibility : null,
        selectedCount: oldFrame?.contentDocument
          ?.querySelectorAll("[data-html-canvas-selected]").length || 0,
        toolbarVisible: Boolean(editor?.querySelector('[role="toolbar"]')?.getClientRects().length),
      };
    });
    expect(oldFrameState).toEqual({
      connected: true,
      visibility: "visible",
      selectedCount: 1,
      toolbarVisible: true,
    });

    await frame.locator("#runtime-proof-target").hover();
    await expect(page.getByTestId("canvas-capability-outline")).toBeVisible();
    const beforeUrl = page.url();
    await frame.locator("#runtime-link").click({ modifiers: ["Alt"] });
    expect(page.url()).toBe(beforeUrl);
    await expect.poll(() => page.locator(".canvas-edit-surface").getAttribute(
      "data-edit-runtime-phase",
    )).toBe("running");
  });
});

test("a failed candidate during text editing rolls back to the previous active frame", {
  tag: ["@gate-smoke", "@smoke-editing"],
}, async () => {
  const html = `<!doctype html>
<html><head><title>Runtime text candidate rollback</title></head><body>
  <div aria-hidden="true" style="height:850px"></div>
  <main>
    <p data-native-case="runtime-text-candidate-failure" id="text-failure">
      文字编辑失败触发后仍需保留换行和后续编辑能力。
    </p>
  </main>
  <div aria-hidden="true" style="height:1800px"></div>
  <script>
    if (document.querySelector('[data-native-case="runtime-text-candidate-failure"] br')) {
      const marker = document.querySelector('meta[data-html-canvas-render-verification]');
      marker?.setAttribute('data-html-canvas-render-verification', 'invalid-text-candidate');
      marker?.setAttribute('content', 'invalid-text-candidate');
    }
  </script>
</body></html>`;

  await withRuntimeProject("pageroot-runtime-text-candidate-failure-e2e-", {
    "runtime-report.html": html,
  }, async ({ page, sourcePath }) => {
    let { frame } = await loadedDiskFrame(page, sourcePath, "runtime-text-candidate-failure");
    const reviewStage = page.locator(".review-scroll-stage");
    const target = frame.locator('[data-native-case="runtime-text-candidate-failure"]');
    await target.click();
    await reviewStage.evaluate((element) => {
      element.scrollTop = 480;
    });
    await expect.poll(() => reviewStage.evaluate((element) => element.scrollTop)).toBe(480);
    await target.dblclick({ force: true });
    await expect(target).toHaveAttribute("contenteditable", "true");
    await target.press("End");
    await armRuntimeHandoffSamples(page);
    await target.press("Enter");
    await expect(target.locator(":scope > br")).toHaveCount(1);
    await assertRuntimeHandoff(page, {
      requireActiveChrome: true,
      expectPromotion: false,
    });
    await page.waitForTimeout(4_500);
    frame = await currentEditorFrame(page);
    const rollbackTarget = frame.locator('[data-native-case="runtime-text-candidate-failure"]');
    await expect(rollbackTarget).not.toHaveAttribute("contenteditable", "true");
    await expect(rollbackTarget.locator(":scope > br")).toHaveCount(1);
    await expect(rollbackTarget).toContainText("失败触发");
    await expect.poll(() => page.evaluate(() => {
      const editor = document.querySelector('[data-testid="html-canvas-editor"]');
      const activeFrame = editor?.querySelector('iframe[title*="HTML"]');
      const oldFrame = window.__PAGEROOT_RUNTIME_OLD_FRAME__;
      return Boolean(activeFrame && oldFrame && activeFrame === oldFrame);
    })).toBe(true);
    await expect.poll(() => reviewStage.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(400);
  });
});

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
    ))).toEqual(["5.5.0", "5.4.3"]);
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
