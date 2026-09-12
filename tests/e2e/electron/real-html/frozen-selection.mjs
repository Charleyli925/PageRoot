import { createHash } from "node:crypto";
import { expect } from "@playwright/test";

const ID = /^pr1_[a-f0-9]{32}$/u;
const HASH = /^[a-f0-9]{64}$/u;
export const frozenDigest = (value) => createHash("sha256").update(value).digest("hex");
export const FROZEN_TEXT_OPERATIONS = Object.freeze([
  "activate", "input", "backspace", "save", "undo", "redo",
]);
export const FROZEN_FORMAT_OPERATIONS = Object.freeze([...FROZEN_TEXT_OPERATIONS, "prepare-unbold", "bold"]);
export const FROZEN_REENTRY_FORMAT_OPERATIONS = Object.freeze([
  "activate", "input", "backspace", "save", "undo", "resume-after-undo", "redo", "resume-after-redo", "prepare-unbold", "bold",
]);
export const FROZEN_STRUCTURE_OPERATIONS = Object.freeze([
  "copy", "select-copy", "activate-copy", "input-copy", "save-copy", "select-copy-for-delete", "delete-copy",
]);
export const FROZEN_COPY_DENIED_OPERATIONS = Object.freeze(["verify-copy-denied"]);
export const FROZEN_STRUCTURE_PROBE_OPERATIONS = Object.freeze([
  "copy", "probe-after-copy", ...FROZEN_STRUCTURE_OPERATIONS.slice(1), "probe-after-delete",
]);

export function assertReadOnlyCorpusMode(mode) {
  requireFact(mode === "capability-preflight-only", "AUTOMATIC_DISCOVERY_EXECUTION_RETIRED");
}

export function frozenInitialRuntimeDecision(actual, expected) {
  requireFact(["runtime", "static"].includes(expected), "FROZEN_INITIAL_RUNTIME_EXPECTATION_INVALID");
  const ready = expected === "runtime" ? actual.phase === "settled" && actual.outcome === "ready"
    : actual.phase === "static" && actual.outcome === "not-candidate";
  const pending = ["preparing", "ready", "running"].includes(actual.phase)
    || (actual.phase === "static" && actual.outcome === "source-not-authoritative");
  return { state: ready ? "READY" : pending ? "WAIT" : "REJECTED",
    expected, actual, reason: ready ? "EXPECTED_INITIAL_RUNTIME_TERMINAL" : pending
      ? "INITIAL_RUNTIME_STILL_PREPARING" : "UNEXPECTED_INITIAL_RUNTIME_TERMINAL" };
}

function requireFact(condition, code, details = {}) {
  if (!condition) throw Object.assign(new Error(code), { code, details });
}

