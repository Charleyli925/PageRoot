import { expect, test } from "@playwright/test";

import {
  authoredTabActivationDecision,
  collectVisibleAuthoredCandidates,
  discoverRuntimeGeneratedTargets,
  driveAuthoredTabActivation,
  probeAuthoredCapability,
  runtimeGeneratedDiagnosticsIssue,
} from "../electron/real-html/capability-driver.mjs";

const CORRECT_ID = "pr1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const WRONG_ID = "pr1_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

const HARNESS_TEST_OPTIONS = { tag: ["@gate-smoke", "@smoke-editing"] };

test("authored tab activation waits for a delayed action and fails ambiguous state", HARNESS_TEST_OPTIONS, async () => {
  expect(authoredTabActivationDecision({
    tabCount: 1,
    active: false,
    activationButtonCount: 0,
    activationButtonVisible: false,
    activationButtonEnabled: false,
  })).toEqual({ state: "pending", reason: "TAB_ACTIVATION_PENDING" });
  expect(authoredTabActivationDecision({
    tabCount: 1,
    active: false,
    activationButtonCount: 1,
    activationButtonVisible: true,
    activationButtonEnabled: true,
  })).toEqual({ state: "activate", reason: "TAB_ACTIVATION_ACTION_READY" });
  expect(authoredTabActivationDecision({
    tabCount: 1,
    active: true,
    activationButtonCount: 0,
    activationButtonVisible: false,
    activationButtonEnabled: false,
  })).toEqual({ state: "active", reason: "TAB_ALREADY_ACTIVE" });
  expect(authoredTabActivationDecision({
    tabCount: 2,
    active: false,
    activationButtonCount: 0,
    activationButtonVisible: false,
    activationButtonEnabled: false,
  })).toEqual({ state: "failed", reason: "TAB_STABLE_ID_NOT_UNIQUE" });
});

test("authored tab driver reaches active after a delayed action and fails a disappearing action", HARNESS_TEST_OPTIONS, async () => {
  let activePrepareCount = 0;
  let activeSelectCount = 0;
  const alreadyActive = await driveAuthoredTabActivation({
    readState: async () => ({
      tabCount: 1,
      active: true,
      activationButtonCount: 0,
      activationButtonVisible: false,
      activationButtonEnabled: false,
    }),
    prepareSelection: async () => { activePrepareCount += 1; },
    selectTab: async () => { activeSelectCount += 1; },
    activateTab: async () => {},
  });
  expect(alreadyActive.decision.state).toBe("active");
  expect(activePrepareCount).toBe(1);
  expect(activeSelectCount).toBe(0);

  const pendingSnapshot = async () => ({
    tabCount: 1,
    active: false,
    activationButtonCount: 0,
    activationButtonVisible: false,
    activationButtonEnabled: false,
  });
  await expect(driveAuthoredTabActivation({
    readState: pendingSnapshot,
    prepareSelection: async () => {
      const error = new Error("sticky selection");
      error.code = "SELECTION_RESET_FAILED";
      throw error;
    },
    selectTab: async () => {},
    activateTab: async () => {},
    timeoutMs: 50,
  })).rejects.toMatchObject({
    code: "TAB_ACTIVATION_NOT_SETTLED",
    details: {
      phase: "prepare-selection",
      causeCode: "SELECTION_RESET_FAILED",
      cause: "sticky selection",
    },
  });
  await expect(driveAuthoredTabActivation({
    readState: pendingSnapshot,
    prepareSelection: async () => {},
    selectTab: async () => {
      const error = new Error("tab intercepted");
      error.code = "POINTER_INTERCEPTED";
      throw error;
    },
    activateTab: async () => {},
    timeoutMs: 50,
  })).rejects.toMatchObject({
    code: "TAB_ACTIVATION_NOT_SETTLED",
    details: {
      phase: "select-tab",
      causeCode: "POINTER_INTERCEPTED",
      cause: "tab intercepted",
    },
  });

  let state = "pending";
  let activationClicks = 0;
  const delayedAction = setTimeout(() => { state = "activate"; }, 20);
  const completed = await driveAuthoredTabActivation({
    readState: async () => ({
      tabCount: 1,
      active: state === "active",
      activationButtonCount: state === "activate" ? 1 : 0,
      activationButtonVisible: state === "activate",
      activationButtonEnabled: state === "activate",
    }),
    prepareSelection: async () => {},
    selectTab: async () => {},
    activateTab: async () => {
      activationClicks += 1;
      state = "active";
    },
    timeoutMs: 500,
    pollIntervalMs: 5,
  });
  clearTimeout(delayedAction);
  expect(completed.decision.state).toBe("active");
  expect(activationClicks).toBe(1);

  state = "activate";
  await expect(driveAuthoredTabActivation({
    readState: async () => ({
      tabCount: 1,
      active: false,
      activationButtonCount: state === "activate" ? 1 : 0,
      activationButtonVisible: state === "activate",
      activationButtonEnabled: state === "activate",
    }),
    prepareSelection: async () => {},
    selectTab: async () => {},
    activateTab: async () => {
      state = "pending";
      throw new Error("activation button detached");
    },
    timeoutMs: 80,
    pollIntervalMs: 5,
  })).rejects.toMatchObject({
    code: "TAB_ACTIVATION_NOT_SETTLED",
    details: { decision: { state: "pending" } },
  });
});

