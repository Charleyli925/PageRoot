// Opt-in local acceptance. User HTML and artifacts never belong in Git/CI.
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import {
  currentEditorFrame,
  documentToken,
  expect,
  expectCheckpointPersisted,
  keyShortcut,
  launchPageRoot,
  managedWorkingCopyPath,
  stopPageRoot,
  waitForProjectReady,
  waitForRuntimeHandoffSettled,
} from "./electron-native-harness.mjs";
import { readPublishedWorkingCopy } from "./helpers/working-copy-publication.mjs";
import {
  COPY_DIAGNOSTIC_CLASSIFICATIONS,
  classifyCopyDiagnostic,
} from "./helpers/copy-diagnostic-classifier.mjs";
import { buildSourceIndex } from "../../../app/lib/source-index.js";

const corpus = process.env.PAGEROOT_REAL_HTML_DIR;
if (!corpus) {
  throw new Error(
    "Set PAGEROOT_REAL_HTML_DIR to the user-designated local HTML corpus. Synthetic fallback is not acceptance.",
  );
}

const corpusFiles = readdirSync(corpus).filter((name) => /\.html?$/iu.test(name)).sort();
if (!corpusFiles.length) {
  throw new Error("The local corpus contains no HTML files. Acceptance was not run.");
}
const requestedFileIndexes = new Set(
  String(process.env.PAGEROOT_REAL_HTML_FILE_INDEXES || "")
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value >= 1),
);
const files = requestedFileIndexes.size
  ? corpusFiles.filter((_name, index) => requestedFileIndexes.has(index + 1))
  : corpusFiles;
if (!files.length) {
  throw new Error("The requested local corpus file indexes did not match any HTML files.");
}

const reportDir = mkdtempSync(path.join(tmpdir(), "stemmio-real-html-acceptance-"));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const report = {
  schemaVersion: 3,
  head: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  diffSha256: sha256(execFileSync("git", ["diff", "HEAD", "--binary"])),
  planned: files.length,
  corpusFiles: corpusFiles.length,
  selectedFileIndexes: [...requestedFileIndexes].sort((left, right) => left - right),
  minimumTextHostsPerFile: 3,
  minimumStructureCyclesPerFile: 2,
  minimumOrdinaryContinuityChecksPerFile: 3,
  inputAuthority: "Playwright mouse and keyboard events; DOM evaluation is discovery/oracle only",
  results: [],
};

console.log(`Private report: ${reportDir}`);
const saveReport = () => writeFileSync(
  path.join(reportDir, "results.json"),
  JSON.stringify(report, null, 2),
);

function editorFor(page) {
  return page.getByTestId("html-canvas-editor").filter({ visible: true }).first();
}

async function waitUntilEditable(page) {
  const editor = editorFor(page);
  await expect(editor).toHaveAttribute("aria-readonly", "false", { timeout: 60_000 });
  await expect(editor.locator('iframe[data-runtime-slot-role="active"]')).toHaveCount(1);
  await expect.poll(async () => ({
    handoff: await editor.getAttribute("data-runtime-handoff"),
    phase: await editor.getAttribute("data-edit-runtime-phase"),
    outcome: await editor.getAttribute("data-edit-runtime-outcome"),
  }), { timeout: 60_000 }).toMatchObject({ handoff: null });
  return editor;
}

async function currentRevision(page) {
  const value = await page.locator("[data-persist-state]").first()
    .getAttribute("data-persisted-revision");
  return Number(value || 0);
}

async function currentFrameIdentity(page) {
  const editor = editorFor(page);
  return {
    document: await documentToken(page),
    generation: await editor.locator('iframe[data-runtime-slot-role="active"]')
      .getAttribute("data-frame-generation"),
    pendingRefresh: {
      present: await editor.getAttribute("data-runtime-refresh-pending") !== null,
      sourceRevision: await editor.getAttribute(
        "data-runtime-refresh-pending-source-revision",
      ),
      reason: await editor.getAttribute("data-runtime-refresh-pending-reason"),
      coalescedCount: await editor.getAttribute(
        "data-runtime-refresh-coalesced-count",
      ),
    },
  };
}

