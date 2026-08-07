import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  readCanvasArchitecture,
  readWorkbenchArchitecture,
} from "./source-architecture-fixture.mjs";

const [canvas, workbench, islandController] = await Promise.all([
  readCanvasArchitecture(),
  readWorkbenchArchitecture(),
  readFile(
    new URL("../app/components/IslandEditingController.ts", import.meta.url),
    "utf8",
  ),
]);

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

test("pending and already-scheduled callbacks share one cancellable latest-wins slot", () => {
  const queue = section(
    canvas,
    "const discardNativeCommandCallback = useCallback",
    "const refreshNativeEditRangeState = useCallback",
  );

  assert.match(
    canvas,
    /const scheduledNativeCommandCallbackRef = useRef<PendingNativeCommandCallback \| null>\(null\)/u,
  );
  assert.match(
    queue,
    /const pending = pendingNativeCommandCallbackRef\.current;[\s\S]*?const scheduled = scheduledNativeCommandCallbackRef\.current;/u,
  );
  assertOrdered(
    queue,
    [
      "pendingNativeCommandCallbackRef.current = null",
      "scheduledNativeCommandCallbackRef.current = null",
      "discardNativeCommandCallback(pending, reason)",
      "discardNativeCommandCallback(scheduled, reason)",
    ],
    "both queue phases must be retired before discard callbacks run",
  );
  assert.match(
    queue,
    /discardPendingNativeCommands\("superseded"\);[\s\S]*?pendingNativeCommandCallbackRef\.current = \{/u,
    "a replacement must discard both the pending and scheduled predecessor before installation",
  );
  assert.match(
    queue,
    /scheduledNativeCommandCallbackRef\.current = pending;[\s\S]*?queueMicrotask\(\(\) => \{[\s\S]*?scheduledNativeCommandCallbackRef\.current !== pending[\s\S]*?scheduledNativeCommandCallbackRef\.current = null;[\s\S]*?pending\.run\(\)/u,
    "a consumed command must remain cancellable until its execution microtask",
  );
  assert.match(
    canvas,
    /onDiscard\?: \(reason: NativeDeferredCommandDiscardReason\) => void/u,
  );
  assert.match(
    queue,
    /try \{[\s\S]*?callback\.onDiscard\(reason\);[\s\S]*?\} catch \{/u,
    "discard bookkeeping must be delivered but cannot revive or break teardown",
  );
});

test("system work cannot replace a queued or scheduled user command", () => {
  const queue = section(
    canvas,
    "const deferNativeCommand = useCallback",
    "deferNativeCommandRef.current = deferNativeCommand",
  );

  assertOrdered(
    queue,
    [
      "const incumbent = pendingNativeCommandCallbackRef.current",
      "?? scheduledNativeCommandCallbackRef.current",
      "authority === \"system\" && incumbent?.authority === \"user-explicit\"",
      "options.onDiscard?.(\"blocked-by-user-command\")",
      "return true",
      "active.session.queuePendingCommand",
    ],
    "system priority must be decided before touching the controller queue",
  );
  assert.match(
    queue,
    /active\.session\.queuePendingCommand\(\{[\s\S]*?authority,[\s\S]*?payload,/u,
    "command authority must also reach the controller fallback policy",
  );
});

test("Workbench header drawers defer until the active composition is settled", () => {
  const headerActions = section(
    workbench,
    "<WorkbenchHeaderActions",
    "</WorkbenchHeaderActions>",
  );

  assert.match(
    headerActions,
    /const openProjectPanel = \(\) => \{[\s\S]*?setDrawer\(\(current\) => \([\s\S]*?"files"[\s\S]*?\)\);[\s\S]*?deferEditorCommand\("project-files", openProjectPanel\)/u,
  );
});

test("format replay rebinds the live element after its checkpoint", () => {
  const format = section(
    canvas,
    "const applyInlineStyle = useCallback",
    "const handleToolbarKeyDown",
  );

  assert.match(format, /let element = selectedElementRef\.current;/u);
  assertOrdered(
    format,
    [
      "const checkpoint = checkpointNativeEdit(\"style\")",
      "activeNativeEdit = activeNativeEditRef.current",
      "element = selectedElementRef.current",
      "!element.isConnected",
      "element !== activeNativeEdit.rootElement",
      "view = element.ownerDocument.defaultView",
      "sourceTextParentsForSegments(element",
    ],
    "formatting must stop using the pre-checkpoint DOM after canonical restart",
  );
});

test("canonical island replacement retires the old lease before DOM removal", () => {
  const restart = section(
    canvas,
    "restartCanonicalNativeEditRef.current = (",
    "const moveSelected = useCallback",
  );

  assertOrdered(
    restart,
    [
      "currentNativeEditLeaseRef.current = null",
      "activeNativeEditRef.current = null",
      "discardPendingNativeCommands(\"session-ended\")",
      "active.session.fenceDispose()",
      "nativeDomGenerationRef.current += 1",
      "parentNode.replaceChild(nextRoot, active.rootElement)",
      "startEditing(undefined, logicalSelection)",
    ],
    "a focused old host must be inert before replaceChild can dispatch focus events",
  );
});

test("source-authority fences defer preview reconcile and retire the editable DOM", () => {
  const fence = section(
    canvas,
    "const fencePendingEdit = useCallback",
    "const commitPendingEdit = useCallback",
  );

  assert.match(
    fence,
    /checkpointNativeEdit\(options\.trigger \?\? "fence", \{[\s\S]*?deferPreviewReconcile: true/u,
  );
  assert.match(
    canvas,
    /options\.islandTextCommit\.deferPreviewReconcile[\s\S]*?"v2-island-fence-deferred"/u,
    "a fence checkpoint must not create an interim contenteditable session",
  );
  assertOrdered(
    fence,
    [
      "checkpointNativeEdit(options.trigger ?? \"fence\"",
      "detachNativeEditForFence()",
      "needsCanonicalFence",
      "queueNativeFenceReload(",
    ],
    "a source fence must retire the live editable document before resuming",
  );
});

test("V2 composition and source revision advance both use hard generation boundaries", () => {
  const composition = section(
    islandController,
    "private handleCompositionStart",
    "private handleBlur",
  );
  assertOrdered(
    composition,
    [
      "this.compositionSnapshot = {",
      "children: Array.from(this.hostElement.childNodes)",
      "selection: this.getSelection()",
      "this.composing = true",
      "this.composing = false",
      "restoreChildren(this.hostElement, snapshot.children)",
      "setSelectionValue(this.hostElement, snapshot.selection)",
      "insertTextAtSelection(this.hostElement, event.data ?? \"\")",
      "this.validateDom()",
    ],
    "V2 IME completion must replay one final value into the frozen island and selection",
  );
  const rebase = section(
    islandController,
    "applyExternalIslandBaseline(",
    "applyExternalBaseline(",
  );
  assertOrdered(
    rebase,
    [
      "leaseStampsMatch(",
      "normalizeEditableIslandHtml(",
      "this.ownedCanonicalInnerHtml !== canonical",
      "this.lease.advance(currentLease, nextLease)",
      "this.leaseStamp = nextLease",
    ],
    "V2 must validate the canonical island before advancing its only outer lease",
  );
});

test("Workbench bridges deferred manual version opening success, failure, and discard distinctly", () => {
  const openVersion = section(
    workbench,
    "const openCommittedVersion = useCallback",
    "const processRunStatus = useCallback",
  );
  const activateReady = section(
    workbench,
    "const activateReadyResult = useCallback",
    "const processRunStatus = useCallback",
  );

  assert.match(
    workbench,
    /openCommittedVersion\?: \([\s\S]*?resolve: \(\) => void,[\s\S]*?reject: \(reason: unknown\) => void,/u,
  );
  assert.match(
    openVersion,
    /new Promise<void>\(\(resolve, reject\) => \{[\s\S]*?resolveDeferred = resolve;[\s\S]*?rejectDeferred = reject;/u,
  );
  assert.match(
    openVersion,
    /const replay = deferredEditorReplayRef\.current\.openCommittedVersion;[\s\S]*?if \(!replay\) \{[\s\S]*?new DeferredEditorCommandDiscardedError\("stale-session"\)[\s\S]*?return;[\s\S]*?replay\([\s\S]*?\(\) => resolveDeferred\?\.\(\),[\s\S]*?\(reason\) => rejectDeferred\?\.\(reason\)/u,
    "an unavailable replay endpoint must reject with the retryable discard sentinel",
  );
  assert.match(
    openVersion,
    /onDiscard: \(reason\) => rejectDeferred\?\.\([\s\S]*?new DeferredEditorCommandDiscardedError\(reason\)/u,
  );
  assert.match(
    openVersion,
    /openCommittedVersion\(run, payload, true\)\.then\(resolve, reject\)/u,
  );
  assert.doesNotMatch(openVersion, /openCommittedVersion\(run, payload, true\)\.finally/u);
  assert.match(
    workbench,
    /class DeferredEditorCommandDiscardedError extends Error[\s\S]*?readonly reason: NativeDeferredCommandDiscardReason/u,
  );
  assert.match(
    activateReady,
    /catch \(cause\) \{\s*if \(isDeferredEditorCommandDiscardedError\(cause\)\) return;/u,
    "a latest-wins discard must keep the ready run tracked so the user can retry opening it",
  );
  assert.match(
    activateReady,
    /await openCommittedVersion\(run, mergedPayload\);/u,
    "a ready result may enter the Canvas queue only after the user activates it",
  );
});

test("a background project result never attaches to the current Canvas queue", () => {
  const openVersion = section(
    workbench,
    "const openCommittedVersion = useCallback",
    "const processRunStatus = useCallback",
  );

  assertOrdered(
    openVersion,
    [
      "const affectsCurrentCanvas = Boolean(projectSessionRef.current.sourcePath)",
      "projectSessionRef.current.projectId === run.projectId",
      "if (!fromDeferred && affectsCurrentCanvas)",
      "deferEditorCommand(",
    ],
    "project identity must gate access to the current editor queue",
  );
  assert.doesNotMatch(
    openVersion.slice(
      0,
      openVersion.indexOf("if (!fromDeferred && affectsCurrentCanvas)"),
    ),
    /deferEditorCommand\(/u,
  );
  assert.match(
    openVersion,
    /"external-refresh"[\s\S]*?authority: "system"/u,
  );
});

test("refresh and project-switch awaiters always settle when replayed or discarded", () => {
  const refresh = section(
    workbench,
    "const refreshWorkspace = useCallback",
    "const hydrateRecentProjectRuns = useCallback",
  );
  const prepare = section(
    workbench,
    "const prepareProjectSwitch = useCallback",
    "const openProject = useCallback",
  );

  assert.match(
    refresh,
    /authority: "system",[\s\S]*?onDiscard: \(\) => resolveDeferred\?\.\(\)/u,
  );
  assertOrdered(
    refresh,
    [
      "if (!fromDeferred && sourceTransitionToken === undefined)",
      "deferEditorCommand(",
    ],
    "an authorized project hydration must bypass a stale native-edit queue",
  );
  assert.match(
    refresh,
    /finally \{[\s\S]*?hydrationSourceTransitionAuthorized[\s\S]*?epoch === projectSessionRef\.current\.epoch[\s\S]*?sameLocalSourcePath\(projectSessionRef\.current\.sourcePath, activeSource\)[\s\S]*?setProjectHydrating\(false\)/u,
    "the current hydration owner must release its lock on every exit path",
  );
  assert.match(
    refresh,
    /const replay = deferredEditorReplayRef\.current\.refreshWorkspace;[\s\S]*?if \(!replay\) \{[\s\S]*?resolveDeferred\?\.\(\);[\s\S]*?return;[\s\S]*?replay\(/u,
    "an unavailable refresh replay endpoint must release its non-throwing waiter",
  );
  assert.match(
    refresh,
    /refreshWorkspace\([\s\S]*?sourceOverride,[\s\S]*?epochOverride,[\s\S]*?true,[\s\S]*?sourceTransitionToken,[\s\S]*?\)\.then\(resolve, resolve\)/u,
    "refresh failures and supersession both release their non-throwing waiter",
  );
  assert.match(
    prepare,
    /onDiscard: \(\) => resolveDeferred\?\.\(false\)/u,
  );
  assert.match(
    prepare,
    /const replay = deferredEditorReplayRef\.current\.prepareProjectSwitch;[\s\S]*?if \(!replay\) \{[\s\S]*?resolveDeferred\?\.\(false\);[\s\S]*?return;[\s\S]*?replay\(\(value\) => resolveDeferred\?\.\(value\),[\s\S]*?retrySourcePath,[\s\S]*?onDeferred/u,
    "an unavailable project-switch replay endpoint must fail closed",
  );
  assert.match(
    prepare,
    /prepareProjectSwitch\(true, options\)\.then\(resolve, \(\) => resolve\(false\)\)/u,
    "project-switch failure and discard must both resolve false",
  );
});
