import { expect } from "@playwright/test";

import {
  launchPageRoot,
  mkdirSync,
  mkdtempSync,
  path,
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


export {
  withRuntimeProject,
  armRuntimeHandoffSamples,
  assertRuntimeHandoff,
  assertRuntimeCandidateReused,
  parserPreclaimFixture,
};