async function copyCapabilitySnapshot({
  page,
  workingCopyPath,
  plan,
  originalSha256,
  relocated = null,
}) {
  const editor = editorFor(page);
  const frame = await currentEditorFrame(page);
  const workingHtml = await readPublishedWorkingCopy(workingCopyPath, "utf8");
  const workingIndex = buildSourceIndex(workingHtml, {
    caller: "local-html-corpus-copy-diagnostic",
  });
  const sourceTarget = workingIndex.byPagerootId.get(plan.id) ?? null;
  const sourceCodeUnitRange = sourceTarget?.range
    ? {
        start: sourceTarget.range.startOffset,
        end: sourceTarget.range.endOffset,
      }
    : null;
  const sourceUtf8ByteRange = sourceCodeUnitRange
    ? {
        start: Buffer.byteLength(workingHtml.slice(0, sourceCodeUnitRange.start), "utf8"),
        end: Buffer.byteLength(workingHtml.slice(0, sourceCodeUnitRange.end), "utf8"),
      }
    : null;
  const copyButton = editor.getByRole("button", { name: "复制元素", exact: true });
  const buttonCount = await copyButton.count();
  const candidateFrames = editor.locator('iframe[data-runtime-slot-role="candidate"]');
  const activeFrame = editor.locator('iframe[data-runtime-slot-role="active"]');
  const editingHosts = frame.locator("[data-html-canvas-editing]");
  const nativeEditingCount = await editingHosts.count();
  const focusInsideEditingHost = await frame.locator("body").evaluate(() => Boolean(
    document.activeElement?.closest?.("[data-html-canvas-editing]"),
  ));
  await editor.evaluate((root) => {
    root.dispatchEvent(new Event("pageroot:e2e-copy-capability-probe"));
  });
  const workingSourceSha256 = await editor.getAttribute("data-working-source-sha256");
  const renderedProjectionSha256 = await editor.getAttribute(
    "data-rendered-projection-sha256",
  );
  const renderedProjectionStale = await editor.getAttribute(
    "data-rendered-projection-stale",
  );
  const diskWorkingSha256 = sha256(Buffer.from(workingHtml));
  const workingEqualsDisplayed = Boolean(
    workingSourceSha256
    && workingSourceSha256 === workingIndex.sourceSha256
    && workingSourceSha256 === renderedProjectionSha256
    && workingSourceSha256 === `sha256:${diskWorkingSha256}`
    && renderedProjectionStale === "false"
  );
  return {
    phase: "before-copy",
    planned: {
      stableId: plan.id,
      tag: plan.tag,
      tabId: plan.tabId,
      sourceTarget: {
        stableId: sourceTarget?.pagerootId ?? null,
        tag: sourceTarget?.tagName ?? null,
        unique: Boolean(sourceTarget),
        codeUnitRange: sourceCodeUnitRange,
        utf8ByteRange: sourceUtf8ByteRange,
        workingSha256: workingIndex.sourceSha256,
      },
    },
    relocated,
    uiProjection: {
      availability: await editor.getAttribute("data-element-copy-availability"),
      reason: await editor.getAttribute("data-element-copy-reason"),
      diagnostic: await editor.getAttribute("data-element-copy-diagnostic"),
      buttonCount,
      disabled: buttonCount === 1 ? await copyButton.isDisabled() : null,
    },
    commandBoundary: {
      availability: await editor.getAttribute("data-e2e-copy-live-availability"),
      reason: await editor.getAttribute("data-e2e-copy-live-reason"),
      diagnostic: await editor.getAttribute("data-e2e-copy-live-diagnostic"),
      targetStableId: await editor.getAttribute("data-e2e-copy-live-target-id"),
      probeSequence: await editor.getAttribute("data-e2e-copy-probe-sequence"),
    },
    nativeTextSession: {
      activeEditingCount: nativeEditingCount,
      focusInsideEditingHost,
      ended: nativeEditingCount === 0 && !focusInsideEditingHost,
      probeEnded: await editor.getAttribute("data-e2e-copy-native-edit-ended") === "true",
    },
    runtime: {
      documentToken: await documentToken(page),
      activeGeneration: await activeFrame.getAttribute("data-frame-generation"),
      candidateCount: await candidateFrames.count(),
      candidateGenerations: await candidateFrames.evaluateAll((frames) => (
        frames.map((candidate) => candidate.getAttribute("data-frame-generation"))
      )),
      candidateId: await editor.getAttribute("data-runtime-candidate-id"),
      candidatePhase: await editor.getAttribute("data-runtime-candidate-phase"),
      handoff: await editor.getAttribute("data-runtime-handoff"),
      renderVerified: await editor.getAttribute("data-render-verified"),
    },
    source: {
      originalSha256,
      diskWorkingSha256,
      workingSourceSha256,
      renderedProjectionSha256,
      renderedProjectionStale,
      workingEqualsDisplayed,
    },
    attribution: null,
  };
}

