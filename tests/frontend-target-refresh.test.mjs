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

function resolvedElement(index, targetRef) {
  const resolution = resolveTargetRef(index, targetRef);
  assert.ok(
    resolution.resolution === "exact" || resolution.resolution === "rebound",
  );
  assert.equal(resolution.target?.type, "element");
  return resolution.target;
}

test("a tracked comment stays on the same unstable element after text edit and undo", () => {
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
    type: "replace-text",
    targetRef: editTarget,
    beforeText: "before",
    nextText: "after",
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

  const undone = applyPatchPlan(applied.inversePlan, applied.html, {
    trackedTargetRefs: [refreshed],
  });
  const restored = undone.refreshedTrackedTargetRefs.find(
    (target) => target.targetId === "target_comment",
  );
  assert.equal(undone.html, source);
  assert.ok(restored);
  assert.equal(restored.targetId, commentTarget.targetId);
  assert.equal(resolvedElement(undone.sourceIndex, restored).textContent, "before");
});

test("a comment on a split block never silently follows the wrong half", () => {
  const source = "<!doctype html><html><body><main><p id=\"copy\">前段评论后段</p></main></body></html>";
  const index = buildSourceIndex(source);
  const paragraph = index.elements.find((element) => element.tagName === "p");
  assert.ok(paragraph);
  const editTarget = createTargetRef(index, paragraph, {
    targetId: "target_shared",
    level: "subregion",
  });
  const fullBlockComment = createTargetRef(index, paragraph, {
    targetId: "target_shared",
    level: "subregion",
  });
  const narrowedComment = (targetId, textQuote) => ({
    ...createTargetRef(index, paragraph, {
      targetId,
      level: "subregion",
    }),
    textQuote,
  });
  const plan = planSourcePatch({
    type: "split-text-block",
    targetRef: editTarget,
    splitOffset: 4,
    expectedSourceSha256: index.sourceSha256,
  }, index);
  const applied = applyPatchPlan(plan, source, {
    trackedTargetRefs: [
      fullBlockComment,
      narrowedComment("target_first", "前段"),
      narrowedComment("target_second", "后段"),
      narrowedComment("target_crossing", "评论后"),
    ],
  });
  const mappings = applied.targetMappings;
  const mapping = (targetId, tracked = true) => mappings.find((candidate) => (
    candidate.targetId === targetId && candidate.tracked === tracked
  ));

  assert.equal(mapping("target_shared", false).resolution, "exact");
  assert.equal(
    applied.sourceIndex.byNodeId.get(mapping("target_shared", false).afterNodeId).textContent,
    "前段评论",
  );
  assert.equal(mapping("target_shared").resolution, "ambiguous");
  assert.equal(mapping("target_shared").afterNodeId, null);
  assert.equal(mapping("target_shared").afterTargetRef.sourceAnchor, undefined);
  assert.equal(
    applied.sourceIndex.byNodeId.get(mapping("target_first").afterNodeId).textContent,
    "前段评论",
  );
  assert.equal(
    applied.sourceIndex.byNodeId.get(mapping("target_second").afterNodeId).textContent,
    "后段",
  );
  assert.equal(mapping("target_crossing").resolution, "ambiguous");

  const undone = applyPatchPlan(applied.inversePlan, applied.html);
  assert.equal(undone.html, source);
  for (const targetId of [
    "target_shared",
    "target_first",
    "target_second",
    "target_crossing",
  ]) {
    const restored = undone.targetMappings.find((candidate) => (
      candidate.targetId === targetId && candidate.tracked
    ));
    assert.equal(restored.resolution, "exact");
    assert.equal(
      undone.sourceIndex.byNodeId.get(restored.afterNodeId).textContent,
      "前段评论后段",
    );
  }
});

test("a tracked comment follows its exact sibling through reorder and undo", () => {
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

  const undone = applyPatchPlan(applied.inversePlan, applied.html, {
    trackedTargetRefs: [refreshed],
  });
  const restored = undone.refreshedTrackedTargetRefs.find(
    (target) => target.targetId === "target_reorder_comment",
  );
  assert.equal(undone.html, source);
  assert.ok(restored);
  const originalPosition = resolvedElement(undone.sourceIndex, restored);
  assert.equal(originalPosition.textContent, "one");
  assert.equal(originalPosition.siblingIndex, 0);
});

