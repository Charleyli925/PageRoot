import assert from "node:assert/strict";
import test from "node:test";

import {
  EDIT_AUTHOR_RUNTIME_BUDGET,
  EDIT_AUTHOR_RUNTIME_VERIFICATION_DEADLINE_MS,
  EDIT_RUNTIME_PROTOCOL_SCHEME,
  collectEditRuntimeScripts,
  editRuntimeProgramIdentity,
  editRuntimeProtocolUrl,
  isEditRuntimeExecutionId,
  isEditRuntimeFrameToken,
  isEditRuntimeProtocolUrl,
  isEditRuntimeRequestId,
  isEditRuntimeSessionId,
  isEditRuntimeSourceSha256,
  unsupportedEditRuntimeProgramReason,
} from "../app/domain/edit-runtime-contract.js";

test("direct Edit runtime extracts ordered deterministic classic scripts", () => {
  const contract = collectEditRuntimeScripts([
    "<!-- <script>ignored()</script> -->",
    '<script src="./vendor/echarts.js"></script>',
    '<script type="text/javascript">echarts.init(document.querySelector("#chart"))</script>',
    '<script type="application/json">{"not":"a program"}</script>',
  ].join("\n"));

  assert.equal(contract.unsupportedReason, null);
  assert.deepEqual(
    contract.executableScripts.map((script) => ({
      index: script.index,
      src: script.src,
      inline: script.inline.trim(),
    })),
    [
      { index: 0, src: "./vendor/echarts.js", inline: "" },
      { index: 1, src: null, inline: 'echarts.init(document.querySelector("#chart"))' },
    ],
  );
  assert.equal(contract.scripts.at(-1)?.executable, false);
});

test("disposable Edit runtime preserves native script scheduling attributes", () => {
  for (const html of [
    '<script type="module">window.ready = true</script>',
    '<script async src="chart.js"></script>',
    '<script defer src="chart.js"></script>',
    '<script nomodule src="chart.js"></script>',
  ]) assert.equal(collectEditRuntimeScripts(html).unsupportedReason, null);
  assert.equal(
    unsupportedEditRuntimeProgramReason('import("./chart.js")'),
    "dynamic-or-module-import",
  );
  assert.equal(
    unsupportedEditRuntimeProgramReason('fetch("/data.json"); new Worker("x.js");'),
    null,
    "CSP, not a string predictor, owns network and worker containment",
  );
});

test("program identity changes only when authored script markup changes", () => {
  const first = '<main>A</main><script defer>window.ready = true</script>';
  const semanticEdit = '<main>B</main><script defer>window.ready = true</script>';
  const scriptEdit = '<main>B</main><script defer>window.ready = false</script>';
  assert.equal(editRuntimeProgramIdentity(first), editRuntimeProgramIdentity(semanticEdit));
  assert.notEqual(editRuntimeProgramIdentity(first), editRuntimeProgramIdentity(scriptEdit));
});

test("direct Edit runtime grants use one session and one execution identity", () => {
  const sessionId = "0123456789abcdef0123456789abcdef";
  const executionId = "abcdefabcdefabcdefabcdef";
  const sourceSha = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const url = editRuntimeProtocolUrl(
    sessionId,
    "/.pageroot/bootstrap/" + executionId + ".js",
  );

  assert.equal(EDIT_RUNTIME_PROTOCOL_SCHEME, "pageroot-edit-runtime");
  assert.equal(isEditRuntimeSessionId(sessionId), true);
  assert.equal(isEditRuntimeExecutionId(executionId), true);
  assert.equal(isEditRuntimeRequestId("edit-runtime-12345678"), true);
  assert.equal(isEditRuntimeSourceSha256(sourceSha), true);
  assert.equal(isEditRuntimeFrameToken("edit-runtime-frame-" + executionId), true);
  assert.equal(isEditRuntimeProtocolUrl(url, sessionId), true);
  assert.equal(editRuntimeProtocolUrl(sessionId, "relative.js"), null);
  assert.equal(EDIT_AUTHOR_RUNTIME_BUDGET.declaredAssetCount, 64);
  assert.equal(EDIT_AUTHOR_RUNTIME_BUDGET.declaredAssetReferenceCount, 128);
  assert.equal(EDIT_AUTHOR_RUNTIME_BUDGET.declaredAssetBytes, 2 * 1024 * 1024);
  assert.equal(
    EDIT_AUTHOR_RUNTIME_VERIFICATION_DEADLINE_MS,
    (EDIT_AUTHOR_RUNTIME_BUDGET.runtimeDeadlineMs * 2) + 1_000,
    "canvas acknowledgement permits bounded preparation and one fail-safe visible-iframe deadline",
  );
  assert.equal(EDIT_AUTHOR_RUNTIME_BUDGET.orphanSessionTtlMs, 60_000);
  assert.equal("cacheEntries" in EDIT_AUTHOR_RUNTIME_BUDGET, false);
  assert.equal("cacheTtlMs" in EDIT_AUTHOR_RUNTIME_BUDGET, false);
  assert.equal("runtimeQuietFrames" in EDIT_AUTHOR_RUNTIME_BUDGET, false);
  assert.equal("hostCount" in EDIT_AUTHOR_RUNTIME_BUDGET, false);
});