function failWithCopyDiagnostic(message, snapshot) {
  const code = classifyCopyDiagnostic(snapshot);
  snapshot.attribution = {
    code,
    label: COPY_DIAGNOSTIC_CLASSIFICATIONS[code],
  };
  const error = new Error(`${message} [${snapshot.attribution.label}; ${code}]`);
  error.copyDiagnostic = snapshot;
  throw error;
}

async function clickAuthoredTab(page, tabId) {
  if (!tabId) return;
  const frame = await currentEditorFrame(page);
  const tab = frame.locator(`[data-pageroot-id="${tabId}"]`);
  await tab.scrollIntoViewIfNeeded();
  await tab.click();
  const activate = editorFor(page).getByRole("button", {
    name: "切换到此页签",
    exact: true,
  });
  if (await activate.count()) await activate.click();
  await page.waitForTimeout(200);
}

async function visibleTextCandidates(page) {
  const frame = await currentEditorFrame(page);
  return frame.locator("[data-pageroot-id]").evaluateAll((elements) => elements
    .map((element) => {
      const rect = element.getBoundingClientRect();
      const style = element.ownerDocument.defaultView.getComputedStyle(element);
      const text = element.textContent?.replace(/\s+/gu, " ").trim() || "";
      const tag = element.tagName.toLowerCase();
      const excluded = Boolean(element.closest(
        "button,a,input,textarea,select,option,nav,[role=tab],[role=tablist],.tab[data-p],[contenteditable=true]",
      ));
      const preferred = [
        "p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "td", "th",
        "blockquote", "figcaption", "label", "span", "div",
      ].indexOf(tag);
      return {
        id: element.getAttribute("data-pageroot-id"),
        tag,
        textLength: text.length,
        childCount: element.childElementCount,
        top: rect.top,
        height: rect.height,
        width: rect.width,
        preferred: preferred < 0 ? 99 : preferred,
        visible:
          !excluded
          && preferred >= 0
          && text.length >= 8
          && text.length <= 800
          && rect.width >= 36
          && rect.height >= 12
          && style.display !== "none"
          && style.visibility !== "hidden"
          && Number(style.opacity || 1) > 0,
      };
    })
    .filter((candidate) => candidate.visible));
}

function distributedCandidates(candidates, limit) {
  const preferred = candidates
    .filter((candidate) => candidate.preferred <= 12)
    .sort((left, right) => left.top - right.top || left.preferred - right.preferred);
  const pool = preferred.length >= limit ? preferred : candidates;
  if (pool.length <= limit) return pool;
  const picks = [];
  for (const ratio of [0, 0.5, 1]) {
    const candidate = pool[Math.round((pool.length - 1) * ratio)];
    if (candidate && !picks.some((pick) => pick.id === candidate.id)) picks.push(candidate);
  }
  for (const candidate of pool) {
    if (picks.length >= limit) break;
    if (!picks.some((pick) => pick.id === candidate.id)) picks.push(candidate);
  }
  return picks.slice(0, limit);
}

async function planTextTargets(page) {
  const planned = [];
  const seen = new Set();
  const usedTags = new Set();
  const extras = [];
  let frame = await currentEditorFrame(page);
  const tabs = await frame.locator(
    '[role="tab"][aria-controls][data-pageroot-id]',
  ).evaluateAll((elements) => (
    elements.filter((element) => {
      const rect = element.getBoundingClientRect();
      const style = element.ownerDocument.defaultView.getComputedStyle(element);
      return rect.width > 10 && rect.height > 10
        && style.display !== "none" && style.visibility !== "hidden";
    }).slice(0, 4).map((element) => element.getAttribute("data-pageroot-id"))
  ));

  const states = tabs.length ? tabs : [null];
  for (const [stateIndex, tabId] of states.entries()) {
    await clickAuthoredTab(page, tabId);
    const candidates = distributedCandidates(await visibleTextCandidates(page), 10);
    const preferred = candidates.find((candidate) => (
      !seen.has(candidate.id) && !usedTags.has(candidate.tag)
    )) || candidates.find((candidate) => !seen.has(candidate.id));
    if (preferred) {
      planned.push({ ...preferred, tabId });
      seen.add(preferred.id);
      usedTags.add(preferred.tag);
    }
    for (const candidate of candidates) {
      if (candidate.id !== preferred?.id) extras.push({ ...candidate, tabId, stateIndex });
    }
  }

  for (const candidate of extras) {
    if (planned.length >= 12) break;
    if (seen.has(candidate.id)) continue;
    planned.push(candidate);
    seen.add(candidate.id);
  }

  if (planned.length < 3) {
    frame = await currentEditorFrame(page);
    const fallback = distributedCandidates(await visibleTextCandidates(page), 8);
    for (const candidate of fallback) {
      if (!seen.has(candidate.id)) planned.push({ ...candidate, tabId: null });
      seen.add(candidate.id);
    }
  }
  return planned;
}

