import { expect, test } from "@playwright/test";

import {
  activateNativeEdit,
  clickEditHistoryMenu,
  currentEditorFrame,
  documentToken,
  expectCheckpointPersisted,
  launchPageRoot,
  loadedDiskFrame,
  managedWorkingCopyPath,
  mkdtempSync,
  path,
  readFileSync,
  removeValidatedTemporaryDirectory,
  setTextSelection,
  stopPageRoot,
  tmpdir,
  waitForRuntimeHandoffSettled,
  writeFileSync,
} from "./electron-native-harness.mjs";

const SINGLE_PATH_HTML = `<!doctype html>
<html><head><title>Canvas single path</title></head><body>
  <div aria-hidden="true" style="height:640px"></div>
  <main>
    <article data-native-case="pipeline-first">
      <p data-native-case="pipeline-text">Alpha</p>
    </article>
    <article data-native-case="pipeline-second">
      <p>Beta</p>
    </article>
  </main>
  <div aria-hidden="true" style="height:1600px"></div>
</body></html>`;

async function withSinglePathProject(run) {
  const sourceDirectory = mkdtempSync(path.join(tmpdir(), "pageroot-edit-pipeline-e2e-"));
  const sourcePath = path.join(sourceDirectory, "single-path.html");
  writeFileSync(sourcePath, SINGLE_PATH_HTML, "utf8");
  let electronApp = null;
  let isolatedUserData = null;
  try {
    const launched = await launchPageRoot({ activeSourcePath: sourcePath });
    electronApp = launched.electronApp;
    isolatedUserData = launched.isolatedUserData;
    await run({ ...launched, sourcePath });
  } finally {
    if (electronApp && isolatedUserData) {
      await stopPageRoot(electronApp, isolatedUserData);
    }
    removeValidatedTemporaryDirectory(sourceDirectory, "pageroot-edit-pipeline-e2e-");
  }
}

async function enablePipelineCounters(page) {
  await expect.poll(() => page.evaluate(() => (
    typeof window.__PAGEROOT_ENABLE_EDIT_PIPELINE_COUNTERS__
  ))).toBe("function");
  await page.evaluate(() => {
    window.__PAGEROOT_ENABLE_EDIT_PIPELINE_COUNTERS__();
    window.__PAGEROOT_RESET_EDIT_PIPELINE_COUNTERS__();
  });
}

async function resetPipelineCounters(page) {
  await page.evaluate(() => window.__PAGEROOT_RESET_EDIT_PIPELINE_COUNTERS__());
}

async function readPipelineCounters(page) {
  return page.evaluate(() => window.__PAGEROOT_READ_EDIT_PIPELINE_COUNTERS__());
}

test("Canvas layout changes do not rescan insertion identities while source and document stay", {
  tag: ["@gate-smoke", "@smoke-editing"],
}, async () => {
  test.setTimeout(120_000);
  await withSinglePathProject(async ({ page, sourcePath }) => {
    const editor = page.getByTestId("html-canvas-editor");
    let frame = (await loadedDiskFrame(page, sourcePath, "pipeline-first")).frame;
    await frame.locator('[data-native-case="pipeline-first"]').click();
    await expect(editor.getByRole("toolbar")).toBeVisible();
    await enablePipelineCounters(page);
    const initialDocument = await documentToken(frame);
    const reviewStage = page.locator(".review-scroll-stage");
    await reviewStage.evaluate((element) => {
      element.scrollTop = 360;
    });
    await expect.poll(() => reviewStage.evaluate((element) => element.scrollTop)).toBe(360);
    await page.setViewportSize({ width: 1180, height: 820 });
    await frame.locator('[data-native-case="pipeline-second"]').click();
    await expect(frame.locator('[data-native-case="pipeline-second"]'))
      .toHaveAttribute("data-html-canvas-selected", "module");
    await expect(editor.getByRole("toolbar")).toBeVisible();
    await frame.locator('[data-native-case="pipeline-first"]').click();
    await expect(frame.locator('[data-native-case="pipeline-first"]'))
      .toHaveAttribute("data-html-canvas-selected", "module");
    expect(await documentToken(frame)).toBe(initialDocument);
    const counts = await readPipelineCounters(page);
    expect(counts.insertionPointFullTreeScans).toBe(0);
    expect(counts.fullPatchApplies).toBe(0);
  });
});

