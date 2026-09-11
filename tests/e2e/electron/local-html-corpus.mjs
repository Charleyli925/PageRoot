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
import { withRestoredElectronClipboard } from "./helpers/clipboard-snapshot.mjs";
import {
  RealHtmlResultReport,
} from "./real-html/result-report.mjs";
import {
  REAL_HTML_OPERATION_IDS,
  REAL_HTML_STAGE_IDS,
  FIXED_STRUCTURE_SAMPLES,
} from "./real-html/plan.mjs";
import {
  FIXED_STRUCTURE_REASON_CODES,
  inspectFixedStructureSamples,
} from "./real-html/structure-editing.mjs";
import {
  runtimeOperationOutcomes,
} from "./real-html/runtime-lifecycle.mjs";
import {
  compareElementScopedMutation,
  compareElementSourceDelta,
  formattedMarkerAppendedPattern,
  SOURCE_SCOPE_POLICIES,
} from "./real-html/source-scope.mjs";
import { workspaceSourceFingerprint } from "./real-html/workspace-provenance.mjs";

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
const resultReport = new RealHtmlResultReport(files, {
  reportKind: "private-real-html-electron",
});
const sourceProvenance = workspaceSourceFingerprint();
const report = {
  schemaVersion: 4,
  head: sourceProvenance.head,
  workspaceSourceSha256: sourceProvenance.workspaceSourceSha256,
  untrackedSourceFileCount: sourceProvenance.untrackedFileCount,
  planned: files.length,
  corpusFiles: corpusFiles.length,
  selectedFileIndexes: [...requestedFileIndexes].sort((left, right) => left - right),
  minimumTextHostsPerFile: 3,
  structureCyclesWhenExpectedCopyableApplies: 2,
  minimumOrdinaryContinuityChecksPerFile: 3,
  inputAuthority: "Playwright mouse and keyboard events; DOM evaluation is discovery/oracle only",
  categories: {
    A: "文字编辑",
    B: "元素结构（固定 expected-copyable / expected-non-copyable）",
    C: "Runtime/iframe（独立生命周期事实）",
  },
  resultPlan: resultReport.plan,
  results: [],
};

console.log(`Private report: ${reportDir}`);
const saveReport = () => writeFileSync(
  path.join(reportDir, "results.json"),
  JSON.stringify({ ...report, resultModel: resultReport.model }, null, 2),
);

function errorDetails(error) {
  return {
    error: String(error?.stack || error),
    code: error?.code || null,
  };
}

function recordOperationFailure(fileId, stageId, operationId, error) {
  resultReport.failOperation(fileId, stageId, operationId, errorDetails(error));
}

async function runtimeContractSnapshot(page) {
  const editor = editorFor(page);
  const active = editor.locator('iframe[data-runtime-slot-role="active"]');
  const candidate = editor.locator('iframe[data-frame-role="runtime-candidate"]');
  const identity = await currentFrameIdentity(page);
  return {
    ...identity,
    candidateId: await editor.getAttribute("data-runtime-candidate-id"),
    candidatePhase: await editor.getAttribute("data-runtime-candidate-phase"),
    candidateCount: await candidate.count(),
    renderVerified: await editor.getAttribute("data-render-verified"),
    runtimePhase: await editor.getAttribute("data-edit-runtime-phase"),
    runtimeOutcome: await editor.getAttribute("data-edit-runtime-outcome"),
    degradation: await editor.getAttribute("data-runtime-degradation"),
    staticFallbackVisible: await editor.getByTestId("edit-runtime-static-fallback")
      .count()
      .catch(() => 0),
    activeSandbox: await active.getAttribute("sandbox"),
  };
}

async function startRuntimeLifecycleObservation(page) {
  await editorFor(page).evaluate((element) => {
    const key = "__PAGEROOT_REAL_HTML_RUNTIME_OBSERVER__";
    globalThis[key]?.observer?.disconnect();
    const candidate = element.querySelector('iframe[data-frame-role="runtime-candidate"]');
    const candidateId = element.getAttribute("data-runtime-candidate-id");
    if (candidate || candidateId) {
      throw new Error("Runtime Candidate observation requires a clean absent precondition.");
    }
    const records = [];
    const observer = new MutationObserver((mutations) => {
      const recorded = new Set();
      const recordCandidate = (evidence, candidateValue, generation = null) => {
        if (typeof candidateValue !== "string" || candidateValue.trim() === "") return;
        const key = `${evidence}:${candidateValue || "unknown"}:${generation || "unknown"}`;
        if (recorded.has(key)) return;
        recorded.add(key);
        records.push({
          kind: "candidate-created",
          evidence,
          candidateId: candidateValue || null,
          generation,
        });
      };
      for (const [index, mutation] of mutations.entries()) {
        if (
          mutation.type === "attributes"
          && mutation.target === element
          && mutation.attributeName === "data-runtime-candidate-id"
          && mutation.oldValue === null
        ) {
          const current = element.getAttribute("data-runtime-candidate-id");
          const removedLater = mutations.slice(index + 1).find((later) => (
            later.type === "attributes"
            && later.target === element
            && later.attributeName === "data-runtime-candidate-id"
            && later.oldValue
          ));
          recordCandidate("candidate-id-absent-to-present", current || removedLater?.oldValue);
        }
        if (
          mutation.type === "attributes"
          && mutation.attributeName === "data-frame-role"
          && mutation.oldValue !== "runtime-candidate"
        ) {
          const frame = mutation.target;
          if (!(frame instanceof element.ownerDocument.defaultView.HTMLIFrameElement)) continue;
          const currentRole = frame.getAttribute("data-frame-role");
          const retiredLater = mutations.slice(index + 1).some((later) => (
            later.type === "attributes"
            && later.target === frame
            && later.attributeName === "data-frame-role"
            && later.oldValue === "runtime-candidate"
          ));
          if (currentRole === "runtime-candidate" || retiredLater) {
            recordCandidate(
              "candidate-frame-role-transition",
              element.getAttribute("data-runtime-candidate-id"),
              frame.getAttribute("data-frame-generation"),
            );
          }
        }
        if (mutation.type !== "childList") continue;
        for (const node of mutation.addedNodes) {
          if (!(node instanceof element.ownerDocument.defaultView.Element)) continue;
          const frames = node.matches("iframe") ? [node] : [...node.querySelectorAll("iframe")];
          for (const frame of frames) {
            if (frame.getAttribute("data-frame-role") === "runtime-candidate") {
              recordCandidate(
                "candidate-frame-added",
                element.getAttribute("data-runtime-candidate-id"),
                frame.getAttribute("data-frame-generation"),
              );
            }
          }
        }
      }
    });
    observer.observe(element, {
      attributes: true,
      attributeOldValue: true,
      childList: true,
      subtree: true,
      attributeFilter: [
        "data-runtime-candidate-id",
        "data-runtime-candidate-phase",
        "data-runtime-slot-role",
        "data-frame-role",
        "data-frame-generation",
      ],
    });
    globalThis[key] = { observer, records };
  });
}