async function renderedTextPosition(target) {
  return target.evaluate((element) => {
    const walker = element.ownerDocument.createTreeWalker(
      element,
      element.ownerDocument.defaultView.NodeFilter.SHOW_TEXT,
    );
    const elementRect = element.getBoundingClientRect();
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent?.trim()) continue;
      const range = element.ownerDocument.createRange();
      range.setStart(node, 0);
      range.setEnd(node, Math.min(1, node.textContent.length));
      const rect = range.getBoundingClientRect();
      if (!rect.width && !rect.height) continue;
      return {
        x: Math.max(1, rect.left - elementRect.left + Math.min(rect.width / 2, 3)),
        y: Math.max(1, rect.top - elementRect.top + Math.max(rect.height / 2, 1)),
      };
    }
    return { x: Math.min(12, elementRect.width / 2), y: Math.min(10, elementRect.height / 2) };
  });
}

async function enterNativeEdit(page, plan) {
  await clickAuthoredTab(page, plan.tabId);
  const frame = await currentEditorFrame(page);
  const target = frame.locator(`[data-pageroot-id="${plan.id}"]`);
  await target.scrollIntoViewIfNeeded();
  await target.dblclick({ position: await renderedTextPosition(target) });
  await expect(target).toHaveAttribute("contenteditable", /^(?:plaintext-only|true)$/u);
  await expect.poll(() => target.evaluate((element) => (
    element.ownerDocument.activeElement === element && element.isContentEditable
  ))).toBe(true);
  return target;
}

async function selectTrailingText(target, page, length) {
  await target.press(keyShortcut("ArrowDown"));
  await page.keyboard.down("Shift");
  for (let index = 0; index < length; index += 1) {
    await page.keyboard.press("ArrowLeft");
  }
  await page.keyboard.up("Shift");
}

async function markerComputedStyle(target, marker) {
  return target.evaluate((element, expectedMarker) => {
    const walker = element.ownerDocument.createTreeWalker(
      element,
      element.ownerDocument.defaultView.NodeFilter.SHOW_TEXT,
    );
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent?.includes(expectedMarker)) continue;
      const style = element.ownerDocument.defaultView.getComputedStyle(node.parentElement);
      return {
        bold: style.fontWeight === "bold" || Number(style.fontWeight) >= 600,
        italic: style.fontStyle === "italic",
        underline: style.textDecorationLine.includes("underline"),
      };
    }
    return { bold: false, italic: false, underline: false };
  }, marker);
}