async function installRuntimeDiagnosticReset(page) {
  await page.evaluate(() => {
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      const root = document.querySelector("[data-runtime-root]");
      for (const name of [
        "data-selection-runtime-generated",
        "data-selection-runtime-generation",
        "data-selection-runtime-source-anchor-id",
        "data-selection-runtime-kind",
        "data-selection-runtime-path",
      ]) root?.removeAttribute(name);
    });
  });
}

async function capabilityFixture(
  page,
  selectedId = null,
  targetTag = "p",
  { resetOnEscape = true } = {},
) {
  await page.setContent(`
    <style>
      #target { display:block; width:240px; height:80px; }
      [role="toolbar"] { position:fixed; inset:0 auto auto 0; width:260px; height:96px; z-index:10; }
    </style>
    <main data-runtime-root data-element-copy-availability="available" data-element-copy-reason="available">
      <${targetTag} id="target" data-pageroot-id="${CORRECT_ID}">editable authored text</${targetTag}>
      <p data-pageroot-id="${WRONG_ID}">other text</p>
      <div role="toolbar" aria-label="元素工具栏" hidden>
        <button aria-label="留评论"></button>
        <button aria-label="编辑"></button>
        <button aria-label="复制元素"></button>
        <button aria-label="上移"></button>
        <button aria-label="删除元素"></button>
      </div>
    </main>
  `);
  await page.locator("#target").evaluate((element, payload) => {
    window.__capabilityProbeClickCount = 0;
    document.querySelectorAll("[data-pageroot-id]").forEach((target) => {
      target.addEventListener("click", (event) => {
        window.__capabilityProbeClickCount += 1;
        window.__capabilityProbeAltKey = event.altKey;
        document.querySelectorAll("[data-html-canvas-selected]")
          .forEach((candidate) => candidate.removeAttribute("data-html-canvas-selected"));
        const nextId = payload.selectedId || target.getAttribute("data-pageroot-id");
        document.querySelector(`[data-pageroot-id="${nextId}"]`)
          ?.setAttribute("data-html-canvas-selected", "");
        document.querySelector('[role="toolbar"]')?.removeAttribute("hidden");
      });
    });
    if (payload.resetOnEscape) {
      document.addEventListener("keydown", (event) => {
        if (event.key !== "Escape") return;
        document.querySelectorAll("[data-html-canvas-selected]")
          .forEach((candidate) => candidate.removeAttribute("data-html-canvas-selected"));
        document.querySelector('[role="toolbar"]')?.setAttribute("hidden", "");
      });
    }
  }, { selectedId, resetOnEscape });
}