export function readFrozenSelection(bytes, expectedDigest) {
  requireFact(HASH.test(expectedDigest || "") && frozenDigest(bytes) === expectedDigest,
    "FROZEN_MANIFEST_DIGEST_MISMATCH");
  const plan = JSON.parse(bytes.toString("utf8"));
  if (plan.scope === "core-three-cycle" || plan.scope === "core-pressure-20") {
    requireFact(plan.operation === "mixed" && plan.initialRuntime === "runtime" && plan.reopen === true
      && plan.cycles === (plan.scope === "core-pressure-20" ? 20 : 3)
      && Array.isArray(plan.targets) && plan.targets.length === 2,
    "FROZEN_MIXED_PLAN_INVALID");
    // Reuse the existing ingress contracts, not another target fact store.
    const checked = [["core-text-format", "native-text"], ["core-structure-leaf", "structure"]]
      .map(([scope, operation], index) => {
        const bytes = Buffer.from(JSON.stringify({ ...plan, scope, operation, targets: [plan.targets[index]] }));
        return readFrozenSelection(bytes, frozenDigest(bytes)).targets[0];
      });
    requireFact(checked[0].selectedId !== checked[1].selectedId && checked[0].initialBold === false
      && checked[0].formatCapability.scope === "element" && checked[0].historyAdoption === "editable-island-in-place"
      && checked[1].rebuildPath === "runtime-candidate" && checked[1].continuationProbe === "session-ended-no-refocus"
      && plan.commentBasis === "EXACT_AUTHORED_SOURCE_ANCHOR"
      && HASH.test(plan.structurePrefixSha256 || ""), "FROZEN_MIXED_CONTRACT_INVALID");
    plan.targets = Object.freeze(checked);
    Object.freeze(plan.original); Object.freeze(plan.seed);
    return Object.freeze(plan);
  }
  const formatCore = plan.scope === "core-text-format";
  const structureCore = plan.scope === "core-structure-leaf";
  const copyDenied = plan.scope === "core-copy-denied";
  const textMicro = plan.scope === "native-text-core-micro" || formatCore;
  requireFact(plan.schemaVersion === 1 && (plan.scope === "single-selection-micro" || textMicro || structureCore || copyDenied)
    && plan.reviewStatus === "FROZEN" && plan.reviewedBy === "root",
  "FROZEN_MANIFEST_NOT_REVIEWED");
  requireFact(/^H\d{2}$/u.test(plan.fileId || "")
    && ["runtime", "static"].includes(plan.initialRuntime)
    && plan.operation === (textMicro ? "native-text" : structureCore ? "structure" : copyDenied ? "copy-denied" : "select")
    && Array.isArray(plan.targets) && plan.targets.length === 1,
  "FROZEN_OPERATION_PLAN_INVALID");
  const target = plan.targets[0];
  requireFact(ID.test(target.clickId) && ID.test(target.selectedId)
    && /^[a-z][a-z0-9-]*$/u.test(target.clickTag)
    && /^[a-z][a-z0-9-]*$/u.test(target.selectedTag), "FROZEN_IDENTITY_INVALID");
  requireFact(target.mapping === (target.clickId === target.selectedId ? "self" : "authored-ancestor")
    && target.expectedCapability === "AVAILABLE"
    && target.contractReason === "UNIQUE_REACHABLE_AUTHORED_TARGET"
    && target.sourceProof === "REVIEWED_EXACT_SEED"
    && target.tabId === null && target.scrollContainer === "document",
  "FROZEN_TARGET_CONTRACT_INVALID");
  requireFact(copyDenied || target.selectionPoint === undefined, "FROZEN_POINTER_SCOPE_INVALID");
  if (copyDenied) {
    const proof = target.denialEvidence;
    const boundary = target.copyCapability?.basis === "REVIEWED_AUTHORED_COPY_BOUNDARY";
    const point = target.selectionPoint;
    if (boundary) {
      const attribute = proof?.kind === "attribute-extra" && ["style", "viewBox", "_echarts_instance_"].includes(proof.attribute);
      requireFact(["attribute-extra", "opaque-canvas", "empty-container-populated"].includes(proof?.kind)
        && ID.test(proof.witnessId) && /^[a-z][a-z0-9-]*$/u.test(proof.witnessTag || "")
        && /^root(?:\/[a-z][a-z0-9-]*\[\d+\])*$/u.test(proof.diagnosticPath || "")
        && (attribute || (proof.kind !== "attribute-extra" && proof.attribute === undefined))
        && (proof.kind !== "opaque-canvas" || proof.witnessTag === "canvas")
        && target.copyCapability.diagnostic === `${proof.diagnosticPath}:${attribute ? `attribute-extra:${proof.attribute.toLowerCase()}`
          : proof.kind === "opaque-canvas" ? "opaque-or-program" : "child-count"}`
        && Number.isFinite(point?.x) && point.x > 0 && Number.isFinite(point.y) && point.y > 0
        && ID.test(point.expectedHitId)
        && ["direct-authored-hit", "dedicated-canvas-through-parent"].includes(point.basis)
        && (point.basis === "direct-authored-hit" ? point.expectedHitId === target.clickId
          : target.selectedTag === "canvas" && proof.kind === "opaque-canvas" && point.expectedHitId !== target.clickId),
      "FROZEN_COPY_BOUNDARY_CONTRACT_INVALID");
      Object.freeze(point);
    }
    requireFact(target.mapping === "self" && target.clickTag === target.selectedTag
      && plan.initialRuntime === "runtime" && plan.reopen === false
      && target.copyCapability?.expected === "UNSUPPORTED"
      && target.copyCapability?.reason === "runtime-subtree-diverged"
      && (boundary || (target.copyCapability?.basis === "REVIEWED_RUNTIME_ATTRIBUTE_DIVERGENCE"
      && point === undefined && /^data-[a-z0-9-]+$/u.test(proof?.attribute || "")
      && !/^data-(?:html-canvas-|pageroot-edit-runtime-|runtime-)/u.test(proof.attribute)
      && proof.attribute !== "data-pageroot-v2-editing"
      && typeof proof?.value === "string" && proof.value.length > 0
      && target.copyCapability?.diagnostic === `root:attribute-extra:${proof.attribute}`))
      && HASH.test(proof?.sourceElementSha256 || "")
      && JSON.stringify(target.operations) === JSON.stringify(FROZEN_COPY_DENIED_OPERATIONS),
    "FROZEN_COPY_DENIED_CONTRACT_INVALID");
    for (const value of [proof, target.copyCapability, target.operations]) Object.freeze(value);
  }
  if (structureCore) {
    const binding = target.copyBinding;
    requireFact(target.mapping === "self" && ["span", "p"].includes(target.selectedTag)
      && target.clickTag === target.selectedTag && plan.reopen === true
      && target.copyCapability?.expected === "AVAILABLE"
      && target.copyCapability?.basis === "REVIEWED_SOURCE_EQUIVALENT_LEAF"
      && target.copyCapability?.reason === "available"
      && target.textCapability?.basis === "SOURCE_EDITABLE_ISLAND_PLAIN_LEAF"
      && target.textCapability?.expected === "AVAILABLE"
      && binding?.kind === "inserted-leaf-at-frozen-source-offset"
      && ID.test(binding.parentId) && (binding.beforeSiblingId === null || ID.test(binding.beforeSiblingId))
      && Number.isSafeInteger(binding.byteOffset) && binding.byteOffset > 0
      && HASH.test(binding.originalElementSha256 || "")
      && ["runtime-candidate", "static-rebuild"].includes(target.rebuildPath)
      && (target.continuationProbe === undefined || target.continuationProbe === "session-ended-no-refocus")
      && JSON.stringify(target.operations) === JSON.stringify(target.continuationProbe
        ? FROZEN_STRUCTURE_PROBE_OPERATIONS : FROZEN_STRUCTURE_OPERATIONS),
    "FROZEN_STRUCTURE_CONTRACT_INVALID");
    for (const value of [binding, target.copyCapability, target.textCapability, target.operations]) Object.freeze(value);
  }
  if (textMicro) {
    requireFact(target.mapping === "self" && target.selectedTag === "p"
      && target.textCapability?.expected === "AVAILABLE"
      && target.textCapability?.basis === (formatCore ? "SOURCE_EDITABLE_ISLAND" : "SOURCE_EDITABLE_ISLAND_PLAIN_LEAF")
      && target.textCapability?.clickPoint === "first-direct-text-character"
      && JSON.stringify(target.operations) === JSON.stringify(formatCore
        ? target.historyAdoption === "runtime-candidate" ? FROZEN_REENTRY_FORMAT_OPERATIONS : FROZEN_FORMAT_OPERATIONS
        : FROZEN_TEXT_OPERATIONS)
      && (formatCore || (target.historyAdoption === undefined && target.historyBasis === undefined && target.historyResume === undefined))
      && (!formatCore || (typeof target.initialBold === "boolean"
        && JSON.stringify(target.textNodePath) === "[0]" && plan.reopen === true
        && ["editable-island-in-place", "runtime-candidate"].includes(target.historyAdoption)
        && target.historyResume === (target.historyAdoption === "runtime-candidate" ? "explicit-reentry" : "in-place")
        && ["text-range", "element"].includes(target.formatCapability?.scope)
        && target.formatCapability?.expected === "AVAILABLE"
        && target.formatCapability?.basis === (target.formatCapability?.scope === "element"
          ? "SOURCE_ELEMENT_STYLE_NO_NEW_WRAPPER" : "SOURCE_SAFE_TEXT_RANGE_WRAPPER")
        && target.historyBasis === (target.historyAdoption === "runtime-candidate"
          ? "REVIEWED_CANONICAL_MAPPING_FALLBACK" : "REVIEWED_CANONICAL_ISLAND"))),
    "FROZEN_TEXT_CONTRACT_INVALID");
    if (formatCore) Object.freeze(target.textNodePath);
    if (formatCore) Object.freeze(target.formatCapability);
    Object.freeze(target.operations);
    Object.freeze(target.textCapability);
  }
  for (const file of [plan.original, plan.seed]) {
    requireFact(typeof file?.path === "string" && HASH.test(file.sha256 || "")
      && Number.isInteger(file.size) && file.size > 0, "FROZEN_SOURCE_BINDING_INVALID");
  }
  requireFact(HASH.test(plan.workspaceSourceSha256 || ""), "FROZEN_PROVENANCE_MISSING");
  for (const value of [target, plan.targets, plan.original, plan.seed, plan]) Object.freeze(value);
  return plan;
}

