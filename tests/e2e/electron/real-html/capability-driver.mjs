import { expect } from "@playwright/test";

import {
  buildSourceIndex,
  createTargetRef,
} from "../../../../app/lib/source-patch-core.js";
import { isEditableIslandTarget } from "../../../../app/lib/editable-island.js";

const TEXT_TAGS = new Set([
  "address", "blockquote", "caption", "dd", "dt", "figcaption", "h1", "h2",
  "h3", "h4", "h5", "h6", "label", "legend", "li", "p", "pre", "summary",
  "td", "th",
]);
const CONTROL_TAGS = new Set(["a", "button", "input", "option", "select", "textarea"]);
const MEDIA_TAGS = new Set(["audio", "canvas", "embed", "iframe", "img", "object", "svg", "video"]);
const TABLE_TAGS = new Set(["table", "tbody", "tfoot", "thead", "tr", "td", "th"]);
const LIST_TAGS = new Set(["dl", "ol", "ul", "li", "dd", "dt"]);

export function majorElementType(tagName) {
  const tag = String(tagName || "").toLowerCase();
  if (TEXT_TAGS.has(tag)) return "text";
  if (CONTROL_TAGS.has(tag)) return "control";
  if (MEDIA_TAGS.has(tag)) return "media";
  if (TABLE_TAGS.has(tag)) return "table";
  if (LIST_TAGS.has(tag)) return "list";
  if (["form", "fieldset"].includes(tag)) return "form";
  return "container";
}

export function sourceElementsForCapabilityManifest(source) {
  const index = buildSourceIndex(source);
  return index.elements.map((element, sourceOrder) => {
    let sourceEditable = false;
    if (element.pagerootIdentityStatus === "valid") {
      try {
        sourceEditable = isEditableIslandTarget(
          index,
          createTargetRef(index, element, { level: "subregion" }),
        ).editable;
      } catch {
        sourceEditable = false;
      }
    }
    const parent = element.parentId ? index.byNodeId.get(element.parentId) : null;
    return {
      pagerootId: element.pagerootId,
      pagerootIdentityStatus: element.pagerootIdentityStatus,
      tagName: element.tagName,
      parentId: parent?.type === "element" ? parent.pagerootId || null : null,
      sourceOrder,
      sourceEditable,
      boundarySafe: element.boundarySafe === true,
    };
  });
}

export async function collectVisibleAuthoredCandidates(frame, sourceElements, tabId = null) {
  return frame.locator("[data-pageroot-id]").evaluateAll((elements, payload) => {
    const sourceById = new Map(payload.sourceElements.map((entry) => [entry.pagerootId, entry]));
    const viewportHeight = Math.max(
      document.documentElement?.scrollHeight || 0,
      document.body?.scrollHeight || 0,
      innerHeight,
    );
    const regionFor = (rect) => {
      const center = scrollY + rect.top + rect.height / 2;
      if (center < viewportHeight / 3) return "top";
      if (center < viewportHeight * 2 / 3) return "middle";
      return "bottom";
    };
    const scrollContainerFor = (element) => {
      let ancestor = element.parentElement;
      while (ancestor && ancestor !== document.body) {
        const style = getComputedStyle(ancestor);
        if (/(?:auto|scroll)/u.test(`${style.overflowY} ${style.overflow}`)
          && ancestor.scrollHeight > ancestor.clientHeight + 1) {
          return ancestor.getAttribute("data-pageroot-id") || "nested-authored-scroller";
        }
        ancestor = ancestor.parentElement;
      }
      return "document";
    };
    return elements.map((element) => {
      const stableId = element.getAttribute("data-pageroot-id");
      const source = sourceById.get(stableId);
      if (!source) return null;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const hidden = element.hasAttribute("hidden")
        || element.closest('[aria-hidden="true"], [hidden]') != null
        || style.display === "none"
        || style.visibility === "hidden"
        || Number(style.opacity || 1) === 0
        || rect.width <= 1
        || rect.height <= 1
        || element.getClientRects().length === 0;
      return {
        stableId,
        tag: element.localName,
        sourceEditable: source.sourceEditable === true,
        visible: !hidden,
        isConnected: element.isConnected,
        inert: element.closest("[inert]") != null,
        runtimeGenerated: false,
        tabId: payload.tabId,
        region: regionFor(rect),
        scrollContainer: scrollContainerFor(element),
      };
    }).filter(Boolean);
  }, { sourceElements, tabId });
}

async function safeAuthoredHitPoint(target) {
  return target.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const fractions = [0.08, 0.2, 0.5, 0.8, 0.92];
    for (const yFraction of fractions) {
      for (const xFraction of fractions) {
        const x = rect.left + Math.max(1, rect.width * xFraction);
        const y = rect.top + Math.max(1, rect.height * yFraction);
        const hit = element.ownerDocument.elementFromPoint(x, y);
        if (hit?.closest("[data-pageroot-id]") === element) {
          return { x: x - rect.left, y: y - rect.top };
        }
      }
    }
    return null;
  });
}