async function stopRuntimeLifecycleObservation(page) {
  return editorFor(page).evaluate(() => {
    const key = "__PAGEROOT_REAL_HTML_RUNTIME_OBSERVER__";
    const state = globalThis[key];
    state?.observer?.disconnect();
    delete globalThis[key];
    return state?.records || [];
  });
}

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

async function saveAndExitTextOperation(page, beforeRevision) {
  await page.keyboard.press(keyShortcut("s"));
  await expectCheckpointPersisted(page, beforeRevision);
  await page.keyboard.press("Escape");
  await waitForRuntimeHandoffSettled(page);
  await waitUntilEditable(page);
}

function assertScopedMutation({
  before,
  workingCopyPath,
  plan,
  normalizationPolicy,
  expectedAfterContains,
  expectedAfterExcludes = [],
  expectedAppendedPattern,
}) {
  const oracle = compareElementScopedMutation({
    before,
    after: readFileSync(workingCopyPath),
    sourceId: plan.id,
    normalizationPolicy,
    expectedAfterContains,
    expectedAfterExcludes,
    expectedAppendedPattern,
  });
  if (!oracle.ok) {
    const error = new Error(`Source scope rejected ${normalizationPolicy} for ${plan.id}.`);
    error.code = "SOURCE_SCOPE_ORACLE_FAILED";
    error.oracle = oracle;
    throw error;
  }
  return oracle;
}

async function runActivationOperation(page, plans) {
  const activated = [];
  for (const plan of plans) {
    await enterNativeEdit(page, plan);
    activated.push({ id: plan.id, tag: plan.tag, tabId: plan.tabId });
    await page.keyboard.press("Escape");
    await waitUntilEditable(page);
  }
  return { targets: activated };
}

async function runInputDeleteOperation({ page, workingCopyPath, plans, fileIndex }) {
  const samples = [];
  for (const [targetIndex, plan] of plans.entries()) {
    const marker = `PRQA_${fileIndex}_${targetIndex}_TEXT`;
    const backspaceMarker = `PRQA_${fileIndex}_${targetIndex}_BACKSPACE`;
    const deleteMarker = `PRQA_${fileIndex}_${targetIndex}_DELETE`;
    const before = readFileSync(workingCopyPath);
    const beforeRevision = await currentRevision(page);
    const target = await enterNativeEdit(page, plan);
    await target.press(keyShortcut("ArrowDown"));
    await page.keyboard.insertText(` ${marker} ${backspaceMarker}X`);
    await page.keyboard.press("Backspace");
    await page.keyboard.insertText(` ${deleteMarker}X`);
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("Delete");
    await expect(target).toContainText(marker);
    await expect(target).not.toContainText(`${backspaceMarker}X`);
    await expect(target).not.toContainText(`${deleteMarker}X`);
    await saveAndExitTextOperation(page, beforeRevision);
    const sourceScope = assertScopedMutation({
      before,
      workingCopyPath,
      plan,
      normalizationPolicy: SOURCE_SCOPE_POLICIES.TEXT_INPUT_DELETE,
      expectedAfterContains: [marker, backspaceMarker, deleteMarker],
      expectedAfterExcludes: [`${backspaceMarker}X`, `${deleteMarker}X`],
      expectedAppendedPattern: new RegExp(
        ` ${marker} ${backspaceMarker} ${deleteMarker}`,
        "u",
      ),
    });
    samples.push({ plan, marker, backspaceMarker, deleteMarker, sourceScope });
  }
  return { samples };
}

async function runNewlineOperation({ page, workingCopyPath, plan, fileIndex }) {
  const beforeMarker = `PRQA_${fileIndex}_NEWLINE_BEFORE`;
  const marker = `PRQA_${fileIndex}_NEWLINE`;
  const before = readFileSync(workingCopyPath);
  const beforeRevision = await currentRevision(page);
  const target = await enterNativeEdit(page, plan);
  await target.press(keyShortcut("ArrowDown"));
  await page.keyboard.insertText(beforeMarker);
  const beforeBreakIds = await target.locator("br[data-pageroot-id]").evaluateAll((elements) => (
    elements.map((element) => element.getAttribute("data-pageroot-id")).filter(Boolean)
  ));
  await page.keyboard.press("Enter");
  await page.keyboard.insertText(marker);
  await expect(target).toContainText(marker);
  await expect.poll(async () => (
    (await target.locator("br[data-pageroot-id]").evaluateAll((elements) => (
      elements.map((element) => element.getAttribute("data-pageroot-id")).filter(Boolean)
    ))).filter((id) => !beforeBreakIds.includes(id)).length
  )).toBe(1);
  await saveAndExitTextOperation(page, beforeRevision);
  const saved = await readPublishedWorkingCopy(workingCopyPath, "utf8");
  expect(saved).toMatch(new RegExp(
    `${beforeMarker}[\\s\\S]*<br\\s+[^>]*data-pageroot-id="pr1_[0-9a-f]{32}"[^>]*>[\\s\\S]*${marker}`,
    "u",
  ));
  return {
    beforeMarker,
    marker,
    beforeBreakIds,
    sourceScope: assertScopedMutation({
      before,
      workingCopyPath,
      plan,
      normalizationPolicy: SOURCE_SCOPE_POLICIES.TEXT_NEWLINE,
      expectedAfterContains: [beforeMarker, marker],
      expectedAppendedPattern: new RegExp(
        `${beforeMarker}<br\\s+data-pageroot-id="pr1_[0-9a-f]{32}">${marker}`,
        "u",
      ),
    }),
  };
}