function candidate(stableId = CORRECT_ID) {
  return {
    stableId,
    tag: "p",
    sourceEditable: true,
    visible: true,
    isConnected: true,
    inert: false,
    runtimeGenerated: false,
    tabId: null,
    region: "top",
    scrollContainer: "document",
  };
}

test("capability probe accepts only the exact selected Stable ID", HARNESS_TEST_OPTIONS, async ({ page }) => {
  await capabilityFixture(page);
  const editor = page.locator("[data-runtime-root]");
  const observed = await probeAuthoredCapability({
    page,
    frame: page,
    editor,
    candidate: candidate(),
  });
  expect(observed).toMatchObject({
    stableId: CORRECT_ID,
    selectedId: CORRECT_ID,
    probeReason: "CAPABILITY_OBSERVED",
  });
  expect(observed.capabilityFamilies).toEqual(expect.arrayContaining([
    "selection",
    "text",
    "format",
    "comment",
    "copy",
  ]));
  expect(observed.behaviorFamilies).toEqual(expect.arrayContaining([
    "bold",
    "italic",
    "underline",
    "font-size",
    "text-color",
    "fill-color",
    "padding",
    "margin",
    "line-height",
  ]));
  expect(await page.evaluate(() => window.__capabilityProbeAltKey)).toBe(false);
});

test("capability probe closes A's toolbar before the next exact click on B", HARNESS_TEST_OPTIONS, async ({ page }) => {
  await capabilityFixture(page);
  const base = {
    page,
    frame: page,
    editor: page.locator("[data-runtime-root]"),
  };
  const first = await probeAuthoredCapability({ ...base, candidate: candidate(CORRECT_ID) });
  const second = await probeAuthoredCapability({ ...base, candidate: candidate(WRONG_ID) });
  expect(first).toMatchObject({ probeReason: "CAPABILITY_OBSERVED", selectedId: CORRECT_ID });
  expect(second).toMatchObject({
    probeReason: "CAPABILITY_OBSERVED",
    selectedId: WRONG_ID,
    selectionReset: {
      ok: true,
      reason: "PREVIOUS_SELECTION_CLEARED",
      selectedMarkerCount: 0,
      visibleToolbarCount: 0,
    },
  });
  expect(await page.evaluate(() => window.__capabilityProbeClickCount)).toBe(2);
});

test("capability probe fails closed before clicking when the prior overlay cannot clear", HARNESS_TEST_OPTIONS, async ({ page }) => {
  await capabilityFixture(page, CORRECT_ID, "p", { resetOnEscape: false });
  await page.evaluate((stableId) => {
    document.querySelector(`[data-pageroot-id="${stableId}"]`)
      ?.setAttribute("data-html-canvas-selected", "");
    document.querySelector('[role="toolbar"]')?.removeAttribute("hidden");
  }, CORRECT_ID);
  const startedAt = Date.now();
  await expect(probeAuthoredCapability({
    page,
    frame: page,
    editor: page.locator("[data-runtime-root]"),
    candidate: candidate(),
  })).rejects.toMatchObject({
    code: "CAPABILITY_PROBE_SELECTION_NOT_CLEARED",
    details: {
      stableId: CORRECT_ID,
      selectionReset: {
        ok: false,
        reason: "PREVIOUS_SELECTION_OVERLAY_DID_NOT_CLOSE",
        selectedMarkerCount: 1,
        visibleToolbarCount: 1,
      },
    },
  });
  expect(Date.now() - startedAt).toBeLessThan(5_000);
  expect(await page.evaluate(() => window.__capabilityProbeClickCount)).toBe(0);
});

