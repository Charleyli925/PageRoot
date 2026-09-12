import { expect, test } from "@playwright/test";

import {
  collectVisibleAuthoredCandidates,
  discoverRuntimeGeneratedTargets,
  probeAuthoredCapability,
  runtimeGeneratedDiagnosticsIssue,
} from "../electron/real-html/capability-driver.mjs";

const CORRECT_ID = "pr1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const WRONG_ID = "pr1_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

const HARNESS_TEST_OPTIONS = { tag: ["@gate-smoke", "@smoke-editing"] };

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

async function capabilityFixture(page, selectedId = CORRECT_ID, targetTag = "p") {
  await page.setContent(`
    <style>#target { display:block; width:240px; height:80px; }</style>
    <main data-runtime-root data-element-copy-availability="available" data-element-copy-reason="available">
      <${targetTag} id="target" data-pageroot-id="${CORRECT_ID}">editable authored text</${targetTag}>
      <p data-pageroot-id="${WRONG_ID}">other text</p>
      <div role="toolbar" aria-label="元素工具栏">
        <button aria-label="留评论"></button>
        <button aria-label="编辑"></button>
        <button aria-label="复制元素"></button>
        <button aria-label="上移"></button>
        <button aria-label="删除元素"></button>
      </div>
    </main>
  `);
  await page.locator("#target").evaluate((element, id) => {
    element.addEventListener("click", (event) => {
      if (!event.altKey) return;
      document.querySelectorAll("[data-html-canvas-selected]")
        .forEach((candidate) => candidate.removeAttribute("data-html-canvas-selected"));
      document.querySelector(`[data-pageroot-id="${id}"]`)
        ?.setAttribute("data-html-canvas-selected", "");
    });
  }, selectedId);
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
});

test("capability probe rejects stale and wrongly selected Stable IDs", HARNESS_TEST_OPTIONS, async ({ page }) => {
  await capabilityFixture(page, WRONG_ID);
  const editor = page.locator("[data-runtime-root]");
  const wrongSelection = await probeAuthoredCapability({
    page,
    frame: page,
    editor,
    candidate: candidate(),
  });
  expect(wrongSelection).toMatchObject({
    capabilityFamilies: [],
    behaviorFamilies: [],
    probeReason: "SELECTION_IDENTITY_MISMATCH",
    selectedId: WRONG_ID,
  });

  const stale = await probeAuthoredCapability({
    page,
    frame: page,
    editor,
    candidate: candidate("pr1_cccccccccccccccccccccccccccccccc"),
  });
  expect(stale).toMatchObject({
    capabilityFamilies: [],
    behaviorFamilies: [],
    probeReason: "LIVE_DOM_MISSING",
  });
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