async function runUndoRedoOperation({ page, workingCopyPath, plan, fileIndex }) {
  const marker = `PRQA_${fileIndex}_UNDO_REDO`;
  const before = readFileSync(workingCopyPath);
  const beforeRevision = await currentRevision(page);
  const target = await enterNativeEdit(page, plan);
  await target.press(keyShortcut("ArrowDown"));
  await page.keyboard.insertText(` ${marker}`);
  await page.keyboard.press(keyShortcut("s"));
  await expect.poll(() => readPublishedWorkingCopy(workingCopyPath, "utf8")).toContain(marker);
  await page.keyboard.press(keyShortcut("z"));
  await expect.poll(() => readPublishedWorkingCopy(workingCopyPath, "utf8")).not.toContain(marker);
  await page.keyboard.press(keyShortcut("Shift+z"));
  await expect.poll(() => readPublishedWorkingCopy(workingCopyPath, "utf8")).toContain(marker);
  await saveAndExitTextOperation(page, beforeRevision);
  return {
    marker,
    sourceScope: assertScopedMutation({
      before,
      workingCopyPath,
      plan,
      normalizationPolicy: SOURCE_SCOPE_POLICIES.TEXT_UNDO_REDO,
      expectedAfterContains: [marker],
      expectedAppendedPattern: new RegExp(` ${marker}`, "u"),
    }),
  };
}

async function runFormatOperation({ page, workingCopyPath, plan, fileIndex }) {
  const marker = `PRQA_${fileIndex}_FORMAT`;
  const before = readFileSync(workingCopyPath);
  const beforeRevision = await currentRevision(page);
  const target = await enterNativeEdit(page, plan);
  await target.press(keyShortcut("ArrowDown"));
  await page.keyboard.insertText(` ${marker}`);
  const editor = editorFor(page);
  for (const [property, name] of [
    ["bold", "加粗"],
    ["italic", "斜体"],
    ["underline", "下划线"],
  ]) {
    await selectTrailingText(target, page, marker.length);
    const button = editor.getByRole("button", { name, exact: true });
    await expect(button).toBeEnabled();
    if (await button.getAttribute("aria-pressed") !== "true") await button.click();
    await expect.poll(async () => (await markerComputedStyle(target, marker))[property]).toBe(true);
  }
  await expect.poll(() => markerComputedStyle(target, marker))
    .toEqual({ bold: true, italic: true, underline: true });
  await saveAndExitTextOperation(page, beforeRevision);
  const saved = await readPublishedWorkingCopy(workingCopyPath, "utf8");
  expectFormattedMarker(saved, marker);
  return {
    marker,
    sourceScope: assertScopedMutation({
      before,
      workingCopyPath,
      plan,
      normalizationPolicy: SOURCE_SCOPE_POLICIES.TEXT_FORMAT,
      expectedAfterContains: [marker],
      expectedAppendedPattern: formattedMarkerAppendedPattern(marker),
    }),
  };
}

async function duplicateFixedStructureTarget({
  page,
  workingCopyPath,
  originalSha256,
  plan,
  selector,
}) {
  await clickAuthoredTab(page, plan.tabId);
  let frame = await currentEditorFrame(page);
  const original = frame.locator(`[data-pageroot-id="${plan.id}"]`);
  const beforeIds = await frame.locator(selector).evaluateAll((elements) => (
    elements.map((element) => element.getAttribute("data-pageroot-id")).filter(Boolean)
  ));
  expect(beforeIds).toContain(plan.id);
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
  if (
    diagnostic.commandBoundary.availability !== "available"
    || diagnostic.commandBoundary.reason !== "available"
    || diagnostic.commandBoundary.targetStableId !== plan.id
  ) {
    failWithCopyDiagnostic("Live copy capability disagreed with the selected Stable ID", diagnostic);
  }
  if (!diagnostic.nativeTextSession.ended || !diagnostic.nativeTextSession.probeEnded) {
    failWithCopyDiagnostic("Previous native text edit session did not end before copy", diagnostic);
  }
  if (!diagnostic.source.workingEqualsDisplayed) {
    failWithCopyDiagnostic("Working source and displayed source diverged before copy", diagnostic);
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
  const afterDuplicateIds = await frame.locator(selector).evaluateAll((elements) => (
    elements.map((element) => element.getAttribute("data-pageroot-id")).filter(Boolean)
  ));
  const addedIds = afterDuplicateIds.filter((id) => !beforeIds.includes(id));
  expect(
    addedIds,
    "Duplicate must add exactly one marked element with a distinct Stable ID",
  ).toHaveLength(1);
  const duplicateId = addedIds[0];
  return { duplicateId, beforeIds, afterDuplicateIds, diagnostic };
}

async function deleteFixedStructureTargets({ page, plan, selector, duplicateIds, originalIds }) {
  for (const duplicateId of duplicateIds) {
    let frame = await currentEditorFrame(page);
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
  }
  const frame = await currentEditorFrame(page);
  expect(await frame.locator(selector).evaluateAll((elements) => (
    elements.map((element) => element.getAttribute("data-pageroot-id")).filter(Boolean)
  ))).toEqual(originalIds);
  const original = frame.locator(`[data-pageroot-id="${plan.id}"]`);
  await expect(original).toHaveCount(1);
}

async function selectMarkerText(target, marker) {
  return target.evaluate((element, wanted) => {
    const walker = element.ownerDocument.createTreeWalker(
      element,
      element.ownerDocument.defaultView.NodeFilter.SHOW_TEXT,
    );
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const offset = node.textContent?.indexOf(wanted) ?? -1;
      if (offset < 0) continue;
      element.focus({ preventScroll: true });
      const range = element.ownerDocument.createRange();
      range.setStart(node, offset);
      range.setEnd(node, offset + wanted.length);
      const selection = element.ownerDocument.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      return true;
    }
    throw new Error(`Marker ${wanted} is not present in the authored target.`);
  }, marker);
}

