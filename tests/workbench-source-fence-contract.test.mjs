import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workbench = await readFile(
  new URL("../app/workbench.tsx", import.meta.url),
  "utf8",
);

function section(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing section start: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing section end: ${endMarker}`);
  return source.slice(start, end);
}

function assertOrdered(source, markers, message) {
  let cursor = -1;
  for (const marker of markers) {
    const next = source.indexOf(marker, cursor + 1);
    assert.notEqual(next, -1, `${message}: missing ${marker}`);
    assert.ok(next > cursor, `${message}: ${marker} is out of order`);
    cursor = next;
  }
}

test("source-boundary freeze is fail closed and verifies the exact source snapshot", () => {
  const boundary = section(
    workbench,
    "const fenceAndFreezeCurrentCanvas = useCallback",
    "const fileInputRef",
  );

  assertOrdered(
    boundary,
    [
      "const editor = editorRef.current",
      "if (!editor)",
      "const frozen = editor.freezeNow()",
      "if (!frozen.ok)",
      "editor.getSourceHtml() !== frozen.html",
      "return { ok: true",
    ],
    "a source transition must not proceed without a frozen exact Canvas snapshot",
  );
});

test("autosave accepts only a byte-identical acknowledgement and fences protocol failures", () => {
  const autosave = section(
    workbench,
    "const flushAutosave = useCallback",
    "const enqueueAutosave = useCallback",
  );

  assert.match(
    autosave,
    /typeof payload\.content === "string"\s*&& payload\.content === write\.html/u,
  );
  assert.match(autosave, /const targetSha256 = await browserSha256\(write\.html\)/u);
  assert.match(autosave, /invalidAck\.code = "INVALID_AUTOSAVE_ACK"/u);
  assertOrdered(
    autosave,
    [
      "const protocolError = error.code === \"INVALID_AUTOSAVE_ACK\"",
      "fenceAndFreezeCurrentCanvas(",
      "persistRecoveryLog(recoveryWrite, writeContext)",
      "// editing host is frozen; only now may the conflict lock appear.",
      "documentSessionRef.current.setPersistence({",
      "state: \"conflict\"",
    ],
    "conflict state must be published only after the native draft is frozen and recovered",
  );
  assert.match(
    autosave,
    /else if \(protocolError\) \{[\s\S]*?projectLoadErrorRef\.current = failClosedMessage/u,
    "a byte-mismatched ACK must lock for source review instead of being adopted",
  );
});

test("an identity-mismatched recovery candidate freezes before becoming a conflict", () => {
  const recovery = section(
    workbench,
    "const recoverAutosaveLog = useCallback",
    "const recoverDraftLog = useCallback",
  );

  assertOrdered(
    recovery,
    [
      "await verifyCanvasRendered(recoveredHtml, targetSha256, context)",
      "fenceAndFreezeCurrentCanvas(",
      "if (!frozen.ok)",
      "documentSessionRef.current.setPersistence({",
      "state: \"failed\"",
      "throw new Error(failClosedMessage)",
      "documentSessionRef.current.setPersistence({",
      "state: \"conflict\"",
    ],
    "recovered bytes must be rendered and frozen before the conflict lock is published",
  );
});

test("beforeunload observes native composition drafts and unacknowledged revisions", () => {
  const unload = section(
    workbench,
    "const beforeUnload = (event: BeforeUnloadEvent) => {",
    "window.addEventListener(\"beforeunload\"",
  );
  const obligations = section(
    workbench,
    "coordinator.replace(\"source\"",
    "const rememberAttachmentObjectUrl",
  );

  assert.match(unload, /hasPending\("close"\)/u);
  assert.match(unload, /event\.preventDefault\(\)/u);
  assert.match(
    obligations,
    /documentSessionRef\.current\.editRevision > documentSessionRef\.current\.lastPersistedRevision/u,
  );
  assert.match(obligations, /editorRef\.current\?\.hasPendingNativeEdit\(\)/u);
});

test("opening a committed version strictly freezes the current Canvas before adoption", () => {
  const openVersion = section(
    workbench,
    "const openCommittedVersion = useCallback",
    "const processRunStatus = useCallback",
  );

  assertOrdered(
    openVersion,
    [
      "const transitionAffectsCurrentCanvas",
      "const transitionContext = captureProjectContext()",
      "if (!transitionContext)",
      "const frozen = fenceAndFreezeCurrentCanvas(",
      "if (!frozen.ok)",
      "isCurrentProjectContext(transitionContext)",
      "persistRecoveryLog(null, transitionContext)",
      "const preparedTransition = await prepareGeneratedSourceTransition",
      "const adoptedContext = commitGeneratedSourceTransition",
      "await verifyCanvasRendered",
    ],
    "the current project must prepare complete bytes before one synchronous authority publication",
  );

  const publication = section(
    workbench,
    "const commitGeneratedSourceTransition = useCallback",
    "const recoverAutosaveLog = useCallback",
  );
  assert.doesNotMatch(publication, /\bawait\b/u);
  assertOrdered(
    publication,
    [
      "projectSessionRef.current.transitionSource",
      "documentSessionRef.current.publishAuthority",
      "publishVersion()",
      "invalidateCanvasRenderAcks()",
    ],
    "project, complete document, version and Canvas generation must publish without an async gap",
  );
});

test("workspace source adoption requires an explicit hydration token or a live source fence", () => {
  const refresh = section(
    workbench,
    "const refreshWorkspace = useCallback",
    "const hydrateRecentProjectRuns = useCallback",
  );

  assert.match(refresh, /sourceTransitionToken\?: number/u);
  assert.match(
    refresh,
    /sourceTransitionToken === epoch[\s\S]*?sourceTransitionToken === projectSessionRef\.current\.epoch[\s\S]*?projectHydratingRef\.current/u,
  );
  assertOrdered(
    refresh,
    [
      "if (projectHydratingRef.current && !hydrationSourceTransitionAuthorized)",
      "if (!sameLocalSourcePath(canonicalSourcePath, activeSource))",
      "if (!mustAdoptAuthoritativeSource)",
      "fenceAndFreezeCurrentCanvas(",
      "preparedTransition = await prepareGeneratedSourceTransition",
      "mustAdoptAuthoritativeSource = true",
      "const currentHtmlSha256 = await browserSha256",
      "const sourcePayload = await bridgeClient.source",
      "const publishVersionAuthority",
      "commitGeneratedSourceTransition",
      "await verifyCanvasRendered",
    ],
    "workspace refresh must stage complete source authority before publishing project, document and version",
  );
  assert.doesNotMatch(
    refresh,
    /documentSessionRef\.current\.setSourceSha256\(workspaceHash\)/u,
    "workspace metadata must never publish a Hash without the matching HTML tuple",
  );
  assert.match(
    workbench,
    /refreshWorkspace\(active\.sourcePath, epoch, false, epoch\)/u,
  );
  assert.match(
    workbench,
    /refreshWorkspace\(project\.sourcePath, epoch, false, epoch\)/u,
  );
});

test("canvas verification fences stale generations and performs one bounded rebuild", () => {
  const verification = section(
    workbench,
    "const verifyCanvasRendered = useCallback",
    "const clearAutosaveTimer",
  );

  assert.match(verification, /expectedGeneration/u);
  assert.match(verification, /documentSessionRef\.current\.canvasGeneration/u);
  assert.match(verification, /documentSessionRef\.current\.reloadCanvas\(\)/u);
  assert.match(verification, /acknowledgeCanvasRender\("edit"/u);
  assert.equal(
    (verification.match(/reloadCanvas\(\)/gu) || []).length,
    1,
    "automatic recovery must stay bounded to one Canvas rebuild",
  );
});

test("safe-save projection requires the visible Canvas to acknowledge current source authority", () => {
  assert.match(
    workbench,
    /const isSafelySaved = Boolean\([\s\S]*?persistState === "idle"[\s\S]*?editRevision === lastPersistedRevision[\s\S]*?visibleCanvasAck\?\.generation === canvasGeneration[\s\S]*?visibleCanvasAck\.sha256 === sourceSha256/u,
  );
  assert.match(workbench, /isSafelySaved\s*\? "已安全保存"/u);
});

test("a disk acknowledgement cannot impersonate a Canvas render acknowledgement", () => {
  const flush = section(
    workbench,
    "const flushAutosave = useCallback",
    "const enqueueAutosave = useCallback",
  );
  assert.doesNotMatch(flush, /acknowledgeCanvasRender/u);
  assert.match(
    flush,
    /writeCompletesCurrentDocument[\s\S]*?html: acknowledgedHtml,[\s\S]*?sourceSha256: nextHash,[\s\S]*?lastPersistedRevision: persistedDocumentRevision/u,
  );
  assert.match(
    workbench,
    /editorRef\.current\?\.getRenderedSourceHtml\(\) === nextHtml[\s\S]*?acknowledgeCanvasRender\("edit", renderGeneration, renderedSha256\)/u,
  );
});

test("source undo keeps its in-place Canvas lease while publishing a complete tuple", () => {
  const historyAction = section(
    workbench,
    "const requestSourceHistoryAction = useCallback",
    "  useEffect(() => {\n    deferredEditorReplayRef.current.requestSourceHistoryAction = (",
  );
  assert.match(
    historyAction,
    /adoptHistorySource\([\s\S]*?documentSessionRef\.current\.update\(\{[\s\S]*?html: canonicalHtml,[\s\S]*?sourceSha256: nextSourceSha256/u,
  );
  assert.doesNotMatch(historyAction, /publishAuthority/u);
});