test("capability probe rejects stale and wrongly selected Stable IDs", HARNESS_TEST_OPTIONS, async ({ page }) => {
  await capabilityFixture(page, WRONG_ID);
  const editor = page.locator("[data-runtime-root]");
  await expect(probeAuthoredCapability({
    page,
    frame: page,
    editor,
    candidate: candidate(),
  })).rejects.toMatchObject({
    code: "CAPABILITY_PROBE_SELECTION_IDENTITY_MISMATCH",
    details: { expectedStableId: CORRECT_ID, selectedId: WRONG_ID },
  });

  await expect(probeAuthoredCapability({
    page,
    frame: page,
    editor,
    candidate: candidate("pr1_cccccccccccccccccccccccccccccccc"),
  })).rejects.toMatchObject({
    code: "CAPABILITY_PROBE_STALE_STABLE_ID",
    details: { count: 0 },
  });
});

test("capability probe uses a bounded real mouse hit for a continuously moving target", HARNESS_TEST_OPTIONS, async ({ page }) => {
  await capabilityFixture(page);
  await page.locator("#target").evaluate((element) => {
    element.animate(
      [{ transform: "translateX(0px)" }, { transform: "translateX(2px)" }],
      { duration: 40, iterations: Infinity, direction: "alternate" },
    );
  });
  const startedAt = Date.now();
  const observed = await probeAuthoredCapability({
    page,
    frame: page,
    editor: page.locator("[data-runtime-root]"),
    candidate: candidate(),
  });
  expect(observed).toMatchObject({ probeReason: "CAPABILITY_OBSERVED", selectedId: CORRECT_ID });
  expect(Date.now() - startedAt).toBeLessThan(5_000);
});

test("capability probe rejects a foreign hit interceptor without force-clicking", HARNESS_TEST_OPTIONS, async ({ page }) => {
  await capabilityFixture(page);
  await page.locator("#target").evaluate((element) => {
    const interceptor = document.createElement("div");
    interceptor.id = "foreign-interceptor";
    Object.assign(interceptor.style, {
      position: "absolute",
      left: `${element.offsetLeft}px`,
      top: `${element.offsetTop}px`,
      width: `${element.offsetWidth}px`,
      height: `${element.offsetHeight}px`,
      zIndex: "9",
    });
    document.body.append(interceptor);
  });
  const startedAt = Date.now();
  const observed = await probeAuthoredCapability({
    page,
    frame: page,
    editor: page.locator("[data-runtime-root]"),
    candidate: candidate(),
  });
  expect(observed).toMatchObject({
    capabilityFamilies: [],
    behaviorFamilies: [],
    probeReason: "NO_EXACT_HIT_POINT",
  });
  expect(Date.now() - startedAt).toBeLessThan(5_000);
  expect(await page.evaluate(() => window.__capabilityProbeClickCount)).toBe(0);
});

test("capability probe rejects an iframe host overlay that appears on pointer move", HARNESS_TEST_OPTIONS, async ({ page }) => {
  await page.setContent(`
    <style>
      iframe { width: 320px; height: 180px; border: 0; }
      #host-overlay { position: fixed; left: 8px; top: 8px; width: 320px; height: 180px; z-index: 20; }
    </style>
    <main data-runtime-root data-element-copy-availability="available" data-element-copy-reason="available">
      <iframe data-runtime-slot-role="active"></iframe>
      <div id="host-overlay" hidden></div>
      <div role="toolbar" aria-label="元素工具栏" hidden></div>
    </main>
  `);
  const iframeElement = await page.locator("iframe").elementHandle();
  const child = await iframeElement.contentFrame();
  await child.setContent(`
    <p id="target" data-pageroot-id="${CORRECT_ID}" style="display:block;width:240px;height:80px">
      iframe authored target
    </p>
  `);
  await child.locator("#target").evaluate((element) => {
    window.__capabilityProbeClickCount = 0;
    element.addEventListener("click", () => {
      window.__capabilityProbeClickCount += 1;
      element.setAttribute("data-html-canvas-selected", "");
    });
  });
  await page.locator("iframe").evaluate((iframe) => {
    iframe.addEventListener("mouseenter", () => {
      document.querySelector("#host-overlay")?.removeAttribute("hidden");
    });
  });
  const startedAt = Date.now();
  await expect(probeAuthoredCapability({
    page,
    frame: child,
    editor: page.locator("[data-runtime-root]"),
    candidate: candidate(),
  })).rejects.toMatchObject({
    code: "CAPABILITY_PROBE_HOST_POINTER_INTERCEPTED",
    details: { stableId: CORRECT_ID, hitKind: "div" },
  });
  expect(Date.now() - startedAt).toBeLessThan(5_000);
  expect(await child.evaluate(() => window.__capabilityProbeClickCount)).toBe(0);
});