function behaviorFamiliesFor(capabilities) {
  const families = new Set(["activation", "persistence", "stable-id"]);
  if (capabilities.includes("text")) {
    for (const family of ["input", "backspace", "delete-key", "enter", "selection-replace", "undo-redo", "paste", "source-scope"]) {
      families.add(family);
    }
  }
  if (capabilities.includes("format")) {
    for (const family of [
      "bold",
      "italic",
      "underline",
      "font-size",
      "text-color",
      "fill-color",
      "padding",
      "margin",
      "line-height",
    ]) families.add(family);
  }
  if (capabilities.includes("comment")) {
    for (const family of ["comment-create", "comment-edit", "comment-delete", "comment-reopen"]) families.add(family);
  }
  if (capabilities.includes("copy")) {
    for (const family of ["duplicate", "delete-duplicate"]) families.add(family);
    if (capabilities.includes("text")) families.add("edit-duplicate");
  }
  if (capabilities.some((value) => value.startsWith("move-"))) families.add("move");
  return [...families];
}

const RUNTIME_GENERATED_DISCOVERY_SELECTOR = [
  "table",
  "td",
  "th",
  "svg",
  "canvas",
  "[data-chart]",
  "[data-chart-root]",
  "[data-echarts]",
  "[role='img']",
].join(", ");

export function runtimeGeneratedDiagnosticsIssue(diagnostics) {
  if (!Array.isArray(diagnostics) || diagnostics.length === 0) {
    return "RUNTIME_GENERATED_DIAGNOSTICS_MISSING";
  }
  if (diagnostics.some((entry) => entry.truncated === true)) {
    return "RUNTIME_GENERATED_DISCOVERY_TRUNCATED";
  }
  if (diagnostics.some((entry) => entry.probeFailureCount > 0)) {
    return "RUNTIME_GENERATED_PROBE_FAILED";
  }
  if (diagnostics.some((entry) => entry.rejectedDiagnosticCount > 0)) {
    return "RUNTIME_GENERATED_DIAGNOSTICS_INCOMPLETE";
  }
  return null;
}

export async function discoverRuntimeGeneratedTargets({ page, frame, editor, tabId = null }) {
  const candidates = frame.locator(RUNTIME_GENERATED_DISCOVERY_SELECTOR);
  const candidateCount = await candidates.count();
  const targets = [];
  const keys = new Set();
  const diagnostics = {
    candidateCount,
    truncated: candidateCount > 512,
    probedCount: 0,
    visibleCount: 0,
    runtimeGeneratedCount: 0,
    frozenTargetCount: 0,
    rejectedDiagnosticCount: 0,
    diagnosticTargetMismatchCount: 0,
    probeFailureCount: 0,
  };
  for (let index = 0; index < Math.min(candidateCount, 512); index += 1) {
    const target = candidates.nth(index);
    if (!await target.isVisible().catch(() => false)) continue;
    const box = await target.boundingBox();
    if (!box || box.width <= 2 || box.height <= 2) continue;
    diagnostics.visibleCount += 1;
    try {
      await page.keyboard.press("Escape");
      await page.evaluate(() => new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      }));
      if (await editor.getAttribute("data-selection-runtime-generated") !== null) {
        throw new Error("Selection diagnostics did not clear before the Runtime probe.");
      }
      await target.scrollIntoViewIfNeeded();
      await target.click({
        position: {
          x: Math.max(1, Math.min(box.width - 1, box.width / 2)),
          y: Math.max(1, Math.min(box.height - 1, box.height / 2)),
        },
      });
      await page.evaluate(() => new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      }));
      diagnostics.probedCount += 1;
    } catch {
      diagnostics.probeFailureCount += 1;
      continue;
    }
    const snapshot = await editor.evaluate((element) => ({
      runtimeGenerated: element.getAttribute("data-selection-runtime-generated"),
      generation: element.getAttribute("data-selection-runtime-generation"),
      sourceAnchorId: element.getAttribute("data-selection-runtime-source-anchor-id"),
      kind: element.getAttribute("data-selection-runtime-kind"),
      relativePath: element.getAttribute("data-selection-runtime-path"),
    }));
    if (snapshot.runtimeGenerated === null) {
      diagnostics.probeFailureCount += 1;
      continue;
    }
    if (snapshot.runtimeGenerated !== "true") continue;
    diagnostics.runtimeGeneratedCount += 1;
    if (
      !snapshot.generation
      || !snapshot.sourceAnchorId
      || !snapshot.kind
      || !snapshot.relativePath
    ) {
      diagnostics.rejectedDiagnosticCount += 1;
      continue;
    }
    const diagnosticMatchesCandidate = await target.evaluate((element, payload) => {
      const anchors = [...document.querySelectorAll("[data-pageroot-id]")].filter(
        (candidate) => candidate.getAttribute("data-pageroot-id") === payload.sourceAnchorId,
      );
      if (anchors.length !== 1) return false;
      let resolved = null;
      try {
        resolved = anchors[0].querySelector(payload.relativePath);
      } catch {
        return false;
      }
      return resolved === element || element.contains(resolved) || resolved?.contains(element) === true;
    }, snapshot);
    if (!diagnosticMatchesCandidate) {
      diagnostics.rejectedDiagnosticCount += 1;
      diagnostics.diagnosticTargetMismatchCount += 1;
      continue;
    }
    if (keys.has(snapshot.kind)) continue;
    keys.add(snapshot.kind);
    const key = [snapshot.sourceAnchorId, snapshot.kind, snapshot.relativePath].join(":");
    targets.push({
      targetKey: key,
      tabId,
      generation: snapshot.generation,
      sourceAnchorId: snapshot.sourceAnchorId,
      kind: snapshot.kind,
      relativePath: snapshot.relativePath,
      capabilityFamilies: ["comment"],
      deniedCapabilityFamilies: ["text", "format", "copy", "move", "delete"],
    });
    diagnostics.frozenTargetCount = targets.length;
  }
  await page.keyboard.press("Escape").catch(() => {});
  return { targets, diagnostics };
}

