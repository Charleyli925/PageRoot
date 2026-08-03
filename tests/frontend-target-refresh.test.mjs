import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  applyPatchPlan,
  buildSourceIndex,
  createTargetRef,
  planSourcePatch,
  resolveTargetRef,
} from "../app/lib/source-patch-core.js";
import {
  readCanvasArchitecture,
  readWorkbenchArchitecture,
} from "./source-architecture-fixture.mjs";

function resolvedElement(index, targetRef) {
  const resolution = resolveTargetRef(index, targetRef);
  assert.ok(
    resolution.resolution === "exact" || resolution.resolution === "rebound",
  );
  assert.equal(resolution.target?.type, "element");
  return resolution.target;
}

test("a tracked comment stays on the same unstable element after text edit and inverse restoration", () => {
  const source = "<!doctype html><html><body><main><p>before</p></main></body></html>";
  const index = buildSourceIndex(source);
  const paragraph = index.elements.find((element) => element.tagName === "p");
  assert.ok(paragraph);
  const editTarget = createTargetRef(index, paragraph, {
    targetId: "target_edit",
    level: "subregion",
  });
  const commentTarget = createTargetRef(index, paragraph, {
    targetId: "target_comment",
    level: "subregion",
  });
  const plan = planSourcePatch({
    type: "replace-editable-island",
    targetRef: editTarget,
    beforeInnerHtml: "before",
    nextInnerHtml: "after",
    expectedSourceSha256: index.sourceSha256,
  }, index);
  const applied = applyPatchPlan(plan, source, {
    trackedTargetRefs: [commentTarget],
  });

  assert.match(applied.html, /<p>after<\/p>/);
  const refreshed = applied.refreshedTrackedTargetRefs.find(
    (target) => target.targetId === "target_comment",
  );
  assert.ok(refreshed);
  assert.equal(refreshed.targetId, commentTarget.targetId);
  assert.equal(refreshed.sourceAnchor?.sourceSha256, applied.sourceSha256);
  assert.equal(resolvedElement(applied.sourceIndex, refreshed).textContent, "after");

  const restoredResult = applyPatchPlan(applied.inversePlan, applied.html, {
    trackedTargetRefs: [refreshed],
  });
  const restored = restoredResult.refreshedTrackedTargetRefs.find(
    (target) => target.targetId === "target_comment",
  );
  assert.equal(restoredResult.html, source);
  assert.ok(restored);
  assert.equal(restored.targetId, commentTarget.targetId);
  assert.equal(resolvedElement(restoredResult.sourceIndex, restored).textContent, "before");
});

test("a tracked comment follows its exact sibling through reorder and inverse restoration", () => {
  const source = [
    "<!doctype html><html><body><main>",
    "<section><p>one</p></section>",
    "<section><p>two</p></section>",
    "</main></body></html>",
  ].join("\n");
  const index = buildSourceIndex(source);
  const parent = index.elements.find((element) => element.tagName === "main");
  assert.ok(parent);
  const sections = parent.childElementIds.map((nodeId) => index.byNodeId.get(nodeId));
  assert.equal(sections.length, 2);
  const editTarget = createTargetRef(index, sections[0], {
    targetId: "target_reorder_edit",
    level: "module",
  });
  const commentTarget = createTargetRef(index, sections[0], {
    targetId: "target_reorder_comment",
    level: "module",
  });
  const plan = planSourcePatch({
    type: "reorder-sibling",
    targetRef: editTarget,
    toIndex: 1,
    beforeOrder: [...parent.childElementIds],
    expectedSourceSha256: index.sourceSha256,
  }, index);
  const applied = applyPatchPlan(plan, source, {
    trackedTargetRefs: [commentTarget],
  });
  const refreshed = applied.refreshedTrackedTargetRefs.find(
    (target) => target.targetId === "target_reorder_comment",
  );
  assert.ok(refreshed);
  const moved = resolvedElement(applied.sourceIndex, refreshed);
  assert.equal(moved.textContent, "one");
  assert.equal(moved.siblingIndex, 1);

  const restoredResult = applyPatchPlan(applied.inversePlan, applied.html, {
    trackedTargetRefs: [refreshed],
  });
  const restored = restoredResult.refreshedTrackedTargetRefs.find(
    (target) => target.targetId === "target_reorder_comment",
  );
  assert.equal(restoredResult.html, source);
  assert.ok(restored);
  const originalPosition = resolvedElement(restoredResult.sourceIndex, restored);
  assert.equal(originalPosition.textContent, "one");
  assert.equal(originalPosition.siblingIndex, 0);
});

