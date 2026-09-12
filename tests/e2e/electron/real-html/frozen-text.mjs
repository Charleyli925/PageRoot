import { expect } from "@playwright/test";
import { keyShortcut, waitForRuntimeHandoffSettled } from "../electron-native-harness.mjs";
import { compareElementScopedMutation, compareElementStyleMutation, SOURCE_SCOPE_POLICIES } from "./source-scope.mjs";
import { frozenDigest, frozenFrameAccess } from "./frozen-selection.mjs";
import { summarizeRuntimeObserverRecords } from "./runtime-observer.mjs";

function requireFact(condition, code, details) {
  if (!condition) throw Object.assign(new Error(code), { code, details });
}

export function boldMarkerPattern(marker, bold) {
  const escaped = marker.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(` <span style="all:\\s*unset;\\s*display:\\s*inline\\s*!important;\\s*font-weight:\\s*${bold ? "700" : "(?:400|normal)"}" data-pageroot-id="pr1_[0-9a-f]{32}">${escaped}</span>`, "u");
}

async function markerBold(handle, marker) {
  return handle.evaluate((element, expected) => {
    const walker = element.ownerDocument.createTreeWalker(element, 4);
    const matches = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.textContent.includes(expected)) matches.push(node);
    }
    if (matches.length !== 1) return null;
    const weight = element.ownerDocument.defaultView.getComputedStyle(matches[0].parentElement).fontWeight;
    return weight === "bold" || Number(weight) >= 600;
  }, marker);
}

// The Document is captured once, not rediscovered after an unexpected rebuild.
export async function requireCurrentTextDocument(frame, documentHandle, targetHandle) {
  let conditions;
  try {
    conditions = await frame.evaluate(([expectedDocument, target]) => ({
      currentDocument: document === expectedDocument,
      targetInCurrentDocument: target.ownerDocument === document,
      connected: target.isConnected,
    }), [documentHandle, targetHandle]);
  } catch (cause) {
    throw Object.assign(new Error("FROZEN_TEXT_DOCUMENT_REPLACED", { cause }), {
      code: "FROZEN_TEXT_DOCUMENT_REPLACED", details: { contextUnavailable: true },
    });
  }
  requireFact(Object.values(conditions).every(Boolean), "FROZEN_TEXT_DOCUMENT_REPLACED", conditions);
  return conditions;
}

export async function requireFrozenTextFocus(targetHandle, expectedId, { atEnd = false } = {}) {
  const actual = await targetHandle.evaluate((element) => {
    const document = element.ownerDocument;
    const selection = document.getSelection();
    const inside = selection?.rangeCount === 1
      && element.contains(selection.anchorNode) && element.contains(selection.focusNode);
    let remainingLength = null;
    if (inside && selection.isCollapsed) {
      const remaining = document.createRange();
      remaining.selectNodeContents(element);
      remaining.setStart(selection.focusNode, selection.focusOffset);
      remainingLength = remaining.toString().length;
    }
    return { id: element.getAttribute("data-pageroot-id"),
      activeId: document.activeElement?.getAttribute("data-pageroot-id"),
      editable: element.isContentEditable, focused: document.activeElement === element,
      selectionInside: inside, collapsed: selection?.isCollapsed === true, remainingLength };
  });
  const conditions = { identityMatches: actual.id === expectedId,
    focusMatches: actual.activeId === expectedId && actual.focused,
    editable: actual.editable, selectionInside: actual.selectionInside,
    caretAtEnd: !atEnd || (actual.collapsed && actual.remainingLength === 0) };
  requireFact(Object.values(conditions).every(Boolean), "FROZEN_TEXT_FOCUS_MISMATCH", { actual, conditions });
  return { actual, conditions };
}

export function requireTextOperationLedger(rows, planned) {
  const conditions = {
    complete: rows.length === planned.length,
    exactSequence: rows.every((row, index) => row.operation === planned[index]),
    allPassed: rows.every((row) => row.state === "PASS"),
    reasonsPresent: rows.every((row) => typeof row.reason === "string" && row.reason.length > 0),
    durationRecorded: rows.every((row) => Number.isFinite(row.durationMs) && row.durationMs >= 0),
  };
  requireFact(Object.values(conditions).every(Boolean), "FROZEN_TEXT_LEDGER_INVALID", conditions);
  return conditions;
}