async function installIframeCapabilityHintFixture(page, {
  hintTargetId = CORRECT_ID,
  hintTargetDomGeneration = "11",
  hintCurrentDomGeneration = "11",
  hintActiveFrameGeneration = "7",
  selectedId = CORRECT_ID,
} = {}) {
  await page.setContent(`
    <style>
      iframe { width: 320px; height: 180px; border: 0; }
      [data-testid="canvas-capability-hint"] {
        position: fixed; left: 8px; top: 8px; width: 320px; height: 180px; z-index: 20;
      }
    </style>
    <main data-runtime-root data-element-copy-availability="available" data-element-copy-reason="available">
      <iframe data-runtime-slot-role="active" data-frame-generation="7"></iframe>
      <button
        data-testid="canvas-capability-hint"
        data-capability-target-id="${hintTargetId}"
        data-capability-target-key="element:${hintTargetId}"
        data-capability-target-dom-generation="${hintTargetDomGeneration}"
        data-capability-current-dom-generation="${hintCurrentDomGeneration}"
        data-capability-active-frame-generation="${hintActiveFrameGeneration}"
        hidden
      >Select exact target</button>
      <div role="toolbar" aria-label="元素工具栏" hidden>
        <button aria-label="留评论"></button>
        <button aria-label="编辑"></button>
        <button aria-label="复制元素"></button>
      </div>
    </main>
  `);
  const iframeElement = await page.locator("iframe").elementHandle();
  const child = await iframeElement.contentFrame();
  await child.setContent(`
    <p id="target" data-pageroot-id="${CORRECT_ID}" style="display:block;width:240px;height:80px">
      iframe authored target
    </p>
    <p data-pageroot-id="${WRONG_ID}">wrong target</p>
  `);
  await page.evaluate((nextSelectedId) => {
    window.__capabilityHintClickCount = 0;
    const iframe = document.querySelector("iframe");
    const hint = document.querySelector('[data-testid="canvas-capability-hint"]');
    iframe?.addEventListener("mouseenter", () => hint?.removeAttribute("hidden"));
    hint?.addEventListener("click", () => {
      window.__capabilityHintClickCount += 1;
      const childDocument = iframe?.contentDocument;
      childDocument?.querySelectorAll("[data-html-canvas-selected]")
        .forEach((element) => element.removeAttribute("data-html-canvas-selected"));
      childDocument?.querySelector(`[data-pageroot-id="${nextSelectedId}"]`)
        ?.setAttribute("data-html-canvas-selected", "subregion");
      document.querySelector('[role="toolbar"]')?.removeAttribute("hidden");
    });
  }, selectedId);
  await page.mouse.move(0, 0);
  return child;
}

test("capability probe accepts an exact product hover hint when DOM generation validly differs from frame generation", HARNESS_TEST_OPTIONS, async ({ page }) => {
  const child = await installIframeCapabilityHintFixture(page);
  const observed = await probeAuthoredCapability({
    page,
    frame: child,
    editor: page.locator("[data-runtime-root]"),
    candidate: candidate(),
  });
  expect(observed).toMatchObject({
    probeReason: "CAPABILITY_OBSERVED",
    selectedId: CORRECT_ID,
  });
  expect(await page.evaluate(() => window.__capabilityHintClickCount)).toBe(1);
});