test("consecutive source-backed moves remain serializable through inverse round trips", () => {
  const source = [
    "<!doctype html><html><body><main>",
    '<section data-key="a">A</section>',
    '<section data-key="b">B</section>',
    '<section data-key="c">C</section>',
    '<section data-key="d">D</section>',
    "</main></body></html>",
  ].join("\n");
  let currentSource = source;
  let currentIndex = buildSourceIndex(currentSource);
  let movingTarget = createTargetRef(
    currentIndex,
    currentIndex.elements.find((element) => element.stableAttributes["data-key"] === "a"),
    { targetId: "rapid-reorder-a", level: "module" },
  );
  const roundTripPlans = [];
  const order = (index) => {
    const parent = index.elements.find((element) => element.tagName === "main");
    assert.ok(parent);
    return parent.childElementIds.map(
      (nodeId) => index.byNodeId.get(nodeId).stableAttributes["data-key"],
    );
  };

  for (const expectedIndex of [1, 2, 3]) {
    const moving = resolvedElement(currentIndex, movingTarget);
    const parent = currentIndex.byNodeId.get(moving.parentId);
    assert.equal(parent?.type, "element");
    const forwardPlan = planSourcePatch({
      type: "reorder-sibling",
      targetRef: movingTarget,
      toIndex: expectedIndex,
      beforeOrder: [...parent.childElementIds],
      expectedSourceSha256: currentIndex.sourceSha256,
    }, currentIndex);
    const applied = applyPatchPlan(forwardPlan, currentSource);
    roundTripPlans.push({ forwardPlan, inversePlan: applied.inversePlan });
    currentSource = applied.html;
    currentIndex = applied.sourceIndex;
    movingTarget = applied.refreshedTargetRefs.find(
      (target) => target.targetId === "rapid-reorder-a",
    );
    assert.ok(movingTarget);
    assert.equal(resolvedElement(currentIndex, movingTarget).siblingIndex, expectedIndex);
  }
  assert.deepEqual(order(currentIndex), ["b", "c", "d", "a"]);

  const reapplyPlans = [];
  for (const entry of roundTripPlans.toReversed()) {
    const restoredResult = applyPatchPlan(entry.inversePlan, currentSource);
    reapplyPlans.push(restoredResult.inversePlan);
    currentSource = restoredResult.html;
    currentIndex = restoredResult.sourceIndex;
  }
  assert.equal(currentSource, source);
  assert.deepEqual(order(currentIndex), ["a", "b", "c", "d"]);

  for (const reapplyPlan of reapplyPlans.toReversed()) {
    const reapplied = applyPatchPlan(reapplyPlan, currentSource);
    currentSource = reapplied.html;
    currentIndex = reapplied.sourceIndex;
  }
  assert.deepEqual(order(currentIndex), ["b", "c", "d", "a"]);
});

test("canvas keeps a logical reorder target through in-place refresh and reload fallback", async () => {
  const canvas = await readCanvasArchitecture();
  const applyCommand = canvas.slice(
    canvas.indexOf("const applySourceCommand = useCallback"),
    canvas.indexOf("const resetSelection = useCallback", canvas.indexOf("const applySourceCommand = useCallback")),
  );
  const moveSelected = canvas.slice(
    canvas.indexOf("const moveSelected = useCallback"),
    canvas.indexOf("const selectInsertionPoint", canvas.indexOf("const moveSelected = useCallback")),
  );

  assert.ok(
    applyCommand.indexOf("selectedSourceSelectionRef.current = appliedMutation.target")
      < applyCommand.indexOf("selectedElementRef.current = null"),
    "the source-backed selection must be retained before the old iframe element is released",
  );
  assert.match(
    moveSelected,
    /element\?\.isConnected[\s\S]*selectedSourceSelectionRef\.current/u,
    "a second move must use the logical selection while a safe reload fallback is still loading",
  );
  assert.match(
    moveSelected,
    /selectionForElement\([\s\S]*element,[\s\S]*sourceIndex,[\s\S]*selectedSourceSelectionRef\.current \?\? undefined[\s\S]*\)/u,
    "a connected refreshed iframe node must retain the logical target identity",
  );
  assert.match(
    applyCommand,
    /mutation\.kind === "reorder"[\s\S]*sourceMoveAvailability\(result\.sourceIndex, appliedMutation\.target\)/u,
    "the next move buttons must be refreshed synchronously from the latest source index",
  );
  assert.doesNotMatch(
    applyCommand,
    /pendingSelectionRef\.current = appliedMutation\.target;[\s\S]{0,300}setMoveAvailability\(\{ up: false, down: false \}\)/u,
    "a successful reorder must not create a silent disabled window",
  );
});