export function verifyFrozenHistory({ expectedPath, before, after, sourceHash, records }) {
  const facts = summarizeRuntimeObserverRecords(records);
  const candidateIds = [...new Set(records.filter((row) => row.kind === "candidate-created").map((row) => row.candidateId))];
  const rebuild = expectedPath === "runtime-candidate";
  const conditions = {
    knownExpectedPath: ["runtime-candidate", "editable-island-in-place"].includes(expectedPath),
    pathMatches: after.path === expectedPath,
    sourceMatches: after.working === sourceHash && after.displayed === sourceHash,
    documentKnown: Boolean(before.documentId && after.documentId),
    generationKnown: Number(before.generation) > 0 && Number(after.generation) > 0,
    documentMatches: rebuild ? before.documentId !== after.documentId : before.documentId === after.documentId,
    generationMatches: rebuild ? Number(after.generation) > Number(before.generation) : after.generation === before.generation,
    requestMatches: !rebuild || (facts.request?.sourceRevision === sourceHash && Boolean(facts.request?.reason)),
    candidateMatches: rebuild ? candidateIds.length === 1 && facts.candidate?.sourceRevision === sourceHash : candidateIds.length === 0,
    candidateReady: !rebuild || facts.candidateTerminal?.terminal === "ready",
    generationObserved: !rebuild || records.some((row) => row.kind === "generation"
      && row.beforeGeneration === before.generation && row.afterGeneration === after.generation),
    activeMatches: !rebuild || (facts.activeIdentity?.candidateId === facts.candidateId
      && facts.activeIdentity?.generation === after.generation),
    runtimeReady: !rebuild || (facts.runtimeTerminal?.phase === "settled" && facts.runtimeTerminal?.terminal === "ready"
      && facts.runtimeTerminal?.candidateId === facts.candidateId),
    noRejectedCandidate: !records.some((row) => row.kind === "candidate-terminal" && row.terminal !== "ready"),
  };
  requireFact(Object.values(conditions).every(Boolean), "FROZEN_HISTORY_ADOPTION_INVALID",
    { conditions, expectedPath, before, after, facts });
  return { conditions, path: after.path, candidateId: facts.candidateId, generation: after.generation };
}

export async function readFrozenActiveGeneration(editor) {
  const active = editor.locator('iframe[data-runtime-slot-role="active"]');
  requireFact(await active.count() === 1, "FROZEN_ACTIVE_FRAME_NOT_UNIQUE");
  const generation = await active.getAttribute("data-frame-generation");
  requireFact(/^[1-9]\d*$/u.test(generation || ""), "FROZEN_ACTIVE_GENERATION_MISSING", { generation });
  return generation;
}

export function verifyEndedHistorySession(actual) {
  const conditions = { sessionEnded: actual.sessionEnded === true,
    hostNotEditable: actual.editable === false, focusIsBody: actual.focusIsBody === true,
    selectionOutside: actual.selectionInside === false };
  requireFact(Object.values(conditions).every(Boolean), "FROZEN_HISTORY_SESSION_END_INVALID", { actual, conditions });
  return { actual, conditions };
}