export function verifyFrozenBytes(bytes, expected, code) {
  const conditions = {
    hashMatches: frozenDigest(bytes) === expected.sha256,
    sizeMatches: bytes.length === expected.size,
  };
  requireFact(Object.values(conditions).every(Boolean), code, conditions);
  return conditions;
}

export function verifyFrozenDisplay(display, seed) {
  const expected = `sha256:${seed.sha256}`;
  const conditions = { workingMatches: display.working === expected,
    displayedMatches: display.displayed === expected };
  requireFact(Object.values(conditions).every(Boolean), "FROZEN_DISPLAY_SOURCE_MISMATCH", conditions);
  return conditions;
}

// This interface exposes exact target lookup and selection-state observation only.
// Discovery, replacement and mapping inference are not available to the executor.
export function frozenFrameAccess(frame, target, calls) {
  const ids = new Set([target.clickId, target.selectedId]);
  return Object.freeze({
    target(id) {
      calls.push({ kind: "exact-target-lookup", id });
      requireFact(ids.has(id), "UNPLANNED_TARGET_LOOKUP", { id });
      return frame.locator(`[data-pageroot-id="${id}"]`);
    },
    selected() {
      calls.push({ kind: "selection-state-read" });
      return frame.locator("[data-html-canvas-selected]");
    },
  });
}

