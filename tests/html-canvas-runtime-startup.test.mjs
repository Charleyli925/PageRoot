import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

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
  assert.doesNotMatch(adr, /native Range\/Caret\/Focus state/u);
  assert.doesNotMatch(adr, /last complete comment layout/u);
});