// Six fixed operations on the same frozen leaf. No target enumeration or fallback.
export async function executeFrozenText({ frame, target, access, page, editor,
  fileId, readSource, rows, calls }) {
  let locator = access.target(target.selectedId);
  requireFact(await locator.count() === 1, "FROZEN_IDENTITY_COUNT_MISMATCH");
  let handle = await locator.elementHandle();
  let documentHandle = await frame.evaluateHandle(() => document);
  const before = await readSource();
  const beforeText = await handle.textContent();
  const marker = ` PRCORE_${fileId}`;
  requireFact(!before.toString().includes(marker), "FROZEN_MARKER_ALREADY_PRESENT");
  let saved;
  let generation = await readFrozenActiveGeneration(editor);
  const documentId = () => frame.evaluate(() =>
    globalThis.__PAGEROOT_NATIVE_QA_DOCUMENT_TOKEN__ ||= crypto.randomUUID());
  const conditions = async () => {
    await requireCurrentTextDocument(frame, documentHandle, handle);
    const actualGeneration = await readFrozenActiveGeneration(editor);
    requireFact(actualGeneration === generation,
      "UNEXPECTED_TEXT_REBUILD", { expectedGeneration: generation, actualGeneration });
  };
  const sourceScope = (after) => {
    const oracle = compareElementScopedMutation({ before, after, sourceId: target.selectedId,
      normalizationPolicy: SOURCE_SCOPE_POLICIES.TEXT_INPUT_DELETE,
      expectedAfterContains: [marker], expectedAppendedPattern: new RegExp(marker, "u") });
    requireFact(oracle.ok, "SOURCE_SCOPE_ORACLE_FAILED", oracle);
    return { changedRanges: oracle.changedRanges, outsideUnchanged: oracle.outsideUnchanged,
      appendedShapeValid: oracle.appendedShapeValid, sourceIdentityValid: oracle.sourceIdentityValid };
  };
  const history = async (shortcut, expectedBytes) => {
    const expectedPath = target.historyAdoption || "editable-island-in-place";
    const before = { documentId: await documentId(), generation };
    const cursor = await editor.evaluate(() => {
      const state = globalThis.__PAGEROOT_REAL_HTML_RUNTIME_OBSERVER__;
      return { candidate: state.records.length, lifecycle: state.lifecycleRecords.length };
    });
    await page.keyboard.press(keyShortcut(shortcut));
    await expect.poll(async () => (await readSource()).equals(expectedBytes), { timeout: 5_000 }).toBe(true);
    const sourceHash = `sha256:${frozenDigest(expectedBytes)}`;
    // Disk publication is not history adoption. Reuse the existing settled
    // handoff boundary before sending the next user operation.
    const settled = await waitForRuntimeHandoffSettled(page, { timeout: 5_000,
      expectedSourceRevision: sourceHash, priorGeneration: Number(generation),
      requireGenerationAdvance: expectedPath === "runtime-candidate" });
    const observation = await editor.evaluate((element, cursor) => {
      const state = globalThis.__PAGEROOT_REAL_HTML_RUNTIME_OBSERVER__;
      return { path: element.getAttribute("data-history-adopt-path"),
        records: [...state.records.slice(cursor.candidate), ...state.lifecycleRecords.slice(cursor.lifecycle)] };
    }, cursor);
    if (expectedPath === "runtime-candidate") {
      const active = editor.locator('iframe[data-runtime-slot-role="active"]');
      requireFact(await active.count() === 1, "FROZEN_ACTIVE_FRAME_NOT_UNIQUE");
      frame = await (await active.elementHandle()).contentFrame();
    }
    const proof = verifyFrozenHistory({ expectedPath, before, sourceHash, records: observation.records,
      after: { documentId: await documentId(), generation: settled.activeFrameGeneration, path: observation.path,
        working: settled.workingProjectionSha256, displayed: settled.renderedProjectionSha256 } });
    if (expectedPath === "runtime-candidate") {
      await handle.dispose(); await documentHandle.dispose();
      access = frozenFrameAccess(frame, target, calls);
      locator = access.target(target.selectedId);
      requireFact(await locator.count() === 1, "FROZEN_IDENTITY_COUNT_MISMATCH");
      handle = await locator.elementHandle();
      requireFact(await handle.evaluate((element) => element.localName) === target.selectedTag, "FROZEN_IDENTITY_TAG_MISMATCH");
      documentHandle = await frame.evaluateHandle(() => document);
      generation = settled.activeFrameGeneration;
    }
    // Observe before any click. Runtime handoff deliberately ends Native Edit;
    // the separately planned reentry operation is not an implicit repair here.
    let focus;
    if (target.historyResume === "explicit-reentry") {
      await editor.evaluate(element => element.dispatchEvent(new Event("pageroot:e2e-copy-capability-probe")));
      const actual = await handle.evaluate(element => {
        const document = element.ownerDocument;
        const selection = document.getSelection();
        return { editable: element.isContentEditable, focusIsBody: document.activeElement === document.body,
          selectionInside: Boolean(selection?.anchorNode && element.contains(selection.anchorNode)) };
      });
      actual.sessionEnded = await editor.getAttribute("data-e2e-copy-native-edit-ended") === "true";
      focus = verifyEndedHistorySession(actual);
    } else focus = await requireFrozenTextFocus(handle, target.selectedId, { atEnd: true });
    return { sourceSha256: frozenDigest(expectedBytes), history: proof, focus };
  };
  const record = async (operation, expected, action) => {
    const row = rows.find((item) => item.operation === operation);
    const started = performance.now();
    try {
      await conditions();
      row.expected = expected;
      row.actual = await action();
      await conditions();
      Object.assign(row, { state: "PASS", reason: "EXPECTED_CHANGE_OBSERVED" });
    } catch (error) {
      Object.assign(row, { state: "FAIL", reason: error.code || "OPERATION_ASSERTION_FAILED",
        details: error.details });
      throw error;
    } finally { row.durationMs = performance.now() - started; }
  };
  const activate = async () => {
      const position = await handle.evaluate((element, path) => {
        const first = element.firstChild;
        if ((!path && element.childNodes.length !== 1) || (path && JSON.stringify(path) !== "[0]")
          || first?.nodeType !== 3 || !first.textContent?.trim()) return null;
        const range = element.ownerDocument.createRange();
        range.setStart(first, 0); range.setEnd(first, 1);
        const rect = range.getBoundingClientRect();
        const outer = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0
          ? { x: rect.left - outer.left + rect.width / 2, y: rect.top - outer.top + rect.height / 2 } : null;
      }, target.textNodePath || null);
      requireFact(position, "FROZEN_TEXT_PLAIN_LEAF_DRIFT");
      await handle.dblclick({ position, timeout: 3_000 });
      await expect(locator).toHaveAttribute("contenteditable", /^(?:true|plaintext-only)$/u, { timeout: 2_000 });
      // Native caret positioning, not a synthetic selection assignment.
      await page.keyboard.press(keyShortcut("ArrowDown"));
      return requireFrozenTextFocus(handle, target.selectedId, { atEnd: true });
  };
  try {
    await record("activate", { editableId: target.selectedId }, activate);
    await record("input", { appended: `${marker}X` }, async () => {
      await requireFrozenTextFocus(handle, target.selectedId, { atEnd: true });
      await page.keyboard.type(`${marker}X`);
      const actual = await handle.textContent();
      requireFact(actual === `${beforeText}${marker}X`, "FROZEN_INPUT_LANDING_MISMATCH", { actual });
      return { appended: `${marker}X`, focusedId: target.selectedId };
    });
    await record("backspace", { removed: "X" }, async () => {
      await requireFrozenTextFocus(handle, target.selectedId, { atEnd: true });
      await page.keyboard.press("Backspace");
      requireFact(await handle.textContent() === `${beforeText}${marker}`, "FROZEN_DELETE_MISMATCH");
      return { removed: "X" };
    });
    await record("save", { sourceContains: marker }, async () => {
      await page.keyboard.press(keyShortcut("s"));
      await expect.poll(async () => (await readSource()).toString().includes(marker), { timeout: 5_000 }).toBe(true);
      const indicator = page.locator("[data-persist-state]").first();
      await expect(indicator).toHaveAttribute("data-persist-state", "idle", { timeout: 5_000 });
      saved = await readSource();
      const oracle = sourceScope(saved);
      // Save is a soft checkpoint. Ending the session here removes the history
      // bookmark and would test the separate fresh-frame history fallback.
      const focus = await requireFrozenTextFocus(handle, target.selectedId, { atEnd: true });
      return { sourceSha256: frozenDigest(saved), sessionPreserved: focus.conditions.focusMatches, ...oracle };
    });
    await record("undo", { sourceSha256: frozenDigest(before) }, async () => {
      return history("z", before);
    });
    if (target.historyResume === "explicit-reentry") {
      await record("resume-after-undo", { editableId: target.selectedId }, activate);
    }
    await record("redo", { sourceSha256: frozenDigest(saved) }, async () => {
      const adoption = await history("Shift+z", saved);
      const after = await readSource();
      return { ...adoption, ...sourceScope(after) };
    });
    if (target.historyResume === "explicit-reentry") {
      await record("resume-after-redo", { editableId: target.selectedId }, activate);
    }
    if (target.operations.includes("bold") && target.formatCapability.scope === "element") {
      let formatBaseline = saved;
      const button = editor.getByRole("button", { name: "加粗", exact: true });
      const bold = () => handle.evaluate(element => {
        const weight = element.ownerDocument.defaultView.getComputedStyle(element).fontWeight;
        return weight === "bold" || Number(weight) >= 600;
      });
      const saveStyle = async (expectedValue) => {
        await page.keyboard.press(keyShortcut("s"));
        let oracle;
        const read = async () => {
          const after = await readSource();
          oracle = compareElementStyleMutation({ before: formatBaseline, after, sourceId: target.selectedId,
            expectedProperty: "font-weight", expectedValue });
          if (oracle.ok) saved = after;
          return oracle.ok;
        };
        try { await expect.poll(read, { timeout: 5_000 }).toBe(true); }
        catch { requireFact(false, "SOURCE_SCOPE_ORACLE_FAILED", oracle); }
        return { changedRanges: oracle.changedRanges, outsideUnchanged: oracle.outsideElementUnchanged,
          contentUnchanged: oracle.elementContentAndClosingUnchanged, changedProperties: oracle.changedProperties };
      };
      await record("prepare-unbold", { bold: false, initialBold: target.initialBold, scope: "element" }, async () => {
        await page.keyboard.press("Escape");
        await handle.click({ timeout: 3_000 });
        await expect(access.selected()).toHaveCount(1);
        await expect(access.selected()).toHaveAttribute("data-pageroot-id", target.selectedId);
        requireFact(await bold() === target.initialBold, "FROZEN_FORMAT_INITIAL_STATE_DRIFT");
        await expect(button).toHaveAttribute("aria-pressed", String(target.initialBold));
        let source;
        if (target.initialBold) {
          await button.click();
          await expect(button).toHaveAttribute("aria-pressed", "false");
          source = await saveStyle("normal");
        }
        requireFact(await bold() === false, "FROZEN_UNBOLD_PREPARATION_FAILED");
        return { bold: false, scope: "element", source };
      });
      await record("bold", { from: false, to: true, scope: "element" }, async () => {
        // Preparation is a separate verified operation. In later mixed cycles
        // the text baseline is already bold; compare this change with unbold.
        formatBaseline = saved;
        requireFact(await bold() === false, "FROZEN_BOLD_INITIAL_STATE_INVALID");
        await expect(button).toHaveAttribute("aria-pressed", "false");
        await button.click();
        await expect(button).toHaveAttribute("aria-pressed", "true");
        const source = await saveStyle("700");
        requireFact(await bold() === true, "FROZEN_BOLD_NOT_APPLIED");
        return { from: false, to: true, scope: "element", ...source };
      });
    } else if (target.operations.includes("bold")) {
      const token = marker.slice(1);
      const selectMarker = async () => {
        await page.keyboard.press(keyShortcut("ArrowDown"));
        await page.keyboard.down("Shift");
        for (let index = 0; index < token.length; index += 1) await page.keyboard.press("ArrowLeft");
        await page.keyboard.up("Shift");
        requireFact(await handle.evaluate((element) => element.ownerDocument.getSelection()?.toString()) === token,
          "FROZEN_FORMAT_SELECTION_MISMATCH");
      };
      const button = editor.getByRole("button", { name: "加粗", exact: true });
      await record("prepare-unbold", { bold: false, initialBold: target.initialBold }, async () => {
        const initial = await markerBold(handle, token);
        requireFact(initial === target.initialBold, "FROZEN_FORMAT_INITIAL_STATE_DRIFT", { expected: target.initialBold, actual: initial });
        await selectMarker();
        await expect(button).toBeEnabled({ timeout: 2_000 });
        await expect(button).toHaveAttribute("aria-pressed", String(target.initialBold));
        if (target.initialBold) {
          await button.click();
          await expect.poll(() => markerBold(handle, token)).toBe(false);
          await page.keyboard.press(keyShortcut("s"));
          await expect.poll(async () => boldMarkerPattern(token, false).test((await readSource()).toString())).toBe(true);
          const oracle = compareElementScopedMutation({ before, after: await readSource(), sourceId: target.selectedId,
            normalizationPolicy: SOURCE_SCOPE_POLICIES.TEXT_FORMAT, expectedAfterContains: [token],
            expectedAppendedPattern: boldMarkerPattern(token, false) });
          requireFact(oracle.ok, "SOURCE_SCOPE_ORACLE_FAILED", oracle);
        }
        requireFact(await markerBold(handle, token) === false, "FROZEN_UNBOLD_PREPARATION_FAILED");
        return { bold: false, normalized: target.initialBold };
      });
      await record("bold", { from: false, to: true }, async () => {
        await selectMarker();
        requireFact(await markerBold(handle, token) === false, "FROZEN_BOLD_INITIAL_STATE_INVALID");
        await expect(button).toHaveAttribute("aria-pressed", "false");
        await button.click();
        await expect(button).toHaveAttribute("aria-pressed", "true");
        await expect.poll(() => markerBold(handle, token)).toBe(true);
        await page.keyboard.press(keyShortcut("s"));
        await expect.poll(async () => boldMarkerPattern(token, true).test((await readSource()).toString())).toBe(true);
        saved = await readSource();
        const oracle = compareElementScopedMutation({ before, after: saved, sourceId: target.selectedId,
          normalizationPolicy: SOURCE_SCOPE_POLICIES.TEXT_FORMAT, expectedAfterContains: [token],
          expectedAppendedPattern: boldMarkerPattern(token, true) });
        requireFact(oracle.ok, "SOURCE_SCOPE_ORACLE_FAILED", oracle);
        return { from: false, to: true, changedRanges: oracle.changedRanges, outsideUnchanged: oracle.outsideUnchanged };
      });
    }
    return { state: "PASS", ledger: requireTextOperationLedger(rows, target.operations),
      finalSha256: frozenDigest(saved), finalSize: saved.length };
  } finally {
    await handle.dispose();
    await documentHandle.dispose();
  }
}