test("consecutive source-backed moves remain serializable through undo and redo", () => {
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
  const history = [];
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
    history.push({ forwardPlan, inversePlan: applied.inversePlan });
    currentSource = applied.html;
    currentIndex = applied.sourceIndex;
    movingTarget = applied.refreshedTargetRefs.find(
      (target) => target.targetId === "rapid-reorder-a",
    );
    assert.ok(movingTarget);
    assert.equal(resolvedElement(currentIndex, movingTarget).siblingIndex, expectedIndex);
  }
  assert.deepEqual(order(currentIndex), ["b", "c", "d", "a"]);

  const redoPlans = [];
  for (const entry of history.toReversed()) {
    const undone = applyPatchPlan(entry.inversePlan, currentSource);
    redoPlans.push(undone.inversePlan);
    currentSource = undone.html;
    currentIndex = undone.sourceIndex;
  }
  assert.equal(currentSource, source);
  assert.deepEqual(order(currentIndex), ["a", "b", "c", "d"]);

  for (const redoPlan of redoPlans.toReversed()) {
    const redone = applyPatchPlan(redoPlan, currentSource);
    currentSource = redone.html;
    currentIndex = redone.sourceIndex;
  }
  assert.deepEqual(order(currentIndex), ["b", "c", "d", "a"]);
});

