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

test("edit visual projection never becomes review, persistence, or AI input", () => {
  const submission = section(
    workbench,
    "const generateRequest = useCallback",
    "const openCommittedVersion = useCallback",
  );
  assertOrdered(
    submission,
    [
      "const frozen = editorRef.current?.freezeNow()",
      "const capturedHtml = frozen.html",
      "const persistedSourceSha256 = documentSessionRef.current.sourceSha256",
      "persistedSourceSha256 !== frozen.sourceSha256",
      "bridgeClient.createRequest({",
      "expectedSourceSha256: persistedSourceSha256",
    ],
    "AI Request must remain bound to the exact frozen and persisted source",
  );
  assert.doesNotMatch(
    submission,
    /runtimeVisualProjection|data-pageroot-readonly-visual|data-pageroot-readonly-visual-host/u,
  );
  assert.doesNotMatch(
    submission.slice(submission.indexOf("bridgeClient.createRequest({")),
    /\b(?:html|baseHtml|projection)\s*:/u,
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
      "const adoptedContext = await adoptGeneratedSourcePath",
    ],
    "the current project must cross a fail-closed Canvas Fence before source adoption",
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
      "if (canonicalSourcePath !== activeSource)",
      "if (!mustAdoptAuthoritativeSource)",
      "fenceAndFreezeCurrentCanvas(",
      "const adoptedContext = await adoptGeneratedSourcePath",
      "mustAdoptAuthoritativeSource = true",
      "if (mustAdoptAuthoritativeSource)",
      "const sourcePayload = await bridgeClient.source",
      "await verifyCanvasRendered",
    ],
    "metadata refresh must not silently become a source transition",
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