async function runDeterministicPasteProbe({
  page,
  electronApp,
  workingCopyPath,
  plan,
  fileIndex,
}) {
  const pasteMarker = "PRQA_" + fileIndex + "_PASTE";
  const before = readFileSync(workingCopyPath);
  const beforeRevision = await currentRevision(page);
  await withRestoredElectronClipboard(electronApp, async () => {
    await electronApp.evaluate(
      ({ clipboard }, value) => clipboard.writeText(value),
      pasteMarker,
    );
    const target = await enterNativeEdit(page, plan);
    await target.press(keyShortcut("ArrowDown"));
    await page.keyboard.press(keyShortcut("v"));
    await expect(target).toContainText(pasteMarker);
    await page.keyboard.press(keyShortcut("s"));
    await expectCheckpointPersisted(page, beforeRevision);
    await page.keyboard.press("Escape");
    await waitForRuntimeHandoffSettled(page);
    await waitUntilEditable(page);
    await expect.poll(() => readPublishedWorkingCopy(workingCopyPath, "utf8"))
      .toContain(pasteMarker);
  });
  return {
    marker: pasteMarker,
    inputAuthority: "Playwright keyboard shortcut with restored Electron clipboard",
    sourceScope: assertScopedMutation({
      before,
      workingCopyPath,
      plan,
      normalizationPolicy: SOURCE_SCOPE_POLICIES.TEXT_PASTE,
      expectedAfterContains: [pasteMarker],
      expectedAppendedPattern: new RegExp(pasteMarker, "u"),
    }),
  };
}