test("canvas keeps a logical reorder target through in-place refresh and reload fallback", async () => {
  const canvas = await readFile(
    new URL("../app/components/HtmlCanvasEditor.tsx", import.meta.url),
    "utf8",
  );
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
    readFile(
      new URL("../app/components/HtmlCanvasEditor.tsx", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../app/workbench.tsx", import.meta.url), "utf8"),
  ]);

  for (const required of [
    "{ trackedTargetRefs }",
    "result.targetMappings",
    "result.refreshedTrackedTargetRefs",
    "targetUpdates",
    "trackedTargetIds",
    "const ambientTargets = uniqueSelections([",
    "{ includeOperationTargetIds: mapsOneTargetToMany }",
    "deterministicOperationTargetUpdate",
    "includeUnresolvedTargetIds: recoverableSplitTargetIds",
    "const deterministicById = new Map(",
    "if (trackedTargetIds.has(target.id))",
    "rebindTargetsPreservingGlobal(nextHtml, untrackedSafeTargets)",
    "isGlobalPageTarget(target)",
    "exactGlobalPageTarget(target)",
    "!isGlobalPageTarget(target) && canLocateTarget(target)",
    ": canLocateTarget(target)",
    "independentCommentTarget(draftTarget, commentId)",
    "relinkSelectionArmedRef.current",
  ]) {
    assert.match(
      `${canvas}\n${workbench}`,
      new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  }
});

test("style writes use source-safe values, canonical target identity, and only active cascade rules", async () => {
  const [canvas, directEditHistory] = await Promise.all([
    readFile(
      new URL("../app/components/HtmlCanvasEditor.tsx", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../app/lib/direct-edit-history.js", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(
    canvas,
    /beforeValue:\s*inlineBefore/u,
    "CSSOM-normalized values must not be compared with authored source text",
  );
  assert.match(directEditHistory, /last\.target\.id !== mutation\.target\.id/u);
  assert.doesNotMatch(
    directEditHistory,
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
  const canvas = await readFile(
    new URL("../app/components/HtmlCanvasEditor.tsx", import.meta.url),
    "utf8",
  );
  const stablePreview = canvas.slice(
    canvas.indexOf("const synchronizeStablePreview = useCallback"),
    canvas.indexOf("const recordHistoryEntry", canvas.indexOf("const synchronizeStablePreview = useCallback")),
  );
  const applyCommand = canvas.slice(
    canvas.indexOf("const applySourceCommand = useCallback"),
    canvas.indexOf("const resetSelection = useCallback", canvas.indexOf("const applySourceCommand = useCallback")),
  );
  const applyHistory = canvas.slice(
    canvas.indexOf("const applyHistoryPlan = useCallback"),
    canvas.indexOf("const undo = useCallback", canvas.indexOf("const applyHistoryPlan = useCallback")),
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
  assert.match(canvas, /srcDoc=\{frameRender\.html\}/u);

  assert.match(applyCommand, /previewStayedMounted = synchronizeStablePreview/u);
  assert.match(
    applyCommand,
    /if \(!previewStayedMounted\) \{[\s\S]*loadFrameSource\(result\.html, \{ preserveViewport: true \}\)/u,
  );
  assert.doesNotMatch(applyHistory, /synchronizeStablePreview/u);
  assert.match(
    applyHistory,
    /PageRoot history never shares[\s\S]*?queueNativeFenceReload\([\s\S]*?result\.html,[\s\S]*?nativeBookmark,[\s\S]*?(?:appliedMutation\.target|historyResumeTarget)/u,
    "undo and redo must always rebuild a canonical frame rather than reuse Chromium history",
  );
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
  assert.match(applyCommand, /forwardPlan\.type === "replace-text-range"/u);
  assert.match(
    applyCommand,
    /const logicalSelection = options\.nativeTextCommit\?\.selection[\s\S]*?\?\? activeNativeEdit\.session\.getSelection\(\)/u,
  );
  assert.match(applyCommand, /buildSourceTextMap\(/u);
  assert.match(applyCommand, /canonicalNativeHostPreview\(/u);
  assert.match(applyCommand, /nativePreviewOwnershipMatches\(/u);
  assert.match(applyCommand, /restartCanonicalNativeEditRef\.current\(/u);
  assert.match(applyCommand, /buildRuntimeDomMap\(/u);
  assert.match(applyCommand, /\.session\.applyExternalBaseline\(\{/u);
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

test("canvas hides insertion affordances while retaining target recovery and local undo", async () => {
  const [canvas, css] = await Promise.all([
    readFile(new URL("../app/components/HtmlCanvasEditor.tsx", import.meta.url), "utf8"),
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
  assert.match(canvas, /撤销上一次文字、样式或排序修改/u);
  const undoLabel = canvas.indexOf('aria-label="撤销上一次文字、样式或排序修改"');
  const undoControl = canvas.slice(
    canvas.lastIndexOf("<button", undoLabel),
    canvas.indexOf("</button>", undoLabel),
  );
  assert.ok(undoLabel >= 0, "the local undo control must remain available");
  assert.match(undoControl, /disabled=\{/u);
  assert.match(undoControl, /undoDepth === 0/u);
  assert.match(undoControl, /!activeNativeEditRef\.current\?\.session\.isDirty\(\)/u);
  assert.match(
    undoControl,
    /!hasPendingNativeDraft/u,
    "uncheckpointed or composing native text must keep undo enabled",
  );
  assert.match(canvas, /historyId: mutation\.historyId/u);
  assert.match(canvas, /mutation\.historyId = appliedMutation\.historyId/u);
  assert.match(canvas, /historyAction: "undo" as const/u);
  const existingCommentMarker = canvas.slice(
    canvas.indexOf("commentMarkers.map"),
    canvas.indexOf("className={styles.globalCommentButton}", canvas.indexOf("commentMarkers.map")),
  );
  assert.match(existingCommentMarker, /selectTarget\(marker\.selection, \{ showToolbar: true \}\)/u);
  assert.doesNotMatch(existingCommentMarker, /onRequestCommentRef/u);

  assert.doesNotMatch(css, /\.insertionButton|\.insertionLine|\.insertionPoint|\.insertionPlus/u);
});

test("global comment selects the whole page, returns to the top, and keeps its marker away from the button", async () => {
  const [canvas, css] = await Promise.all([
    readFile(new URL("../app/components/HtmlCanvasEditor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/HtmlCanvasEditor.module.css", import.meta.url), "utf8"),
  ]);

  assert.match(canvas, /data-html-canvas-selected", nextSelection\.level/u);
  assert.match(canvas, /className=\{styles\.globalCommentButton\}/u);
  assert.match(canvas, />\s*全局评论\s*<\/button>/u);
  assert.match(canvas, /data-active=\{!interactionLocked && isPageRootSelection\(selection\)/u);
  assert.match(canvas, /disabled=\{interactionLocked\}/u);
  assert.match(canvas, /onClick=\{requestGlobalComment\}/u);
  assert.match(canvas, /defaultGlobalCommentElement\(documentNode\)/u);
  assert.match(canvas, /return documentNode\.body/u);
  assert.match(canvas, /selectElement\(globalElement, "module"\)/u);
  assert.match(canvas, /GLOBAL_SELECTION_ATTRIBUTE/u);
  assert.match(canvas, /documentNode\.defaultView\?\.scrollTo\(\{[\s\S]*?top: 0/u);
  assert.match(canvas, /isGlobalPageTarget[\s\S]*?frameOffsetLeft \+ 18/u);
  assert.match(canvas, /data-global=\{isPageRootSelection\(marker\.selection\)/u);
  assert.doesNotMatch(
    canvas,
    /\{!interactionLocked && selection\?\.level === "module" \? \([\s\S]*className=\{styles\.globalCommentButton\}/u,
  );
  assert.match(canvas, /toolbarVisible[\s\S]*?!isPageRootSelection\(selection\)[\s\S]*?overlayPosition/u);
  assert.match(canvas, /levelOverride \?\? identityTarget\?\.level \?\? inferSelectionLevel\(element\)/u);
  assert.match(canvas, /element === element\.ownerDocument\.documentElement/u);
  assert.match(canvas, /\[data-html-canvas-selected="part"\]/u);
  assert.match(canvas, /\[data-html-canvas-selected="module"\]:not\(\[data-html-canvas-global-selected\]\)/u);
  assert.match(canvas, /\[data-html-canvas-global-selected\]/u);
  assert.doesNotMatch(canvas, /\[data-html-canvas-selected\]\s*\{/u);
  assert.match(css, /\.globalCommentButton\s*\{[\s\S]*color: #77747d;[\s\S]*background: #e9e8e5;/u);
  assert.match(css, /\.globalCommentButton\[data-active="true"\]\s*\{[\s\S]*background: #5147dc;/u);
  assert.match(css, /\.editor\s*\{[\s\S]*grid-template-rows:\s*40px minmax\(0, 1fr\)/u);
  assert.match(css, /\.frame\s*\{[\s\S]*grid-row:\s*2/u);
  assert.match(css, /\.editor:not\(\[data-render-verified="true"\]\) \.frame\s*\{[\s\S]*?visibility:\s*hidden/u);
});

test("preview native links and forms cannot navigate the editing canvas on double click", async () => {
  const canvas = await readFile(
    new URL("../app/components/HtmlCanvasEditor.tsx", import.meta.url),
    "utf8",
  );
  const doubleClickHandler = canvas.slice(
    canvas.indexOf("const handleDoubleClick = (event: MouseEvent) =>"),
    canvas.indexOf("const handleKeyDown = (event: KeyboardEvent) =>"),
  );
  assert.match(canvas, /function findNativeActionTarget/u);
  assert.match(canvas, /"a\[href\], area\[href\], button, form, input, select, textarea"/u);
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
  assert.match(clickHandler, /event\.preventDefault\(\);[\s\S]*?event\.stopPropagation\(\);[\s\S]*?selectElement\(target\)/u);
  assert.match(canvas, /documentNode\.addEventListener\("submit", handleSubmit, true\)/u);
});

test("native editing uses the authored DOM, browser Selection, and a measured host mode", async () => {
  const [canvas, nativeController, capability, preflight, policy] = await Promise.all([
    readFile(
      new URL("../app/components/HtmlCanvasEditor.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/components/NativeEditingController.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/lib/native-edit-capability.js", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/components/native-edit-runtime-preflight.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/lib/native-edit-policy.js", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(
    canvas,
    /const session(?:: NativeEditingController)? = new NativeEditingController\(\{[\s\S]*?hostElement,[\s\S]*?baseline,/u,
  );
  const caretPointHelper = canvas.slice(
    canvas.indexOf("function caretPointFromMouseEvent"),
    canvas.indexOf("function wordBoundsAtOffset"),
  );
  assert.match(caretPointHelper, /event\.clientX[\s\S]*?event\.clientY/u);
  assert.doesNotMatch(
    caretPointHelper,
    /event\.offset[XY]/u,
    "nested inline clicks must use viewport coordinates shared with Range rects",
  );
  assert.match(
    canvas,
    /const startEditing = useCallback\(\([\s\S]*?caretPoint\?: TextCaretPoint,[\s\S]*?restoredSelection\?: NativeEditSelection,[\s\S]*?session\.focusAtPoint\(caretPoint\)/u,
  );
  assert.match(
    canvas,
    /const caretPoint = caretPointFromMouseEvent\(event\)[\s\S]*?nativeTextRangeMatchesActivation\(nativeRange, target, caretPoint\)[\s\S]*?const editingStarted = capturedRange \? startEditing\(\) : false/u,
  );
  assert.match(
    canvas,
    /caretPositionFromPoint[\s\S]*?Never turn that proximity[\s\S]*?nativeTextRangeContainsPoint\(range, point\)/u,
    "an inert media surface or empty box must not fall back to nearby authored text",
  );
  assert.match(canvas, /inspectNativeEditRuntime\(/u);
  assert.match(
    preflight,
    /function hasGeneratedPseudoContent[\s\S]*?querySelectorAll<HTMLElement>\("\*"\)[\s\S]*?hasContent\(candidate, "::before"\)[\s\S]*?hasContent\(candidate, "::after"\)/u,
    "generated content on a descendant must block the whole native text island",
  );
  assert.match(
    preflight,
    /hasDisplayContents[\s\S]*?classifyNativeEventDelivery\([\s\S]*?observerReady:/u,
    "display:contents must use the explicit native or observer-guarded lane",
  );
  assert.match(canvas, /classifyNativeEditCapability\(/u);
  assert.match(canvas, /isNativeEditableCapability\(capability\)/u);
  assert.match(canvas, /reportBlockedEdit\(new Error\(capability\.userMessage\)\)/u);
  assert.match(canvas, /nativeLogicalText\(hostElement\) !== projection\.text/u);
  assert.match(canvas, /可选中文字后添加评论/u);
  assert.match(canvas, /继续浏览和选择文字/u);
  assert.match(capability, /EDITABLE: "native-editable"/u);
  assert.match(capability, /SELECT_COMMENT: "select-comment"/u);
  assert.match(capability, /COMMENT_ONLY: "comment-only"/u);
  assert.match(capability, /nativeEventDeliveryProven/u);
  assert.match(capability, /nativeEventDeliveryGuarded/u);

  const nativeBlur = canvas.slice(
    canvas.indexOf("onBlur: () => {"),
    canvas.indexOf("onEscape:", canvas.indexOf("onBlur: () => {")),
  );
  assert.match(
    nativeBlur,
    /const blurredLease = \{ \.\.\.activeAtBlur\.lease \};[\s\S]*?nativeEditLeasesMatch\(currentNativeEditLeaseRef\.current, blurredLease\)/u,
    "a deferred blur must stay bound to the lease that scheduled it",
  );
  assert.match(
    nativeBlur,
    /retainedFocus\?\.session === session[\s\S]*?nativeEditLeasesMatch\(retainedFocus\.lease, blurredLease\)[\s\S]*?retainNativeEditFocusRef\.current = null;[\s\S]*?return;/u,
    "toolbar focus must preserve only its exact native editing session",
  );
  assert.doesNotMatch(
    nativeBlur,
    /session\.focusSelection\(\)/u,
    "number and color inputs must retain focus instead of being stolen back by the iframe",
  );

  assert.match(nativeController, /applyNativeEditSessionAttributes\(this\.hostElement/u);
  assert.match(policy, /element\.setAttribute\("contenteditable", hostMode\)/u);
  assert.match(policy, /element\.setAttribute\("role", "textbox"\)/u);
  assert.match(nativeController, /this\.hostElement\.addEventListener\("beforeinput"/u);
  assert.match(nativeController, /documentNode\.addEventListener\("selectionchange"/u);
  assert.match(nativeController, /compositionstart/u);
  assert.match(nativeController, /compositionend/u);
  assert.match(
    nativeController,
    /export type NativeEditLeaseStamp = \{[\s\S]*?sessionId: string;[\s\S]*?domGeneration: number;[\s\S]*?sourceRevision: string;[\s\S]*?hostId: string;/u,
  );
  assert.match(
    canvas,
    /const lease: ActiveNativeEdit\["lease"\] = \{[\s\S]*?sessionId:[\s\S]*?domGeneration:[\s\S]*?sourceRevision:[\s\S]*?hostId:/u,
  );
  assert.match(
    canvas,
    /currentNativeEditLeaseRef\.current = null;[\s\S]*?activeNativeEditRef\.current = null;[\s\S]*?active\.session\.fenceDispose\(\)/u,
    "a History Fence must invalidate ownership before retiring the old controller",
  );
  assert.match(
    nativeController,
    /observer\.takeRecords\(\);[\s\S]*?observer\.disconnect\(\);[\s\S]*?observer\.takeRecords\(\)/u,
    "fencing must drain and disconnect MutationObserver records",
  );
  assert.match(
    nativeController,
    /this\.disposed = true;[\s\S]*?this\.detachSessionInfrastructure\(\);[\s\S]*?this\.cancelAllScheduledWork\(\)/u,
    "late native work must see a retired lease before listener and timer cleanup",
  );
  assert.match(canvas, /nativeHistoryDirtyRef\.current = true/u);
  assert.match(canvas, /nativeHistoryDirtyRef\.current = false/u);
  assert.match(
    canvas,
    /const needsCanonicalFence = Boolean\(bookmark\) \|\| nativeHistoryDirtyRef\.current/u,
    "save and export fences must replace a contaminated Document after the controller has blurred",
  );
  assert.match(nativeController, /focusAtPoint\(point\?: \{ clientX: number; clientY: number \}\)/u);
  assert.match(nativeController, /documentNode\.caretPositionFromPoint/u);
  assert.match(nativeController, /documentNode\.caretRangeFromPoint/u);
  assert.match(
    nativeController,
    /offsetNode === this\.hostElement \|\| this\.hostElement\.contains\(offsetNode\)/u,
  );
  assert.match(nativeController, /restoreNativeEditSessionAttributes\(/u);
  assert.doesNotMatch(
    `${canvas}\n${nativeController}`,
    /InlineEditSession|LexicalEditor|createEditor\(|registerPlainText|pageroot-text-editor|pageroot-text-ghost/u,
  );
  assert.doesNotMatch(nativeController, /documentNode\.body\.appendChild|surfaceElement/u);
  assert.doesNotMatch(
    canvas,
    /liveTarget\.textContent\s*=/u,
    "a preview refresh must never flatten semantic inline children",
  );
});

test("spacing menu is controlled and closes for outside toolbar and canvas interactions", async () => {
  const canvas = await readFile(
    new URL("../app/components/HtmlCanvasEditor.tsx", import.meta.url),
    "utf8",
  );
  assert.match(canvas, /const spacingMenuRef = useRef<HTMLDetailsElement>/u);
  assert.match(canvas, /const \[spacingMenuOpen, setSpacingMenuOpen\] = useState\(false\)/u);
  assert.match(canvas, /documentNode\.addEventListener\("pointerdown", closeOutsideSpacingMenu, true\)/u);
  assert.match(canvas, /const handleMouseDown = \(event: MouseEvent\) => \{[\s\S]*?setSpacingMenuOpen\(false\)/u);
  assert.match(canvas, /ref=\{spacingMenuRef\}[\s\S]*?open=\{spacingMenuOpen\}/u);
  assert.match(canvas, /setSpacingMenuOpen\(\(open\) => !open\)/u);
});

test("canvas root whitespace clears selection instead of selecting the document body", async () => {
  const canvas = await readFile(
    new URL("../app/components/HtmlCanvasEditor.tsx", import.meta.url),
    "utf8",
  );
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

test("canvas maps native DOM selections to source-safe patches and promotes media to modules", async () => {
  const [canvas, nativeController, sourceMap, sourcePatch, workbench, preflight] = await Promise.all([
    readFile(
      new URL("../app/components/HtmlCanvasEditor.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/components/NativeEditingController.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/lib/source-text-map.js", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/lib/source-patch-engine.js", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/workbench.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/components/native-edit-runtime-preflight.ts", import.meta.url),
      "utf8",
    ),
  ]);

  // Native Selection is the editing surface; persisted text still goes through
  // the source map and SourcePatchEngine rather than DOM serialization.
  const doubleClickHandler = canvas.slice(
    canvas.indexOf("const handleDoubleClick = (event: MouseEvent) =>"),
    canvas.indexOf("const handleKeyDown = (event: KeyboardEvent) =>"),
  );
  assert.match(canvas, /function activeTextRangeFromDocument/u);
  assert.match(canvas, /sourceTextNodeForDomText/u);
  assert.match(canvas, /range\.intersectsNode\(textNode\)/u);
  assert.match(canvas, /preserveTextSelection: true/u);
  assert.match(canvas, /documentNode\.addEventListener\("mouseup", handleMouseUp, true\)/u);
  assert.match(canvas, /if \(captureTextRange\(\)\)[\s\S]*?return;/u);
  const cloneRange = doubleClickHandler.indexOf(".cloneRange()");
  const selectWord = doubleClickHandler.indexOf("nativeRange = selectWordAtPoint(");
  const restoreNativeRange = doubleClickHandler.indexOf("selection?.addRange(nativeRange)");
  const captureRange = doubleClickHandler.indexOf("const capturedRange = nativeRange ? captureTextRange() : null;");
  const preserveSelection = doubleClickHandler.indexOf("preserveTextSelection: Boolean(nativeRange)");
  const startEditingAtRange = doubleClickHandler.indexOf(
    "const editingStarted = capturedRange ? startEditing() : false;",
  );
  assert.ok(cloneRange >= 0, "Chromium's double-click range must be cloned before DOM ownership changes");
  assert.ok(selectWord > cloneRange, "the word fallback must only run when Chromium supplied no range");
  assert.ok(restoreNativeRange > selectWord && captureRange > restoreNativeRange);
  assert.ok(preserveSelection > captureRange && startEditingAtRange > preserveSelection);
  assert.match(canvas, /function wordBoundsAtOffset[\s\S]*?new Intl\.Segmenter\([^)]*\{ granularity: "word" \}/u);
  assert.match(canvas, /function selectWordAtPoint[\s\S]*?selection\?\.addRange\(range\)/u);
  assert.match(
    doubleClickHandler,
    /!editingStarted[\s\S]*?restoredSelection\?\.addRange\(nativeRange\);[\s\S]*?captureTextRange\(\)/u,
    "a rejected direct edit must restore the user's native word selection",
  );
  assert.match(
    doubleClickHandler,
    /!nativeTextRangeMatchesActivation\(nativeRange, target, caretPoint\)[\s\S]*?nativeSelection\?\.removeAllRanges\(\)/u,
    "an invalid browser proximity range must be cleared before source capture",
  );
  assert.match(canvas, /if \(initialSelection\) session\.focusSelection\(\)/u);
  assert.match(canvas, /else if \(caretPoint\) session\.focusAtPoint\(caretPoint\)/u);
  assert.match(canvas, /type: "set-text-range-style"/u);
  assert.match(canvas, /segments: activeRange\.segments/u);
  assert.match(canvas, /TEXT_RANGE_EDITABLE_PROPERTIES/u);
  assert.match(canvas, /plan\.type === "set-text-range-style"/u);
  assert.match(canvas, /replaceChildren\([\s\S]*?documentNode\.importNode/u);
  assert.match(canvas, /data-text-range=\{hasTextRange \? "true"/u);

  assert.match(canvas, /classifyNativeEditCapability/u);
  assert.match(canvas, /buildSourceTextMap\(/u);
  assert.match(preflight, /function buildRuntimeDomMap\(/u);
  assert.match(canvas, /const captured = active\.session\.captureCheckpoint\(trigger\)/u);
  assert.match(
    canvas,
    /validateFormatSkeletonTransaction\([\s\S]*?replacements: replacements\.map\([\s\S]*?startOffset: replacement\.startOffset,[\s\S]*?endOffset: replacement\.endOffset/u,
  );
  assert.doesNotMatch(
    canvas,
    /textRangeToSourceEdit\(/u,
    "native DOM commits must use source-owned FormatSkeleton descriptors",
  );
  assert.match(canvas, /type: "replace-text-range"/u);
  assert.match(canvas, /const mappedReplacements = replacements\.map/u);
  assert.match(canvas, /const descriptorsByInput = new Map/u);
  assert.match(canvas, /replacements: mappedReplacements\.map[\s\S]*?deleteSegments: replacement\.deleteSegments[\s\S]*?insertAt: replacement\.insertAt/u);
  assert.match(canvas, /validateResult: \(candidate\)[\s\S]*?candidate\.refreshedTargetRefs[\s\S]*?projection\.text !== nextText/u);
  assert.match(canvas, /plan\.type === "replace-text-range"\) return false/u);
  assert.match(canvas, /NATIVE_EDIT_CHECKPOINT_DELAY_MS/u);
  assert.match(canvas, /state\.dirty && !state\.composing/u);
  assert.match(canvas, /patch\.kind === "text-range-style-open"/u);
  assert.match(
    nativeController,
    /if \(this\.composing \|\| this\.draftCompositionUnsettled\) \{[\s\S]*?reason: "composing"/u,
  );
  assert.match(nativeController, /NativeTextChangeTracker/u);
  assert.match(sourceMap, /export function textRangeToSourceEdit/u);
  assert.match(sourceMap, /export function textRangeToSourceSegments/u);

  // The patch protocol is plural even for one minimal diff so it can safely
  // map selections spanning more than one source text node.
  assert.match(sourcePatch, /Object\.hasOwn\(command, "replacements"\)/u);
  assert.match(sourcePatch, /inputs = command\.replacements/u);
  assert.match(sourcePatch, /Text replacements contain overlapping deletion ranges/u);
  assert.match(sourcePatch, /metadataReplacements = replacements\.map/u);
  assert.match(
    sourcePatch,
    /const TEXT_RANGE_LAYOUT_GUARD = "all: unset; display: inline !important"/u,
  );
  assert.doesNotMatch(
    sourcePatch,
    /TEXT_RANGE_LAYOUT_GUARD\s*=\s*["'][^"']*display\s*:\s*contents/iu,
  );
  assert.match(
    canvas,
    /hasFlexOrGridTextParent[\s\S]*?\["flex", "inline-flex", "grid", "inline-grid"\][\s\S]*?createsRangeWrapper[\s\S]*?hasFlexOrGridTextParent/u,
  );
  assert.match(
    canvas,
    /createsRangeWrapper && property === "backgroundColor"/u,
  );

  assert.doesNotMatch(canvas, /className=\{styles\.textRangeEditor\}|commitTextRangeEditing|directEditableTextRangeForElement/u);
  assert.doesNotMatch(
    `${canvas}\n${nativeController}`,
    /InlineEditSession|LexicalEditor|registerPlainText|pageroot-text-editor|pageroot-text-ghost/u,
  );
  assert.match(nativeController, /applyNativeEditSessionAttributes\(this\.hostElement/u);
  assert.doesNotMatch(canvas, /data-pageroot-text-flow-item/u);
  assert.match(canvas, /MEDIA_SURFACE_SELECTOR/u);
  assert.match(canvas, /element\.querySelector\(MEDIA_SURFACE_SELECTOR\)/u);
  assert.match(canvas, /inferSelectionLevel\(candidate\) === "module"/u);
  assert.match(canvas, /pointer-events: none !important/u);
  assert.match(canvas, /noscript \{[\s\S]*?display: none !important/u);
  assert.match(canvas, /prepareVerifiedFrameDocument[\s\S]*?editorStyle\.textContent = EDITOR_DOCUMENT_STYLES/u);
  assert.match(canvas, /pendingToolbarVisibleRef\.current = toolbarVisibleRef\.current/u);
  assert.match(canvas, /showToolbar: pendingToolbarVisible/u);
  assert.match(canvas, /rangeComputedStyles\.every\(styleIsBold\)/u);
  assert.match(canvas, /trackedTargetsRef\.current/u);
  assert.match(canvas, /preservesTextRange/u);
  assert.match(workbench, /trackedTargets=\{trackedAuditTargets\}/u);
  assert.match(
    workbench,
    /changeEventsRef\.current\.map\(\(event\) => event\.target\)/u,
  );
});

test("handoff commits a pending source edit before recapturing and freezing comment targets", async () => {
  const workbench = await readFile(
    new URL("../app/workbench.tsx", import.meta.url),
    "utf8",
  );
  const handoffStart = workbench.indexOf("const generateRequest = useCallback");
  const commit = workbench.indexOf(
    "const committed = editorRef.current?.fencePendingEdit({",
    handoffStart,
  );
  const initialCapture = workbench.indexOf(
    "let activeComments = commentsRef.current.filter",
    handoffStart,
  );
  const ensure = workbench.indexOf(
    "await ensureProjectRegistered();",
    initialCapture,
  );
  const recapture = workbench.indexOf(
    "activeComments = commentsRef.current.filter",
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
    "a failed native-edit History Fence must stop handoff before comment targets are captured",
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
  const flush = workbench.indexOf("await flushAutosave(freezeCutoffRevision)", projectLock);
  const requestDispatch = workbench.indexOf("requestDispatched = true", flush);
  assert.ok(flush > projectLock);
  assert.ok(requestDispatch > flush);
  assert.match(
    workbench.slice(flush, requestDispatch),
    /lastPersistedRevisionRef\.current !== freezeCutoffRevision[\s\S]*?editRevisionRef\.current !== freezeCutoffRevision[\s\S]*?persistedSourceSha256 !== frozen\.sourceSha256/u,
    "handoff must prove that the exact frozen revision and hash were persisted before dispatch",
  );
});
