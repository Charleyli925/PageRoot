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
  startRuntimeCandidateObservation,
  stopRuntimeCandidateObservation,
} from "./real-html/runtime-observer.mjs";
import {
  createFixedTextTargetPlan,
  describeTextTarget,
  TEXT_TARGET_COUNT,
  TEXT_TARGET_REASON_CODES,
  TEXT_TARGET_SELECTOR,
  validateFrozenTextTarget,
} from "./real-html/text-targets.mjs";
import {
  compareElementScopedMutation,
  formattedMarkerAppendedPattern,
  SOURCE_SCOPE_POLICIES,
} from "./real-html/source-scope.mjs";
import { workspaceSourceFingerprint } from "./real-html/workspace-provenance.mjs";
import {
  buildSourceIndex as buildPatchSourceIndex,
  createTargetRef,
} from "../../../app/lib/source-patch-core.js";
import { isEditableIslandTarget } from "../../../app/lib/editable-island.js";
import { isTransparentSourceTextElement } from "../../../app/lib/source-text-map.js";

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

const PUBLIC_ERROR_STRING_KEYS = new Set([
  "code",
  "exactReason",
  "reasonCode",
  "expectedId",
  "observedId",
  "observedTag",
  "observedParentId",
  "sourceId",
  "policy",
]);
const PRIVATE_ERROR_KEYS = new Set([
  "afterSnippet",
  "beforeSnippet",
  "html",
  "raw",
  "text",
  "value",
  "message",
  "stack",
  "filename",
  "path",
  "selector",
]);

function publicRange(range) {
  if (!range || typeof range !== "object") return null;
  const start = Number.isInteger(range.start) ? range.start : null;
  const end = Number.isInteger(range.end) ? range.end : null;
  return {
    start,
    end,
    length: start != null && end != null ? Math.max(0, end - start) : null,
  };
}

function publicFirstDifferingByte(value) {
  if (!value || typeof value !== "object") return null;
  return {
    beforeOffset: Number.isInteger(value.beforeOffset) ? value.beforeOffset : null,
    afterOffset: Number.isInteger(value.afterOffset) ? value.afterOffset : null,
  };
}

function publicOracleRange(value) {
  if (!value || typeof value !== "object") return null;
  return {
    scope: typeof value.scope === "string" ? value.scope : null,
    reasonCode: typeof value.reasonCode === "string" ? value.reasonCode : null,
    kind: typeof value.kind === "string" ? value.kind : null,
    sourceRange: publicRange(value.sourceRange),
    domRange: publicRange(value.domRange),
    beforeRange: publicRange(value.beforeRange),
    afterRange: publicRange(value.afterRange),
    firstDifferingByte: publicFirstDifferingByte(value.firstDifferingByte),
  };
}