test("accepted Canvas text, style and structure edits each apply once", {
  tag: ["@gate-smoke", "@smoke-editing"],
}, async () => {
  test.setTimeout(180_000);
  await withSinglePathProject(async ({ electronApp, page, sourcePath }) => {
    const editor = page.getByTestId("html-canvas-editor");
    const workingCopyPath = await managedWorkingCopyPath(page, sourcePath);
    let frame = (await loadedDiskFrame(page, sourcePath, "pipeline-text")).frame;
    await enablePipelineCounters(page);

    await resetPipelineCounters(page);
    await activateNativeEdit(frame, "pipeline-text");
    await setTextSelection(frame, "pipeline-text", "Alpha".length);
    const textDocument = await documentToken(frame);
    await page.keyboard.insertText(" Gamma");
    await page.locator(".comments-panel.comment-rail").click({ position: { x: 4, y: 4 } });
    await expect.poll(() => readFileSync(workingCopyPath, "utf8")).toContain("Alpha Gamma");
    expect(await documentToken(await currentEditorFrame(page))).toBe(textDocument);
    const textCounts = await readPipelineCounters(page);
    expect(textCounts.fullPatchApplies).toBe(1);
    const textRevision = await expectCheckpointPersisted(page, 0);

    await waitForRuntimeHandoffSettled(page);
    frame = await currentEditorFrame(page);
    await resetPipelineCounters(page);
    await frame.locator('[data-native-case="pipeline-first"]').click();
    const toolbar = editor.getByRole("toolbar");
    await expect(toolbar).toBeVisible();
    await toolbar.getByText("样式与间距", { exact: true }).click();
    await toolbar.getByLabel("内边距（像素）").fill("20");
    await expect.poll(() => readFileSync(workingCopyPath, "utf8"))
      .toMatch(/padding-top:\s*20px/u);
    const styleCounts = await readPipelineCounters(page);
    expect(styleCounts.fullPatchApplies).toBe(1);
    const styleRevision = await expectCheckpointPersisted(page, textRevision);

    await waitForRuntimeHandoffSettled(page);
    frame = await currentEditorFrame(page);
    await resetPipelineCounters(page);
    await frame.locator('[data-native-case="pipeline-first"]').click();
    const duplicateButton = page.getByRole("button", { name: "复制元素", exact: true });
    await expect(duplicateButton).toBeVisible();
    await duplicateButton.click();
    await expect.poll(() => (
      readFileSync(workingCopyPath, "utf8").split('data-native-case="pipeline-first"').length - 1
    )).toBe(2);
    const structureCounts = await readPipelineCounters(page);
    expect(structureCounts.fullPatchApplies).toBe(1);
    frame = await currentEditorFrame(page);
    await expect(frame.locator('[data-native-case="pipeline-first"]')).toHaveCount(2);
    const firstIds = await frame.locator('[data-native-case="pipeline-first"]')
      .evaluateAll((elements) => elements.map((element) => element.getAttribute("data-pageroot-id")));
    expect(new Set(firstIds).size).toBe(2);

    await resetPipelineCounters(page);
    await clickEditHistoryMenu(electronApp, page, "undo");
    await expectCheckpointPersisted(page, styleRevision);
    await expect.poll(() => (
      readFileSync(workingCopyPath, "utf8").split('data-native-case="pipeline-first"').length - 1
    )).toBe(1);
    const undoCounts = await readPipelineCounters(page);
    expect(undoCounts.fullPatchApplies).toBe(1);
    frame = await currentEditorFrame(page);
    await expect(frame.locator('[data-native-case="pipeline-first"]')).toHaveCount(1);
    await expect.poll(() => readFileSync(workingCopyPath, "utf8")).toMatch(/padding-top:\s*20px/u);

    await resetPipelineCounters(page);
    await clickEditHistoryMenu(electronApp, page, "redo");
    await expect.poll(() => (
      readFileSync(workingCopyPath, "utf8").split('data-native-case="pipeline-first"').length - 1
    )).toBe(2);
    const redoCounts = await readPipelineCounters(page);
    expect(redoCounts.fullPatchApplies).toBe(1);
    frame = await currentEditorFrame(page);
    await expect(frame.locator('[data-native-case="pipeline-first"]')).toHaveCount(2);
  });
});
