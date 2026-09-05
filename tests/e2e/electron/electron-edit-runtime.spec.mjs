import { expect, test } from "@playwright/test";

import { buildSourceIndex } from "../../../app/lib/source-index.js";

import {
  activateNativeEdit,
  ECHARTS_STUB,
  bridgeJson,
  clickEditHistoryMenu,
  chooseClipboardDelivery,
  currentEditorFrame,
  existsSync,
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
  setTextSelection,
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
  let electronApp = null;
  let isolatedUserData = null;
  try {
    const launched = await launchPageRoot({
      activeSourcePath: sourcePath,
      ...launchOptions,
    });
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

async function armRuntimeCommitHold(page) {
  await page.evaluate(() => {
    window.__PAGEROOT_E2E_RUNTIME_COMMIT_RELEASES__ = [];
  });
}

async function waitForHeldRuntimeCommit(page) {
  await expect.poll(() => page.evaluate(() => (
    window.__PAGEROOT_E2E_RUNTIME_COMMIT_RELEASES__?.length || 0
  ))).toBeGreaterThan(0);
}

async function releaseHeldRuntimeCommits(page) {
  await page.evaluate(() => {
    const releases = window.__PAGEROOT_E2E_RUNTIME_COMMIT_RELEASES__ || [];
    window.__PAGEROOT_E2E_RUNTIME_COMMIT_RELEASES__ = undefined;
    releases.forEach((release) => release());
  });
}

async function visibleActiveFrameProof(page, nativeCase) {
  return page.evaluate((targetCase) => {
    const editor = document.querySelector('[data-testid="html-canvas-editor"]');
    const activeFrame = Array.from(editor?.querySelectorAll("iframe") || [])
      .find((frame) => !frame.hasAttribute("data-frame-role"));
    const target = activeFrame?.contentDocument?.querySelector(
      `[data-native-case="${targetCase}"]`,
    );
    return {
      renderVerified: editor?.getAttribute("data-render-verified") || null,
      visible: Boolean(
        activeFrame instanceof HTMLIFrameElement
        && activeFrame.isConnected
        && getComputedStyle(activeFrame).visibility === "visible"
      ),
      text: target?.textContent?.trim() || "",
      nativeStartStatus: editor?.getAttribute("data-native-start-status") || null,
    };
  }, nativeCase);
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
    window.__PAGEROOT_RUNTIME_SLOT_A__ = editor.querySelector(
      'iframe[data-runtime-slot="a"]',
    );
    window.__PAGEROOT_RUNTIME_SLOT_B__ = editor.querySelector(
      'iframe[data-runtime-slot="b"]',
    );
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
        runtimeSlotCount: editor.querySelectorAll("iframe[data-runtime-slot]").length,
        candidateGeneration,
        candidateVisibility: candidateFrame ? candidateStyle?.visibility : null,
        candidateOpacity: candidateFrame ? candidateStyle?.opacity : null,
        candidatePointerEvents: candidateFrame ? candidateStyle?.pointerEvents : null,
        newFrameOpacity: candidateFrame ? candidateStyle?.opacity : null,
        newFramePointerEvents: candidateFrame ? candidateStyle?.pointerEvents : null,
        oldConnected: oldFrame.isConnected,
        oldGeneration: oldFrame.getAttribute("data-frame-generation"),
        oldSlotRole: oldFrame.getAttribute("data-runtime-slot-role"),
        oldBodyChildCount: oldFrame.contentDocument?.body?.childElementCount ?? null,
        oldScriptCount: oldFrame.contentDocument?.querySelectorAll("script").length ?? null,
        oldBootstrapCount: oldFrame.contentDocument?.querySelectorAll(
          "[data-pageroot-edit-runtime-bootstrap]",
        ).length ?? null,
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
    await expect.poll(() => page.evaluate(() => {
      const samples = window.__PAGEROOT_RUNTIME_HANDOFF_SAMPLES__ || [];
      const firstActiveRaf = samples.find((sample) => (
        Number.isInteger(sample.rafSequence)
        && sample.handoffState === "active"
        && sample.activeGeneration === sample.candidateGeneration
      ));
      return Boolean(
        firstActiveRaf
        && samples.some((sample) => (
          Number.isInteger(sample.rafSequence)
          && sample.rafSequence >= firstActiveRaf.rafSequence + 2
        ))
      );
    })).toBe(true);
  } else {
    // A failed candidate is observed at the handoff boundary. Do not wait for
    // the runtime session's separate static-fallback policy, because that
    // would hide whether the still-authoritative old frame stayed visible.
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
    // Positioning may be a single commit frame. The contract is the first
    // visible Active location and old-slot cleanup, not a minimum number of
    // half-switched frames.
    const positioningRafSamples = candidateSamples.filter((sample) => (
      Number.isInteger(sample.rafSequence)
      && sample.handoffState === "positioning"
    ));
    if (positioningRafSamples.length > 0) {
      expect(positioningRafSamples.some((sample) => (
        sample.oldConnected
        && sample.oldVisibility === "visible"
        && Number(sample.oldOpacity) === 1
      ))).toBe(true);
    }

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
        && Math.abs(actual - expected) <= 8
    );
    const activeViewportMatches = (sample) => {
      if (
        sample.viewportAnchorStableId !== handoffBaselineSample.viewportAnchorStableId
        || sample.selectionStableId !== handoffBaselineSample.selectionStableId
      ) return false;
      if (assertVisualContinuity) {
        return positionMatches(
          sample.selectedScreenTop,
          handoffBaselineSample.selectedScreenTop,
        );
      }
      return Number.isFinite(sample.selectedTop)
        && Number.isFinite(sample.iframeHeight)
        && sample.selectedTop >= 0
        && sample.selectedTop < sample.iframeHeight;
    };
    const firstTopmostActiveIndex = activeStateSamples.findIndex(isTopmostActiveSample);
    expect(firstTopmostActiveIndex).toBeGreaterThanOrEqual(0);
    const firstTopmostActiveSample = activeStateSamples[firstTopmostActiveIndex];
    if (!activeViewportMatches(firstTopmostActiveSample)) {
      throw new Error(`Runtime presentation anchor mismatch: ${JSON.stringify({
        baseline: handoffBaselineSample,
        promoted: firstTopmostActiveSample,
      })}`);
    }
    expect(firstTopmostActiveSample.viewportAnchorStableId)
      .toBe(handoffBaselineSample.viewportAnchorStableId);
    expect(firstTopmostActiveSample.selectionStableId)
      .toBe(handoffBaselineSample.selectionStableId);
    expect(firstTopmostActiveSample.layoutReady).toBe(true);
    expect(candidateSamples.every((sample) => sample.runtimeSlotCount === 2)).toBe(true);
    const firstActiveRaf = activeStateSamples.find((sample) => (
      Number.isInteger(sample.rafSequence)
      && isTopmostActiveSample(sample)
    ));
    expect(firstActiveRaf).toBeTruthy();
    const oldSlotClearedWithinTwoFrames = candidateSamples.some((sample) => (
      Number.isInteger(sample.rafSequence)
      && sample.rafSequence >= firstActiveRaf.rafSequence
      && sample.rafSequence <= firstActiveRaf.rafSequence + 2
      && sample.oldSlotRole === "inactive"
      && sample.oldBodyChildCount === 0
      && sample.oldScriptCount === 0
      && sample.oldBootstrapCount === 0
    ));
    if (!oldSlotClearedWithinTwoFrames) {
      throw new Error(`Runtime old slot was not cleared within two frames: ${JSON.stringify(
        candidateSamples.filter((sample) => Number.isInteger(sample.rafSequence)),
      )}`);
    }
    expect(Number.isFinite(firstTopmostActiveSample.selectedTop)).toBe(true);
    expect(firstTopmostActiveSample.selectedTop).toBeGreaterThanOrEqual(0);
    expect(firstTopmostActiveSample.selectedTop)
      .toBeLessThan(firstTopmostActiveSample.iframeHeight);
    if (assertVisualContinuity) {
      expect(Math.abs(
        firstTopmostActiveSample.selectedScreenTop - handoffBaselineSample.selectedScreenTop,
      )).toBeLessThanOrEqual(8);
    }
  }
  return handoffSamples;
}

async function assertRuntimeCandidateReused(page) {
  await expect.poll(() => page.evaluate(() => {
    const editor = document.querySelector('[data-testid="html-canvas-editor"]');
    const slots = Array.from(editor?.querySelectorAll('iframe[data-runtime-slot]') || []);
    const active = slots.find((frame) => (
      frame.getAttribute("data-runtime-slot-role") === "active"
    ));
    const inactive = slots.find((frame) => (
      frame.getAttribute("data-runtime-slot-role") === "inactive"
    ));
    return Boolean(
      slots.length === 2
      && slots.filter((frame) => frame.getAttribute("data-runtime-slot") === "a").length === 1
      && slots.filter((frame) => frame.getAttribute("data-runtime-slot") === "b").length === 1
      && window.__PAGEROOT_RUNTIME_SLOT_A__ === slots.find(
        (frame) => frame.getAttribute("data-runtime-slot") === "a",
      )
      && window.__PAGEROOT_RUNTIME_SLOT_B__ === slots.find(
        (frame) => frame.getAttribute("data-runtime-slot") === "b",
      )
      && window.__PAGEROOT_RUNTIME_SLOT_A__?.isConnected
      && window.__PAGEROOT_RUNTIME_SLOT_B__?.isConnected
      && active
      && active.isConnected
      && active === window.__PAGEROOT_RUNTIME_CANDIDATE_FRAME__
      && active.contentDocument?.documentElement
      && active.contentDocument.querySelectorAll(
        "[data-pageroot-edit-runtime-bootstrap]",
      ).length === 1
      && inactive
      && inactive.contentDocument?.body
      && inactive.contentDocument.body.childElementCount === 0
      && inactive.contentDocument.querySelectorAll("script").length === 0
    );
  })).toBe(true);
}

function parserPreclaimFixture() {
  const futurePagerootId = "pr1_123456789abc4def8abc000000000006";
  return `<!doctype html>
<html data-pageroot-id="pr1_123456789abc4def8abc000000000001"><head data-pageroot-id="pr1_123456789abc4def8abc000000000002"><title data-pageroot-id="pr1_123456789abc4def8abc000000000003">Preclaim</title><script data-pageroot-id="pr1_123456789abc4def8abc000000000004">
    const decoy = document.createElement('button');
    decoy.id = 'runtime-preclaim-decoy';
    decoy.textContent = '伪造源码按钮';
    decoy.setAttribute('data-pageroot-id', '${futurePagerootId}');
    decoy.setAttribute('data-pageroot-edit-runtime-source', '${futurePagerootId}');
    document.documentElement.append(decoy);
  </script></head><body data-pageroot-id="pr1_123456789abc4def8abc000000000005"><button id="future-source" data-native-case="runtime-preclaim" data-pageroot-id="${futurePagerootId}">真实源码按钮</button></body></html>`;
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
    const toolbar = page.getByRole("toolbar");

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
      'data-pageroot-id',
      sourceIdDecoy.getAttribute('data-pageroot-id'),
    );
    sourceIdForged.setAttribute(
      'data-pageroot-edit-runtime-source',
      sourceIdDecoy.getAttribute('data-pageroot-edit-runtime-source'),
    );
    window.__mutateSelectedSourceIdentity = () => {
      sourceIdLate.setAttribute(
        'data-pageroot-id',
        sourceIdDecoy.getAttribute('data-pageroot-id'),
      );
      sourceIdLate.setAttribute(
        'data-pageroot-edit-runtime-source',
        sourceIdDecoy.getAttribute('data-pageroot-edit-runtime-source'),
      );
    };
    const generated = document.createElement('button');
    generated.id = 'runtime-generated';
    generated.textContent = '运行时按钮';
    const copiedPagerootId = host.getAttribute('data-pageroot-id');
    const copiedRuntimeMarker = host.getAttribute('data-pageroot-edit-runtime-source');
    generated.setAttribute('data-pageroot-edit-runtime-source', copiedRuntimeMarker);
    generated.setAttribute('data-pageroot-id', copiedPagerootId);
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
    const toolbar = page.getByRole("toolbar");
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
      "data-pageroot-id",
    )).toBe(await frame.locator("#source-id-decoy").getAttribute(
      "data-pageroot-id",
    ));
    page.once("dialog", (dialog) => dialog.accept());
    await toolbar.getByRole("button", { name: "删除元素", exact: true }).click();
    await expect(frame.locator("#source-id-late")).toHaveCount(1);
    await expect(frame.locator("#source-id-decoy")).toHaveCount(1);

    await frame.locator("#runtime-body-generated").click();
    await expect(toolbar.getByRole("button", { name: /留评论/u })).toBeVisible();
    await expect(toolbar.getByRole("button", { name: "编辑", exact: true })).toHaveCount(0);

    const provenance = await frame.locator("#runtime-generated").evaluate((node) => ({
      generatedPagerootId: node.getAttribute("data-pageroot-id"),
      runtimeMarker: node.getAttribute("data-pageroot-edit-runtime-source"),
      hostPagerootId: node.closest("[data-pageroot-id]")
        ?.getAttribute("data-pageroot-id") || null,
    }));
    expect(provenance.generatedPagerootId).toBe(provenance.hostPagerootId);
    expect(provenance.runtimeMarker).toBe(provenance.generatedPagerootId);
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