export function selectionExecutionIssues(calls, target) {
  const issues = [];
  const lookups = calls.filter((call) => call.kind === "exact-target-lookup");
  if (lookups.length !== 2 || lookups[0]?.id !== target.clickId
    || lookups[1]?.id !== target.selectedId) issues.push("FROZEN_LOOKUP_SEQUENCE_CHANGED");
  if (calls.some((call) => !["exact-target-lookup", "selection-state-read", "pointer-click"].includes(call.kind))) {
    issues.push("FORBIDDEN_EXECUTION_ACTIVITY");
  }
  const clicks = calls.filter((call) => call.kind === "pointer-click");
  if (clicks.length !== 1 || clicks[0]?.id !== target.clickId) issues.push("FROZEN_CLICK_SEQUENCE_CHANGED");
  if (!calls.some((call) => call.kind === "selection-state-read")) issues.push("SELECTION_OBSERVATION_MISSING");
  return issues;
}

export async function executeFrozenSelection({ access, keyboard, mouse, target, calls, priorSelectionId = null }) {
  const started = performance.now();
  const clickTarget = access.target(target.clickId);
  const selectedTarget = access.target(target.selectedId);
  for (const [locator, tag] of [[clickTarget, target.clickTag], [selectedTarget, target.selectedTag]]) {
    requireFact(await locator.count() === 1, "FROZEN_IDENTITY_COUNT_MISMATCH");
    const identity = await locator.evaluate((element) => ({
      tag: element.localName,
      connected: element.isConnected,
      inert: element.inert,
    }));
    requireFact(identity.tag === tag && identity.connected && !identity.inert,
      "FROZEN_IDENTITY_MISMATCH", identity);
    requireFact(await locator.isVisible(), "FROZEN_TARGET_NOT_VISIBLE");
  }
  // Fresh-session selection starts empty; a structural target switch starts
  // from its explicitly known original/copy. Escape on an unfocused iframe is
  // not a reliable reset, and switching targets does not require an empty state.
  if (priorSelectionId === null) await keyboard.press("Escape");
  const initial = access.selected();
  const initialCount = await initial.count();
  const initialId = initialCount === 1 ? await initial.getAttribute("data-pageroot-id") : null;
  requireFact(priorSelectionId === null ? initialCount === 0 : initialCount === 1 && initialId === priorSelectionId,
    "FROZEN_SELECTION_INITIAL_STATE_MISMATCH", { initialCount, initialId, priorSelectionId });
  // A single fixed point on the frozen element. No alternate hit-point search.
  await clickTarget.scrollIntoViewIfNeeded({ timeout: 3_000 });
  const handle = await clickTarget.elementHandle();
  requireFact(handle, "FROZEN_TARGET_DETACHED");
  try {
    if (target.selectionPoint) {
      const point = target.selectionPoint;
      requireFact(mouse, "FROZEN_POINTER_INPUT_MISSING");
      await handle.evaluate(element => element.scrollIntoView({ block: "start", inline: "nearest" }));
      const hit = await handle.evaluate((element, point) => {
        const rect = element.getBoundingClientRect();
        const hit = element.ownerDocument.elementFromPoint(rect.left + point.x, rect.top + point.y);
        return { id: hit?.getAttribute("data-pageroot-id"), inside: point.x < rect.width && point.y < rect.height,
          pointerEvents: getComputedStyle(element).pointerEvents,
          parentId: element.parentElement?.getAttribute("data-pageroot-id") };
      }, point);
      requireFact(hit.inside && hit.id === point.expectedHitId
        && (point.basis !== "dedicated-canvas-through-parent" || (hit.pointerEvents === "none" && hit.parentId === point.expectedHitId)),
      "FROZEN_POINTER_HIT_MISMATCH", { expected: point, actual: hit });
      const box = await handle.boundingBox();
      requireFact(box, "FROZEN_TARGET_DETACHED");
      calls.push({ kind: "pointer-click", id: target.clickId, point, hit });
      await mouse.click(box.x + point.x, box.y + point.y);
    } else {
      calls.push({ kind: "pointer-click", id: target.clickId });
      await handle.click({ timeout: 3_000 });
    }
    await expect.poll(async () => {
      const selected = access.selected();
      if (await selected.count() !== 1) return null;
      return selected.getAttribute("data-pageroot-id");
    }, { timeout: 2_000 }).toBe(target.selectedId);
  } catch (cause) {
    if (cause.code) throw cause;
    const selected = access.selected();
    const count = await selected.count();
    throw Object.assign(new Error("FROZEN_SELECTION_FAILED", { cause }), {
      code: "FROZEN_SELECTION_FAILED",
      details: { selectedCount: count, observedId: count === 1
        ? await selected.getAttribute("data-pageroot-id") : null, expectedId: target.selectedId },
    });
  } finally {
    await handle.dispose();
  }
  const issues = selectionExecutionIssues(calls, target);
  requireFact(issues.length === 0, "FROZEN_EXECUTION_ACTIVITY_INVALID", { issues });
  return { state: "PASS", operation: "select", expected: target.selectedId,
    actual: target.selectedId, initialSelectionCount: initialCount, initialSelectionId: initialId,
    reason: "FROZEN_TARGET_SELECTED", durationMs: performance.now() - started, calls };
}