async function runSourceScopeProbe({ page, workingCopyPath, plan, markers }) {
  const before = readFileSync(workingCopyPath);
  const beforeRevision = await currentRevision(page);
  const sourceMarker = markers.startMarker || markers.marker;
  const replacement = `${sourceMarker}_SCOPE`;
  const target = await enterNativeEdit(page, plan);
  await selectMarkerText(target, sourceMarker);
  await page.keyboard.insertText(replacement);
  await expect(target).toContainText(replacement);
  await page.keyboard.press(keyShortcut("s"));
  await expectCheckpointPersisted(page, beforeRevision);
  await page.keyboard.press("Escape");
  await waitForRuntimeHandoffSettled(page);
  await waitUntilEditable(page);

  const after = readFileSync(workingCopyPath);
  const beforeToken = Buffer.from(sourceMarker, "utf8");
  const afterToken = Buffer.from(replacement, "utf8");
  const beforeStart = before.indexOf(beforeToken);
  const afterStart = after.indexOf(afterToken);
  if (beforeStart < 0 || afterStart < 0) {
    const error = new Error("Source scope probe markers were not found in the saved bytes.");
    error.code = "SOURCE_SCOPE_MARKER_MISSING";
    throw error;
  }
  const oracle = compareElementSourceDelta({
    before,
    after,
    sourceId: plan.id,
    beforeRange: { start: beforeStart, end: beforeStart + beforeToken.length },
    afterRange: { start: afterStart, end: afterStart + afterToken.length },
    expectedBefore: beforeToken,
    expectedAfter: afterToken,
    domSelector: `[data-pageroot-id="${plan.id}"]`,
    label: `A source scope ${plan.id}`,
    kind: "replace",
  });
  if (!oracle.ok) {
    const error = new Error("Text source scope oracle rejected the saved bytes.");
    error.code = "SOURCE_SCOPE_ORACLE_FAILED";
    error.oracle = oracle;
    throw error;
  }
  return {
    marker: sourceMarker,
    replacement,
    ok: oracle.ok,
    outsideUnchanged: oracle.outsideUnchanged,
    changedRegionCount: oracle.changedRegionCount,
    outsideChangedRangeCount: oracle.outsideChangedRangeCount,
    allowedRegions: oracle.allowedRegions,
  };
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
  const copyDir = path.join(reportDir, String(fileIndex));
  const copyPath = path.join(copyDir, filename);
  const row = {
    filename,
    originalSha256: null,
    status: "NOT_EXECUTED",
    plannedTargets: [],
    completedTargets: [],
    structureCycles: [],
    lifecycle: [],
  };
  let session;
  let original;
  let activeStageId = REAL_HTML_STAGE_IDS.TEXT_EDITING;
  try {
    try {
      original = readFileSync(originalPath);
      row.originalSha256 = sha256(original);
      mkdirSync(copyDir, { recursive: true });
      writeFileSync(copyPath, original);
    } catch (cause) {
      resultReport.blockFile(filename, "ENVIRONMENT_BLOCKED", {
        exactReason: "CORPUS_FILE_COPY_FAILED",
        ...errorDetails(cause),
      });
      throw cause;
    }
    try {
      session = await launchPageRoot({ activeSourcePath: copyPath });
    } catch (cause) {
      resultReport.blockFile(filename, "ENVIRONMENT_BLOCKED", {
        exactReason: "ELECTRON_LAUNCH_FAILED",
        ...errorDetails(cause),
      });
      throw cause;
    }
    const { page } = session;
    await waitForProjectReady(page);
    await waitUntilEditable(page);
    const ordinaryBefore = await runtimeContractSnapshot(page);
    const workingCopyPath = await managedWorkingCopyPath(page, copyPath);
    const plans = await planTextTargets(page);
    row.plannedTargets = plans.map(({ id, tag, tabId, top }) => ({ id, tag, tabId, top }));

    const selectedPlans = plans.slice(0, 3);
    if (selectedPlans.length < 3) {
      const error = new Error("Each real HTML file must exercise at least three text hosts.");
      error.code = "TEXT_HOST_COVERAGE_INCOMPLETE";
      recordOperationFailure(
        filename,
        REAL_HTML_STAGE_IDS.TEXT_EDITING,
        REAL_HTML_OPERATION_IDS.TEXT_ACTIVATE,
        error,
      );
      throw error;
    }
    const runTextOperation = async (operationId, action) => {
      try {
        const details = await action();
        resultReport.passOperation(
          filename,
          REAL_HTML_STAGE_IDS.TEXT_EDITING,
          operationId,
          details,
        );
        return details;
      } catch (cause) {
        if (cause?.code === "CLIPBOARD_FORMAT_UNSUPPORTED") {
          const details = {
            notApplicable: true,
            exactReason: "SYSTEM_CLIPBOARD_ACCEPTANCE_DEFERRED",
            observedFormatCount: Array.isArray(cause.formats) ? cause.formats.length : 0,
          };
          resultReport.notApplicableOperation(
            filename,
            REAL_HTML_STAGE_IDS.TEXT_EDITING,
            operationId,
            details,
          );
          await page.keyboard.press("Escape").catch(() => {});
          await waitUntilEditable(page).catch(() => {});
          return details;
        }
        recordOperationFailure(filename, REAL_HTML_STAGE_IDS.TEXT_EDITING, operationId, cause);
        await page.keyboard.press("Escape").catch(() => {});
        await waitUntilEditable(page).catch(() => {});
        throw cause;
      }
    };

    await runTextOperation(
      REAL_HTML_OPERATION_IDS.TEXT_ACTIVATE,
      () => runActivationOperation(page, selectedPlans),
    );
    const inputDelete = await runTextOperation(
      REAL_HTML_OPERATION_IDS.TEXT_INPUT_DELETE,
      () => runInputDeleteOperation({ page, workingCopyPath, plans: selectedPlans, fileIndex }),
    );
    const successful = inputDelete.samples.map((sample) => ({
      plan: sample.plan,
      markers: { startMarker: sample.marker, ...sample },
    }));
    row.completedTargets = inputDelete.samples.map((sample) => ({
      id: sample.plan.id,
      tag: sample.plan.tag,
      tabId: sample.plan.tabId,
      operations: ["activate", "input", "Backspace", "Delete", "save and re-enter"],
      sourceScope: sample.sourceScope,
    }));
    await runTextOperation(
      REAL_HTML_OPERATION_IDS.TEXT_NEWLINE,
      () => runNewlineOperation({
        page,
        workingCopyPath,
        plan: selectedPlans[0],
        fileIndex,
      }),
    );
    const paste = await runTextOperation(
      REAL_HTML_OPERATION_IDS.TEXT_PASTE,
      () => runDeterministicPasteProbe({
        page,
        electronApp: session.electronApp,
        workingCopyPath,
        plan: selectedPlans[0],
        fileIndex,
      }),
    );
    await runTextOperation(
      REAL_HTML_OPERATION_IDS.TEXT_UNDO_REDO,
      () => runUndoRedoOperation({
        page,
        workingCopyPath,
        plan: selectedPlans[0],
        fileIndex,
      }),
    );
    await runTextOperation(
      REAL_HTML_OPERATION_IDS.TEXT_FORMAT,
      () => runFormatOperation({
        page,
        workingCopyPath,
        plan: selectedPlans[0],
        fileIndex,
      }),
    );
    const sourceScope = await runTextOperation(
      REAL_HTML_OPERATION_IDS.TEXT_SOURCE_SCOPE,
      () => runSourceScopeProbe({
        page,
        workingCopyPath,
        plan: selectedPlans[0],
        markers: successful[0].markers,
      }),
    );
    row.sourceScope = sourceScope;
    resultReport.passStage(filename, REAL_HTML_STAGE_IDS.TEXT_EDITING, {
      targetCount: successful.length,
      paste,
      operationOrder: [
        REAL_HTML_OPERATION_IDS.TEXT_ACTIVATE,
        REAL_HTML_OPERATION_IDS.TEXT_INPUT_DELETE,
        REAL_HTML_OPERATION_IDS.TEXT_NEWLINE,
        REAL_HTML_OPERATION_IDS.TEXT_PASTE,
        REAL_HTML_OPERATION_IDS.TEXT_UNDO_REDO,
        REAL_HTML_OPERATION_IDS.TEXT_FORMAT,
        REAL_HTML_OPERATION_IDS.TEXT_SOURCE_SCOPE,
      ],
    });
    const ordinaryAfter = await runtimeContractSnapshot(page);

    await page.screenshot({ path: path.join(copyDir, "after-complex-text-edits.png"), fullPage: true });
    activeStageId = REAL_HTML_STAGE_IDS.ELEMENT_STRUCTURE;
    const structureFrame = await currentEditorFrame(page);
    const structureSamples = await inspectFixedStructureSamples(structureFrame);
    row.structureSamples = structureSamples;
    const copyable = structureSamples.expectedCopyable;
    const nonCopyable = structureSamples.expectedNonCopyable;
    let duplicateIds = [];
    if (copyable.status === "invalid") {
      const error = new Error("The expected-copyable marker must resolve to exactly one valid target.");
      error.code = copyable.reason;
      recordOperationFailure(
        filename,
        REAL_HTML_STAGE_IDS.ELEMENT_STRUCTURE,
        REAL_HTML_OPERATION_IDS.STRUCTURE_COPYABLE,
        error,
      );
      throw error;
    }
    if (copyable.status === "missing") {
      resultReport.notApplicableOperation(
        filename,
        REAL_HTML_STAGE_IDS.ELEMENT_STRUCTURE,
        REAL_HTML_OPERATION_IDS.STRUCTURE_COPYABLE,
        {
          exactReason: FIXED_STRUCTURE_REASON_CODES.SAMPLE_NOT_FOUND,
          sampleId: FIXED_STRUCTURE_SAMPLES.expectedCopyable.id,
          selector: FIXED_STRUCTURE_SAMPLES.expectedCopyable.selector,
        },
      );
      resultReport.notApplicableOperation(
        filename,
        REAL_HTML_STAGE_IDS.ELEMENT_STRUCTURE,
        REAL_HTML_OPERATION_IDS.STRUCTURE_DELETE_DUPLICATE,
        { exactReason: "COPYABLE_SAMPLE_NOT_AVAILABLE" },
      );
    } else {
      const copyablePlan = {
        id: copyable.sourceId,
        tag: copyable.tagName,
        tabId: null,
      };
      let originalIds;
      try {
        const fixedCopyableTarget = (await currentEditorFrame(page))
          .locator(FIXED_STRUCTURE_SAMPLES.expectedCopyable.selector);
        await fixedCopyableTarget.click();
        await expect(
          editorFor(page).getByRole("button", { name: "复制元素", exact: true }),
        ).toBeVisible();
        for (let cycle = 0; cycle < 2; cycle += 1) {
          const duplicate = await duplicateFixedStructureTarget({
            page,
            workingCopyPath,
            originalSha256: row.originalSha256,
            plan: copyablePlan,
            selector: FIXED_STRUCTURE_SAMPLES.expectedCopyable.selector,
          });
          originalIds ||= duplicate.beforeIds;
          duplicateIds.push(duplicate.duplicateId);
          row.structureCycles.push({
            cycle,
            originalId: copyable.sourceId,
            duplicateId: duplicate.duplicateId,
            result: "copied",
            diagnostic: duplicate.diagnostic,
          });
        }
      } catch (cause) {
        recordOperationFailure(
          filename,
          REAL_HTML_STAGE_IDS.ELEMENT_STRUCTURE,
          REAL_HTML_OPERATION_IDS.STRUCTURE_COPYABLE,
          cause,
        );
        throw cause;
      }
      resultReport.passOperation(
        filename,
        REAL_HTML_STAGE_IDS.ELEMENT_STRUCTURE,
        REAL_HTML_OPERATION_IDS.STRUCTURE_COPYABLE,
        {
          sampleId: copyable.sampleId,
          sourceId: copyable.sourceId,
          expectedCopyable: true,
        },
      );
      try {
        await deleteFixedStructureTargets({
          page,
          plan: copyablePlan,
          selector: FIXED_STRUCTURE_SAMPLES.expectedCopyable.selector,
          duplicateIds,
          originalIds,
        });
        for (const cycle of row.structureCycles) cycle.result = "copied-and-deleted";
        resultReport.passOperation(
          filename,
          REAL_HTML_STAGE_IDS.ELEMENT_STRUCTURE,
          REAL_HTML_OPERATION_IDS.STRUCTURE_DELETE_DUPLICATE,
          { duplicateIds },
        );
      } catch (cause) {
        recordOperationFailure(
          filename,
          REAL_HTML_STAGE_IDS.ELEMENT_STRUCTURE,
          REAL_HTML_OPERATION_IDS.STRUCTURE_DELETE_DUPLICATE,
          cause,
        );
        throw cause;
      }
    }

    if (nonCopyable.status === "invalid") {
      const error = new Error(
        "The expected-non-copyable marker must resolve to exactly one valid target.",
      );
      error.code = nonCopyable.reason;
      recordOperationFailure(
        filename,
        REAL_HTML_STAGE_IDS.ELEMENT_STRUCTURE,
        REAL_HTML_OPERATION_IDS.STRUCTURE_NON_COPYABLE,
        error,
      );
      throw error;
    }
    if (nonCopyable.status === "missing") {
      resultReport.notApplicableOperation(
        filename,
        REAL_HTML_STAGE_IDS.ELEMENT_STRUCTURE,
        REAL_HTML_OPERATION_IDS.STRUCTURE_NON_COPYABLE,
        {
          exactReason: FIXED_STRUCTURE_REASON_CODES.SAMPLE_NOT_FOUND,
          sampleId: FIXED_STRUCTURE_SAMPLES.expectedNonCopyable.id,
          selector: FIXED_STRUCTURE_SAMPLES.expectedNonCopyable.selector,
        },
      );
    } else {
      try {
        const nonCopyableTarget = (await currentEditorFrame(page))
          .locator(FIXED_STRUCTURE_SAMPLES.expectedNonCopyable.selector);
        await nonCopyableTarget.click();
        const nonCopyablePlan = {
          id: nonCopyable.sourceId,
          tag: nonCopyable.tagName,
          tabId: null,
        };
        const relocated = await nonCopyableTarget.evaluate((element, expected) => ({
          count: 1,
          stableId: element.getAttribute("data-pageroot-id"),
          tag: element.tagName.toLowerCase(),
          connected: element.isConnected,
          selectedMarker: element.hasAttribute("data-html-canvas-selected"),
          liveStyleAttribute: element.getAttribute("style"),
          sameAsPlanned: element.getAttribute("data-pageroot-id") === expected.stableId
            && element.tagName.toLowerCase() === expected.tag,
        }), { stableId: nonCopyablePlan.id, tag: nonCopyablePlan.tag });
        const diagnostic = await copyCapabilitySnapshot({
          page,
          workingCopyPath,
          plan: nonCopyablePlan,
          originalSha256: row.originalSha256,
          relocated,
        });
        await expect(
          editorFor(page).getByRole("button", { name: "复制元素", exact: true }),
        ).toHaveCount(0);
        expect(await nonCopyableTarget.evaluate(
          (element) => element.isContentEditable,
        )).toBe(false);
        const copyAvailability = await editorFor(page)
          .getAttribute("data-element-copy-availability");
        expect(copyAvailability).toBe("unsupported");
        const capabilityReason = await editorFor(page)
          .getAttribute("data-element-copy-reason");
        expect(capabilityReason).toBeTruthy();
        expect(diagnostic.commandBoundary.availability).toBe("unsupported");
        expect(diagnostic.commandBoundary.reason).toBeTruthy();
        expect(diagnostic.commandBoundary.reason).not.toBe("available");
        expect(diagnostic.commandBoundary.targetStableId).toBe(nonCopyable.sourceId);
        resultReport.passOperation(
          filename,
          REAL_HTML_STAGE_IDS.ELEMENT_STRUCTURE,
          REAL_HTML_OPERATION_IDS.STRUCTURE_NON_COPYABLE,
          {
            sampleId: nonCopyable.sampleId,
            sourceId: nonCopyable.sourceId,
            expectedCopyable: false,
            contentEditable: false,
            copyAvailability,
            capabilityReason,
            diagnostic,
          },
        );
      } catch (cause) {
        recordOperationFailure(
          filename,
          REAL_HTML_STAGE_IDS.ELEMENT_STRUCTURE,
          REAL_HTML_OPERATION_IDS.STRUCTURE_NON_COPYABLE,
          cause,
        );
        throw cause;
      }
    }
    const structureRows = resultReport.rowsForFile(filename).filter(
      (resultRow) => resultRow.level === "operation"
        && resultRow.stageId === REAL_HTML_STAGE_IDS.ELEMENT_STRUCTURE,
    );
    if (structureRows.some((resultRow) => resultRow.state === "FAIL")) {
      throw new Error("Element structure stage failed.");
    }
    if (structureRows.every((resultRow) => resultRow.state === "NOT_APPLICABLE")) {
      resultReport.notApplicableStage(filename, REAL_HTML_STAGE_IDS.ELEMENT_STRUCTURE, {
        exactReason: "FIXED_STRUCTURE_SAMPLES_UNAVAILABLE",
      });
    } else {
      resultReport.passStage(filename, REAL_HTML_STAGE_IDS.ELEMENT_STRUCTURE, {
        fixedSamples: structureSamples,
      });
    }

    activeStageId = REAL_HTML_STAGE_IDS.RUNTIME_IFRAME;
    await page.getByRole("button", { name: "预览", exact: true }).click();
    await expect(editorFor(page).getByRole("toolbar")).toHaveCount(0);
    await page.getByRole("button", { name: "编辑", exact: true }).click();
    await waitUntilEditable(page);
    let target = await enterNativeEdit(page, successful[0].plan);
    await expect(target).toHaveAttribute("contenteditable", /^(?:plaintext-only|true)$/u);
    await page.keyboard.press("Escape");
    row.lifecycle.push("preview-edit-reenter");

    const reloadBefore = await runtimeContractSnapshot(page);
    await startRuntimeLifecycleObservation(page);
    await page.getByRole("button", { name: "更多", exact: true }).click();
    await page.getByRole("menuitem", { name: "从磁盘重新载入 HTML", exact: true }).click();
    await expect(page.locator(".workbench-chrome-status"))
      .toHaveText("页面已重新加载，可以继续编辑", { timeout: 60_000 });
    await waitUntilEditable(page);
    const runtimeObservations = await stopRuntimeLifecycleObservation(page);
    const reloadAfter = await runtimeContractSnapshot(page);
    row.runtime = {
      ordinaryBefore,
      ordinaryAfter,
      reloadBefore,
      reloadAfter,
      observations: runtimeObservations,
    };
    const runtimeOutcomes = runtimeOperationOutcomes({
      ordinaryBefore,
      ordinaryAfter,
      reloadBefore,
      reloadAfter,
      candidateEvidence: runtimeObservations.find((observation) => (
        observation.kind === "candidate-created"
        && observation.evidence === "candidate-id-absent-to-present"
        && typeof observation.candidateId === "string"
        && observation.candidateId.trim() !== ""
      )) || null,
      dynamicRecovery: null,
      staticFallback: {
        observed: reloadAfter.staticFallbackVisible > 0
          || reloadAfter.runtimePhase === "static-fallback",
        phase: reloadAfter.runtimePhase,
        renderVerified: reloadAfter.renderVerified,
        sandbox: reloadAfter.activeSandbox,
      },
    });
    for (const operationId of [
      REAL_HTML_OPERATION_IDS.RUNTIME_REBUILD,
      REAL_HTML_OPERATION_IDS.RUNTIME_CANDIDATE,
      REAL_HTML_OPERATION_IDS.RUNTIME_GENERATION,
      REAL_HTML_OPERATION_IDS.RUNTIME_DYNAMIC_RECOVERY,
      REAL_HTML_OPERATION_IDS.RUNTIME_STATIC_FALLBACK,
    ]) {
      const outcome = runtimeOutcomes[operationId];
      resultReport.operation(
        filename,
        REAL_HTML_STAGE_IDS.RUNTIME_IFRAME,
        operationId,
        outcome,
      );
      if (outcome.state === "FAIL") break;
    }
    const runtimeRows = resultReport.rowsForFile(filename).filter(
      (resultRow) => resultRow.level === "operation"
        && resultRow.stageId === REAL_HTML_STAGE_IDS.RUNTIME_IFRAME,
    );
    if (runtimeRows.some((resultRow) => resultRow.state === "FAIL")) {
      resultReport.failStage(filename, REAL_HTML_STAGE_IDS.RUNTIME_IFRAME, {
        exactReason: "RUNTIME_OPERATION_FAILED",
      });
      throw new Error("Runtime/iframe stage failed.");
    }
    try {
      target = await enterNativeEdit(page, successful[1].plan);
      await expect(target).toContainText(successful[1].markers.startMarker);
      await page.keyboard.press("Escape");
      row.lifecycle.push("source-reload-reenter");
      resultReport.passOperation(
        filename,
        REAL_HTML_STAGE_IDS.RUNTIME_IFRAME,
        REAL_HTML_OPERATION_IDS.RUNTIME_REENTER,
        { sourceId: successful[1].plan.id },
      );
    } catch (cause) {
      recordOperationFailure(
        filename,
        REAL_HTML_STAGE_IDS.RUNTIME_IFRAME,
        REAL_HTML_OPERATION_IDS.RUNTIME_REENTER,
        cause,
      );
      throw cause;
    }

    try {
      row.viewport = await verifyViewport(page);
      expect(row.viewport.horizontalOverflow, "Workbench chrome must fit the acceptance viewport")
        .toBe(false);
      resultReport.passOperation(
        filename,
        REAL_HTML_STAGE_IDS.RUNTIME_IFRAME,
        REAL_HTML_OPERATION_IDS.RUNTIME_VIEWPORT,
        row.viewport,
      );
    } catch (cause) {
      recordOperationFailure(
        filename,
        REAL_HTML_STAGE_IDS.RUNTIME_IFRAME,
        REAL_HTML_OPERATION_IDS.RUNTIME_VIEWPORT,
        cause,
      );
      throw cause;
    }
    await page.screenshot({ path: path.join(copyDir, "after-source-reload.png"), fullPage: true });

    const isolatedUserData = session.isolatedUserData;
    await stopPageRoot(session.electronApp, isolatedUserData, { cleanup: false });
    session = undefined;
    try {
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
      resultReport.passOperation(
        filename,
        REAL_HTML_STAGE_IDS.RUNTIME_IFRAME,
        REAL_HTML_OPERATION_IDS.RUNTIME_REOPEN,
        { targetCount: successful.length },
      );
    } catch (cause) {
      recordOperationFailure(
        filename,
        REAL_HTML_STAGE_IDS.RUNTIME_IFRAME,
        REAL_HTML_OPERATION_IDS.RUNTIME_REOPEN,
        cause,
      );
      throw cause;
    }
    await session.page.screenshot({ path: path.join(copyDir, "reopened.png"), fullPage: true });

    const finalWorkingCopy = await managedWorkingCopyPath(session.page, copyPath);
    row.finalWorkingSha256 = sha256(readFileSync(finalWorkingCopy));
    row.originalUnchanged = sha256(readFileSync(originalPath)) === row.originalSha256;
    if (!row.originalUnchanged) {
      const error = new Error("The original user HTML changed during isolated acceptance.");
      error.code = "ORIGINAL_HTML_CHANGED";
      recordOperationFailure(
        filename,
        REAL_HTML_STAGE_IDS.RUNTIME_IFRAME,
        REAL_HTML_OPERATION_IDS.ORIGINAL_SOURCE_IMMUTABLE,
        error,
      );
      throw error;
    }
    resultReport.passOperation(
      filename,
      REAL_HTML_STAGE_IDS.RUNTIME_IFRAME,
      REAL_HTML_OPERATION_IDS.ORIGINAL_SOURCE_IMMUTABLE,
      { originalSha256: row.originalSha256 },
    );
    resultReport.passStage(filename, REAL_HTML_STAGE_IDS.RUNTIME_IFRAME, {
      observations: runtimeObservations,
      lifecycle: row.lifecycle,
    });
    resultReport.passFile(filename, {
      textTargets: successful.length,
      structureCycles: row.structureCycles.length,
      lifecycle: row.lifecycle,
    });
    row.status = "PASS";
  } catch (cause) {
    row.error = String(cause?.stack || cause);
    const stageRow = resultReport.rowsForFile(filename).find(
      (resultRow) => resultRow.level === "stage" && resultRow.stageId === activeStageId,
    );
    if (stageRow?.state === "NOT_EXECUTED" && stageRow.reasonCode === "NOT_STARTED") {
      resultReport.failStage(filename, activeStageId, errorDetails(cause));
    }
    const fileRow = resultReport.rowsForFile(filename).find(
      (resultRow) => resultRow.level === "file",
    );
    if (fileRow?.state === "NOT_EXECUTED" && fileRow.reasonCode === "NOT_STARTED") {
      resultReport.failFile(filename, errorDetails(cause));
    }
    if (session) {
      await session.page.screenshot({ path: path.join(copyDir, "failure.png"), fullPage: true })
        .catch(() => {});
    }
  } finally {
    if (session) {
      await stopPageRoot(session.electronApp, session.isolatedUserData).catch((cause) => {
        row.cleanupError = String(cause?.stack || cause);
      });
    }
    if (original) {
      try {
        row.originalUnchanged = sha256(readFileSync(originalPath)) === row.originalSha256;
      } catch (cause) {
        row.originalUnchanged = null;
        row.originalVerificationError = String(cause?.stack || cause);
      }
    }
    row.status = resultReport.rowsForFile(filename).find(
      (resultRow) => resultRow.level === "file",
    )?.state || row.status;
    report.results.push(row);
    saveReport();
    console.log(
      `${report.results.length}/${files.length}: ${row.status} ${filename} `
      + `(${row.completedTargets.filter((target) => !target.rejected).length} text hosts, `
      + `${row.structureCycles.length} structure cycles)`,
    );
  }
}

report.passed = report.results.filter((row) => row.status === "PASS").length;
report.failed = report.results.filter((row) => row.status === "FAIL").length;
report.notExecuted = report.results.filter((row) => row.status === "NOT_EXECUTED").length;
report.notApplicable = report.results.filter((row) => row.status === "NOT_APPLICABLE").length;
resultReport.finalize();
saveReport();
process.exitCode = report.failed || report.notExecuted ? 1 : 0;