function collectOracleBooleans(value, path = "", output = {}) {
  if (typeof value === "boolean") {
    output[path || "ok"] = value;
    return output;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return output;
  for (const [key, nested] of Object.entries(value)) {
    if (PRIVATE_ERROR_KEYS.has(key) || key === "errors" || key === "allowedRegions") continue;
    collectOracleBooleans(nested, path ? `${path}.${key}` : key, output);
  }
  return output;
}

function publicOracleDetails(oracle) {
  if (!oracle || typeof oracle !== "object") return null;
  const changedRanges = Array.isArray(oracle.changedRanges)
    ? oracle.changedRanges.map(publicOracleRange)
    : oracle.changedRanges?.before || oracle.changedRanges?.after
      ? [
        {
          scope: "target",
          reasonCode: null,
          kind: "before",
          sourceRange: publicRange(oracle.changedRanges.before),
          domRange: null,
          beforeRange: publicRange(oracle.changedRanges.before),
          afterRange: null,
          firstDifferingByte: null,
        },
        {
          scope: "target",
          reasonCode: null,
          kind: "after",
          sourceRange: publicRange(oracle.changedRanges.after),
          domRange: null,
          beforeRange: null,
          afterRange: publicRange(oracle.changedRanges.after),
          firstDifferingByte: null,
        },
      ]
      : [];
  const errors = Array.isArray(oracle.errors)
    ? oracle.errors.map((entry) => ({
      code: typeof entry?.code === "string" ? entry.code : null,
    }))
    : [];
  return {
    exactReason: oracle.ok === true
      ? "SOURCE_SCOPE_ORACLE_PASSED"
      : errors.find((entry) => entry.code)?.code || "SOURCE_SCOPE_ORACLE_FAILED",
    booleanConditions: collectOracleBooleans(oracle),
    changedRanges,
    changedRegionCount: Number.isInteger(oracle.changedRegionCount)
      ? oracle.changedRegionCount
      : changedRanges.filter((entry) => entry?.scope === "allowed").length,
    outsideChangedRangeCount: Number.isInteger(oracle.outsideChangedRangeCount)
      ? oracle.outsideChangedRangeCount
      : changedRanges.filter((entry) => entry?.scope === "outside").length,
    appendedByteRange: publicRange(oracle.appendedByteRange),
    elementRanges: {
      before: publicRange(oracle.elementRanges?.before),
      after: publicRange(oracle.elementRanges?.after),
    },
    errors,
  };
}

function publicErrorValue(value, key = "") {
  if (typeof value === "boolean" || typeof value === "number" || value == null) return value;
  if (typeof value === "string") return PUBLIC_ERROR_STRING_KEYS.has(key) ? value : undefined;
  if (Array.isArray(value)) {
    return value.map((entry) => publicErrorValue(entry, key)).filter((entry) => entry !== undefined);
  }
  if (typeof value !== "object") return undefined;
  const output = {};
  for (const [nestedKey, nestedValue] of Object.entries(value)) {
    if (PRIVATE_ERROR_KEYS.has(nestedKey) || nestedKey === "oracle") continue;
    const publicValue = publicErrorValue(nestedValue, nestedKey);
    if (publicValue !== undefined) output[nestedKey] = publicValue;
  }
  return output;
}

function errorDetails(error) {
  const code = error?.code || null;
  const oracle = publicOracleDetails(error?.oracle);
  const details = publicErrorValue(error?.details);
  return {
    error: code === "SOURCE_SCOPE_ORACLE_FAILED"
      ? "Source scope oracle failed."
      : String(error?.stack || error),
    code,
    exactReason: oracle?.exactReason || details?.exactReason || null,
    ...(details && Object.keys(details).length > 0 ? { details } : {}),
    ...(oracle ? { oracle } : {}),
  };
}

function recordOperationFailure(fileId, stageId, operationId, error) {
  resultReport.failOperation(fileId, stageId, operationId, errorDetails(error));
}

async function runtimeContractSnapshot(page) {
  const editor = editorFor(page);
  const surface = surfaceFor(page);
  const active = editor.locator('iframe[data-runtime-slot-role="active"]');
  const candidate = editor.locator('iframe[data-frame-role="runtime-candidate"]');
  const identity = await currentFrameIdentity(page);
  return {
    ...identity,
    candidateId: await editor.getAttribute("data-runtime-candidate-id"),
    candidatePhase: await editor.getAttribute("data-runtime-candidate-phase"),
    candidateCount: await candidate.count(),
    renderVerified: await editor.getAttribute("data-render-verified"),
    runtimePhase: await surface.getAttribute("data-edit-runtime-phase"),
    runtimeOutcome: await surface.getAttribute("data-edit-runtime-outcome"),
    degradation: await editor.getAttribute("data-runtime-degradation"),
    staticFallbackVisible: await surface.getByTestId("edit-runtime-static-fallback")
      .count()
      .catch(() => 0),
    activeSandbox: await active.getAttribute("sandbox"),
  };
}

async function startRuntimeLifecycleObservation(page) {
  await editorFor(page).evaluate(startRuntimeCandidateObservation);
}

async function stopRuntimeLifecycleObservation(page) {
  return editorFor(page).evaluate(stopRuntimeCandidateObservation);
}

function editorFor(page) {
  return page.getByTestId("html-canvas-editor").filter({ visible: true }).first();
}

function surfaceFor(page) {
  return page.getByTestId("workbench-active-document-canvas")
    .filter({ visible: true })
    .first();
}

async function waitForRuntimeReloadTerminal(page) {
  await expect.poll(async () => {
    const surface = surfaceFor(page);
    const phase = await surface.getAttribute("data-edit-runtime-phase");
    const outcome = await surface.getAttribute("data-edit-runtime-outcome");
    return {
      terminal: phase === "settled"
        || phase === "static-fallback"
        || (phase === "static" && typeof outcome === "string" && outcome !== ""),
      phase,
      outcome,
    };
  }, { timeout: 60_000 }).toMatchObject({ terminal: true });
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

function editableSourceElementCapabilities(sourceBytes) {
  const index = buildPatchSourceIndex(sourceBytes.toString("utf8"));
  return index.elements.flatMap((element) => {
    if (!element.textContent?.trim()) return [];
    const targetRef = createTargetRef(index, element, { level: "subregion" });
    if (!isEditableIslandTarget(index, targetRef).editable) return [];
    const parent = element.parentId ? index.byNodeId.get(element.parentId) : null;
    return [{
      id: element.pagerootId || element.nodeId,
      parentId: parent?.type === "element" ? parent.pagerootId || null : null,
      transparent: isTransparentSourceTextElement(element.tagName),
    }];
  });
}

async function captureTextTargetSnapshots(page, sourceCapabilities, tabId) {
  const frame = await currentEditorFrame(page);
  // `evaluateAll` serializes only the callback itself, so the descriptor is
  // intentionally called inline through its self-contained function source.
  const snapshots = await frame.locator(TEXT_TARGET_SELECTOR).evaluateAll((elements, capabilities) => {
    const allowed = new Map(capabilities.map((capability) => [capability.id, capability]));
    const nativeHostFor = (hitElement) => {
      let candidate = hitElement.closest("[data-pageroot-id]");
      let nearestSafeCandidate = null;
      while (candidate) {
        const id = candidate.getAttribute("data-pageroot-id");
        const capability = allowed.get(id);
        if (!capability) return null;
        const parent = candidate.parentElement?.closest("[data-pageroot-id]") || null;
        if ((parent?.getAttribute("data-pageroot-id") || null) !== capability.parentId) return null;
        nearestSafeCandidate = candidate;
        const display = candidate.ownerDocument.defaultView
          ?.getComputedStyle(candidate).display.toLowerCase() || "";
        const climbThrough = candidate.localName === "br" || (
          capability.transparent && (display === "inline" || display === "contents")
        );
        if (!climbThrough) break;
        candidate = parent;
      }
      return nearestSafeCandidate;
    };
    return (
    elements.map((hitElement) => nativeHostFor(hitElement)).filter(Boolean).map((element) => {
      const view = element.ownerDocument.defaultView;
      const style = view?.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const id = element.getAttribute("data-pageroot-id");
      const parent = element.parentElement?.closest("[data-pageroot-id]") || null;
      const descendantSourceNodes = Array.from(
        element.querySelectorAll("[data-pageroot-id]"),
      );
      const descendantSourceIds = descendantSourceNodes
        .map((candidate) => candidate.getAttribute("data-pageroot-id"));
      const descendantSourceTags = descendantSourceNodes.map((candidate) => candidate.localName);
      const excludedAncestor = element.closest(
        "button,a,input,textarea,select,option,nav,[role=tab],[role=tablist],[contenteditable=true]",
      );
      const tag = element.localName;
      const sourceIdValid = /^pr1_[0-9a-f]{32}$/u.test(id || "");
      const text = element.textContent?.replace(/\s+/gu, " ").trim() || "";
      const hiddenByAttribute = element.hasAttribute("hidden")
        || element.getAttribute("aria-hidden") === "true"
        || element.hasAttribute("inert");
      const visible = Boolean(
        style
        && !hiddenByAttribute
        && style.display !== "none"
        && style.visibility !== "hidden"
        && Number(style.opacity || 1) > 0
        && rect.width > 0
        && rect.height > 0
        && element.getClientRects().length > 0,
      );
      const format = {
        bold: style?.fontWeight === "bold" || Number(style?.fontWeight || 0) >= 600,
        italic: style?.fontStyle === "italic" || style?.fontStyle === "oblique",
        underline: (style?.textDecorationLine || "").split(/\s+/u).includes("underline"),
      };
      const documentOrder = Array.from(
        element.ownerDocument.querySelectorAll("[data-pageroot-id]"),
      ).indexOf(element);
      const domIdentityValid = sourceIdValid
        && Array.from(element.ownerDocument.querySelectorAll("[data-pageroot-id]"))
          .filter((candidate) => candidate.getAttribute("data-pageroot-id") === id)
          .length === 1;
      return {
        id,
        tag,
        parentId: parent?.getAttribute("data-pageroot-id") || null,
        documentOrder,
        textLength: text.length,
        childCount: element.childElementCount,
        descendantSourceIds,
        descendantSourceTags,
        sourceIdValid,
        domIdentityValid,
        visible,
        interactive: Boolean(excludedAncestor),
        sourceEditable: allowed.has(id),
        format,
        rect: { width: rect.width, height: rect.height },
      };
    })
    );
  }, sourceCapabilities);
  return snapshots
    .filter((snapshot) => snapshot.visible && snapshot.sourceEditable)
    .map((snapshot) => ({ ...snapshot, tabId }));
}

async function planTextTargets(page, workingCopyPath, {
  limit = TEXT_TARGET_COUNT,
  requireFormatTarget = true,
} = {}) {
  const sourceCapabilities = editableSourceElementCapabilities(readFileSync(workingCopyPath));
  const initialFrame = await currentEditorFrame(page);
  const tabs = await initialFrame.locator(
    '[role="tab"][aria-controls][data-pageroot-id]',
  ).evaluateAll((elements) => elements.filter((element) => {
    const rect = element.getBoundingClientRect();
    const style = element.ownerDocument.defaultView.getComputedStyle(element);
    return rect.width > 10 && rect.height > 10
      && style.display !== "none" && style.visibility !== "hidden";
  }).slice(0, 4).map((element) => element.getAttribute("data-pageroot-id")).filter(Boolean));
  const snapshots = [];
  for (const tabId of tabs.length > 0 ? tabs : [null]) {
    await clickAuthoredTab(page, tabId);
    snapshots.push(...await captureTextTargetSnapshots(page, sourceCapabilities, tabId));
  }
  const fixed = createFixedTextTargetPlan(snapshots, { limit, requireFormatTarget });
  if (!fixed.ok) {
    const error = new Error("The fixed text-host preflight did not produce enough qualified targets.");
    error.code = fixed.reasonCode || TEXT_TARGET_REASON_CODES.SNAPSHOT_INCOMPLETE;
    error.details = {
      reasonCode: fixed.reasonCode,
      available: fixed.available ?? 0,
      required: fixed.required ?? limit,
      duplicateIds: fixed.duplicateIds || [],
      rejected: fixed.rejected || [],
    };
    throw error;
  }
  return fixed.targets;
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

async function enterNativeEdit(page, plan, { requireFormatProperty = null } = {}) {
  await clickAuthoredTab(page, plan.tabId);
  await page.keyboard.press("Escape");
  await waitUntilEditable(page);
  const frame = await currentEditorFrame(page);
  const target = frame.locator(`[data-pageroot-id=${JSON.stringify(plan.id)}]`);
  const count = await target.count();
  if (count !== 1) {
    const error = new Error("The frozen text target must resolve to exactly one DOM element.");
    error.code = count === 0
      ? TEXT_TARGET_REASON_CODES.DOM_IDENTITY_INVALID
      : TEXT_TARGET_REASON_CODES.STABLE_ID_DUPLICATE;
    error.details = { expectedId: plan.id, observedCount: count };
    throw error;
  }
  await target.scrollIntoViewIfNeeded();
  const currentSnapshot = await target.evaluate(describeTextTarget);
  currentSnapshot.sourceEditable = plan.sourceEditable === true;
  const validation = validateFrozenTextTarget(currentSnapshot, plan, {
    requireFormatProperty,
  });
  if (!validation.ok) {
    const error = new Error("The frozen text target changed before the operation.");
    error.code = validation.reasons[0] || TEXT_TARGET_REASON_CODES.SNAPSHOT_DRIFT;
    error.details = {
      expectedId: plan.id,
      reasons: validation.reasons,
      observedTag: currentSnapshot.tag,
      observedParentId: currentSnapshot.parentId,
      observedDocumentOrder: currentSnapshot.documentOrder,
    };
    throw error;
  }
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
  await expect.poll(() => markerComputedStyle(target, marker))
    .toEqual({ bold: false, italic: false, underline: false });
  const editor = editorFor(page);
  const formatTransitions = [];
  for (const [property, name] of [
    ["bold", "加粗"],
    ["italic", "斜体"],
    ["underline", "下划线"],
  ]) {
    await selectTrailingText(target, page, marker.length);
    const button = editor.getByRole("button", { name, exact: true });
    await expect(button).toBeEnabled();
    await expect(button).toHaveAttribute("aria-pressed", "false");
    const beforeState = await markerComputedStyle(target, marker);
    expect(beforeState[property]).toBe(false);
    await button.click();
    await expect(button).toHaveAttribute("aria-pressed", "true");
    await expect.poll(async () => (await markerComputedStyle(target, marker))[property]).toBe(true);
    formatTransitions.push({ property, from: false, to: true });
  }
  await expect.poll(() => markerComputedStyle(target, marker))
    .toEqual({ bold: true, italic: true, underline: true });
  await saveAndExitTextOperation(page, beforeRevision);
  const saved = await readPublishedWorkingCopy(workingCopyPath, "utf8");
  expectFormattedMarker(saved, marker);
  return {
    marker,
    formatTransitions,
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

function summarizeSourceScopeEvidence(entries, omittedOperationIds = []) {
  const checks = entries.map(({ operationId, targetId, sourceScope }) => ({
    operationId,
    targetId,
    booleanConditions: Object.fromEntries(
      Object.entries(sourceScope).filter(([, value]) => typeof value === "boolean"),
    ),
    appendedByteRange: sourceScope.appendedByteRange || null,
    changedRanges: sourceScope.changedRanges || null,
    elementRanges: sourceScope.elementRanges || null,
  }));
  const failed = checks.filter((check) => (
    Object.values(check.booleanConditions).some((value) => value !== true)
  ));
  if (failed.length) {
    const error = new Error("One or more operation-scoped source oracles failed.");
    error.code = "SOURCE_SCOPE_ORACLE_FAILED";
    error.oracle = { checks, omittedOperationIds };
    throw error;
  }
  return {
    ok: true,
    checkedOperationCount: new Set(checks.map((check) => check.operationId)).size,
    checkedTargetCount: new Set(checks.map((check) => check.targetId)).size,
    omittedOperationIds,
    checks,
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
  let page;
  let original;
  let workingCopyPath = null;
  let plans = [];
  let selectedPlans = [];
  let successful = [];
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
    page = session.page;
    await waitForProjectReady(page);
    await waitUntilEditable(page);
    workingCopyPath = await managedWorkingCopyPath(page, copyPath);
    try {
    plans = await planTextTargets(page, workingCopyPath);
    selectedPlans = plans.slice(0, TEXT_TARGET_COUNT);
    row.plannedTargets = plans.map(({ id, tag, tabId, top }) => ({ id, tag, tabId, top }));

    if (selectedPlans.length < TEXT_TARGET_COUNT) {
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
    successful = inputDelete.samples.map((sample) => ({
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
    const newline = await runTextOperation(
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
    const undoRedo = await runTextOperation(
      REAL_HTML_OPERATION_IDS.TEXT_UNDO_REDO,
      () => runUndoRedoOperation({
        page,
        workingCopyPath,
        plan: selectedPlans[0],
        fileIndex,
      }),
    );
    const format = await runTextOperation(
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
      () => summarizeSourceScopeEvidence([
        ...inputDelete.samples.map((sample) => ({
          operationId: REAL_HTML_OPERATION_IDS.TEXT_INPUT_DELETE,
          targetId: sample.plan.id,
          sourceScope: sample.sourceScope,
        })),
        {
          operationId: REAL_HTML_OPERATION_IDS.TEXT_NEWLINE,
          targetId: selectedPlans[0].id,
          sourceScope: newline.sourceScope,
        },
        ...(paste.sourceScope ? [{
          operationId: REAL_HTML_OPERATION_IDS.TEXT_PASTE,
          targetId: selectedPlans[0].id,
          sourceScope: paste.sourceScope,
        }] : []),
        {
          operationId: REAL_HTML_OPERATION_IDS.TEXT_UNDO_REDO,
          targetId: selectedPlans[0].id,
          sourceScope: undoRedo.sourceScope,
        },
        {
          operationId: REAL_HTML_OPERATION_IDS.TEXT_FORMAT,
          targetId: selectedPlans[0].id,
          sourceScope: format.sourceScope,
        },
      ], paste.sourceScope ? [] : [REAL_HTML_OPERATION_IDS.TEXT_PASTE]),
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

    await page.screenshot({ path: path.join(copyDir, "after-complex-text-edits.png"), fullPage: true });
    } catch (cause) {
      row.textError = errorDetails(cause);
      const textStage = resultReport.rowsForFile(filename).find(
        (resultRow) => resultRow.level === "stage"
          && resultRow.stageId === REAL_HTML_STAGE_IDS.TEXT_EDITING,
      );
      if (textStage?.state === "NOT_EXECUTED" && textStage.reasonCode === "NOT_STARTED") {
        resultReport.failStage(filename, REAL_HTML_STAGE_IDS.TEXT_EDITING, errorDetails(cause));
      }
      await page.keyboard.press("Escape").catch(() => {});
      await waitUntilEditable(page).catch(() => {});
    }

    await stopPageRoot(session.electronApp, session.isolatedUserData);
    session = undefined;
    writeFileSync(copyPath, original);
    session = await launchPageRoot({ activeSourcePath: copyPath });
    page = session.page;
    await waitForProjectReady(page);
    await waitUntilEditable(page);
    workingCopyPath = await managedWorkingCopyPath(page, copyPath);

    try {
    const structureFrame = await currentEditorFrame(page);
    const structureSamples = await inspectFixedStructureSamples(structureFrame);
    row.structureSamples = structureSamples;
    const copyable = structureSamples.expectedCopyable;
    const nonCopyable = structureSamples.expectedNonCopyable;
    let duplicateIds = [];
    const deferredStructureFailures = [];
    if (copyable.status === "invalid") {
      const error = new Error("The expected-copyable marker must resolve to exactly one valid target.");
      error.code = copyable.reason;
      deferredStructureFailures.push({
        operationId: REAL_HTML_OPERATION_IDS.STRUCTURE_COPYABLE,
        error,
      });
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
    } else if (copyable.status !== "invalid") {
      const copyablePlan = {
        id: copyable.sourceId,
        tag: copyable.tagName,
        tabId: null,
      };
      let originalIds;
      let copyableError = null;
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
        copyableError = cause;
      }
      if (copyableError) {
        deferredStructureFailures.push({
          operationId: REAL_HTML_OPERATION_IDS.STRUCTURE_COPYABLE,
          error: copyableError,
        });
      } else {
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
          deferredStructureFailures.push({
            operationId: REAL_HTML_OPERATION_IDS.STRUCTURE_DELETE_DUPLICATE,
            error: cause,
          });
        }
      }
    }

    if (nonCopyable.status === "invalid") {
      const error = new Error(
        "The expected-non-copyable marker must resolve to exactly one valid target.",
      );
      error.code = nonCopyable.reason;
      deferredStructureFailures.push({
        operationId: REAL_HTML_OPERATION_IDS.STRUCTURE_NON_COPYABLE,
        error,
      });
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
        deferredStructureFailures.push({
          operationId: REAL_HTML_OPERATION_IDS.STRUCTURE_NON_COPYABLE,
          error: cause,
        });
      }
    }
    for (const failure of deferredStructureFailures.reverse()) {
      recordOperationFailure(
        filename,
        REAL_HTML_STAGE_IDS.ELEMENT_STRUCTURE,
        failure.operationId,
        failure.error,
      );
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

    } catch (cause) {
      row.structureError = errorDetails(cause);
      const structureStage = resultReport.rowsForFile(filename).find(
        (resultRow) => resultRow.level === "stage"
          && resultRow.stageId === REAL_HTML_STAGE_IDS.ELEMENT_STRUCTURE,
      );
      if (
        structureStage?.state === "NOT_EXECUTED"
        && structureStage.reasonCode === "NOT_STARTED"
      ) {
        resultReport.failStage(filename, REAL_HTML_STAGE_IDS.ELEMENT_STRUCTURE, errorDetails(cause));
      }
      await page.keyboard.press("Escape").catch(() => {});
      await waitUntilEditable(page).catch(() => {});
    }

    await stopPageRoot(session.electronApp, session.isolatedUserData);
    session = undefined;
    writeFileSync(copyPath, original);
    session = await launchPageRoot({ activeSourcePath: copyPath });
    page = session.page;
    await waitForProjectReady(page);
    await waitUntilEditable(page);
    workingCopyPath = await managedWorkingCopyPath(page, copyPath);

    try {
    const runtimePlans = await planTextTargets(page, workingCopyPath, {
      limit: 1,
      requireFormatTarget: false,
    });
    const runtimePlan = runtimePlans[0] || null;
    const runtimeSecondaryPlan = runtimePlans[1] || runtimePlan;
    await page.getByRole("button", { name: "预览", exact: true }).click();
    await expect(editorFor(page).getByRole("toolbar")).toHaveCount(0);
    await page.getByRole("button", { name: "编辑", exact: true }).click();
    await waitUntilEditable(page);
    let target = null;
    if (runtimePlan) {
      target = await enterNativeEdit(page, runtimePlan);
      await expect(target).toHaveAttribute("contenteditable", /^(?:plaintext-only|true)$/u);
      await page.keyboard.press("Escape");
      row.lifecycle.push("preview-edit-reenter");
    } else {
      resultReport.notApplicableOperation(
        filename,
        REAL_HTML_STAGE_IDS.RUNTIME_IFRAME,
        REAL_HTML_OPERATION_IDS.RUNTIME_REENTER,
        { exactReason: "TEXT_TARGETS_UNAVAILABLE" },
      );
    }

    const reloadBefore = await runtimeContractSnapshot(page);
    await startRuntimeLifecycleObservation(page);
    await page.getByRole("button", { name: "更多", exact: true }).click();
    await page.getByRole("menuitem", { name: "从磁盘重新载入 HTML", exact: true }).click();
    await expect(page.locator(".workbench-chrome-status"))
      .toHaveText("页面已重新加载，可以继续编辑", { timeout: 60_000 });
    await waitUntilEditable(page);
    await waitForRuntimeReloadTerminal(page);
    const runtimeObservations = await stopRuntimeLifecycleObservation(page);
    const reloadAfter = await runtimeContractSnapshot(page);
    row.runtime = {
      ordinaryBefore: null,
      ordinaryAfter: null,
      reloadBefore,
      reloadAfter,
      observations: runtimeObservations,
    };
    const runtimeOutcomes = runtimeOperationOutcomes({
      ordinaryBefore: null,
      ordinaryAfter: null,
      reloadBefore,
      reloadAfter,
      candidateApplicable: !(
        reloadAfter.runtimePhase === "static"
        && reloadAfter.runtimeOutcome === "not-candidate"
      ),
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
      if (!runtimeSecondaryPlan) {
        resultReport.notApplicableOperation(
          filename,
          REAL_HTML_STAGE_IDS.RUNTIME_IFRAME,
          REAL_HTML_OPERATION_IDS.RUNTIME_REENTER,
          { exactReason: "TEXT_TARGETS_UNAVAILABLE" },
        );
      } else {
        target = await enterNativeEdit(page, runtimeSecondaryPlan);
        await page.keyboard.press("Escape");
        row.lifecycle.push("source-reload-reenter");
        resultReport.passOperation(
          filename,
          REAL_HTML_STAGE_IDS.RUNTIME_IFRAME,
          REAL_HTML_OPERATION_IDS.RUNTIME_REENTER,
          { sourceId: runtimeSecondaryPlan.id },
        );
      }
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
      if (!runtimePlan) {
        resultReport.notApplicableOperation(
          filename,
          REAL_HTML_STAGE_IDS.RUNTIME_IFRAME,
          REAL_HTML_OPERATION_IDS.RUNTIME_REOPEN,
          { exactReason: "TEXT_TARGETS_UNAVAILABLE" },
        );
      } else {
        await clickAuthoredTab(session.page, runtimePlan.tabId);
        const reopenedTarget = (await currentEditorFrame(session.page)).locator(
          `[data-pageroot-id="${runtimePlan.id}"]`,
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
          { targetCount: 1 },
        );
      }
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
    } catch (cause) {
      row.runtimeError = errorDetails(cause);
      const runtimeStage = resultReport.rowsForFile(filename).find(
        (resultRow) => resultRow.level === "stage"
          && resultRow.stageId === REAL_HTML_STAGE_IDS.RUNTIME_IFRAME,
      );
      if (
        runtimeStage?.state === "NOT_EXECUTED"
        && runtimeStage.reasonCode === "NOT_STARTED"
      ) {
        resultReport.failStage(filename, REAL_HTML_STAGE_IDS.RUNTIME_IFRAME, errorDetails(cause));
      }
      await page.keyboard.press("Escape").catch(() => {});
      await waitUntilEditable(page).catch(() => {});
    }

    const failedStages = resultReport.rowsForFile(filename).filter(
      (resultRow) => resultRow.level === "stage" && resultRow.state === "FAIL",
    );
    if (failedStages.length > 0) {
      resultReport.failFile(filename, {
        exactReason: "CATEGORY_FAILED",
        failedStages: failedStages.map((stage) => stage.stageId),
      });
    } else {
      resultReport.passFile(filename, {
        textTargets: successful.length,
        structureCycles: row.structureCycles.length,
        lifecycle: row.lifecycle,
      });
    }
  } catch (cause) {
    row.error = String(cause?.stack || cause);
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