test("capability probe rejects wrong-target, stale-frame, and stale-DOM product hover hints before click", HARNESS_TEST_OPTIONS, async ({ page }) => {
  const child = await installIframeCapabilityHintFixture(page, { hintTargetId: WRONG_ID });
  const input = {
    page,
    frame: child,
    editor: page.locator("[data-runtime-root]"),
    candidate: candidate(),
  };
  await expect(probeAuthoredCapability(input)).rejects.toMatchObject({
    code: "CAPABILITY_PROBE_HOST_POINTER_INTERCEPTED",
    details: { hitKind: "capability-hint-identity-mismatch" },
  });
  expect(await page.evaluate(() => window.__capabilityHintClickCount)).toBe(0);

  await page.getByTestId("canvas-capability-hint").evaluate((hint, stableId) => {
    hint.setAttribute("data-capability-target-id", stableId);
    hint.setAttribute("data-capability-target-key", `element:${stableId}`);
    hint.setAttribute("data-capability-active-frame-generation", "6");
  }, CORRECT_ID);
  await expect(probeAuthoredCapability(input)).rejects.toMatchObject({
    code: "CAPABILITY_PROBE_HOST_POINTER_INTERCEPTED",
    details: { hitKind: "capability-hint-identity-mismatch" },
  });
  expect(await page.evaluate(() => window.__capabilityHintClickCount)).toBe(0);

  await page.getByTestId("canvas-capability-hint").evaluate((hint) => {
    hint.setAttribute("data-capability-active-frame-generation", "7");
    hint.setAttribute("data-capability-target-dom-generation", "10");
    hint.setAttribute("data-capability-current-dom-generation", "11");
  });
  await expect(probeAuthoredCapability(input)).rejects.toMatchObject({
    code: "CAPABILITY_PROBE_HOST_POINTER_INTERCEPTED",
    details: { hitKind: "capability-hint-identity-mismatch" },
  });
  expect(await page.evaluate(() => window.__capabilityHintClickCount)).toBe(0);
});

test("capability probe rejects every incomplete product hover generation diagnostic before click", HARNESS_TEST_OPTIONS, async ({ page }) => {
  const missingGenerationCases = [
    ["[data-runtime-slot-role=active]", "data-frame-generation"],
    ["[data-testid=canvas-capability-hint]", "data-capability-target-dom-generation"],
    ["[data-testid=canvas-capability-hint]", "data-capability-current-dom-generation"],
    ["[data-testid=canvas-capability-hint]", "data-capability-active-frame-generation"],
  ];
  for (const [selector, attribute] of missingGenerationCases) {
    const child = await installIframeCapabilityHintFixture(page);
    await page.locator(selector).evaluate((element, name) => element.removeAttribute(name), attribute);
    await expect(probeAuthoredCapability({
      page,
      frame: child,
      editor: page.locator("[data-runtime-root]"),
      candidate: candidate(),
    })).rejects.toMatchObject({
      code: "CAPABILITY_PROBE_HOST_POINTER_INTERCEPTED",
      details: { hitKind: "capability-hint-identity-mismatch" },
    });
    expect(await page.evaluate(() => window.__capabilityHintClickCount)).toBe(0);
  }

  for (const invalidGeneration of ["01", "9007199254740992"]) {
    const invalidChild = await installIframeCapabilityHintFixture(page, {
      hintTargetDomGeneration: invalidGeneration,
      hintCurrentDomGeneration: invalidGeneration,
    });
    await expect(probeAuthoredCapability({
      page,
      frame: invalidChild,
      editor: page.locator("[data-runtime-root]"),
      candidate: candidate(),
    })).rejects.toMatchObject({
      code: "CAPABILITY_PROBE_HOST_POINTER_INTERCEPTED",
      details: { hitKind: "capability-hint-identity-mismatch" },
    });
    expect(await page.evaluate(() => window.__capabilityHintClickCount)).toBe(0);
  }
});