test("runtime tables, SVG and Canvas keep visual comments source-anchored", {
  tag: ["@gate-smoke", "@smoke-editing"],
}, async () => {
  test.setTimeout(120_000);
  const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>运行时评论</title>
<style>
  body { margin: 0; padding: 24px; font: 16px/1.5 system-ui, sans-serif; background: #f7f7fb; }
  main { max-width: 720px; margin: 0 auto; padding: 20px; background: white; border-radius: 12px; }
  #runtime-output { display: grid; gap: 16px; }
  #runtime-page-table { margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; background: #fff; }
  th, td { border: 1px solid #d8d9e3; padding: 7px 10px; text-align: left; }
  caption { padding: 8px; text-align: left; font-weight: 700; }
  svg, canvas { display: block; width: 100%; height: 120px; border: 1px solid #d8d9e3; background: #fff; }
</style></head><body>
<main data-native-case="runtime-comment-host"><h1>财报运行时视图</h1><div id="runtime-output"></div></main>
<script>
  const output = document.querySelector('#runtime-output');
  const makeTable = (id, label, rows) => {
    const table = document.createElement('table');
    table.id = id;
    table.setAttribute('aria-label', label);
    const caption = document.createElement('caption');
    caption.textContent = label;
    table.append(caption);
    const head = document.createElement('tr');
    for (const value of ['项目', '2025Q1', '2025Q2', '2026Q2']) {
      const cell = document.createElement('th');
      cell.textContent = value;
      head.append(cell);
    }
    table.append(head);
    for (const row of rows) {
      const line = document.createElement('tr');
      for (const value of row) {
        const cell = document.createElement('td');
        cell.textContent = value;
        line.append(cell);
      }
      table.append(line);
    }
    output.append(table);
  };
  makeTable('runtime-table-first', '财务数据表', [
    ['营业收入', '1,000', '1,120', '1,260'],
    ['净利润', '120', '138', '151'],
  ]);
  makeTable('runtime-table-second', '利润数据表', [
    ['毛利率', '22%', '24%', '26%'],
    ['经营现金流', '88', '96', '109'],
  ]);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.id = 'runtime-svg';
  svg.setAttribute('aria-label', '季度趋势示意图');
  svg.setAttribute('viewBox', '0 0 640 120');
  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('x', '18');
  rect.setAttribute('y', '18');
  rect.setAttribute('width', '240');
  rect.setAttribute('height', '70');
  rect.setAttribute('fill', '#c9c5ff');
  svg.append(rect);
  output.append(svg);
  const canvas = document.createElement('canvas');
  canvas.id = 'runtime-canvas';
  canvas.setAttribute('aria-label', '收益趋势画布');
  canvas.width = 640;
  canvas.height = 120;
  const context = canvas.getContext('2d');
  context.fillStyle = '#d9f4e8';
  context.fillRect(18, 18, 260, 70);
  output.append(canvas);
  const pageTable = document.createElement('table');
  pageTable.id = 'runtime-page-table';
  pageTable.setAttribute('aria-label', '页面级数据表');
  const pageCaption = document.createElement('caption');
  pageCaption.textContent = '页面级数据表';
  pageTable.append(pageCaption);
  const pageRow = document.createElement('tr');
  for (const value of ['总计', '2026Q2', '1,260']) {
    const cell = document.createElement('td');
    cell.textContent = value;
    pageRow.append(cell);
  }
  pageTable.append(pageRow);
  document.body.prepend(pageTable);
</script></body></html>`;

  await withRuntimeProject("pageroot-runtime-comment-dual-anchor-e2e-", {
    "runtime-report.html": html,
  }, async ({ page, sourcePath, electronApp }) => {
    const { frame } = await loadedDiskFrame(page, sourcePath, "runtime-comment-host");
    const toolbar = page.getByRole("toolbar", { name: /评论/u });
    const table = frame.locator("#runtime-table-first");
    await expect(table).toBeVisible();
    await table.locator("caption").click();
    await expect(toolbar).toHaveAttribute("aria-label", "评论财务数据表");
    await expect(toolbar.getByRole("button", { name: /给财务数据表留评论/u })).toBeVisible();
    await expect(toolbar.getByRole("button", { name: "编辑", exact: true })).toHaveCount(0);
    await expect(toolbar.getByRole("button", { name: "复制元素", exact: true })).toHaveCount(0);
    await expect(toolbar.getByRole("button", { name: "删除元素", exact: true })).toHaveCount(0);
    await expect(toolbar.getByRole("button", { name: "上移", exact: true })).toHaveCount(0);
    await expect(toolbar.getByRole("button", { name: "下移", exact: true })).toHaveCount(0);

    const selectedOutline = page.getByTestId("html-canvas-editor").locator(
      '[data-testid="canvas-target-outline"][data-tone="selected"]',
    );
    await expect(selectedOutline).toBeVisible();
    const tableBox = await table.boundingBox();
    const outlineBox = await selectedOutline.boundingBox();
    expect(tableBox).not.toBeNull();
    expect(outlineBox).not.toBeNull();
    expect(Math.abs((outlineBox?.x || 0) - (tableBox?.x || 0))).toBeLessThan(4);
    expect(Math.abs((outlineBox?.y || 0) - (tableBox?.y || 0))).toBeLessThan(4);
    expect(Math.abs((outlineBox?.width || 0) - (tableBox?.width || 0))).toBeLessThan(4);
    expect(Math.abs((outlineBox?.height || 0) - (tableBox?.height || 0))).toBeLessThan(4);

    await toolbar.getByRole("button", { name: /给财务数据表留评论/u }).click();
    const composer = page.getByRole("region", { name: "添加评论" });
    await expect(composer).toBeVisible();
    await expect(composer).toContainText("财务数据表");
    await expect(composer).not.toContainText(/运行时节点|源码宿主|ambiguous/u);
    const firstCommentText = "请核对财务数据表的 2026Q2 数值。";
    await composer.getByRole("textbox", { name: "评论内容" }).fill(firstCommentText);
    await composer.getByRole("button", { name: "评论", exact: true }).click();
    await expect(page.locator(".comment-card").filter({ hasText: firstCommentText }))
      .toHaveCount(1);

    const saveRuntimeComment = async (selector, text, label) => {
      const target = frame.locator(selector);
      if (selector === "#runtime-canvas") {
        const box = await target.boundingBox();
        expect(box).not.toBeNull();
        await page.mouse.click(
          (box?.x || 0) + (box?.width || 0) / 2,
          (box?.y || 0) + (box?.height || 0) / 2,
        );
      } else {
        await target.click();
      }
      const commentButton = toolbar.getByRole("button", { name: new RegExp(`给${label}留评论`, "u") });
      await expect(commentButton).toBeVisible();
      await commentButton.click();
      const nextComposer = page.getByRole("region", { name: "添加评论" });
      await expect(nextComposer).toBeVisible();
      if (selector.startsWith("#runtime-page-table")) {
        await expect(nextComposer).toContainText("页面级数据表");
        await expect(nextComposer.getByRole("textbox", { name: "评论内容" }))
          .toHaveAttribute("placeholder", "输入对这部分内容的修改要求…");
      }
      await nextComposer.getByRole("textbox", { name: "评论内容" }).fill(text);
      await nextComposer.getByRole("button", { name: "评论", exact: true }).click();
      await expect(page.locator(".comment-card").filter({ hasText: text })).toHaveCount(1);
    };
    await saveRuntimeComment(
      "#runtime-table-second caption",
      "请单独检查利润数据表。",
      "利润数据表",
    );
    await saveRuntimeComment(
      "#runtime-svg",
      "请保留这张趋势示意图的比例。",
      "季度趋势示意图",
    );
    await saveRuntimeComment(
      "#runtime-canvas",
      "请核对无文字画布中的收益曲线。",
      "收益趋势画布",
    );
    await saveRuntimeComment(
      "#runtime-page-table caption",
      "请保留页面级数据表的汇总行。",
      "页面级数据表",
    );

    const managedSourcePath = await managedWorkingCopyPath(page, sourcePath);
    const readDraftComments = async () => {
      const response = await bridgeJson(
        page,
        `/workspace?sourcePath=${encodeURIComponent(managedSourcePath)}`,
      );
      return response.body?.runtimeState?.draft?.comments
        || response.body?.activeDraft?.comments
        || [];
    };
    await expect.poll(async () => (await readDraftComments()).length, { timeout: 30_000 })
      .toBe(5);
    const draftComments = await readDraftComments();
    const firstRecord = draftComments.find((comment) => comment.text === firstCommentText);
    expect(firstRecord).toBeTruthy();
    const sourceHostId = await frame.locator("#runtime-output")
      .getAttribute("data-pageroot-id");
    expect(firstRecord.sourceAnchor.resolution).toBe("exact");
    expect(firstRecord.sourceAnchor.elementId).toBe(sourceHostId);
    expect(firstRecord.target.elementId).toBe(sourceHostId);
    expect(firstRecord.target.visualHint).toBeUndefined();
    expect(firstRecord.visualHint).toMatchObject({
      runtimeGenerated: true,
      kind: "table",
      label: "财务数据表",
      relativePath: "table:nth-of-type(1)",
    });
    expect(firstRecord.visualHint.relativeBox).toEqual(expect.objectContaining({
      x: expect.any(Number),
      y: expect.any(Number),
      width: expect.any(Number),
      height: expect.any(Number),
    }));
    expect(firstRecord).not.toHaveProperty("outerHTML");
    expect(firstRecord).not.toHaveProperty("event");

    const secondRecord = draftComments.find((comment) => comment.text === "请单独检查利润数据表。");
    expect(secondRecord.visualHint.kind).toBe("table");
    expect(secondRecord.visualHint.relativePath).toBe("table:nth-of-type(2)");
    expect(secondRecord.visualHint.relativePath).not.toBe(firstRecord.visualHint.relativePath);

    const svgRecord = draftComments.find((comment) => comment.text.includes("趋势示意图"));
    const canvasRecord = draftComments.find((comment) => comment.text.includes("无文字画布"));
    expect(svgRecord.visualHint.kind).toBe("svg");
    expect(canvasRecord.visualHint.kind).toBe("canvas");
    expect(svgRecord.visualHint.renderedText).toBeUndefined();
    expect(canvasRecord.visualHint.renderedText).toBeUndefined();
    expect(svgRecord.visualHint.relativePath).toBeTruthy();
    expect(canvasRecord.visualHint.relativePath).toBeTruthy();
    const pageTableRecord = draftComments.find((comment) => comment.text.includes("页面级数据表"));
    const bodySourceHostId = await frame.locator("body").getAttribute("data-pageroot-id");
    expect(pageTableRecord.sourceAnchor).toMatchObject({
      resolution: "exact",
      elementId: bodySourceHostId,
      level: "module",
      selector: "body",
    });
    expect(pageTableRecord.visualHint).toMatchObject({
      runtimeGenerated: true,
      kind: "table",
      label: "页面级数据表",
      relativePath: "table",
    });
    expect(pageTableRecord.target.visualHint).toBeUndefined();

    expect(readFileSync(sourcePath, "utf8")).toBe(html);
    const tablist = page.getByRole("tablist", { name: "已打开的页面" });
    const documentTab = tablist.getByRole("tab").first();
    await page.getByRole("button", { name: "新标签页" }).click();
    await documentTab.click();
    const reopened = await loadedDiskFrame(page, sourcePath, "runtime-comment-host");
    const reopenedFrame = reopened.frame;
    await expect.poll(async () => (await readDraftComments()).length, { timeout: 30_000 })
      .toBe(5);
    const marker = page.getByRole("button", { name: "财务数据表", exact: true });
    await expect(marker).toBeVisible();
    const reopenedTableBox = await reopenedFrame.locator("#runtime-table-first").boundingBox();
    const markerBox = await marker.boundingBox();
    expect(reopenedTableBox).not.toBeNull();
    expect(markerBox).not.toBeNull();
    expect(markerBox?.x || 0).toBeGreaterThanOrEqual((reopenedTableBox?.x || 0) - 24);
    expect(markerBox?.x || 0).toBeLessThanOrEqual((reopenedTableBox?.x || 0) + (reopenedTableBox?.width || 0) + 24);
    expect(markerBox?.y || 0).toBeGreaterThanOrEqual((reopenedTableBox?.y || 0) - 24);
    expect(markerBox?.y || 0).toBeLessThanOrEqual((reopenedTableBox?.y || 0) + (reopenedTableBox?.height || 0) + 24);
    const pageMarker = page.getByRole("button", { name: "页面级数据表", exact: true });
    await expect(pageMarker).toBeVisible();
    const reopenedPageTableBox = await reopenedFrame.locator("#runtime-page-table").boundingBox();
    const pageMarkerBox = await pageMarker.boundingBox();
    expect(reopenedPageTableBox).not.toBeNull();
    expect(pageMarkerBox).not.toBeNull();
    expect(pageMarkerBox?.x || 0).toBeGreaterThanOrEqual((reopenedPageTableBox?.x || 0) - 24);
    expect(pageMarkerBox?.x || 0).toBeLessThanOrEqual((reopenedPageTableBox?.x || 0) + (reopenedPageTableBox?.width || 0) + 24);
    expect(pageMarkerBox?.y || 0).toBeGreaterThanOrEqual((reopenedPageTableBox?.y || 0) - 24);
    expect(pageMarkerBox?.y || 0).toBeLessThanOrEqual((reopenedPageTableBox?.y || 0) + (reopenedPageTableBox?.height || 0) + 24);
    const pageCommentCard = page.locator(".comment-card").filter({
      hasText: "请保留页面级数据表的汇总行。",
    });
    await expect(pageCommentCard).toContainText("页面级数据表");

    await page.getByRole("button", { name: "全局评论" }).click();
    const globalComposer = page.getByRole("region", { name: "添加评论" });
    await expect(globalComposer).toContainText("全局评论");
    await expect(globalComposer.getByRole("textbox", { name: "评论内容" }))
      .toHaveAttribute("placeholder", "输入对整个页面的修改要求…");
    await globalComposer.getByRole("button", { name: "关闭评论编辑器" }).click();

    await reopenedFrame.locator("#runtime-page-table caption").click();
    const reopenedToolbar = page.getByRole("toolbar", { name: /评论/u });
    await reopenedToolbar.getByRole("button", { name: /给页面级数据表留评论/u }).click();
    const recoveredComposer = page.getByRole("region", { name: "添加评论" });
    await recoveredComposer.getByRole("textbox", { name: "评论内容" })
      .fill("页面级数据表草稿");
    await recoveredComposer.getByRole("button", { name: "关闭评论编辑器" }).click();
    await expect(page.locator(".draft-comment-card").filter({ hasText: "页面级数据表" }))
      .toBeVisible();
    await page.getByRole("button", { name: "新标签页" }).click();
    await documentTab.click();
    const draftReopened = await loadedDiskFrame(page, sourcePath, "runtime-comment-host");
    const draftCard = page.locator(".draft-comment-card").filter({
      hasText: "页面级数据表",
    });
    await expect(draftCard).toBeVisible();
    await draftCard.click();
    const restoredDraftComposer = page.getByRole("region", { name: "添加评论" });
    await expect(restoredDraftComposer).toContainText("表格");
    await expect(restoredDraftComposer.getByRole("textbox", { name: "评论内容" }))
      .toHaveAttribute("placeholder", "输入对这部分内容的修改要求…");
    await restoredDraftComposer.getByRole("button", { name: "删除未保存评论" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "删除这条未保存评论" }))
      .toBeVisible();
    await page.getByRole("alert").getByRole("button", { name: "删除", exact: true }).click();
    const reopenedFrameAfterDraft = draftReopened.frame;

    await reopenedFrameAfterDraft.evaluate(() => {
      document.querySelector("#runtime-table-first")?.remove();
    });
    await page.setViewportSize({ width: 1279, height: 720 });
    await expect(marker).toBeVisible();
    const fallbackHostBox = await reopenedFrameAfterDraft.locator("#runtime-output").boundingBox();
    const fallbackMarkerBox = await marker.boundingBox();
    expect(fallbackHostBox).not.toBeNull();
    expect(fallbackMarkerBox).not.toBeNull();
    expect(fallbackMarkerBox?.x || 0).toBeGreaterThanOrEqual((fallbackHostBox?.x || 0) - 24);
    expect(fallbackMarkerBox?.x || 0).toBeLessThanOrEqual((fallbackHostBox?.x || 0) + (fallbackHostBox?.width || 0) + 24);
    await marker.click();
    await expect(reopenedFrameAfterDraft.locator("#runtime-output"))
      .toHaveAttribute("data-html-canvas-selected", "part");
    const fallbackToolbar = page.getByRole("toolbar", { name: /评论/u });
    await expect(fallbackToolbar.getByRole("button", { name: "编辑", exact: true }))
      .toHaveCount(0);
    await expect(fallbackToolbar.getByRole("button", { name: "删除元素", exact: true }))
      .toHaveCount(0);
    await expect(fallbackToolbar.getByRole("button", { name: "上移", exact: true }))
      .toHaveCount(0);
    await expect(fallbackToolbar.getByRole("button", { name: "下移", exact: true }))
      .toHaveCount(0);
    await expect(reopenedFrameAfterDraft.locator("#runtime-table-second"))
      .not.toHaveAttribute("data-html-canvas-selected", /.+/u);
    await expect(page.locator(".comment-card").filter({ hasText: firstCommentText }))
      .toHaveCount(1);

    await electronApp.evaluate(({ clipboard }) => clipboard.clear());
    await page.getByRole("button", { name: /AI 助手/u }).click();
    await chooseClipboardDelivery(page);
    await expect(page.getByTestId("ai-conversation-action-bar"))
      .toContainText("任务已复制，等你的 AI 改完");
    let promptPath = "";
    await expect.poll(async () => {
      const copied = await electronApp.evaluate(({ clipboard }) => clipboard.readText());
      promptPath = copied.match(/请执行\s+(.+?\/PROMPT\.md)\s+中的单轮任务/u)?.[1] || "";
      return Boolean(promptPath && existsSync(promptPath));
    }, { timeout: 20_000 }).toBe(true);
    const requestRoot = path.dirname(promptPath);
    const requestRecord = JSON.parse(
      readFileSync(path.join(requestRoot, "request.json"), "utf8"),
    );
    const annotations = JSON.parse(
      readFileSync(path.join(requestRoot, "input", "annotations", "records.json"), "utf8"),
    );
    const runtimeRequestComments = requestRecord.request.comments.filter(
      (comment) => comment.visualHint?.runtimeGenerated === true,
    );
    expect(runtimeRequestComments).toHaveLength(5);
    expect(runtimeRequestComments.map((comment) => comment.visualHint.relativePath))
      .toEqual(expect.arrayContaining([
        "table:nth-of-type(1)",
        "table:nth-of-type(2)",
      ]));
    expect(runtimeRequestComments.every((comment) => (
      comment.sourceAnchor?.elementId
      && comment.target?.elementId === comment.sourceAnchor.elementId
      && !comment.target?.visualHint
    ))).toBe(true);
    expect(requestRecord.request.taskSpec.scopePolicy)
      .toBe("targets-plus-required-dependencies");
    const prompt = readFileSync(promptPath, "utf8");
    expect(prompt).toContain("财务数据表");
    expect(prompt).toContain("利润数据表");
    expect(prompt).toContain("table:nth-of-type(1)");
    expect(prompt).toContain("table:nth-of-type(2)");
    expect(prompt).toContain("请修改生成该内容的 HTML、数据或 Script");
    const annotatedFirstTable = annotations.comments.find(
      (comment) => comment.visualHint?.relativePath === "table:nth-of-type(1)",
    );
    const annotatedSecondTable = annotations.comments.find(
      (comment) => comment.visualHint?.relativePath === "table:nth-of-type(2)",
    );
    expect(annotatedFirstTable?.sourceAnchor?.elementId).toBe(sourceHostId);
    expect(annotatedSecondTable?.sourceAnchor?.elementId).toBe(sourceHostId);
  });
});

test("dense runtime tables keep pointer hit testing bounded", {
  tag: ["@gate-smoke", "@smoke-editing"],
}, async () => {
  test.setTimeout(120_000);
  const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>运行时命中性能</title>
<style>
  html, body { margin: 0; padding: 0; }
  body { font: 14px/1.2 system-ui, sans-serif; }
  main { padding: 16px; }
  table { width: 720px; table-layout: fixed; border-collapse: collapse; }
  td { width: 36px; height: 26px; padding: 2px; border: 1px solid #d8d9e3; }
</style></head><body>
<main data-native-case="runtime-perf-host"><div id="runtime-perf-output"></div></main>
<script>
  const table = document.createElement('table');
  table.id = 'runtime-perf-table';
  const body = document.createElement('tbody');
  for (let row = 0; row < 50; row += 1) {
    const line = document.createElement('tr');
    for (let column = 0; column < 20; column += 1) {
      const cell = document.createElement('td');
      cell.textContent = row + ':' + column;
      line.append(cell);
    }
    body.append(line);
  }
  table.append(body);
  document.querySelector('#runtime-perf-output').append(table);
</script></body></html>`;

  await withRuntimeProject("pageroot-runtime-pointer-perf-e2e-", {
    "runtime-report.html": html,
  }, async ({ page, sourcePath }) => {
    const { frame } = await loadedDiskFrame(page, sourcePath, "runtime-perf-host");
    const table = frame.locator("#runtime-perf-table");
    await expect(table).toBeVisible();
    await expect(table.locator("td")).toHaveCount(1_000);
    await frame.evaluate(() => {
      const runtimeTable = document.querySelector("#runtime-perf-table");
      const state = { bcr: 0, runtimeBcr: 0, qsa: 0 };
      const originalBcr = Element.prototype.getBoundingClientRect;
      const originalQsa = Document.prototype.querySelectorAll;
      Element.prototype.getBoundingClientRect = function countedBcr() {
        state.bcr += 1;
        if (this === runtimeTable || runtimeTable?.contains(this)) state.runtimeBcr += 1;
        return originalBcr.call(this);
      };
      Document.prototype.querySelectorAll = function countedQsa(...args) {
        state.qsa += 1;
        return originalQsa.apply(this, args);
      };
      window.__PAGEROOT_RUNTIME_POINTER_PERF__ = state;
    });
    const box = await table.boundingBox();
    expect(box).not.toBeNull();
    await frame.evaluate(() => {
      document.querySelector("#runtime-perf-table").style.pointerEvents = "none";
    });
    await page.mouse.move((box?.x || 0) + 12, (box?.y || 0) + 12);
    await page.waitForTimeout(100);
    await frame.evaluate(() => {
      const state = window.__PAGEROOT_RUNTIME_POINTER_PERF__;
      if (state) {
        state.bcr = 0;
        state.runtimeBcr = 0;
        state.qsa = 0;
      }
    });
    for (let index = 0; index < 30; index += 1) {
      await page.mouse.move(
        (box?.x || 0) + 10 + (index % 20) * ((box?.width || 720) / 20),
        (box?.y || 0) + 10 + (index % 12) * 24,
      );
    }
    await page.waitForTimeout(100);
    const metrics = await frame.evaluate(() => window.__PAGEROOT_RUNTIME_POINTER_PERF__);
    expect(metrics).toMatchObject({
      bcr: expect.any(Number),
      runtimeBcr: expect.any(Number),
      qsa: expect.any(Number),
    });
    expect(metrics.runtimeBcr).toBeLessThan(180);
    expect(metrics.qsa).toBeLessThan(100);
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
    await expect.poll(() => reviewStage.evaluate((element) => (
      Math.abs(element.scrollTop - 518.5) <= 2
    ))).toBe(true);
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

test("same-source history cancellation reloads through a fixed Runtime candidate", {
  tag: ["@gate-smoke", "@smoke-editing"],
}, async () => {
  const html = `<!doctype html>
<html><head><title>Runtime history cancel</title></head><body>
  <p data-native-case="runtime-history-cancel">保持当前源码</p>
  <script>
    parent.__PAGEROOT_RUNTIME_HISTORY_CANCEL_COUNT__ =
      (parent.__PAGEROOT_RUNTIME_HISTORY_CANCEL_COUNT__ || 0) + 1;
  </script>
</body></html>`;

  await withRuntimeProject("pageroot-runtime-history-cancel-e2e-", {
    "runtime-report.html": html,
  }, async ({ electronApp, page, sourcePath }) => {
    let { frame } = await loadedDiskFrame(
      page,
      sourcePath,
      "runtime-history-cancel",
    );
    await expect.poll(() => page.evaluate(() => (
      window.__PAGEROOT_RUNTIME_HISTORY_CANCEL_COUNT__
    ))).toBe(1);

    for (const expectedExecutionCount of [2, 3]) {
      await activateNativeEdit(frame, "runtime-history-cancel");
      await armRuntimeHandoffSamples(page);
      const candidateStarted = page.waitForFunction(() => Boolean(
        document.querySelector('[data-testid="html-canvas-editor"]')
          ?.getAttribute("data-runtime-candidate-id"),
      ));
      await clickEditHistoryMenu(electronApp, page, "undo");
      await candidateStarted;
      await expect.poll(() => page.locator(".canvas-edit-surface").getAttribute(
        "data-edit-runtime-phase",
      )).toBe("settled");
      await expect.poll(() => page.getByTestId("html-canvas-editor").getAttribute(
        "data-runtime-handoff",
      )).toBeNull();
      await page.evaluate(() => {
        window.__PAGEROOT_RUNTIME_HANDOFF_ACTIVE__ = false;
        window.__PAGEROOT_RUNTIME_HANDOFF_ANIMATION_FRAME__?.();
        window.__PAGEROOT_RUNTIME_HANDOFF_OBSERVER__?.disconnect();
      });
      await assertRuntimeCandidateReused(page);
      await expect.poll(() => page.evaluate(() => (
        window.__PAGEROOT_RUNTIME_HISTORY_CANCEL_COUNT__
      ))).toBe(expectedExecutionCount);
      frame = await currentEditorFrame(page);
      await expect(frame.locator('[data-native-case="runtime-history-cancel"]'))
        .toHaveText("保持当前源码");
    }
  });
});

test("runtime handoff refreshes the Presentation Anchor after candidate-time scrolling", {
  tag: ["@gate-smoke", "@smoke-editing"],
}, async () => {
  const html = `<!doctype html>
<html><head><title>Runtime presentation anchor</title></head><body>
  <div aria-hidden="true" style="height:600px"></div>
  <section>
    <p id="first" data-native-case="runtime-presentation-anchor">甲</p>
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

  await withRuntimeProject("pageroot-runtime-presentation-anchor-e2e-", {
    "runtime-report.html": html,
  }, async ({ page, sourcePath }) => {
    const { frame } = await loadedDiskFrame(
      page,
      sourcePath,
      "runtime-presentation-anchor",
    );
    const reviewStage = page.locator(".review-scroll-stage");
    await frame.locator('[data-native-case="runtime-presentation-anchor"]').click();
    await reviewStage.evaluate((element) => {
      element.scrollTop = 480;
    });
    await expect.poll(() => reviewStage.evaluate((element) => element.scrollTop)).toBe(480);
    const moveDownButton = page.getByRole("button", { name: "下移", exact: true });
    await armRuntimeHandoffSamples(page);
    const expectedViewportSample = await moveDownButton.evaluate((button) => {
      button.click();
      const editor = document.querySelector('[data-testid="html-canvas-editor"]');
      const stage = editor?.closest(".review-scroll-stage");
      const activeFrame = editor?.querySelector("iframe:not([data-frame-role])");
      if (!(stage instanceof HTMLElement) || !(activeFrame instanceof HTMLIFrameElement)) {
        throw new Error("Runtime handoff viewport was not available.");
      }
      stage.scrollTop = 560;
      const selected = activeFrame.contentDocument?.querySelector(
        "[data-html-canvas-selected]",
      );
      const selectedRect = selected?.getBoundingClientRect();
      const frameRect = activeFrame.getBoundingClientRect();
      const stableId = selected?.getAttribute("data-pageroot-id") || null;
      return {
        sharedScrollTop: stage.scrollTop,
        selectedScreenTop: selectedRect ? frameRect.top + selectedRect.top : null,
        selectionStableId: stableId,
        viewportAnchorStableId: stableId,
      };
    });
    expect(expectedViewportSample).toBeTruthy();
    expect(expectedViewportSample.sharedScrollTop).toBeGreaterThan(520);
    expect(expectedViewportSample.selectedScreenTop).not.toBeNull();
    await assertRuntimeHandoff(page, {
      requireActiveChrome: true,
      assertVisualContinuity: true,
      expectedViewportSample,
    });
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

test("overlapping edits promote only the latest Runtime without losing charts or text editing", {
  tag: ["@gate-smoke", "@smoke-editing"],
}, async () => {
  const html = `<!doctype html>
<html><head><title>Runtime supersession</title></head><body>
  <main>
    <article data-native-case="runtime-supersession" id="supersession-target" style="padding:24px">
      <h2 data-native-case="runtime-supersession-text">连续编辑目标</h2>
      <div id="supersession-chart" style="width:320px;height:180px"></div>
    </article>
    <output id="supersession-proof"></output>
  </main>
  <script src="echarts.js"></script>
  <script>
    let layoutFrame = 0;
    const pulseLayout = () => {
      layoutFrame += 1;
      document.querySelector('[data-native-case="runtime-supersession"]').style.paddingBottom =
        (layoutFrame % 2 === 0 ? '24px' : '28px');
      if (layoutFrame < 30) {
        requestAnimationFrame(pulseLayout);
      } else {
        document.querySelector('[data-native-case="runtime-supersession"]').style.paddingBottom = '';
      }
    };
    requestAnimationFrame(pulseLayout);
    document.querySelector('#supersession-proof').textContent =
      '运行时卡片 ' + document.querySelectorAll('[data-native-case="runtime-supersession"]').length;
    echarts.init(document.querySelector('#supersession-chart')).setOption({
      series: [{ type: 'bar', data: [1, 2, 3] }],
    });
  </script>
  <script type="module" src="slow-module.js"></script>
</body></html>`;

  await withRuntimeProject("pageroot-runtime-supersession-e2e-", {
    "runtime-report.html": html,
    "echarts.js": ECHARTS_STUB,
    "slow-module.js": "await new Promise((resolve) => setTimeout(resolve, 500));",
  }, async ({ page, sourcePath }) => {
    let frame = (await loadedDiskFrame(page, sourcePath, "runtime-supersession")).frame;
    const workingCopyPath = await managedWorkingCopyPath(page, sourcePath);
    await expect(frame.locator("#supersession-chart canvas")).toHaveCount(1);
    await frame.locator('[data-native-case="runtime-supersession"]').click({
      position: { x: 6, y: 6 },
    });
    const duplicateButton = page.getByRole("button", { name: "复制元素", exact: true });
    await expect(duplicateButton).toBeVisible();
    await duplicateButton.evaluate((button) => {
      if (!(button instanceof HTMLButtonElement)) {
        throw new Error("Overlapping duplicate button is missing.");
      }
      button.click();
      button.click();
    });

    await expect.poll(() => page.locator(".canvas-edit-surface").getAttribute(
      "data-edit-runtime-phase",
    )).toBe("settled");
    await expect(page.getByTestId("edit-runtime-static-fallback")).toHaveCount(0);
    frame = await currentEditorFrame(page);
    await expect(frame.locator('[data-native-case="runtime-supersession"]')).toHaveCount(3);
    await expect(frame.locator("#supersession-proof")).toHaveText("运行时卡片 3");
    await expect(frame.locator("#supersession-chart canvas")).toHaveCount(1);

    const text = frame.locator('[data-native-case="runtime-supersession-text"]').first();
    await text.click();
    await text.dblclick({ force: true });
    await expect.poll(async () => ({
      contenteditable: await text.getAttribute("contenteditable"),
      editor: await page.getByTestId("html-canvas-editor").evaluate((element) => ({
        startStatus: element.getAttribute("data-native-start-status"),
        blockedDetail: element.getAttribute("data-edit-block-detail"),
        renderVerified: element.getAttribute("data-render-verified"),
        runtimeHandoff: element.getAttribute("data-runtime-handoff"),
      })),
    })).toEqual({
      contenteditable: "true",
      editor: {
        startStatus: "started",
        blockedDetail: null,
        renderVerified: "true",
        runtimeHandoff: null,
      },
    });
    await text.press("End");
    await page.keyboard.insertText("                        ");
    await page.keyboard.press("Escape");
    await expect.poll(() => page.locator(".canvas-edit-surface").getAttribute(
      "data-edit-runtime-phase",
    )).toBe("settled");
    await expect.poll(() => readFileSync(workingCopyPath, "utf8"))
      .toMatch(/(?:&nbsp;| ){8}/u);
    frame = await currentEditorFrame(page);
    await expect(frame.locator("#supersession-chart canvas")).toHaveCount(1);
    const editedText = frame.locator('[data-native-case="runtime-supersession-text"]').first();
    await editedText.click();
    await editedText.dblclick({ force: true });
    await expect(editedText).toHaveAttribute("contenteditable", "true");
    await page.keyboard.insertText("仍可继续编辑");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("edit-runtime-static-fallback")).toHaveCount(0);
    await expect.poll(() => readFileSync(workingCopyPath, "utf8"))
      .toContain("仍可继续编辑");
  });
});

test("Runtime style edits stay in one document and coalesce at selection boundary", {
  tag: ["@gate-smoke", "@smoke-editing"],
}, async () => {
  const html = `<!doctype html>
<html><head><title>Runtime style coalescing</title></head><body>
  <main>
    <article style="padding:24px"><h2 data-native-case="runtime-style-first">甲</h2></article>
    <article style="padding:24px"><h2 data-native-case="runtime-style-second">乙</h2></article>
    <output id="runtime-style-proof"></output>
  </main>
  <script>
    const runtimeStyleCards = document.querySelectorAll('[data-native-case^="runtime-style-"]');
    const forgedRuntimeStyleCard = runtimeStyleCards[0].cloneNode(true);
    forgedRuntimeStyleCard.removeAttribute('data-native-case');
    forgedRuntimeStyleCard.setAttribute('data-runtime-forged-clone', 'true');
    runtimeStyleCards[0].before(forgedRuntimeStyleCard);
    document.querySelector('#runtime-style-proof').textContent =
      'runtime-ready:' + runtimeStyleCards.length;
  </script>
  <script type="module" src="slow-module.js"></script>
</body></html>`;

  await withRuntimeProject("pageroot-runtime-style-coalescing-e2e-", {
    "runtime-report.html": html,
    "slow-module.js": [
      "parent.__PAGEROOT_STYLE_RUNTIME_COUNT__ =",
      "  (parent.__PAGEROOT_STYLE_RUNTIME_COUNT__ || 0) + 1;",
      "if (parent.__PAGEROOT_STYLE_RUNTIME_COUNT__ > 1) {",
      "  await new Promise((resolve) => setTimeout(resolve, 600));",
      "}",
    ].join("\n"),
  }, async ({ electronApp, page, sourcePath }) => {
    const editor = page.getByTestId("html-canvas-editor");
    const workingCopyPath = await managedWorkingCopyPath(page, sourcePath);
    let frame = (await loadedDiskFrame(page, sourcePath, "runtime-style-first")).frame;
    const first = frame.locator(
      '[data-native-case="runtime-style-first"]:not([data-runtime-forged-clone])',
    );
    const forgedFirst = frame.locator(
      '[data-runtime-forged-clone="true"]',
    );
    await expect(forgedFirst).toHaveCount(1);
    await first.click();
    await expect(first).toHaveAttribute("data-html-canvas-selected", "part");
    const initialDocument = await documentToken(page);
    const initialGeneration = await editor.locator('iframe:not([data-frame-role])')
      .getAttribute("data-frame-generation");
    const toolbar = editor.getByRole("toolbar");
    await expect(toolbar).toBeVisible();
    await toolbar.getByText("样式与间距", { exact: true }).click();
    await toolbar.getByLabel("内边距（像素）").fill("20");
    await expect.poll(() => readFileSync(workingCopyPath, "utf8"))
      .toMatch(/padding-top:\s*20px/u);
    await toolbar.getByLabel("内边距（像素）").fill("22");
    await expect.poll(() => readFileSync(workingCopyPath, "utf8"))
      .toMatch(/padding-top:\s*22px/u);
    await expect(first).toHaveCSS("padding-top", "22px");
    await expect(forgedFirst).toHaveCSS("padding-top", "0px");

    await expect.poll(() => documentToken(page)).toBe(initialDocument);
    await expect(editor.locator('iframe:not([data-frame-role])')).toHaveAttribute(
      "data-frame-generation",
      initialGeneration,
    );
    await expect(editor.locator('iframe[data-frame-role="runtime-candidate"]')).toHaveCount(0);
    await expect(editor).toHaveAttribute("data-runtime-refresh-pending", "");
    await expect(editor).toHaveAttribute(
      "data-runtime-refresh-pending-source-revision",
      /^sha256:[a-f0-9]{64}$/u,
    );
    await expect.poll(async () => Number(
      await editor.getAttribute("data-runtime-refresh-coalesced-count"),
    )).toBeGreaterThanOrEqual(2);

    const latestSourceRevision = buildSourceIndex(
      readFileSync(workingCopyPath, "utf8"),
    ).sourceSha256;
    await frame.locator('[data-native-case="runtime-style-second"]').click();
    await expect(editor).toHaveAttribute("data-runtime-refresh-decision", "candidate-now");
    await expect(editor).toHaveAttribute("data-runtime-refresh-reason", "selection-changed");
    await expect.poll(() => page.locator(".canvas-edit-surface").getAttribute(
      "data-edit-runtime-phase",
    )).toBe("settled");
    await expect(editor).toHaveAttribute(
      "data-runtime-last-known-good-source-revision",
      latestSourceRevision,
    );
    frame = await currentEditorFrame(page);
    await expect(frame.locator('[data-native-case="runtime-style-first"]'))
      .toHaveCSS("padding-top", "22px");
    await expect(editor.locator('iframe[data-frame-role="runtime-candidate"]')).toHaveCount(0);
    await expect(editor).not.toHaveAttribute("data-runtime-refresh-pending", "");

    const styleRevision = await expectCheckpointPersisted(page, 0);
    await frame.locator('[data-native-case="runtime-style-first"]').click();
    await clickEditHistoryMenu(electronApp, page, "undo");
    const undoRevision = await expectCheckpointPersisted(page, styleRevision);
    await expect.poll(() => readFileSync(workingCopyPath, "utf8"))
      .toMatch(/padding-top:\s*20px/u);
    frame = await currentEditorFrame(page);
    await expect(frame.locator('[data-native-case="runtime-style-first"]'))
      .toHaveCSS("padding-top", "20px");

    await clickEditHistoryMenu(electronApp, page, "redo");
    await expectCheckpointPersisted(page, undoRevision);
    await expect.poll(() => readFileSync(workingCopyPath, "utf8"))
      .toMatch(/padding-top:\s*22px/u);
    frame = await currentEditorFrame(page);
    await expect(frame.locator('[data-native-case="runtime-style-first"]'))
      .toHaveCSS("padding-top", "22px");
  });
});

test("Runtime range styling never grants a forged clone source authority", {
  tag: ["@gate-smoke", "@smoke-editing"],
}, async () => {
  const html = `<!doctype html>
<html><head><title>Runtime forged range</title></head><body>
  <main><p data-native-case="runtime-forged-range">甲乙</p></main>
  <script>
    document.querySelector('[data-native-case="runtime-forged-range"]');
  </script>
</body></html>`;

  await withRuntimeProject("pageroot-runtime-forged-range-e2e-", {
    "runtime-report.html": html,
  }, async ({ page, sourcePath }) => {
    const editor = page.getByTestId("html-canvas-editor");
    const workingCopyPath = await managedWorkingCopyPath(page, sourcePath);
    const frame = (await loadedDiskFrame(page, sourcePath, "runtime-forged-range")).frame;
    const target = frame.locator(
      '[data-native-case="runtime-forged-range"]:not([data-runtime-forged-clone])',
    );
    await activateNativeEdit(frame, "runtime-forged-range");
    await expect(target).toHaveAttribute("contenteditable", "true");
    await setTextSelection(frame, "runtime-forged-range", 0, 1);
    const beforeDocument = await documentToken(page);
    const toolbar = editor.getByRole("toolbar");
    await expect(toolbar).toHaveAttribute("data-text-range", "true");
    await target.evaluate((element) => {
      const forged = element.cloneNode(true);
      if (!(forged instanceof HTMLElement)) throw new Error("Runtime forged clone failed.");
      forged.removeAttribute("data-native-case");
      forged.removeAttribute("contenteditable");
      forged.removeAttribute("data-html-canvas-editing");
      forged.removeAttribute("data-html-canvas-selected");
      forged.setAttribute("data-runtime-forged-clone", "true");
      element.before(forged);
    });
    const forged = frame.locator('[data-runtime-forged-clone="true"]');
    await expect(forged).toHaveCount(1);
    const bold = toolbar
      .getByRole("button", { name: "加粗", exact: true });
    await expect(bold).toBeEnabled();
    await bold.click();

    await expect.poll(() => readFileSync(workingCopyPath, "utf8"))
      .toMatch(/<span[^>]*font-weight:\s*700/iu);
    await expect(target.locator('span[style*="font-weight"]')).toHaveCount(1);
    await expect(forged.locator('span[style*="font-weight"]')).toHaveCount(0);
    await expect.poll(() => documentToken(page)).toBe(beforeDocument);
    await expect(editor.locator('iframe[data-frame-role="runtime-candidate"]')).toHaveCount(0);
  });
});

test("latest Runtime candidate wins across slow ECharts, native editing and static degradation", {
  tag: ["@gate-smoke", "@smoke-editing"],
}, async () => {
  const html = `<!doctype html>
<html><head><title>Runtime latest wins</title></head><body>
  <div aria-hidden="true" style="height:850px"></div>
  <main>
    <article data-native-case="runtime-latest-wins" style="padding:24px">
      <h2 data-native-case="runtime-latest-wins-text">连续编辑 Word 目标</h2>
      <div id="latest-wins-chart" style="width:320px;height:180px"></div>
    </article>
    <output id="latest-wins-proof"></output>
  </main>
  <div aria-hidden="true" style="height:1800px"></div>
  <script src="echarts.js"></script>
  <script>
    const heading = document.querySelector('[data-native-case="runtime-latest-wins-text"]');
    const chart = document.querySelector('#latest-wins-chart');
    echarts.init(chart).setOption({ series: [{ type: 'bar', data: [1, 2, 3] }] });
    document.querySelector('#latest-wins-proof').textContent =
      '运行时卡片 ' + document.querySelectorAll('[data-native-case="runtime-latest-wins"]').length;
    if (heading?.textContent.includes('候选失败')) {
      throw new Error('synthetic latest candidate activation failure');
    }
  </script>
  <script type="module" src="slow-module.js"></script>
</body></html>`;

  await withRuntimeProject("pageroot-runtime-latest-wins-e2e-", {
    "runtime-report.html": html,
    "echarts.js": ECHARTS_STUB,
    "slow-module.js": [
      "parent.__PAGEROOT_RUNTIME_MODULE_COUNT__ =",
      "  (parent.__PAGEROOT_RUNTIME_MODULE_COUNT__ || 0) + 1;",
      "if (parent.__PAGEROOT_RUNTIME_MODULE_COUNT__ > 1) {",
      "  await new Promise((resolve) => {",
      "    (parent.__PAGEROOT_RUNTIME_RELEASES__ ||= []).push(resolve);",
      "  });",
      "}",
    ].join("\n"),
  }, async ({ page, sourcePath }) => {
    const editor = page.getByTestId("html-canvas-editor");
    const surface = page.locator(".canvas-edit-surface");
    const reviewStage = page.locator(".review-scroll-stage");
    const workingCopyPath = await managedWorkingCopyPath(page, sourcePath);
    let frame = (await loadedDiskFrame(page, sourcePath, "runtime-latest-wins")).frame;
    await expect(frame.locator("#latest-wins-chart canvas")).toHaveCount(1);
    await reviewStage.evaluate((element) => {
      element.scrollTop = 480;
    });
    await expect.poll(() => reviewStage.evaluate((element) => element.scrollTop)).toBe(480);

    const candidateIds = [];
    const currentActiveRuntimeFrame = async () => {
      const activeIframe = editor.locator('iframe:not([data-frame-role])');
      await expect(activeIframe).toHaveCount(1);
      const activeHandle = await activeIframe.elementHandle();
      const activeFrame = await activeHandle?.contentFrame();
      if (!activeFrame || activeFrame.isDetached()) {
        throw new Error("Latest-wins active Runtime frame is unavailable.");
      }
      return activeFrame;
    };
    const waitForNewCandidate = async (previousId) => {
      const candidateHandle = await page.waitForFunction((priorCandidateId) => {
        const candidateId = document.querySelector(
          '[data-testid="html-canvas-editor"]',
        )?.getAttribute("data-runtime-candidate-id");
        return candidateId && candidateId !== priorCandidateId ? candidateId : false;
      }, previousId, { polling: "raf", timeout: 30_000 });
      const candidateId = await candidateHandle.jsonValue();
      await candidateHandle.dispose();
      return candidateId;
    };
    const captureNextCandidate = async (trigger) => {
      const previousId = await editor.getAttribute("data-runtime-candidate-id");
      const candidatePending = waitForNewCandidate(previousId);
      await trigger();
      const candidateId = await candidatePending;
      expect(candidateId).toBeTruthy();
      candidateIds.push(candidateId);
      await expect.poll(() => page.evaluate(() => {
        const activeFrame = document.querySelector(
          '[data-testid="html-canvas-editor"] iframe:not([data-frame-role])',
        );
        return Boolean(
          activeFrame instanceof HTMLIFrameElement
          && activeFrame.isConnected
          && getComputedStyle(activeFrame).visibility === "visible"
          && activeFrame.contentDocument?.querySelector("#latest-wins-chart canvas"),
        );
      })).toBe(true);
      await expect(editor.locator('iframe[data-frame-role="runtime-previous"]')).toHaveCount(0);
      await expect(page.getByTestId("edit-runtime-static-fallback")).toHaveCount(0);
      return candidateId;
    };

    await frame.locator('[data-native-case="runtime-latest-wins"]').click({
      position: { x: 6, y: 6 },
    });
    const duplicateButton = page.getByRole("button", { name: "复制元素", exact: true });
    await expect(duplicateButton).toBeVisible();
    await captureNextCandidate(() => duplicateButton.evaluate((button) => {
      if (!(button instanceof HTMLButtonElement)) {
        throw new Error("Latest-wins duplicate button is missing.");
      }
      button.click();
      button.click();
    }));
    await expect.poll(() => (
      readFileSync(workingCopyPath, "utf8").split('data-native-case="runtime-latest-wins"').length - 1
    )).toBeGreaterThanOrEqual(3);
    await page.evaluate(() => {
      const editorElement = document.querySelector('[data-testid="html-canvas-editor"]');
      const activeFrame = editorElement?.querySelector('iframe:not([data-frame-role])');
      const editTarget = activeFrame?.contentDocument?.querySelector(
        '[data-native-case="runtime-latest-wins-text"]',
      );
      if (!(activeFrame instanceof HTMLIFrameElement)
        || !(editTarget instanceof activeFrame.contentWindow.HTMLElement)) {
        throw new Error("Latest-wins active heading is missing.");
      }
      const rect = editTarget.getBoundingClientRect();
      const eventInit = {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + Math.max(1, rect.width / 2),
        clientY: rect.top + Math.max(1, rect.height / 2),
      };
      editTarget.dispatchEvent(new MouseEvent("click", { ...eventInit, detail: 1 }));
      editTarget.dispatchEvent(new MouseEvent("dblclick", { ...eventInit, detail: 2 }));
    });
    frame = await currentActiveRuntimeFrame();
    let heading = frame.locator('[data-native-case="runtime-latest-wins-text"]').first();
    await expect(heading).toHaveAttribute("contenteditable", "true");
    await heading.evaluate((element) => {
      const text = element.firstChild;
      if (!(text instanceof Text)) throw new Error("Latest-wins IME text is missing.");
      const selection = document.getSelection();
      const range = document.createRange();
      range.setStart(text, text.data.length);
      range.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(range);
      element.dispatchEvent(new CompositionEvent("compositionstart", {
        bubbles: true,
        data: "pinyin",
      }));
      text.data += "pinyin";
      element.dispatchEvent(new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: false,
        data: "pinyin",
        inputType: "insertCompositionText",
        isComposing: true,
      }));
      element.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        data: "pinyin",
        inputType: "insertCompositionText",
        isComposing: true,
      }));
    });
    await expect(heading).toHaveAttribute("contenteditable", "true");
    await expect(editor.locator('iframe[data-frame-role="runtime-previous"]')).toHaveCount(0);
    expect(readFileSync(workingCopyPath, "utf8")).not.toContain("pinyin");
    await heading.evaluate((element) => {
      element.dispatchEvent(new CompositionEvent("compositionend", {
        bubbles: true,
        data: "",
      }));
    });
    await expect(heading).not.toContainText("pinyin");
    expect(readFileSync(workingCopyPath, "utf8")).not.toContain("pinyin");

    frame = await currentActiveRuntimeFrame();
    heading = frame.locator('[data-native-case="runtime-latest-wins-text"]').first();
    await expect(heading).toHaveAttribute("contenteditable", "true");
    await heading.press("End");
    const revisionBeforeText = Number(await page.locator("[data-persist-state]").first()
      .getAttribute("data-persisted-revision"));
    await page.keyboard.insertText("你好");
    await expect(heading).toContainText("你好");
    await page.keyboard.insertText("                        ");
    const textRevision = await expectCheckpointPersisted(page, revisionBeforeText);
    await expect.poll(() => readFileSync(workingCopyPath, "utf8")).toContain("你好");
    await expect.poll(() => readFileSync(workingCopyPath, "utf8"))
      .toMatch(/(?:&nbsp;| ){8}/u);
    frame = await currentEditorFrame(page);
    heading = frame.locator('[data-native-case="runtime-latest-wins-text"]').first();
    await expect(heading).toHaveAttribute("contenteditable", "true");
    await heading.evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      range.collapse(false);
      const selection = document.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      element.focus();
    });
    const lastKnownGoodBeforeEnter = await editor.getAttribute(
      "data-runtime-last-known-good-id",
    );
    const candidateBeforeEnter = await editor.getAttribute("data-runtime-candidate-id");
    const documentBeforeEnter = await documentToken(page);
    const generationBeforeEnter = await editor.locator('iframe:not([data-frame-role])')
      .getAttribute("data-frame-generation");
    await heading.press("Enter");
    await expect(heading.locator(":scope > br[data-pageroot-id]")).toHaveCount(1);
    await expect.poll(() => documentToken(page)).toBe(documentBeforeEnter);
    await expect(editor.locator('iframe:not([data-frame-role])')).toHaveAttribute(
      "data-frame-generation",
      generationBeforeEnter,
    );
    await expect(editor).toHaveAttribute(
      "data-runtime-last-known-good-id",
      lastKnownGoodBeforeEnter,
    );
    if (candidateBeforeEnter) {
      await expect(editor).toHaveAttribute(
        "data-runtime-candidate-id",
        candidateBeforeEnter,
      );
    } else {
      await expect(editor).not.toHaveAttribute("data-runtime-candidate-id", /.+/u);
    }
    await expect(heading).toHaveAttribute("contenteditable", "true");
    await expect.poll(() => readFileSync(workingCopyPath, "utf8")).toContain("你好");
    await expectCheckpointPersisted(page, textRevision);

    // The explicit edit boundary coalesces the text and Enter checkpoints into
    // one newest candidate. The two earlier structural candidates remain
    // blocked and superseded; only this source revision may activate.
    const beforeBoundaryCandidate = await editor.getAttribute("data-runtime-candidate-id");
    const boundaryCandidatePending = waitForNewCandidate(beforeBoundaryCandidate);
    await page.keyboard.press("Escape");
    const boundaryCandidate = await boundaryCandidatePending;
    expect(boundaryCandidate).toBeTruthy();
    candidateIds.push(boundaryCandidate);
    expect(new Set(candidateIds).size).toBe(candidateIds.length);
    await expect.poll(() => page.evaluate(() => (
      window.__PAGEROOT_RUNTIME_RELEASES__?.length || 0
    ))).toBeGreaterThan(0);
    await page.evaluate(() => {
      const releases = window.__PAGEROOT_RUNTIME_RELEASES__ || [];
      window.__PAGEROOT_RUNTIME_RELEASES__ = [];
      releases.forEach((release) => release());
    });
    await expect.poll(() => surface.getAttribute("data-edit-runtime-outcome"), {
      timeout: 12_000,
    }).toBe("ready");
    await expect(editor).toHaveAttribute(
      "data-runtime-last-known-good-id",
      boundaryCandidate,
    );
    frame = await currentEditorFrame(page);
    heading = frame.locator('[data-native-case="runtime-latest-wins-text"]').first();
    await expect(heading).not.toHaveAttribute("contenteditable", "true");
    await expect(heading).toHaveAttribute("data-html-canvas-selected", "part");
    await expect(heading).toContainText("你好");

    // A true latest candidate activation failure must promote the same latest
    // Working HTML as a Script-disabled page. Dynamic execution resumes only
    // after the user removes the fault and explicitly retries it.
    frame = await currentEditorFrame(page);
    heading = frame.locator('[data-native-case="runtime-latest-wins-text"]').first();
    await heading.click();
    await heading.dblclick({ force: true });
    await expect(heading).toHaveAttribute("contenteditable", "true");
    await heading.press("End");
    await page.keyboard.insertText("        候选失败");
    const pendingResolverCount = await page.evaluate(() => (
      window.__PAGEROOT_RUNTIME_RELEASES__?.length || 0
    ));
    const beforeFailureCandidate = await editor.getAttribute("data-runtime-candidate-id");
    const failureCandidatePending = waitForNewCandidate(beforeFailureCandidate);
    await page.keyboard.press("Escape");
    const failureCandidate = await failureCandidatePending;
    expect(failureCandidate).toBeTruthy();
    candidateIds.push(failureCandidate);
    await expect.poll(() => page.evaluate(() => (
      window.__PAGEROOT_RUNTIME_RELEASES__?.length || 0
    ))).toBeGreaterThan(pendingResolverCount);
    await page.evaluate(() => {
      const releases = window.__PAGEROOT_RUNTIME_RELEASES__ || [];
      window.__PAGEROOT_RUNTIME_RELEASES__ = [];
      releases.forEach((release) => release());
    });
    await expect.poll(() => surface.getAttribute("data-edit-runtime-outcome"), {
      timeout: 12_000,
    }).toBe("candidate-failed");
    await expect(surface).toHaveAttribute("data-edit-runtime-phase", "static-fallback");
    await expect(page.getByTestId("edit-runtime-static-fallback")).toContainText(
      "部分动态内容未更新",
    );
    await expect(editor).toHaveAttribute("data-runtime-degradation", "static-visible");
    frame = await currentEditorFrame(page);
    await expect(editor.locator('iframe[data-runtime-slot-role="active"]'))
      .toHaveAttribute("sandbox", "allow-same-origin");
    await expect(editor).toHaveAttribute("aria-readonly", "false");
    await expect(page.getByTestId("edit-runtime-static-fallback")).toContainText(
      "已显示最新源码的静态页面，仍可编辑和保存。",
    );
    await expect(frame.locator("#latest-wins-chart canvas")).toHaveCount(0);

    heading = frame.locator('[data-native-case="runtime-latest-wins-text"]').first();
    await heading.click();
    await heading.dblclick({ force: true });
    await expect(heading).toHaveAttribute("contenteditable", "true");
    await heading.evaluate((element) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let startText = null;
      let markerText = null;
      let text = walker.nextNode();
      while (text instanceof Text) {
        if (!startText && text.data.includes("你好")) startText = text;
        if (text.data.includes("候选失败")) {
          markerText = text;
          break;
        }
        text = walker.nextNode();
      }
      if (!(startText instanceof Text) || !(markerText instanceof Text)) {
        throw new Error("Editable spaces or failure marker text is missing.");
      }
      const markerEnd = markerText.data.indexOf("候选失败") + "候选失败".length;
      const range = document.createRange();
      range.setStart(startText, startText.data.indexOf("你好") + "你好".length);
      range.setEnd(markerText, markerEnd);
      const selection = document.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    });
    await page.keyboard.press("Backspace");
    await expect(heading).not.toContainText("候选失败");
    await page.keyboard.press("Escape");
    await expect.poll(() => readFileSync(workingCopyPath, "utf8").match(
      /<h2[^>]*data-native-case="runtime-latest-wins-text"[^>]*>([\s\S]*?)<\/h2>/u,
    )?.[1] ?? "").not.toContain("候选失败");

    frame = await currentEditorFrame(page);
    await expect(frame.locator("#latest-wins-chart canvas")).toHaveCount(0);
    await expect(frame.locator('[data-native-case="runtime-latest-wins"]')).toHaveCount(3);
    await expect(editor.locator('iframe:not([data-frame-role])')).toHaveCount(1);
    await expect(editor.locator('iframe[data-frame-role="runtime-candidate"]')).toHaveCount(0);
    await expect(editor.locator('iframe[data-frame-role="runtime-previous"]')).toHaveCount(0);
    const degradedSource = readFileSync(workingCopyPath, "utf8");
    expect(degradedSource).toContain("你好");
    expect(degradedSource).not.toContain("pinyin");
    const degradedHeadingSource = degradedSource.match(
      /<h2[^>]*data-native-case="runtime-latest-wins-text"[^>]*>([\s\S]*?)<\/h2>/u,
    )?.[1] ?? "";
    expect(degradedHeadingSource).not.toContain("候选失败");
    const degradedIndex = buildSourceIndex(degradedSource);
    expect(degradedIndex.byPagerootId.size).toBeGreaterThanOrEqual(5);
  });
});

test("long text Enter checkpoints Working HTML without replacing the Runtime document", {
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
    const beforeDocument = await documentToken(page);
    const beforeGeneration = await page.getByTestId("html-canvas-editor")
      .locator('iframe:not([data-frame-role])')
      .getAttribute("data-frame-generation");
    const beforeCandidate = await page.getByTestId("html-canvas-editor")
      .getAttribute("data-runtime-candidate-id");
    for (let index = 0; index < 20; index += 1) {
      await parent.press("Enter");
    }
    await expect(parent.locator(":scope > br")).toHaveCount(20);
    const workingCopyPath = await managedWorkingCopyPath(page, sourcePath);
    await expect.poll(() => readFileSync(workingCopyPath, "utf8"))
      .toMatch(/runtime-enter-parent[\s\S]*<br/u);
    await expect.poll(() => documentToken(page)).toBe(beforeDocument);
    await expect(page.getByTestId("html-canvas-editor")
      .locator('iframe:not([data-frame-role])'))
      .toHaveAttribute("data-frame-generation", beforeGeneration);
    await expect(page.getByTestId("html-canvas-editor")
      .locator('iframe[data-frame-role="runtime-candidate"]'))
      .toHaveCount(0);
    expect(await page.getByTestId("html-canvas-editor")
      .getAttribute("data-runtime-candidate-id")).toBe(beforeCandidate);
    await expect(frame.locator("#enter-proof")).toHaveText("运行时回车 0");
    await expect(parent).toHaveAttribute("contenteditable", "true");
    await expect(parent.locator(":scope > br[data-pageroot-id]")).toHaveCount(20);
    const continuity = await parent.evaluate((element) => {
      const selection = document.getSelection();
      return {
        focused: document.activeElement === element || element.contains(document.activeElement),
        collapsed: selection?.isCollapsed ?? false,
        inside: Boolean(selection?.focusNode && element.contains(selection.focusNode)),
      };
    });
    expect(continuity).toEqual({ focused: true, collapsed: true, inside: true });
    await page.keyboard.insertText("后续输入");
    await expect(parent).toContainText("后续输入");
    await parent.press("Meta+s");
    await expect.poll(() => readFileSync(workingCopyPath, "utf8"))
      .toContain("后续输入");
    await expect.poll(() => documentToken(page)).toBe(beforeDocument);
    await expect(parent).toHaveAttribute("contenteditable", "true");
    await expect(page.getByTestId("html-canvas-editor")
      .locator('iframe[data-frame-role="runtime-candidate"]'))
      .toHaveCount(0);
    const afterSaveContinuity = await parent.evaluate((element) => {
      const selection = document.getSelection();
      return {
        focused: document.activeElement === element || element.contains(document.activeElement),
        collapsed: selection?.isCollapsed ?? false,
        inside: Boolean(selection?.focusNode && element.contains(selection.focusNode)),
      };
    });
    expect(afterSaveContinuity).toEqual({ focused: true, collapsed: true, inside: true });
    await expect.poll(() => reviewStage.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(400);

    await page.getByRole("button", { name: "预览", exact: true }).click();
    await expect(page.locator('iframe[title="HTML 交互预览"]')).toBeVisible();
    const retainedEditor = page.getByTestId("html-canvas-editor").first();
    await expect(retainedEditor.locator('iframe[data-frame-role="runtime-candidate"]'))
      .toHaveCount(0);
    await expect.poll(() => retainedEditor.locator('iframe:not([data-frame-role])')
      .evaluate((frameElement) => (
        frameElement.contentWindow?.__PAGEROOT_NATIVE_QA_DOCUMENT_TOKEN__ || null
      ))).toBe(beforeDocument);
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

test("a failed dynamic candidate promotes the latest Script-disabled static page", {
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
    const workingCopyPath = await managedWorkingCopyPath(page, sourcePath);
    const lastKnownGoodSource = readFileSync(workingCopyPath, "utf8");
    await frame.locator('[data-native-case="runtime-candidate-failure"]').click();
    const toolbar = page.getByRole("toolbar", { name: /编辑/u });
    await expect(toolbar).toBeVisible();
    await expect(toolbar.getByRole("button", { name: "下移", exact: true })).toBeVisible();
    await toolbar.getByRole("button", { name: /给.+留评论/u }).click();
    const commentComposer = page.getByRole("region", { name: "添加评论" });
    await commentComposer.getByRole("textbox", { name: "评论内容" })
      .fill("保留这次结构调整。");
    await commentComposer.getByRole("button", { name: "评论", exact: true }).click();

    await armRuntimeHandoffSamples(page);
    await toolbar.getByRole("button", { name: "下移", exact: true }).click();
    await assertRuntimeHandoff(page, {
      requireActiveChrome: true,
      expectPromotion: false,
    });

    await expect.poll(() => page.locator(".canvas-edit-surface").getAttribute(
      "data-edit-runtime-phase",
    )).toBe("static-fallback");
    await expect(page.locator(".canvas-edit-surface")).toHaveAttribute(
      "data-edit-runtime-outcome",
      "candidate-failed",
    );
    await expect(page.getByTestId("edit-runtime-static-fallback")).toContainText(
      "部分动态内容未更新",
    );
    const editor = page.getByTestId("html-canvas-editor").filter({ visible: true }).first();
    await expect(editor).toHaveAttribute("data-runtime-degradation", "static-visible");
    const staticFrame = await currentEditorFrame(page);
    await expect(editor.locator('iframe[data-runtime-slot-role="active"]'))
      .toHaveAttribute("sandbox", "allow-same-origin");
    await expect(staticFrame.locator("#runtime-order")).toHaveText("");
    await expect.poll(() => staticFrame.locator("section > p").evaluateAll(
      (nodes) => nodes.map((node) => node.id),
    )).toEqual(["second", "first"]);
    const oldFrameState = await page.evaluate(() => {
      const oldFrame = window.__PAGEROOT_RUNTIME_OLD_FRAME__;
      return {
        connected: oldFrame?.isConnected || false,
        role: oldFrame?.getAttribute("data-runtime-slot-role") || null,
        text: oldFrame?.contentDocument?.body?.textContent?.trim() || "",
      };
    });
    expect(oldFrameState).toEqual({ connected: true, role: "inactive", text: "" });

    await page.getByRole("button", { name: "关闭动态内容提示" }).click();
    await expect(page.getByTestId("edit-runtime-static-fallback")).toHaveCount(0);
    const staticTarget = staticFrame.locator('[data-native-case="runtime-candidate-failure"]');
    await staticTarget.click();
    await staticTarget.dblclick();
    await expect(staticTarget).toHaveAttribute("contenteditable", "true");
    await staticTarget.press("End");
    await page.keyboard.insertText(" 静态继续编辑");
    await page.keyboard.press("Escape");
    await expect(staticTarget).toContainText("静态继续编辑");
    await expect.poll(() => readFileSync(workingCopyPath, "utf8"))
      .toContain("静态继续编辑");
    await expect.poll(() => page.locator(".canvas-edit-surface").getAttribute(
      "data-edit-runtime-phase",
    )).toBe("static-fallback");

    const latestWorkingSource = readFileSync(workingCopyPath, "utf8");
    const lastKnownGoodHash = buildSourceIndex(lastKnownGoodSource).sourceSha256;
    const latestWorkingHash = buildSourceIndex(latestWorkingSource).sourceSha256;
    expect(latestWorkingHash).not.toBe(lastKnownGoodHash);

    const lastKnownGoodBeforeSubmission = await page.getByTestId("html-canvas-editor")
      .getAttribute("data-runtime-last-known-good-id");
    expect(lastKnownGoodBeforeSubmission).toBeTruthy();
    await page.getByRole("button", { name: /AI 助手/u }).click();
    await chooseClipboardDelivery(page);
    await expect(page.getByTestId("ai-conversation-action-bar"))
      .toContainText("任务已复制，等你的 AI 改完");
    await expect(page.getByText(
      "最新页面还没有完成显示，请重新加载动态内容后再发起修改。",
      { exact: true },
    )).toHaveCount(0);
    await expect(page.getByTestId("html-canvas-editor")).toHaveAttribute(
      "data-working-source-sha256",
      latestWorkingHash,
    );
    await expect(page.getByTestId("html-canvas-editor")).toHaveAttribute(
      "data-rendered-projection-sha256",
      latestWorkingHash,
    );
    await expect(page.getByTestId("html-canvas-editor")).toHaveAttribute(
      "data-rendered-projection-stale",
      "false",
    );
    await expect(page.getByTestId("html-canvas-editor")).toHaveAttribute(
      "data-runtime-last-known-good-id",
      lastKnownGoodBeforeSubmission,
    );
    await expect(page.getByTestId("html-canvas-editor")
      .locator('iframe[data-frame-role="runtime-candidate"]'))
      .toHaveCount(0);
  });
});

test("a queued static fallback follows the latest Working HTML after Native Edit", {
  tag: ["@gate-smoke", "@smoke-editing"],
}, async () => {
  const html = `<!doctype html>
<html><head><title>Runtime queued static latest</title></head><body>
  <main>
    <p data-native-case="runtime-queued-static-latest">静态候选必须跟随最新源码</p>
  </main>
  <script>
    if (document.querySelectorAll('[data-native-case="runtime-queued-static-latest"]')
      .length > 1) {
      throw new Error('synthetic queued Runtime activation failure');
    }
  </script>
</body></html>`;

  await withRuntimeProject("pageroot-runtime-queued-static-latest-e2e-", {
    "runtime-report.html": html,
  }, async ({ page, sourcePath }) => {
    let { frame } = await loadedDiskFrame(
      page,
      sourcePath,
      "runtime-queued-static-latest",
    );
    const editor = page.getByTestId("html-canvas-editor").filter({ visible: true }).first();
    const target = frame.locator(
      '[data-native-case="runtime-queued-static-latest"]',
    ).first();
    await target.click();
    await page.getByRole("button", { name: "复制元素", exact: true }).evaluate((button) => {
      button.click();
      const editorElement = document.querySelector('[data-testid="html-canvas-editor"]');
      const activeFrame = editorElement?.querySelector('iframe:not([data-frame-role])');
      const editTarget = activeFrame?.contentDocument?.querySelector(
        '[data-native-case="runtime-queued-static-latest"]',
      );
      if (!(activeFrame instanceof HTMLIFrameElement)
        || !(editTarget instanceof activeFrame.contentWindow.HTMLElement)) {
        throw new Error("Queued-static Active target is missing.");
      }
      const rect = editTarget.getBoundingClientRect();
      const eventInit = {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + Math.max(1, rect.width / 2),
        clientY: rect.top + Math.max(1, rect.height / 2),
      };
      editTarget.dispatchEvent(new MouseEvent("click", { ...eventInit, detail: 1 }));
      editTarget.dispatchEvent(new MouseEvent("dblclick", { ...eventInit, detail: 2 }));
    });
    await expect(editor).toHaveAttribute("data-runtime-candidate-id", /.+/u);

    frame = await currentEditorFrame(page);
    const activeTarget = frame.locator(
      '[data-native-case="runtime-queued-static-latest"]',
    ).first();
    await expect(activeTarget).toHaveAttribute("contenteditable", "true");
    await expect(editor).toHaveAttribute(
      "data-runtime-degradation",
      "static-preparing",
      { timeout: 12_000 },
    );
    await expect(activeTarget).toHaveAttribute("contenteditable", "true");

    const revisionBeforeLatestEdit = Number(await page.locator("[data-persist-state]").first()
      .getAttribute("data-persisted-revision"));
    await activeTarget.press("End");
    await page.keyboard.insertText(" 最新来源");
    await expect(activeTarget).toContainText("最新来源");
    const latestTextRevision = await expectCheckpointPersisted(page, revisionBeforeLatestEdit);
    await page.keyboard.press("Escape");
    await expect.poll(async () => {
      const indicator = page.locator("[data-persist-state]").first();
      const editRevision = Number(await indicator.getAttribute("data-edit-revision"));
      const persistedRevision = Number(await indicator.getAttribute("data-persisted-revision"));
      return {
        state: await indicator.getAttribute("data-persist-state"),
        synchronized: editRevision >= latestTextRevision && editRevision === persistedRevision,
      };
    }, { timeout: 30_000 }).toEqual({ state: "idle", synchronized: true });

    await expect(editor).toHaveAttribute(
      "data-runtime-degradation",
      "static-visible",
      { timeout: 12_000 },
    );
    await expect(editor).not.toHaveAttribute(
      "data-runtime-handoff",
      /^(?:preparing|positioning|active)$/u,
    );
    await expect(editor.locator('iframe[data-frame-role="runtime-candidate"]')).toHaveCount(0);
    const staticFrame = await currentEditorFrame(page);
    await expect(editor.locator('iframe[data-runtime-slot-role="active"]'))
      .toHaveAttribute("sandbox", "allow-same-origin");
    await expect(staticFrame.locator(
      '[data-native-case="runtime-queued-static-latest"]',
    ).first()).toContainText("最新来源");
    await expect(staticFrame.locator(
      '[data-native-case="runtime-queued-static-latest"]',
    )).toHaveCount(2);
    const workingCopyPath = await managedWorkingCopyPath(page, sourcePath);
    const latestWorkingSource = readFileSync(workingCopyPath, "utf8");
    expect(latestWorkingSource).toContain("最新来源");
  });
});

test("dynamic and static candidate failure preserves latest HTML behind a read-only last-known-good frame", async () => {
  const html = `<!doctype html>
<html><head><title>Runtime double failure</title></head><body>
  <section>
    <p id="first" data-native-case="runtime-double-failure">甲</p>
    <p id="second">乙</p>
    <output id="runtime-order"></output>
  </section>
  <script>
    document.querySelector('#runtime-order').textContent = Array.from(
      document.querySelectorAll('section > p'),
      (node) => node.textContent,
    ).join('');
    if (document.querySelector('section > p')?.id === 'second') {
      const marker = document.querySelector('meta[data-html-canvas-render-verification]');
      marker?.setAttribute('data-html-canvas-render-verification', 'invalid-dynamic-candidate');
      marker?.setAttribute('content', 'invalid-dynamic-candidate');
    }
  </script>
</body></html>`;

  await withRuntimeProject("pageroot-runtime-double-failure-e2e-", {
    "runtime-report.html": html,
  }, async ({ page, sourcePath, sourceDirectory, electronApp }) => {
    const { frame } = await loadedDiskFrame(page, sourcePath, "runtime-double-failure");
    const workingCopyPath = await managedWorkingCopyPath(page, sourcePath);
    const oldSourceHash = buildSourceIndex(readFileSync(workingCopyPath, "utf8")).sourceSha256;
    await frame.locator('[data-native-case="runtime-double-failure"]').click();
    const toolbar = page.getByRole("toolbar", { name: /编辑/u });
    await toolbar.getByRole("button", { name: /给.+留评论/u }).click();
    const commentComposer = page.getByRole("region", { name: "添加评论" });
    await commentComposer.getByRole("textbox", { name: "评论内容" })
      .fill("保留最新 Working HTML 的结构调整。");
    await commentComposer.getByRole("button", { name: "评论", exact: true }).click();
    await toolbar.getByRole("button", { name: "下移", exact: true }).click();

    const editor = page.getByTestId("html-canvas-editor").filter({ visible: true }).first();
    await expect(editor).toHaveAttribute(
      "data-runtime-degradation",
      "static-preparing",
      { timeout: 12_000 },
    );
    const preparingNotice = page.getByTestId("edit-runtime-static-fallback");
    await preparingNotice.getByRole("button", { name: "关闭动态内容提示" }).click();
    await expect(page.getByTestId("edit-runtime-static-fallback")).toHaveCount(0);
    await expect(editor).toHaveAttribute(
      "data-runtime-degradation",
      "last-known-good-readonly",
      { timeout: 12_000 },
    );
    await expect(editor).toHaveAttribute("aria-readonly", "true");
    const degradationNotice = page.getByTestId("edit-runtime-static-fallback");
    await expect(degradationNotice).toContainText("动态和静态页面都未能更新");
    await expect(degradationNotice).toContainText("最新 HTML 未回滚");
    await expect(degradationNotice.getByRole("button", { name: "重新加载", exact: true }))
      .toBeVisible();
    await expect(degradationNotice.getByRole("button", { name: "导出当前 HTML", exact: true }))
      .toBeVisible();
    await expect(degradationNotice.getByRole("button", { name: "关闭动态内容提示" }))
      .toHaveCount(0);

    const latestSource = readFileSync(workingCopyPath, "utf8");
    const latestSourceHash = buildSourceIndex(latestSource).sourceSha256;
    expect(latestSourceHash).not.toBe(oldSourceHash);
    expect(latestSource.indexOf('id="second"')).toBeLessThan(latestSource.indexOf('id="first"'));

    const exportedPath = path.join(sourceDirectory, "latest-working-export.html");
    await electronApp.evaluate(({ dialog }, destination) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: destination });
    }, exportedPath);
    await degradationNotice.getByRole("button", { name: "导出当前 HTML", exact: true })
      .click();
    await expect.poll(() => existsSync(exportedPath)).toBe(true);
    expect(readFileSync(exportedPath, "utf8")).toBe(latestSource);

    await expect(editor).toHaveAttribute(
      "data-runtime-last-known-good-source-revision",
      oldSourceHash,
    );
    await expect(frame.locator("#runtime-order")).toHaveText("甲乙");
    await frame.locator('[data-native-case="runtime-double-failure"]').dblclick({ force: true });
    await expect(frame.locator('[data-native-case="runtime-double-failure"]'))
      .not.toHaveAttribute("contenteditable", "true");

    await electronApp.evaluate(({ clipboard }) => clipboard.clear());
    await page.getByRole("button", { name: /AI 助手/u }).click();
    await chooseClipboardDelivery(page);
    await expect(page.getByTestId("ai-conversation-action-bar"))
      .toContainText("任务已复制，等你的 AI 改完");
    let promptPath = "";
    await expect.poll(async () => {
      const copied = await electronApp.evaluate(({ clipboard }) => clipboard.readText());
      promptPath = copied.match(/请执行\s+(.+?\/PROMPT\.md)\s+中的单轮任务/u)?.[1] || "";
      return Boolean(promptPath && existsSync(promptPath));
    }, { timeout: 20_000 }).toBe(true);
    const requestRoot = path.dirname(promptPath);
    const requestRecord = JSON.parse(
      readFileSync(path.join(requestRoot, "request.json"), "utf8"),
    );
    expect(requestRecord.expectedSourceSha256).toBe(latestSourceHash);
    expect(readFileSync(path.join(requestRoot, "input", "base", "index.html"), "utf8"))
      .toBe(latestSource);
  }, {
    injectedEnv: {
      PAGEROOT_E2E_STATIC_CANDIDATE_FAILURE: "1",
    },
  });
});

test("a failed candidate after text editing promotes static without resuming Native Edit", {
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
    const beforeDocument = await documentToken(page);
    const beforeGeneration = await page.getByTestId("html-canvas-editor")
      .locator('iframe:not([data-frame-role])')
      .getAttribute("data-frame-generation");
    await target.press("Enter");
    await expect(target.locator(":scope > br")).toHaveCount(1);
    const workingCopyPath = await managedWorkingCopyPath(page, sourcePath);
    await expect.poll(() => readFileSync(workingCopyPath, "utf8"))
      .toMatch(/runtime-text-candidate-failure[\s\S]*<br/u);
    await expect.poll(() => documentToken(page)).toBe(beforeDocument);
    await expect(page.getByTestId("html-canvas-editor")
      .locator('iframe:not([data-frame-role])'))
      .toHaveAttribute("data-frame-generation", beforeGeneration);
    await expect(page.getByTestId("html-canvas-editor")
      .locator('iframe[data-frame-role="runtime-candidate"]'))
      .toHaveCount(0);
    await expect(target).toHaveAttribute("contenteditable", "true");

    await armRuntimeHandoffSamples(page);
    await page.keyboard.press("Escape");
    const failedHandoffSamples = await assertRuntimeHandoff(page, {
      requireActiveChrome: true,
      expectPromotion: false,
    });
    const failedCandidateGenerations = new Set(
      failedHandoffSamples
        .map((sample) => sample.candidateGeneration)
        .filter(Boolean),
    );
    expect(failedCandidateGenerations.size).toBe(1);
    await page.waitForTimeout(4_500);
    frame = await currentEditorFrame(page);
    const rollbackTarget = frame.locator('[data-native-case="runtime-text-candidate-failure"]');
    await expect(rollbackTarget).not.toHaveAttribute("contenteditable", "true");
    await expect(rollbackTarget.locator(":scope > br")).toHaveCount(1);
    await expect(rollbackTarget).toContainText("失败触发");
    const activeGeneration = await page.locator(
      '[data-testid="html-canvas-editor"] iframe[title*="HTML"]:not([data-frame-role])',
    ).getAttribute("data-frame-generation");
    expect(failedCandidateGenerations.has(activeGeneration)).toBe(false);
    await expect.poll(() => page.evaluate(() => {
      const editor = document.querySelector('[data-testid="html-canvas-editor"]');
      const activeFrame = editor?.querySelector('iframe[title*="HTML"]');
      return Boolean(
        activeFrame
        && activeFrame.isConnected
        && activeFrame.contentDocument?.documentElement
      );
    })).toBe(true);
    await expect.poll(() => reviewStage.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(400);
  });
});

test("a ready Candidate waiting to commit still accepts Native Edit on Active", {
  tag: ["@gate-smoke", "@smoke-editing"],
}, async () => {
  const html = `<!doctype html>
<html><head><title>Runtime commit hold edit</title></head><body>
  <main>
    <p data-native-case="runtime-commit-hold-edit" id="commit-hold-edit">
      候选等待提交时仍可进入文字编辑。
    </p>
  </main>
  <script>
    document.querySelector('[data-native-case="runtime-commit-hold-edit"]')
      .dataset.runtimeReady = 'true';
  </script>
</body></html>`;

  await withRuntimeProject("pageroot-runtime-commit-hold-edit-e2e-", {
    "runtime-report.html": html,
  }, async ({ page, sourcePath }) => {
    const editor = page.getByTestId("html-canvas-editor");
    const surface = page.locator(".canvas-edit-surface");
    let { frame } = await loadedDiskFrame(page, sourcePath, "runtime-commit-hold-edit");
    await expect(editor).toHaveAttribute("data-render-verified", "true");
    await expect.poll(() => editor.getAttribute("data-runtime-last-known-good-id"))
      .toBeTruthy();
    const lastKnownGoodBefore = await editor.getAttribute("data-runtime-last-known-good-id");
    const workingCopyPath = await managedWorkingCopyPath(page, sourcePath);

    await armRuntimeCommitHold(page);
    const target = frame.locator('[data-native-case="runtime-commit-hold-edit"]');
    await target.click();
    const duplicateButton = page.getByRole("button", { name: "复制元素", exact: true });
    await expect(duplicateButton).toBeVisible();
    await duplicateButton.click();
    await expect.poll(() => (
      readFileSync(workingCopyPath, "utf8")
        .split('<p data-native-case="runtime-commit-hold-edit"').length - 1
    )).toBeGreaterThanOrEqual(2);
    await waitForHeldRuntimeCommit(page);
    await expect(editor).toHaveAttribute("data-runtime-candidate-phase", "preparing");
    await expect(editor.locator('iframe[data-frame-role="runtime-candidate"]')).toHaveCount(1);
    await expect.poll(() => visibleActiveFrameProof(page, "runtime-commit-hold-edit"))
      .toEqual(expect.objectContaining({
        renderVerified: "true",
        visible: true,
      }));

    frame = await currentEditorFrame(page);
    const activeTarget = frame.locator('[data-native-case="runtime-commit-hold-edit"]').first();
    await activeTarget.dblclick({ force: true });
    await expect(activeTarget).toHaveAttribute("contenteditable", "true");
    await expect(editor).toHaveAttribute("data-native-start-status", "started");
    await expect(editor).toHaveAttribute("data-runtime-candidate-phase", "preparing");

    await releaseHeldRuntimeCommits(page);
    await expect(activeTarget).toHaveAttribute("contenteditable", "true");
    await expect(editor.locator('iframe[data-frame-role="runtime-candidate"]')).toHaveCount(0);
    await expect(editor).toHaveAttribute("data-runtime-last-known-good-id", lastKnownGoodBefore);

    await activeTarget.press("End");
    await page.keyboard.insertText(" 提交后继续");
    await page.keyboard.press("Escape");
    await expect(activeTarget).not.toHaveAttribute("contenteditable", "true");
    await expect.poll(() => readFileSync(workingCopyPath, "utf8")).toContain("提交后继续");
    await expect.poll(() => surface.getAttribute("data-edit-runtime-outcome"), {
      timeout: 12_000,
    }).toBe("ready");
    await expect.poll(() => editor.getAttribute("data-runtime-last-known-good-id"))
      .not.toBe(lastKnownGoodBefore);
    frame = await currentEditorFrame(page);
    await expect(
      frame.locator('[data-native-case="runtime-commit-hold-edit"]')
        .filter({ hasText: "提交后继续" }),
    ).toHaveCount(1);
  }, {
    injectedEnv: {
      PAGEROOT_E2E_RUNTIME_COMMIT_HOOKS: "1",
    },
  });
});

test("a Candidate commit verification failure restores the visible Active", {
  tag: ["@gate-smoke", "@smoke-editing"],
}, async () => {
  const html = `<!doctype html>
<html><head><title>Runtime commit verification failure</title></head><body>
  <main>
    <p data-native-case="runtime-commit-verify-failure" id="commit-verify-failure">
      提交校验失败后旧画面仍可选择评论和编辑。
    </p>
  </main>
  <script>
    document.querySelector('[data-native-case="runtime-commit-verify-failure"]')
      .dataset.runtimeReady = 'true';
  </script>
</body></html>`;

  await withRuntimeProject("pageroot-runtime-commit-verify-failure-e2e-", {
    "runtime-report.html": html,
  }, async ({ page, sourcePath }) => {
    const editor = page.getByTestId("html-canvas-editor");
    let { frame } = await loadedDiskFrame(page, sourcePath, "runtime-commit-verify-failure");
    await expect(editor).toHaveAttribute("data-render-verified", "true");
    await expect.poll(() => editor.getAttribute("data-runtime-last-known-good-id"))
      .toBeTruthy();
    const lastKnownGoodBefore = await editor.getAttribute("data-runtime-last-known-good-id");
    const workingCopyPath = await managedWorkingCopyPath(page, sourcePath);
    const workingHtmlBeforeDuplicate = readFileSync(workingCopyPath, "utf8");

    await armRuntimeCommitHold(page);
    const target = frame.locator('[data-native-case="runtime-commit-verify-failure"]');
    await target.click();
    const duplicateButton = page.getByRole("button", { name: "复制元素", exact: true });
    await expect(duplicateButton).toBeVisible();
    await duplicateButton.click();
    await expect.poll(() => (
      readFileSync(workingCopyPath, "utf8")
        .split('<p data-native-case="runtime-commit-verify-failure"').length - 1
    )).toBeGreaterThanOrEqual(2);
    await waitForHeldRuntimeCommit(page);
    await expect(editor).toHaveAttribute("data-runtime-candidate-phase", "preparing");
    await page.evaluate(() => {
      window.__PAGEROOT_E2E_FAIL_NEXT_RUNTIME_COMMIT__ = true;
    });
    await releaseHeldRuntimeCommits(page);

    await expect.poll(() => visibleActiveFrameProof(page, "runtime-commit-verify-failure"))
      .toEqual(expect.objectContaining({
        renderVerified: "true",
        visible: true,
        text: "提交校验失败后旧画面仍可选择评论和编辑。",
      }));
    await expect(editor).toHaveAttribute("data-render-verified", "true");
    await expect(editor).toHaveAttribute("data-runtime-last-known-good-id", lastKnownGoodBefore);
    const workingHtmlAfterFailure = readFileSync(workingCopyPath, "utf8");
    expect(workingHtmlAfterFailure).not.toBe(workingHtmlBeforeDuplicate);
    expect(
      workingHtmlAfterFailure.split('<p data-native-case="runtime-commit-verify-failure"').length - 1,
    ).toBeGreaterThanOrEqual(2);

    await expect.poll(() => page.locator(".canvas-edit-surface").getAttribute(
      "data-edit-runtime-phase",
    )).toBe("static-fallback");
    await expect(page.getByTestId("edit-runtime-static-fallback")).toBeVisible();
    await expect(editor).toHaveAttribute("data-render-verified", "true");
    expect(readFileSync(workingCopyPath, "utf8")).toBe(workingHtmlAfterFailure);

    const staticNotice = page.getByTestId("edit-runtime-static-fallback");
    await page.getByRole("button", { name: "关闭动态内容提示" }).click();
    await expect(staticNotice).toHaveCount(0);
    frame = await currentEditorFrame(page);
    const restoredTarget = frame.locator('[data-native-case="runtime-commit-verify-failure"]').first();
    await restoredTarget.click({ force: true });
    await expect(restoredTarget).toHaveAttribute("data-html-canvas-selected", /.+/u);
    const toolbar = page.getByRole("toolbar", { name: /编辑/u });
    await expect(toolbar).toBeVisible();
    await toolbar.getByRole("button", { name: /给.+留评论/u }).click();
    const commentComposer = page.getByRole("region", { name: "添加评论" });
    await commentComposer.getByRole("textbox", { name: "评论内容" })
      .fill("提交失败后仍可评论。");
    await commentComposer.getByRole("button", { name: "评论", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "评论内容" })).toHaveCount(0);
    await expect(page.locator('aside[aria-label="本轮评论"]'))
      .toContainText("提交失败后仍可评论。");

    if (await staticNotice.count()) {
      await page.getByRole("button", { name: "关闭动态内容提示" }).click();
      await expect(staticNotice).toHaveCount(0);
    }
    await restoredTarget.dblclick({ force: true });
    await expect(restoredTarget).toHaveAttribute("contenteditable", "true");
    await expect(editor).toHaveAttribute("data-native-start-status", "started");
    await page.keyboard.press("Escape");
    await expect(restoredTarget).not.toHaveAttribute("contenteditable", "true");
    expect(readFileSync(workingCopyPath, "utf8")).toBe(workingHtmlAfterFailure);
    await expect(editor).toHaveAttribute("data-render-verified", "true");
  }, {
    injectedEnv: {
      PAGEROOT_E2E_RUNTIME_COMMIT_HOOKS: "1",
    },
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