function expectFormattedMarker(savedHtml, marker) {
  const markerIndex = savedHtml.indexOf(marker);
  expect(markerIndex).toBeGreaterThanOrEqual(0);
  const vicinity = savedHtml.slice(
    Math.max(0, markerIndex - 500),
    Math.min(savedHtml.length, markerIndex + marker.length + 500),
  );
  expect(vicinity).toMatch(/font-weight\s*:\s*(?:700|bold)/iu);
  expect(vicinity).toMatch(/font-style\s*:\s*italic/iu);
  expect(vicinity).toMatch(/text-decoration(?:-line)?\s*:[^;"']*underline/iu);
}

async function exerciseTextTarget({
  page,
  workingCopyPath,
  plan,
  fileIndex,
  markerIndex,
  round,
}) {
  const startMarker = `PRQA_${fileIndex}_${markerIndex}_START`;
  const endMarker = `PRQA_${fileIndex}_${markerIndex}_END`;
  const historyMarker = `PRQA_${fileIndex}_${markerIndex}_UNDO`;
  const lineMarker = `PRQA_${fileIndex}_${markerIndex}_LINE`;
  let beforeRevision = await currentRevision(page);
  let target = await enterNativeEdit(page, plan);
  const ordinaryBoundaryBefore = await currentFrameIdentity(page);

  await target.press(keyShortcut("ArrowUp"));
  await page.keyboard.insertText(`${startMarker} `);
  await target.press(keyShortcut("ArrowDown"));
  await page.keyboard.insertText(`        ${endMarker}`);
  await expect(target).toContainText(endMarker);

  const editor = editorFor(page);
  for (const name of ["加粗", "斜体", "下划线"]) {
    const button = editor.getByRole("button", { name, exact: true });
    for (let repeat = 0; repeat < 2; repeat += 1) {
      await selectTrailingText(target, page, endMarker.length);
      await expect(button).toBeEnabled();
      await button.click();
      await expect(target).toHaveAttribute("contenteditable", /^(?:plaintext-only|true)$/u);
    }
  }
  for (const [property, button] of [
    ["bold", "加粗"],
    ["italic", "斜体"],
    ["underline", "下划线"],
  ]) {
    const formatButton = editor.getByRole("button", { name: button, exact: true });
    await selectTrailingText(target, page, endMarker.length);
    await expect(formatButton).toBeEnabled();
    if (await formatButton.getAttribute("aria-pressed") !== "true") {
      await formatButton.click();
    }
    await expect(formatButton).toHaveAttribute("aria-pressed", "true");
    await expect.poll(
      async () => (await markerComputedStyle(target, endMarker))[property],
      { message: `${button} must apply to the keyboard-selected marker` },
    )
      .toBe(true);
  }
  await expect.poll(() => markerComputedStyle(target, endMarker))
    .toEqual({ bold: true, italic: true, underline: true });
  await page.keyboard.press(keyShortcut("s"));
  await expectCheckpointPersisted(page, beforeRevision);
  await page.keyboard.press("Escape");
  await waitForRuntimeHandoffSettled(page);
  await waitUntilEditable(page);
  await page.locator(".comments-panel.comment-rail").click({
    position: { x: 12, y: 96 },
  });
  await page.waitForTimeout(750);
  const ordinaryBoundaryAfter = await currentFrameIdentity(page);
  expect(ordinaryBoundaryAfter).toEqual(ordinaryBoundaryBefore);
  await expect(editor.locator('iframe[data-runtime-slot-role="candidate"]')).toHaveCount(0);

  let savedHtml = await readPublishedWorkingCopy(workingCopyPath, "utf8");
  expect(savedHtml).toContain(startMarker);
  expect(savedHtml).toContain(endMarker);
  expectFormattedMarker(savedHtml, endMarker);

  beforeRevision = await currentRevision(page);
  target = await enterNativeEdit(page, plan);
  await target.press(keyShortcut("ArrowDown"));
  await page.keyboard.insertText(` ${historyMarker}`);
  await page.keyboard.press(keyShortcut("s"));
  await expect.poll(() => readPublishedWorkingCopy(workingCopyPath, "utf8"))
    .toContain(historyMarker);
  await page.keyboard.press(keyShortcut("z"));
  await expect.poll(() => readPublishedWorkingCopy(workingCopyPath, "utf8"))
    .not.toContain(historyMarker);
  await page.keyboard.press(keyShortcut("Shift+z"));
  await expect.poll(() => readPublishedWorkingCopy(workingCopyPath, "utf8"))
    .toContain(historyMarker);
  await expectCheckpointPersisted(page, beforeRevision);
  await page.keyboard.press("Escape");
  await waitForRuntimeHandoffSettled(page);
  await waitUntilEditable(page);

  beforeRevision = await currentRevision(page);
  target = await enterNativeEdit(page, plan);
  if (round === 1) {
    await target.press(keyShortcut("ArrowDown"));
    await page.keyboard.press("Enter");
    await page.keyboard.insertText(lineMarker);
    await expect(target).toContainText(lineMarker);
  } else {
    await selectTrailingText(target, page, historyMarker.length);
    await page.keyboard.press("Backspace");
    await page.keyboard.press(keyShortcut("s"));
    await expect.poll(() => readPublishedWorkingCopy(workingCopyPath, "utf8"))
      .not.toContain(historyMarker);
    await page.keyboard.press(keyShortcut("z"));
    await expect.poll(() => readPublishedWorkingCopy(workingCopyPath, "utf8"))
      .toContain(historyMarker);
    await page.keyboard.press(keyShortcut("Shift+z"));
    await expect.poll(() => readPublishedWorkingCopy(workingCopyPath, "utf8"))
      .not.toContain(historyMarker);
    await page.keyboard.press(keyShortcut("z"));
    await expect.poll(() => readPublishedWorkingCopy(workingCopyPath, "utf8"))
      .toContain(historyMarker);
  }

  await page.keyboard.press(keyShortcut("s"));
  await expectCheckpointPersisted(page, beforeRevision);
  await page.keyboard.press("Escape");
  await waitForRuntimeHandoffSettled(page);
  await waitUntilEditable(page);

  savedHtml = await readPublishedWorkingCopy(workingCopyPath, "utf8");
  expect(savedHtml).toContain(startMarker);
  expect(savedHtml).toContain(endMarker);
  expect(savedHtml).toContain(historyMarker);
  expectFormattedMarker(savedHtml, endMarker);
  target = (await currentEditorFrame(page)).locator(`[data-pageroot-id="${plan.id}"]`);
  await expect(target).toContainText(startMarker);
  await expect(target).toContainText(endMarker);
  return {
    startMarker,
    endMarker,
    historyMarker,
    lineMarker: round === 1 ? lineMarker : null,
    ordinaryBoundary: {
      sameDocument: ordinaryBoundaryAfter.document === ordinaryBoundaryBefore.document,
      sameGeneration: ordinaryBoundaryAfter.generation === ordinaryBoundaryBefore.generation,
      ordinaryEditCreatedPendingRefresh: (
        !ordinaryBoundaryBefore.pendingRefresh.present
        && ordinaryBoundaryAfter.pendingRefresh.present
      ),
      pendingRefreshUnchanged: (
        JSON.stringify(ordinaryBoundaryAfter.pendingRefresh)
        === JSON.stringify(ordinaryBoundaryBefore.pendingRefresh)
      ),
      noDeferredCandidate: true,
      boundaries: ["edit-end", "selection-clear", "wait", "ordinary-save"],
    },
  };
}

async function exerciseDuplicateDelete({
  page,
  workingCopyPath,
  originalSha256,
  plan,
  marker,
}) {
  await clickAuthoredTab(page, plan.tabId);
  let frame = await currentEditorFrame(page);
  let original = frame.locator(`[data-pageroot-id="${plan.id}"]`);
  const relocatedCount = await original.count();
  let relocated = {
    count: relocatedCount,
    stableId: null,
    tag: null,
    connected: false,
    selectedMarker: false,
    sameAsPlanned: false,
    liveStyleAttribute: null,
  };
  if (relocatedCount === 1) {
    relocated = await original.evaluate((element, expected) => ({
      count: 1,
      stableId: element.getAttribute("data-pageroot-id"),
      tag: element.tagName.toLowerCase(),
      connected: element.isConnected,
      selectedMarker: element.hasAttribute("data-html-canvas-selected"),
      liveStyleAttribute: element.getAttribute("style"),
      sameAsPlanned: (
        element.getAttribute("data-pageroot-id") === expected.stableId
        && element.tagName.toLowerCase() === expected.tag
      ),
    }), { stableId: plan.id, tag: plan.tag });
  }
  if (relocatedCount !== 1 || !relocated.sameAsPlanned || !relocated.connected) {
    const diagnostic = await copyCapabilitySnapshot({
      page,
      workingCopyPath,
      plan,
      originalSha256,
      relocated,
    });
    failWithCopyDiagnostic("Planned copy target could not be uniquely re-located", diagnostic);
  }
  await original.scrollIntoViewIfNeeded();
  await original.click({ timeout: 5_000 });
  await page.waitForTimeout(0);
  relocated.selectedMarker = await original.getAttribute("data-html-canvas-selected") !== null;
  const diagnostic = await copyCapabilitySnapshot({
    page,
    workingCopyPath,
    plan,
    originalSha256,
    relocated,
  });
  if (!relocated.selectedMarker) {
    failWithCopyDiagnostic("Re-located copy target was not the selected operation target", diagnostic);
  }
  if (
    diagnostic.uiProjection.buttonCount !== 1
    || diagnostic.uiProjection.disabled
    || diagnostic.uiProjection.availability !== "available"
  ) {
    failWithCopyDiagnostic("Copy action was unavailable immediately after exact selection", diagnostic);
  }
  const beforeDuplicate = await currentRevision(page);
  await editorFor(page).getByRole("button", { name: "复制元素", exact: true })
    .click({ timeout: 5_000 });
  diagnostic.commandBoundary.executedAvailability = await editorFor(page).getAttribute(
    "data-element-copy-command-availability",
  );
  diagnostic.commandBoundary.executedReason = await editorFor(page).getAttribute(
    "data-element-copy-command-reason",
  );
  if (
    diagnostic.commandBoundary.executedAvailability !== "available"
    || diagnostic.commandBoundary.executedReason !== "available"
  ) {
    failWithCopyDiagnostic("Copy command was refused at the live command boundary", diagnostic);
  }
  await waitForRuntimeHandoffSettled(page);
  await waitUntilEditable(page);
  await expectCheckpointPersisted(page, beforeDuplicate);

  frame = await currentEditorFrame(page);
  const matchingIds = await frame.locator(`${plan.tag}[data-pageroot-id]`).evaluateAll(
    (elements, expectedMarker) => elements
      .filter((element) => element.textContent?.includes(expectedMarker))
      .map((element) => element.getAttribute("data-pageroot-id")),
    marker,
  );
  const duplicateId = matchingIds.find((id) => id && id !== plan.id);
  expect(duplicateId, "Duplicated authored element must receive a distinct stable id").toBeTruthy();
  const duplicate = frame.locator(`[data-pageroot-id="${duplicateId}"]`);
  await duplicate.scrollIntoViewIfNeeded();
  await duplicate.click();
  const beforeDelete = await currentRevision(page);
  page.once("dialog", (dialog) => dialog.accept());
  await editorFor(page).getByRole("button", { name: "删除元素", exact: true }).click();
  await waitForRuntimeHandoffSettled(page);
  await waitUntilEditable(page);
  await expectCheckpointPersisted(page, beforeDelete);

  frame = await currentEditorFrame(page);
  await expect(frame.locator(`[data-pageroot-id="${duplicateId}"]`)).toHaveCount(0);
  original = frame.locator(`[data-pageroot-id="${plan.id}"]`);
  await expect(original).toHaveCount(1);
  await expect(original).toContainText(marker);
  return { duplicateId, diagnostic };
}

async function verifyViewport(page) {
  return page.evaluate(() => ({
    viewport: { width: innerWidth, height: innerHeight },
    bodyWidth: document.body.scrollWidth,
    documentWidth: document.documentElement.scrollWidth,
    horizontalOverflow:
      Math.max(document.body.scrollWidth, document.documentElement.scrollWidth) > innerWidth + 2,
  }));
}

for (const filename of files) {
  const fileIndex = corpusFiles.indexOf(filename);
  const originalPath = path.join(corpus, filename);
  const original = readFileSync(originalPath);
  const copyDir = path.join(reportDir, String(fileIndex));
  mkdirSync(copyDir, { recursive: true });
  const copyPath = path.join(copyDir, filename);
  writeFileSync(copyPath, original);
  const row = {
    filename,
    originalSha256: sha256(original),
    status: "failed",
    plannedTargets: [],
    completedTargets: [],
    structureCycles: [],
    lifecycle: [],
  };
  let session;
  try {
    session = await launchPageRoot({ activeSourcePath: copyPath });
    const { page } = session;
    await waitForProjectReady(page);
    await waitUntilEditable(page);
    const workingCopyPath = await managedWorkingCopyPath(page, copyPath);
    const plans = await planTextTargets(page);
    row.plannedTargets = plans.map(({ id, tag, tabId, top }) => ({ id, tag, tabId, top }));

    const successful = [];
    for (const [markerIndex, plan] of plans.entries()) {
      if (successful.length >= 3) break;
      try {
        const markers = await exerciseTextTarget({
          page,
          workingCopyPath,
          plan,
          fileIndex,
          markerIndex,
          round: successful.length,
        });
        successful.push({ plan, markers });
        row.completedTargets.push({
          id: plan.id,
          tag: plan.tag,
          tabId: plan.tabId,
          operations: [
            "start/end insertion",
            "eight consecutive spaces",
            "undo/redo",
            "repeated bold/italic/underline",
            successful.length === 2 ? "line split and undo/redo" : "selection delete and undo/redo",
            "save and re-enter",
          ],
          ordinaryBoundary: markers.ordinaryBoundary,
        });
      } catch (cause) {
        row.completedTargets.push({
          id: plan.id,
          tag: plan.tag,
          tabId: plan.tabId,
          rejected: String(cause?.stack || cause),
        });
        await page.keyboard.press("Escape").catch(() => {});
        await waitUntilEditable(page).catch(() => {});
      }
    }
    expect(successful.length, "Each real HTML file must exercise at least three text hosts").toBeGreaterThanOrEqual(3);

    await page.screenshot({ path: path.join(copyDir, "after-complex-text-edits.png"), fullPage: true });
    for (let cycle = 0; cycle < 2; cycle += 1) {
      const sample = successful.find(({ plan }) => !["td", "th"].includes(plan.tag))
        ?? successful[0];
      try {
        const { duplicateId, diagnostic } = await exerciseDuplicateDelete({
          page,
          workingCopyPath,
          originalSha256: row.originalSha256,
          plan: sample.plan,
          marker: sample.markers.startMarker,
        });
        row.structureCycles.push({
          cycle,
          originalId: sample.plan.id,
          duplicateId,
          result: "passed",
          diagnostic,
        });
      } catch (cause) {
        row.structureCycles.push({
          cycle,
          originalId: sample.plan.id,
          duplicateId: null,
          result: "failed",
          diagnostic: cause?.copyDiagnostic ?? null,
          error: String(cause?.stack || cause),
        });
        throw cause;
      }
    }

    await page.getByRole("button", { name: "预览", exact: true }).click();
    await expect(editorFor(page).getByRole("toolbar")).toHaveCount(0);
    await page.getByRole("button", { name: "编辑", exact: true }).click();
    await waitUntilEditable(page);
    let target = await enterNativeEdit(page, successful[0].plan);
    await expect(target).toHaveAttribute("contenteditable", /^(?:plaintext-only|true)$/u);
    await page.keyboard.press("Escape");
    row.lifecycle.push("preview-edit-reenter");

    await page.getByRole("button", { name: "更多", exact: true }).click();
    await page.getByRole("menuitem", { name: "从磁盘重新载入 HTML", exact: true }).click();
    await expect(page.locator(".workbench-chrome-status"))
      .toHaveText("页面已重新加载，可以继续编辑", { timeout: 60_000 });
    await waitUntilEditable(page);
    target = await enterNativeEdit(page, successful[1].plan);
    await expect(target).toContainText(successful[1].markers.startMarker);
    await page.keyboard.press("Escape");
    row.lifecycle.push("source-reload-reenter");

    row.viewport = await verifyViewport(page);
    expect(row.viewport.horizontalOverflow, "Workbench chrome must fit the acceptance viewport")
      .toBe(false);
    await page.screenshot({ path: path.join(copyDir, "after-source-reload.png"), fullPage: true });

    const isolatedUserData = session.isolatedUserData;
    await stopPageRoot(session.electronApp, isolatedUserData, { cleanup: false });
    session = undefined;
    session = await launchPageRoot({ isolatedUserData });
    await waitForProjectReady(session.page);
    await waitUntilEditable(session.page);
    for (const sample of successful) {
      await clickAuthoredTab(session.page, sample.plan.tabId);
      const reopenedTarget = (await currentEditorFrame(session.page))
        .locator(`[data-pageroot-id="${sample.plan.id}"]`);
      await expect(reopenedTarget).toContainText(sample.markers.startMarker);
    }
    await clickAuthoredTab(session.page, successful[0].plan.tabId);
    const reopenedTarget = (await currentEditorFrame(session.page)).locator(
      `[data-pageroot-id="${successful[0].plan.id}"]`,
    );
    await reopenedTarget.scrollIntoViewIfNeeded();
    await reopenedTarget.dblclick({ position: await renderedTextPosition(reopenedTarget) });
    await expect(reopenedTarget).toHaveAttribute("contenteditable", /^(?:plaintext-only|true)$/u);
    await session.page.keyboard.press("Escape");
    row.lifecycle.push("reopen-managed-project-reenter");
    await session.page.screenshot({ path: path.join(copyDir, "reopened.png"), fullPage: true });

    const finalWorkingCopy = await managedWorkingCopyPath(session.page, copyPath);
    row.finalWorkingSha256 = sha256(readFileSync(finalWorkingCopy));
    row.status = "passed";
  } catch (cause) {
    row.error = String(cause?.stack || cause);
    if (session) {
      await session.page.screenshot({ path: path.join(copyDir, "failure.png"), fullPage: true })
        .catch(() => {});
    }
  } finally {
    if (session) await stopPageRoot(session.electronApp, session.isolatedUserData);
    row.originalUnchanged = sha256(readFileSync(originalPath)) === row.originalSha256;
    if (!row.originalUnchanged) row.status = "failed";
    report.results.push(row);
    saveReport();
    console.log(
      `${report.results.length}/${files.length}: ${row.status} ${filename} `
      + `(${row.completedTargets.filter((target) => !target.rejected).length} text hosts, `
      + `${row.structureCycles.length} structure cycles)`,
    );
  }
}

report.passed = report.results.filter((row) => row.status === "passed").length;
report.failed = report.results.length - report.passed;
report.skipped = 0;
saveReport();
process.exitCode = report.failed ? 1 : 0;