test("capability probe reports a same-ID wrong DOM tag instead of echoing the frozen tag", HARNESS_TEST_OPTIONS, async ({ page }) => {
  await capabilityFixture(page, CORRECT_ID, "section");
  const observed = await probeAuthoredCapability({
    page,
    frame: page,
    editor: page.locator("[data-runtime-root]"),
    candidate: candidate(),
  });
  expect(observed).toMatchObject({
    stableId: CORRECT_ID,
    selectedId: CORRECT_ID,
    tag: "section",
    probeReason: "CAPABILITY_OBSERVED",
  });
  expect(observed.tag).not.toBe(candidate().tag);
  expect(observed.selectedId === CORRECT_ID && observed.tag === candidate().tag)
    .toBe(false);
});

test("capability census keeps only the currently reachable authored tab content", HARNESS_TEST_OPTIONS, async ({ page }) => {
  await page.setContent(`
    <section id="tab-a"><p data-pageroot-id="${CORRECT_ID}">A</p></section>
    <section id="tab-b" hidden><p data-pageroot-id="${WRONG_ID}">B</p></section>
  `);
  const sourceElements = [CORRECT_ID, WRONG_ID].map((pagerootId) => ({
    pagerootId,
    sourceEditable: true,
  }));
  const first = await collectVisibleAuthoredCandidates(page, sourceElements, "tab-a");
  expect(first.filter((entry) => entry.visible).map((entry) => entry.stableId))
    .toEqual([CORRECT_ID]);
  expect(first.find((entry) => entry.stableId === WRONG_ID)?.visible).toBe(false);

  await page.evaluate(() => {
    document.querySelector("#tab-a").hidden = true;
    document.querySelector("#tab-b").hidden = false;
  });
  const second = await collectVisibleAuthoredCandidates(page, sourceElements, "tab-b");
  expect(second.filter((entry) => entry.visible).map((entry) => entry.stableId))
    .toEqual([WRONG_ID]);
});

test("Runtime-generated discovery trusts controller diagnostics and freezes one target per kind", HARNESS_TEST_OPTIONS, async ({ page }) => {
  await page.setContent(`
    <main data-runtime-root>
      <section data-pageroot-id="${CORRECT_ID}">
        <table id="runtime-table"><tbody><tr><td>runtime</td></tr></tbody></table>
        <table id="same-kind-runtime-table"><tbody><tr><td>runtime 2</td></tr></tbody></table>
      </section>
    </main>
  `);
  const editor = page.locator("[data-runtime-root]");
  await installRuntimeDiagnosticReset(page);
  for (const [index, id] of ["runtime-table", "same-kind-runtime-table"].entries()) {
    await page.locator(`#${id}`).evaluate((element, payload) => {
      element.addEventListener("click", () => {
        const root = document.querySelector("[data-runtime-root]");
        root.setAttribute("data-selection-runtime-generated", "true");
        root.setAttribute("data-selection-runtime-generation", "7");
        root.setAttribute("data-selection-runtime-source-anchor-id", payload.anchorId);
        root.setAttribute("data-selection-runtime-kind", "table");
        root.setAttribute(
          "data-selection-runtime-path",
          payload.index === 0 ? "table:nth-of-type(1)" : "table:nth-of-type(2)",
        );
      });
    }, { anchorId: CORRECT_ID, index });
  }
  const frozen = await discoverRuntimeGeneratedTargets({ page, frame: page, editor, tabId: "tab-a" });
  expect(frozen.diagnostics).toMatchObject({
    candidateCount: 4,
    runtimeGeneratedCount: 4,
    frozenTargetCount: 1,
    rejectedDiagnosticCount: 0,
    truncated: false,
  });
  expect(frozen.targets).toEqual([{
    targetKey: `${CORRECT_ID}:table:table:nth-of-type(1)`,
    tabId: "tab-a",
    generation: "7",
    sourceAnchorId: CORRECT_ID,
    kind: "table",
    relativePath: "table:nth-of-type(1)",
    capabilityFamilies: ["comment"],
    deniedCapabilityFamilies: ["text", "format", "copy", "move", "delete"],
  }]);
  expect(runtimeGeneratedDiagnosticsIssue([frozen.diagnostics])).toBeNull();
});

