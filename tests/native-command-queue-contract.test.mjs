import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [canvas, workbench, nativeController] = await Promise.all([
  readFile(
    new URL("../app/components/HtmlCanvasEditor.tsx", import.meta.url),
    "utf8",
  ),
  readFile(new URL("../app/workbench.tsx", import.meta.url), "utf8"),
  readFile(
    new URL("../app/components/NativeEditingController.ts", import.meta.url),
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

test("queued undo and redo bypass their own defer branch exactly once", () => {
  const undo = section(
    canvas,
    "const undo = useCallback",
    "const redo = useCallback",
  );
  const redo = section(
    canvas,
    "const redo = useCallback",
    "const checkpointPendingEdit = useCallback",
  );

  assert.match(canvas, /const undoRef = useRef<\(fromQueuedCommand\?: boolean\) => boolean>/u);
  assert.match(canvas, /const redoRef = useRef<\(fromQueuedCommand\?: boolean\) => boolean>/u);
  assert.match(undo, /\(fromQueuedCommand = false\): boolean/u);
  assert.match(
    undo,
    /!fromQueuedCommand[\s\S]*?deferNativeCommandRef\.current\("undo", \(\) => undoRef\.current\(true\)\)/u,
  );
  assert.doesNotMatch(
    undo,
    /deferNativeCommandRef\.current\("undo", \(\) => undoRef\.current\(\)\)/u,
  );
  assertOrdered(
    undo,
    [
      "!fromQueuedCommand",
      "deferNativeCommandRef.current(\"undo\"",
      "checkpointNativeEdit(\"history\", {",
      "applyHistoryPlan(",
    ],
    "queued undo must bypass re-queuing before committing history",
  );

  assert.match(redo, /\(fromQueuedCommand = false\): boolean/u);
  assert.match(
    redo,
    /!fromQueuedCommand[\s\S]*?deferNativeCommandRef\.current\("redo", \(\) => redoRef\.current\(true\)\)/u,
  );
  assert.doesNotMatch(
    redo,
    /deferNativeCommandRef\.current\("redo", \(\) => redoRef\.current\(\)\)/u,
  );
});

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
    '<nav className="header-actions"',
    "</nav>",
  );

  assert.match(
    headerActions,
    /const openProjectPanel = \(\) => \{[\s\S]*?setDrawer\(\(current\) => \([\s\S]*?"files"[\s\S]*?\)\);[\s\S]*?deferEditorCommand\("project-files", openProjectPanel\)/u,
  );
});

test("focus retention is scoped to one lease and cannot leak across a rebuilt session", () => {
  const blur = section(
    canvas,
    "onBlur: () => {",
    "onEscape:",
  );
  const toolbar = section(
    canvas,
    "onPointerDownCapture={(event) => {",
    "onMouseDownCapture={(event) => {",
  );

  assert.match(
    canvas,
    /type RetainedNativeEditFocus = \{[\s\S]*?session: NativeEditingController;[\s\S]*?lease: ActiveNativeEdit\["lease"\];[\s\S]*?\};/u,
  );
  assertOrdered(
    toolbar,
    [
      "activeNativeEdit.session.isComposing()",
      "event.preventDefault()",
      "return",
      "retainNativeEditFocusRef.current = {",
      "session: activeNativeEdit.session",
      "lease: { ...activeNativeEdit.lease }",
    ],
    "prevented composition gestures must not mint a stale focus-retention token",
  );
  assert.match(
    blur,
    /retainNativeEditFocusRef\.current\?\.session === session[\s\S]*?retainNativeEditFocusRef\.current = null;[\s\S]*?return;/u,
    "an obsolete session must clear its own token before returning",
  );
  assert.match(
    blur,
    /retainedFocus\?\.session === session[\s\S]*?nativeEditLeasesMatch\(retainedFocus\.lease, blurredLease\)/u,
    "a valid toolbar-focus exception must match both session and lease",
  );
  assert.match(canvas, /discardPendingNativeCommands\("session-ended"\);\s*retainNativeEditFocusRef\.current = null;/u);
  assert.match(canvas, /discardPendingNativeCommands\("unmounted"\);\s*retainNativeEditFocusRef\.current = null;/u);
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

test("source-authority fences defer preview reconcile and cut history even when the stack is empty", () => {
  const fence = section(
    canvas,
    "const fencePendingEdit = useCallback",
    "const commitPendingEdit = useCallback",
  );
  const undo = section(canvas, "const undo = useCallback", "const redo = useCallback");
  const redo = section(
    canvas,
    "const redo = useCallback",
    "const checkpointPendingEdit = useCallback",
  );

  assert.match(
    fence,
    /checkpointNativeEdit\(options\.trigger \?\? "fence", \{[\s\S]*?deferPreviewReconcile: true/u,
  );
  assert.match(
    canvas,
    /if \(options\.nativeTextCommit\?\.deferPreviewReconcile\) \{[\s\S]*?"fence-deferred"/u,
    "a fence checkpoint must not create an interim contenteditable session",
  );
  for (const historyCommand of [undo, redo]) {
    assertOrdered(
      historyCommand,
      [
        "checkpointNativeEdit(\"history\", {",
        "detachNativeEditForFence()",
        "if (!entry)",
        "queueNativeFenceReload(",
      ],
      "every invoked source-history command must retire Chromium history before a no-op return",
    );
  }
});

test("composition checkpoints and source revision advance both use hard generation boundaries", () => {
  assert.match(
    nativeController,
    /this\.tracker\.replaceCurrentRange\([\s\S]*?this\.requiresCanonicalReconcile = true;/u,
    "a strictly accepted IME value must still restart the island before an old tail can reach a new revision",
  );
  const rebase = section(
    nativeController,
    "const draftRebased = this.blockDraft.rebaseFromSource({",
    "this.leaseStamp = nextLease",
  );
  assertOrdered(
    rebase,
    [
      "advanceLease: (expected, next)",
      "this.leaseAdvance(currentLease, nextLease)",
      "if (!draftRebased.accepted)",
    ],
    "the shadow draft must validate before it performs the only outer lease CAS",
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
      "const affectsCurrentCanvas = Boolean(sourcePathRef.current)",
      "projectIdRef.current === run.projectId",
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
    /finally \{[\s\S]*?hydrationSourceTransitionAuthorized[\s\S]*?epoch === projectEpochRef\.current[\s\S]*?sameLocalSourcePath\(sourcePathRef\.current, activeSource\)[\s\S]*?setProjectHydrating\(false\)/u,
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
    /const replay = deferredEditorReplayRef\.current\.prepareProjectSwitch;[\s\S]*?if \(!replay\) \{[\s\S]*?resolveDeferred\?\.\(false\);[\s\S]*?return;[\s\S]*?replay\(\(value\) => resolveDeferred\?\.\(value\)\)/u,
    "an unavailable project-switch replay endpoint must fail closed",
  );
  assert.match(
    prepare,
    /prepareProjectSwitch\(true\)\.then\(resolve, \(\) => resolve\(false\)\)/u,
    "project-switch failure and discard must both resolve false",
  );
});