export async function probeAuthoredCapability({ frame, editor, candidate }) {
  const target = frame.locator(`[data-pageroot-id=${JSON.stringify(candidate.stableId)}]`);
  const count = await target.count();
  if (count !== 1) {
    return { ...candidate, capabilityFamilies: [], behaviorFamilies: [], probeReason: count ? "LIVE_DUPLICATE_STABLE_ID" : "LIVE_DOM_MISSING" };
  }
  const liveTag = await target.evaluate((element) => element.localName);
  await target.scrollIntoViewIfNeeded();
  const position = await safeAuthoredHitPoint(target);
  if (!position) {
    return { ...candidate, capabilityFamilies: [], behaviorFamilies: [], visible: false, probeReason: "NO_EXACT_HIT_POINT" };
  }
  await target.click({ position, modifiers: ["Alt"] });
  let selectedId = null;
  try {
    await expect.poll(async () => {
      const selected = frame.locator("[data-html-canvas-selected]");
      if (await selected.count() !== 1) return null;
      selectedId = await selected.getAttribute("data-pageroot-id");
      return selectedId;
    }, { timeout: 2_000 }).toBe(candidate.stableId);
  } catch {
    return { ...candidate, capabilityFamilies: [], behaviorFamilies: [], probeReason: "SELECTION_IDENTITY_MISMATCH", selectedId };
  }

  const toolbar = editor.getByRole("toolbar").filter({ visible: true }).first();
  if (await toolbar.count() !== 1) {
    return { ...candidate, capabilityFamilies: [], behaviorFamilies: [], probeReason: "SELECTION_TOOLBAR_MISSING", selectedId };
  }
  const toolbarLabel = await toolbar.getAttribute("aria-label");
  const runtimeGenerated = Boolean(toolbarLabel?.startsWith("评论"));
  const enabled = async (name) => {
    const button = toolbar.getByRole("button", { name, exact: true });
    return await button.count() === 1 && await button.isEnabled().catch(() => false);
  };
  const capabilityFamilies = ["selection"];
  if (await toolbar.getByRole("button", { name: /留评论/u }).count()) capabilityFamilies.push("comment");
  if (!runtimeGenerated && candidate.sourceEditable && await enabled("编辑")) {
    capabilityFamilies.push("text", "format");
  }
  const copyAvailability = await editor.getAttribute("data-element-copy-availability");
  const copyReason = await editor.getAttribute("data-element-copy-reason");
  if (!runtimeGenerated && copyAvailability === "available" && await enabled("复制元素")) {
    capabilityFamilies.push("copy");
  }
  if (!runtimeGenerated && await enabled("上移")) capabilityFamilies.push("move-up");
  if (!runtimeGenerated && await enabled("下移")) capabilityFamilies.push("move-down");
  if (!runtimeGenerated && await toolbar.getByRole("button", { name: "删除元素", exact: true }).count()) {
    capabilityFamilies.push("delete");
  }
  return {
    ...candidate,
    tag: liveTag,
    runtimeGenerated,
    selectedId,
    capabilityFamilies,
    behaviorFamilies: behaviorFamiliesFor(capabilityFamilies),
    copyAvailability,
    copyReason,
    toolbarLabel,
    probeReason: "CAPABILITY_OBSERVED",
  };
}