test("Runtime-generated discovery rejects incomplete diagnostics and authored visual targets", HARNESS_TEST_OPTIONS, async ({ page }) => {
  await page.setContent(`
    <main data-runtime-root>
      <section data-pageroot-id="${CORRECT_ID}">
        <table id="authored-table"><tbody><tr><td>authored</td></tr></tbody></table>
        <table id="incomplete-runtime-table"><tbody><tr><td>runtime</td></tr></tbody></table>
      </section>
    </main>
  `);
  await installRuntimeDiagnosticReset(page);
  await page.locator("#authored-table").evaluate((element) => {
    element.addEventListener("click", () => {
      const root = document.querySelector("[data-runtime-root]");
      root.setAttribute("data-selection-runtime-generated", "false");
    });
  });
  await page.locator("#incomplete-runtime-table").evaluate((element, anchorId) => {
    element.addEventListener("click", () => {
      const root = document.querySelector("[data-runtime-root]");
      root.setAttribute("data-selection-runtime-generated", "true");
      root.setAttribute("data-selection-runtime-generation", "7");
      root.setAttribute("data-selection-runtime-source-anchor-id", anchorId);
      root.setAttribute("data-selection-runtime-kind", "table");
    });
  }, CORRECT_ID);
  const frozen = await discoverRuntimeGeneratedTargets({
    page,
    frame: page,
    editor: page.locator("[data-runtime-root]"),
    tabId: "tab-a",
  });
  expect(frozen.targets).toEqual([]);
  expect(frozen.diagnostics).toMatchObject({
    candidateCount: 4,
    runtimeGeneratedCount: 2,
    frozenTargetCount: 0,
    rejectedDiagnosticCount: 2,
    probeFailureCount: 0,
  });
  expect(runtimeGeneratedDiagnosticsIssue([frozen.diagnostics]))
    .toBe("RUNTIME_GENERATED_DIAGNOSTICS_INCOMPLETE");
});

test("Runtime-generated discovery rejects stale diagnostics when Escape cannot clear them", HARNESS_TEST_OPTIONS, async ({ page }) => {
  await page.setContent(`
    <main
      data-runtime-root
      data-selection-runtime-generated="true"
      data-selection-runtime-generation="7"
      data-selection-runtime-source-anchor-id="${CORRECT_ID}"
      data-selection-runtime-kind="table"
      data-selection-runtime-path="table"
    >
      <section data-pageroot-id="${CORRECT_ID}">
        <table><tbody><tr><td>stale</td></tr></tbody></table>
      </section>
    </main>
  `);
  const frozen = await discoverRuntimeGeneratedTargets({
    page,
    frame: page,
    editor: page.locator("[data-runtime-root]"),
    tabId: "tab-a",
  });
  expect(frozen.targets).toEqual([]);
  expect(frozen.diagnostics.probeFailureCount).toBe(2);
  expect(runtimeGeneratedDiagnosticsIssue([frozen.diagnostics]))
    .toBe("RUNTIME_GENERATED_PROBE_FAILED");
  expect(runtimeGeneratedDiagnosticsIssue([]))
    .toBe("RUNTIME_GENERATED_DIAGNOSTICS_MISSING");
});
