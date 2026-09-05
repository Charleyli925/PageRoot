import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { queuedStaticFallbackOracle } from "./e2e/electron/queued-static-fallback-oracle.mjs";

function source(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

function callbackBody(editor, name) {
  const start = editor.indexOf(`const ${name} = useCallback(`);
  assert.notEqual(start, -1, `missing ${name}`);
  const next = editor.indexOf("\n  const ", start + `const ${name} = useCallback(`.length);
  assert.notEqual(next, -1, `could not bound ${name}`);
  return editor.slice(start, next);
}

test("authoritative HTML replacement never starts author Script in Active", () => {
  const editor = source("app/components/HtmlCanvasEditor.tsx");
  const loadFrameSource = callbackBody(editor, "loadFrameSource");
  const startRuntimeCandidate = callbackBody(editor, "startRuntimeCandidate");
  const requestDynamicRuntimeRefresh = callbackBody(editor, "requestDynamicRuntimeRefresh");

  assert.match(editor, /const requestDynamicRuntimeRefresh = useCallback/u);
  assert.match(editor, /const loadFrameSource = useCallback/u);
  assert.match(editor, /const startRuntimeCandidate = useCallback/u);

  assert.doesNotMatch(editor, /forceRuntimeHandoff/u);
  assert.doesNotMatch(editor, /runtimeNeedsRerenderRef/u);
  assert.match(editor, /runtimeRefreshPendingRef/u);

  assert.doesNotMatch(loadFrameSource, /mode:\s*"disposable-runtime"/u);
  assert.doesNotMatch(loadFrameSource, /editRuntimeRegistrationProperty/u);
  assert.doesNotMatch(loadFrameSource, /beginRuntimeAttempt/u);
  assert.doesNotMatch(loadFrameSource, /reportActivationOutcome/u);
  assert.match(loadFrameSource, /mode:\s*"static"/u);
  assert.match(loadFrameSource, /scheduleDynamicRuntimeRefresh\(source\)/u);
  assert.match(loadFrameSource, /runtime:\s*false/u);

  assert.match(startRuntimeCandidate, /mode:\s*"disposable-runtime"/u);
  assert.match(startRuntimeCandidate, /editRuntimeRegistrationProperty/u);
  assert.match(startRuntimeCandidate, /Sole author-Script start path/u);

  assert.match(
    requestDynamicRuntimeRefresh,
    /activeNativeEditRef\.current \|\| !visibleAuthoritativeFrameReady\(\)/u,
  );
  assert.match(requestDynamicRuntimeRefresh, /scheduleDynamicRuntimeRefresh\(source\)/u);
  assert.match(requestDynamicRuntimeRefresh, /startRuntimeCandidateRef\.current\(source\)/u);
});

test("first open, late grant, grant during edit, retry and history use the Candidate entry", () => {
  const editor = source("app/components/HtmlCanvasEditor.tsx");

  assert.match(
    editor,
    /requestDynamicRuntimeRefresh\(frameSourceHtmlRef\.current\)/u,
  );
  assert.match(
    editor,
    /data-history-adopt-path",\s*"runtime-candidate"/u,
  );
  assert.match(
    editor,
    /if \(preserveRuntimeActiveFrame\) requestDynamicRuntimeRefresh\(result\.html\)/u,
  );
  assert.match(
    editor,
    /if \(preserveRuntimeActiveFrame\) \{\s*requestDynamicRuntimeRefresh\(source\)/u,
  );
  assert.match(editor, /loadFrameSource\(html, \{ forceStatic: true, preserveViewport: true \}\)/u);
  assert.match(editor, /loadFrameSource\(html\);/u);
});

test("ADR 0065 no longer requires native session or comment-layout handoff restore", () => {
  const adr = source("docs/decisions/0065-disposable-edit-runtime.md");
  assert.match(adr, /hidden Candidate/u);
  assert.match(adr, /Active has no second path that executes Script/u);
  assert.match(adr, /must not restore Caret, Range,\s+Focus or a native editing session/u);
  assert.match(adr, /One commit then\s+switches Active identity and visibility together/u);
  assert.doesNotMatch(adr, /native Range\/Caret\/Focus state/u);
  assert.doesNotMatch(adr, /last complete comment layout/u);
});

test("Candidate commit rewrites Active last and keeps only a short commit rollback", () => {
  const editor = source("app/components/HtmlCanvasEditor.tsx");
  const promoteRuntimeCandidate = callbackBody(editor, "promoteRuntimeCandidate");
  const commitRuntimeCandidate = callbackBody(editor, "commitRuntimeCandidate");
  const cancelRuntimeCandidate = callbackBody(editor, "cancelRuntimeCandidate");

  assert.doesNotMatch(editor, /type RuntimeActiveFrameSnapshot/u);
  assert.doesNotMatch(editor, /rollbackRuntimeCandidatePromotion/u);
  assert.doesNotMatch(editor, /previousActive:/u);
  assert.match(editor, /type RuntimeSlotRetirement/u);
  assert.match(editor, /retiredSlot: RuntimeSlotRetirement \| null/u);

  assert.doesNotMatch(promoteRuntimeCandidate, /setActiveRuntimeSlotId\(/u);
  assert.doesNotMatch(promoteRuntimeCandidate, /runtimeFrameRef\.current = candidate\.runtimeFrame/u);
  assert.doesNotMatch(promoteRuntimeCandidate, /beginPositioning\(/u);
  assert.doesNotMatch(promoteRuntimeCandidate, /runtimePromotionRef\.current = candidate/u);
  assert.match(promoteRuntimeCandidate, /commitRuntimeCandidateRef\.current\(candidate, iframe\)/u);

  assert.match(
    commitRuntimeCandidate,
    /beginPositioning\(candidate\.attempt\)[\s\S]*runtimePromotionRef\.current = candidate/u,
  );
  assert.match(commitRuntimeCandidate, /previousRenderVerified/u);
  assert.match(commitRuntimeCandidate, /data-render-verified/u);
  assert.match(commitRuntimeCandidate, /runtimeFrameRef\.current = candidate\.runtimeFrame/u);
  assert.match(commitRuntimeCandidate, /setActiveRuntimeSlotId\(candidate\.attempt\.slotId\)/u);
  assert.match(commitRuntimeCandidate, /latestSourceProjectionRef\.current\.source !== candidate\.source/u);
  assert.match(commitRuntimeCandidate, /activeNativeEditRef\.current/u);
  assert.match(cancelRuntimeCandidate, /if \(activeNativeEditRef\.current\)/u);
  assert.match(cancelRuntimeCandidate, /pendingToolbarVisibleRef\.current = true/u);
});

test("reading-position restore is shared and comment layout is not frozen across Frames", () => {
  const editor = source("app/components/HtmlCanvasEditor.tsx");
  const spec = source("tests/e2e/electron/electron-edit-runtime.spec.mjs");
  assert.match(editor, /applyReadingPosition\(/u);
  assert.match(editor, /correctReadingPositionOnce\(/u);
  assert.match(editor, /selectedVisible \? selectedAnchor/u);
  assert.doesNotMatch(editor, /lastValidCommentLayoutRef/u);
  assert.doesNotMatch(spec, /positioningRafSequences\.size\)\.toBeGreaterThanOrEqual\(2\)/u);
});

test("static fallback after dynamic failure can pause scheduling without marking ready", () => {
  const editor = source("app/components/HtmlCanvasEditor.tsx");
  const helper = callbackBody(editor, "scheduleLatestStaticFallbackAfterFailure");
  const failRuntimeCandidate = callbackBody(editor, "failRuntimeCandidate");
  const startRuntimeCandidate = callbackBody(editor, "startRuntimeCandidate");
  assert.match(helper, /__PAGEROOT_E2E_RUNTIME_COMMIT_RELEASES__/u);
  assert.match(helper, /publishRuntimeDegradation\("static-preparing"\)/u);
  assert.match(helper, /releases\.push\(run\)/u);
  assert.doesNotMatch(helper, /publishRuntimeDegradation\("none"\)/u);
  assert.doesNotMatch(helper, /outcome === "ready"/u);
  assert.match(
    failRuntimeCandidate,
    /scheduleLatestStaticFallbackAfterFailure\(candidate\.attempt\.candidateId\)/u,
  );
  assert.match(
    startRuntimeCandidate,
    /scheduleLatestStaticFallbackAfterFailure\(attempt\.candidateId\)/u,
  );
});

test("queued-static oracle rejects a stale R1 static frame after R2 is on disk", () => {
  assert.throws(() => queuedStaticFallbackOracle({
    diskHtml: "<p>静态候选必须跟随最新源码 最新来源</p><p>静态候选必须跟随最新源码 最新来源</p>",
    visibleTexts: ["静态候选必须跟随最新源码", "静态候选必须跟随最新源码"],
    sandbox: "allow-same-origin",
    expectedSnippet: "最新来源",
    expectedVisibleCount: 2,
  }), /Visible static frame is not the latest Working HTML/u);
});

test("queued-static oracle accepts R2 on disk and in the static frame", () => {
  queuedStaticFallbackOracle({
    diskHtml: "<p>静态候选必须跟随最新源码 最新来源</p><p>静态候选必须跟随最新源码</p>",
    visibleTexts: ["静态候选必须跟随最新源码 最新来源", "静态候选必须跟随最新源码"],
    sandbox: "allow-same-origin",
    expectedSnippet: "最新来源",
    expectedVisibleCount: 2,
  });
});