test("canvas and workbench consume deterministic mappings before generic fallback", async () => {
  const [canvas, workbench] = await Promise.all([
    readCanvasArchitecture(),
    readWorkbenchArchitecture(),
  ]);

  for (const required of [
    "{ trackedTargetRefs }",
    "result.targetMappings",
    "result.refreshedTrackedTargetRefs",
    "targetUpdates",
    "trackedTargetIds",
    "const ambientTargets = uniqueSelections([",
    "const trackedTargetRefs = trackedSourceTargetRefs(",
    "deterministicOperationTargetUpdate",
    "const deterministicById = new Map(",
    "if (trackedTargetIds.has(target.id))",
    "rebindTargetsPreservingGlobal(nextHtml, untrackedSafeTargets)",
    "isGlobalPageTarget(target)",
    "exactGlobalPageTarget(target)",
    "!isGlobalPageTarget(target) && canLocateTarget(target)",
    ": canLocateTarget(target)",
    "independentCommentTarget(currentTarget, commentId)",
    "relinkSelectionArmedRef.current",
  ]) {
    assert.match(
      `${canvas}\n${workbench}`,
      new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  }
  assert.doesNotMatch(
    canvas,
    /split-text-block|includeOperationTargetIds/u,
    "retired one-to-many V1 target mapping must not remain in the V2 canvas",
  );
});

test("legacy whole-page comments normalize before recovery and submission", async () => {
  const workbench = await readWorkbenchArchitecture();
  const globalTargetPolicy = workbench.slice(
    workbench.indexOf("function isGlobalPageTarget"),
    workbench.indexOf("function displayVersionLabel"),
  );
  const recordHydration = workbench.slice(
    workbench.indexOf("function selectionFromRecord"),
    workbench.indexOf("type PersistedTargetRef"),
  );
  const submission = workbench.slice(
    workbench.indexOf("const generateRequest"),
    workbench.indexOf("const openCommittedVersion"),
  );

  assert.match(
    globalTargetPolicy,
    /target\.selector\.trim\(\)\.toLowerCase\(\) === "body"[\s\S]*?target\.level === "module"/u,
  );
  assert.doesNotMatch(
    globalTargetPolicy.slice(
      0,
      globalTargetPolicy.indexOf("function exactGlobalPageTarget"),
    ),
    /tagName/u,
    "whole-page identity must not depend on a field omitted by legacy records",
  );
  assert.match(
    recordHydration,
    /isGlobalPageTarget\(selection\)[\s\S]*?exactGlobalPageTarget\(selection\)/u,
  );
  assert.ok(
    submission.match(/normalizeCurrentGlobalComments\(\)/gu)?.length >= 2,
    "submission must normalize before and after lazy project registration",
  );
  assert.match(submission, /unsafeCommentTargetsNotice\(unsafeTargets\)/u);
  assert.match(submission, /unsafeCommentTargetsNotice\(unsafeRegisteredTargets\)/u);
});

test("style writes use source-safe values, canonical target identity, and only active cascade rules", async () => {
  const [canvas, directEditEvents] = await Promise.all([
    readCanvasArchitecture(),
    readFile(new URL("../app/lib/direct-edit-events.js", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(
    canvas,
    /beforeValue:\s*inlineBefore/u,
    "CSSOM-normalized values must not be compared with authored source text",
  );
  assert.match(directEditEvents, /last\.target\.id !== mutation\.target\.id/u);
  assert.doesNotMatch(
    directEditEvents,
    /last\.target\.selector === mutation\.target\.selector/u,
  );
  assert.match(canvas, /activeMediaCondition\(view, sheetMedia\)/u);
  assert.match(canvas, /rule\.type === 4 && !activeMediaCondition/u);
  assert.match(canvas, /rule\.type === 12 && !activeSupportsCondition/u);
  assert.match(canvas, /css\.supports\(condition\)/u);
  assert.match(
    canvas,
    /sharedSelectorImpact\(documentNode, styleRule\.selectorText\)/u,
    "shared impact must cover the complete selector list",
  );
  assert.match(
    canvas,
    /const impactedElements = new Set<Element>\(\)[\s\S]*impactedElements\.add\(element\)[\s\S]*return impactedElements\.size/u,
    "overlapping selector groups must be counted as a de-duplicated union",
  );
  assert.match(
    canvas,
    /winnerKeyword === "unset" && naturallyInherited/u,
    "unset inherits only for naturally inherited properties",
  );
  assert.match(
    canvas,
    /winnerKeyword === "unset" && !naturallyInherited/u,
    "unset on non-inherited properties must use its initial effect",
  );
  assert.match(
    canvas,
    /kind: "initial"[\s\S]*selector: winner\.selector[\s\S]*source: winner\.source/u,
    "the initial effect must preserve the winning rule provenance",
  );
  assert.doesNotMatch(
    canvas,
    />样式来源</u,
    "style provenance may still drive safe writes but is no longer exposed as product UI",
  );

  const styleWrite = canvas.slice(
    canvas.indexOf("const applyInlineStyle = useCallback"),
    canvas.indexOf("const handleToolbarKeyDown", canvas.indexOf("const applyInlineStyle = useCallback")),
  );
  assert.match(
    styleWrite,
    /\.\.\.\(sourceInfo\?\.important \? \{ important: true \} : \{\}\)/u,
    "an active !important cascade winner must remain important when writing an inline override",
  );
  assert.doesNotMatch(
    styleWrite,
    /!inlineBefore/u,
    "an existing non-important inline declaration must not suppress the winning !important priority",
  );
});

test("ordinary patches keep the mounted iframe while source-authority fences use a fresh frame", async () => {
  const canvas = await readCanvasArchitecture();
  const stablePreview = canvas.slice(
    canvas.indexOf("const synchronizeStablePreview = useCallback"),
    canvas.indexOf("const applySourceCommand = useCallback", canvas.indexOf("const synchronizeStablePreview = useCallback")),
  );
  const applyCommand = canvas.slice(
    canvas.indexOf("const applySourceCommand = useCallback"),
    canvas.indexOf("const resetSelection = useCallback", canvas.indexOf("const applySourceCommand = useCallback")),
  );

  assert.match(
    stablePreview,
    /originalMutation\.kind !== "style"[\s\S]*?originalMutation\.kind !== "text"[\s\S]*?originalMutation\.kind !== "reorder"/u,
  );
  assert.match(stablePreview, /instrumentPreviewHtml\(result\.sourceIndex/u);
  assert.match(stablePreview, /sourceBackedPreviewElements\(documentNode\)/u);
  assert.match(stablePreview, /sourceBackedPreviewElements\(detachedDocument\)/u);
  assert.match(stablePreview, /liveNodes\.length !== previousElements\.length/u);
  assert.match(stablePreview, /liveParent\.insertBefore\(/u);
  assert.match(stablePreview, /const stableNodes = sourceBackedPreviewElements\(documentNode\)/u);
  assert.match(stablePreview, /node\.setAttribute\(SOURCE_NODE_ATTRIBUTE, nextElements\[index\]\.nodeId\)/u);
  assert.match(stablePreview, /renderedSourceHtmlRef\.current = result\.html/u);
  assert.match(
    stablePreview,
    /The DOM remains a preview only; it is never[\s\S]*?serialized back/u,
  );
  assert.doesNotMatch(stablePreview, /setFrameHtml|setFrameRevision|loadFrameSource/u);
  assert.match(
    canvas,
    /function sourceBackedPreviewElements[\s\S]*?element\.tagName === "TEMPLATE"[\s\S]*?content\.children/u,
    "template descendants must remain in the source-backed node sequence",
  );
  assert.doesNotMatch(canvas, /const \[frameRevision, setFrameRevision\]/u);
  assert.doesNotMatch(canvas, /key=\{frameRevision\}/u);
  assert.match(
    canvas,
    /const \[frameRender, setFrameRender\][\s\S]*?elementGeneration: 0/u,
    "the frame element generation must be explicit rather than inferred from source text",
  );
  assert.match(canvas, /flushSync\(replaceFrameElement\)/u);
  assert.match(canvas, /key=\{frameRender\.elementGeneration\}/u);
  assert.match(canvas, /data-frame-generation=\{frameRender\.elementGeneration\}/u);
  assert.match(canvas, /srcDoc=\{frameRender\.html\}/u);
  assert.match(
    canvas,
    /connectedFrameGeneration !== frameLoadGenerationRef\.current[\s\S]*?return/u,
    "a late load from a retired frame must not overwrite the current render verification state",
  );
  assert.match(
    canvas,
    /connectFrame\([\s\S]*?event\.currentTarget,[\s\S]*?frameRender\.elementGeneration/u,
    "frame load events must carry the render generation that created their iframe",
  );
  assert.match(
    canvas,
    /const connectParsedFrame = \(\) => \{[\s\S]*?connectedFrameGeneration !== frameLoadGenerationRef\.current[\s\S]*?iframe\.srcdoc === expectedFrameHtml[\s\S]*?marker\.getAttribute\("content"\) === expectedToken[\s\S]*?connectFrame\(iframe, connectedFrameGeneration\)/u,
    "a verified parsed frame must connect without waiting for load-blocking page resources",
  );

  assert.match(applyCommand, /previewStayedMounted = synchronizeStablePreview/u);
  assert.match(
    applyCommand,
    /if \(!previewStayedMounted\) \{[\s\S]*loadFrameSource\(result\.html, \{ preserveViewport: true \}\)/u,
  );
  assert.doesNotMatch(canvas, /applyHistoryPlan|undoStackRef|redoStackRef/u);
  assert.match(
    canvas,
    /mutation\.kind === "reorder"[\s\S]*loadFrameSource\(result\.html, \{ preserveViewport: true \}\)/u,
    "structural reorders retain the verified iframe reload path",
  );
  assert.match(canvas, /pendingFrameViewportRef/u);
  assert.match(
    canvas,
    /documentNode\?\.documentElement\?\.toggleAttribute\("data-html-canvas-locked", shouldLock\)/u,
    "lock synchronization must tolerate the transient rootless document exposed during iframe navigation",
  );
  assert.match(
    canvas,
    /selectTarget\(pendingSelection, \{[\s\S]*?reveal: false,[\s\S]*?showToolbar: pendingToolbarVisible/u,
  );
  assert.match(applyCommand, /forwardPlan\.type === "replace-editable-island"/u);
  assert.match(applyCommand, /options\.islandTextCommit/u);
  assert.match(applyCommand, /buildSourceTextMap\(/u);
  assert.match(applyCommand, /editableIslandForTarget\(/u);
  assert.match(applyCommand, /refreshMountedPreviewSourceNodeIds\(/u);
  assert.match(applyCommand, /\.session\.applyExternalIslandBaseline\(\{/u);
  assert.match(applyCommand, /data-render-verified", "true"/u);
  assert.doesNotMatch(applyCommand, /data-render-verified", "false"/u);

  const finishStart = canvas.indexOf("const frameReloadRequired");
  const finishNativeEdit = canvas.slice(
    Math.max(0, finishStart - 800),
    canvas.indexOf("const resetSelection", finishStart),
  );
  assert.match(finishNativeEdit, /const frameReloadRequired/u);
  assert.match(
    finishNativeEdit,
    /if \(frameReloadRequired\)[\s\S]*?loadFrameSource\(source, \{ preserveViewport: true \}\)/u,
  );
  assert.match(
    finishNativeEdit,
    /selectedElementRef\.current = rootElement;[\s\S]*?renderedSourceHtmlRef\.current = source/u,
  );
  const stableFinish = finishNativeEdit.slice(
    finishNativeEdit.indexOf(
      "pendingSelectionRef.current = null",
      finishNativeEdit.indexOf("if (frameReloadRequired)"),
    ),
  );
  assert.doesNotMatch(stableFinish, /loadFrameSource\(source/u);
});

test("canvas hides insertion and source-reversal affordances while retaining target recovery", async () => {
  const [canvas, css] = await Promise.all([
    readCanvasArchitecture(),
    readFile(new URL("../app/components/HtmlCanvasEditor.module.css", import.meta.url), "utf8"),
  ]);

  assert.match(canvas, /children\.forEach\(\(moduleElement, childIndex\)/u);
  assert.match(canvas, /addBoundary\(moduleElement, moduleElement, beforeTop, beforeLabel\)/u);
  assert.match(canvas, /在页面顶部添加内容建议/u);
  assert.match(canvas, /Consecutive modules share one boundary/u);
  assert.match(canvas, /sourceDistinctInsertionPoints\.filter/u);
  assert.match(canvas, /overlap >= Math\.min\(existing\.width, point\.width\) \* 0\.8/u);
  assert.doesNotMatch(canvas, /insertionPoints\.map/u);
  assert.doesNotMatch(canvas, /styles\.insertionPlus/u);
  assert.doesNotMatch(canvas, /撤销|重做|undoStackRef|redoStackRef|historyAction/u);
  const existingCommentMarker = canvas.slice(
    canvas.indexOf("commentMarkers.map"),
    canvas.indexOf("&& toolbarVisible", canvas.indexOf("commentMarkers.map")),
  );
  assert.match(
    existingCommentMarker,
    /selectTarget\(marker\.selection, \{ reveal: false, showToolbar: true \}\)/u,
  );
  assert.doesNotMatch(existingCommentMarker, /onRequestCommentRef/u);

  assert.doesNotMatch(css, /\.insertionButton|\.insertionLine|\.insertionPoint|\.insertionPlus/u);
});

test("the canvas has no persistent global-comment button while global targets remain addressable", async () => {
  const [canvas, css] = await Promise.all([
    readCanvasArchitecture(),
    readFile(new URL("../app/components/HtmlCanvasEditor.module.css", import.meta.url), "utf8"),
  ]);

  assert.match(canvas, /data-html-canvas-selected", nextSelection\.level/u);
  assert.doesNotMatch(canvas, /className=\{styles\.globalCommentButton\}/u);
  assert.doesNotMatch(css, /\.globalCommentButton/u);
  assert.match(canvas, /defaultGlobalCommentElement\(documentNode\)/u);
  assert.match(canvas, /return documentNode\.body/u);
  assert.match(canvas, /selectElement\(globalElement, "module"\)/u);
  assert.match(canvas, /GLOBAL_SELECTION_ATTRIBUTE/u);
  assert.match(canvas, /documentNode\.defaultView\?\.scrollTo\(\{[\s\S]*?top: 0/u);
  assert.match(canvas, /isGlobalPageTarget[\s\S]*?frameOffsetLeft \+ 18/u);
  assert.match(canvas, /data-global=\{isPageRootSelection\(marker\.selection\)/u);
  assert.match(canvas, /toolbarVisible[\s\S]*?!isPageRootSelection\(selection\)[\s\S]*?overlayPosition/u);
  assert.match(canvas, /levelOverride \?\? identityTarget\?\.level \?\? inferSelectionLevel\(element\)/u);
  assert.match(canvas, /element === element\.ownerDocument\.documentElement/u);
  assert.match(canvas, /\[data-html-canvas-selected="part"\]/u);
  assert.match(canvas, /\[data-html-canvas-selected="module"\]:not\(\[data-html-canvas-global-selected\]\)/u);
  assert.match(canvas, /\[data-html-canvas-global-selected\]/u);
  assert.doesNotMatch(canvas, /\[data-html-canvas-selected\]\s*\{/u);
  assert.match(css, /\.editor\s*\{[\s\S]*grid-template-rows:\s*40px minmax\(0, 1fr\)/u);
  assert.match(css, /\.frame\s*\{[\s\S]*grid-row:\s*2/u);
  assert.match(css, /\.editor:not\(\[data-render-verified="true"\]\) \.frame\s*\{[\s\S]*?visibility:\s*hidden/u);
});

test("preview native links and forms cannot navigate the editing canvas on double click", async () => {
  const canvas = await readCanvasArchitecture();
  const doubleClickHandler = canvas.slice(
    canvas.indexOf("const handleDoubleClick = (event: MouseEvent) =>"),
    canvas.indexOf("const handleKeyDown = (event: KeyboardEvent) =>"),
  );
  assert.match(canvas, /function findNativeActionTarget/u);
  for (const selector of [
    "a[href]",
    "area[href]",
    "button",
    "form",
    "input",
    "select",
    "summary",
    "textarea",
    '[role="tab"]',
    "[aria-expanded][aria-controls]",
  ]) {
    assert.match(canvas, new RegExp(JSON.stringify(selector).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  }
  const lockedGuard = doubleClickHandler.indexOf("if (lockedRef.current) return;");
  const startEdit = doubleClickHandler.indexOf("const editingStarted = capturedRange");
  const acceptedEditGuard = doubleClickHandler.indexOf("if (editingStarted)", startEdit);
  const preventDefault = doubleClickHandler.indexOf("event.preventDefault();", acceptedEditGuard);
  assert.ok(lockedGuard >= 0 && lockedGuard < startEdit, "locked canvases must not enter editing");
  assert.ok(
    startEdit >= 0 && acceptedEditGuard > startEdit && preventDefault > acceptedEditGuard,
    "an accepted authored-DOM edit must cancel the remaining double-click default",
  );
  const clickHandler = canvas.slice(
    canvas.indexOf("const handleClick = (event: MouseEvent) =>"),
    canvas.indexOf("const handleDoubleClick = (event: MouseEvent) =>"),
  );
  const actionDefault = clickHandler.indexOf("if (nativeActionTarget) event.preventDefault()");
  const activeEditFastPath = clickHandler.indexOf(
    "if (activeNativeEditRef.current?.rootElement.contains(event.target as Node)) return",
  );
  assert.ok(
    actionDefault >= 0 && activeEditFastPath > actionDefault,
    "authored actions must be suppressed before the active-edit fast path",
  );
  assert.match(clickHandler, /event\.preventDefault\(\);[\s\S]*?event\.stopPropagation\(\);[\s\S]*?selectElement\(target\)/u);
  assert.match(canvas, /documentNode\.addEventListener\("submit", handleSubmit, true\)/u);
});

test("spacing menu is controlled and closes for outside toolbar and canvas interactions", async () => {
  const canvas = await readCanvasArchitecture();
  assert.match(canvas, /const spacingMenuRef = useRef<HTMLDetailsElement>/u);
  assert.match(canvas, /const \[spacingMenuOpen, setSpacingMenuOpen\] = useState\(false\)/u);
  assert.match(canvas, /documentNode\.addEventListener\("pointerdown", closeOutsideSpacingMenu, true\)/u);
  assert.match(canvas, /const handleMouseDown = \(event: MouseEvent\) => \{[\s\S]*?setSpacingMenuOpen\(false\)/u);
  assert.match(canvas, /ref=\{spacingMenuRef\}[\s\S]*?open=\{spacingMenuOpen\}/u);
  assert.match(canvas, /setSpacingMenuOpen\(\(open\) => !open\)/u);
});

test("outside app or canvas clicks commit editing and clear the active selection", async () => {
  const canvas = await readCanvasArchitecture();
  assert.match(
    canvas,
    /documentNode\.addEventListener\("pointerdown", clearOnOutsidePointer, true\)/u,
  );
  assert.match(
    canvas,
    /toolbarRef\.current\?\.contains\(target\)[\s\S]*?clearSelection\(\)/u,
  );
  const handleClick = canvas.slice(
    canvas.indexOf("const handleClick = (event: MouseEvent) =>"),
    canvas.indexOf("const handleDoubleClick", canvas.indexOf("const handleClick = (event: MouseEvent) =>")),
  );
  assert.match(
    handleClick,
    /selectedElement\.contains\(event\.target\)[\s\S]*?clearSelection\(\)[\s\S]*?return;/u,
  );
});

test("canvas root whitespace clears selection instead of selecting the document body", async () => {
  const canvas = await readCanvasArchitecture();
  const selectableHelper = canvas.slice(
    canvas.indexOf("function findSelectableElement"),
    canvas.indexOf("const HtmlCanvasEditor =", canvas.indexOf("function findSelectableElement")),
  );
  const handleClick = canvas.slice(
    canvas.indexOf("const handleClick = (event: MouseEvent) =>"),
    canvas.indexOf("const handleDoubleClick", canvas.indexOf("const handleClick = (event: MouseEvent) =>")),
  );

  assert.match(selectableHelper, /\["HTML", "BODY", "HEAD", "SCRIPT", "STYLE"\]/u);
  assert.match(selectableHelper, /function isCanvasRootElement/u);
  assert.match(handleClick, /isCanvasRootElement\(event\.target\)[\s\S]*clearSelection\(\)[\s\S]*return;/u);
  assert.ok(
    handleClick.indexOf("isCanvasRootElement(event.target)")
      < handleClick.indexOf("findCanvasSelectionElement(event.target)"),
    "root whitespace must be handled before the selectable-element path",
  );
});

test("handoff commits a pending source edit before recapturing and freezing comment targets", async () => {
  const workbench = await readWorkbenchArchitecture();
  const handoffStart = workbench.indexOf("const generateRequest = useCallback");
  const commit = workbench.indexOf(
    "const committed = editorRef.current?.fencePendingEdit({",
    handoffStart,
  );
  const initialCapture = workbench.indexOf(
    "let activeComments = normalizeCurrentGlobalComments();",
    handoffStart,
  );
  const ensure = workbench.indexOf(
    "await ensureProjectRegistered();",
    initialCapture,
  );
  const recapture = workbench.indexOf(
    "activeComments = normalizeCurrentGlobalComments();",
    ensure,
  );
  const revalidate = workbench.indexOf(
    "const unsafeRegisteredTargets = activeComments.filter",
    recapture,
  );
  const initialRevalidate = workbench.indexOf(
    "const unsafeTargets = activeComments.filter",
    initialCapture,
  );
  const freeze = workbench.indexOf(
    "const frozen = editorRef.current?.freezeNow();",
    handoffStart,
  );

  assert.ok(handoffStart >= 0);
  assert.ok(commit > handoffStart);
  assert.ok(initialCapture > commit);
  assert.ok(initialRevalidate > initialCapture);
  assert.ok(ensure > initialRevalidate);
  assert.ok(recapture > ensure);
  assert.ok(revalidate > recapture);
  assert.ok(freeze > revalidate);
  assert.match(
    workbench.slice(commit, initialCapture),
    /const (\w+) = editorRef\.current\?\.fencePendingEdit\(\{[\s\S]*?resumeEditing: false,[\s\S]*?trigger: "ai",[\s\S]*?\}\);[\s\S]*?if \(!\1 \|\| !\1\.ok\) \{[\s\S]*?return;/u,
    "a failed native-edit source-authority fence must stop handoff before comment targets are captured",
  );
  assert.doesNotMatch(
    workbench.slice(recapture, freeze),
    /\n\s*await\b/,
    "an async gap could let input change after registered comment targets are recaptured",
  );
  assert.match(
    workbench.slice(freeze, workbench.indexOf("let requestDispatched", freeze)),
    /comments: activeComments\.map/,
  );
  const freezeGuard = workbench.indexOf("!frozen", freeze);
  const projectLock = workbench.indexOf("projectLockedRef.current = true", freeze);
  assert.ok(freezeGuard > freeze, "handoff must inspect the freeze result");
  assert.ok(projectLock > freezeGuard, "handoff must not lock before a successful freeze");
  assert.match(
    workbench.slice(freezeGuard, projectLock),
    /!frozen[\s\S]*?\|\| !frozen\.ok[\s\S]*?return;/u,
  );
  const drain = workbench.indexOf(
    'await drainCoordinatorRef.current.drain("submit"',
    projectLock,
  );
  const requestDispatch = workbench.indexOf("requestDispatched = true", drain);
  assert.ok(drain > projectLock);
  assert.ok(requestDispatch > drain);
  assert.match(
    workbench.slice(drain, requestDispatch),
    /!drained\.ok[\s\S]*?documentSessionRef\.current\.lastPersistedRevision !== freezeCutoffRevision[\s\S]*?documentSessionRef\.current\.editRevision !== freezeCutoffRevision[\s\S]*?persistedSourceSha256 !== frozen\.sourceSha256/u,
    "handoff must prove that the exact frozen revision and hash were persisted before dispatch",
  );
});
