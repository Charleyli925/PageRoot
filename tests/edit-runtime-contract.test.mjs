import assert from "node:assert/strict";
import test from "node:test";

import {
  EDIT_AUTHOR_RUNTIME_BUDGET,
  EDIT_RUNTIME_PROTOCOL_SCHEME,
  collectEditRuntimeScripts,
  editRuntimeProtocolUrl,
  editRuntimeSourceMarker,
  isEditRuntimeEchartsCandidate,
  isEditRuntimeExecutionId,
  isEditRuntimeFrameToken,
  isEditRuntimeProtocolUrl,
  isEditRuntimeRequestId,
  isEditRuntimeSessionId,
  isEditRuntimeSourceSha256,
  unsupportedEditRuntimeProgramReason,
} from "../app/domain/edit-runtime-contract.js";

test("Edit one-shot contract extracts only deterministic classic author scripts in source order", () => {
  const contract = collectEditRuntimeScripts([
    "<!-- <script>ignored()</script> -->",
    '<script src="./vendor/echarts.js"></script>',
    '<script type="text/javascript">window.initChart()</script>',
    '<script type="application/json">{"not":"a program"}</script>',
  ].join("\n"));

  assert.equal(contract.unsupportedReason, null);
  assert.equal(contract.scripts.length, 3);
  assert.deepEqual(
    contract.executableScripts.map((script) => ({
      index: script.index,
      src: script.src,
      inline: script.inline.trim(),
    })),
    [
      { index: 0, src: "./vendor/echarts.js", inline: "" },
      { index: 1, src: null, inline: "window.initChart()" },
    ],
  );
  assert.equal(contract.scripts[2].executable, false);
  assert.equal(contract.scripts[2].index, null);
});

test("Edit one-shot contract rejects modules, non-deterministic scripts, and runtime fetch surfaces", () => {
  for (const [html, expected] of [
    ['<script type="module">import "./chart.js"</script>', "module-script"],
    ['<script async src="chart.js"></script>', "non-deterministic-script"],
    ['<script defer src="chart.js"></script>', "non-deterministic-script"],
    ['<script nomodule src="chart.js"></script>', "nomodule-script"],
  ]) {
    assert.equal(collectEditRuntimeScripts(html).unsupportedReason, expected);
  }
  assert.equal(unsupportedEditRuntimeProgramReason("fetch('/data.json')"), "runtime-network");
  assert.equal(unsupportedEditRuntimeProgramReason("new Worker('chart.js')"), "worker");
  assert.equal(unsupportedEditRuntimeProgramReason("import('./chart.js')"), "dynamic-or-module-import");
  assert.equal(unsupportedEditRuntimeProgramReason("window.echarts.init(host)"), null);
});

test("Edit one-shot contract remains limited to explicit ECharts candidates", () => {
  assert.equal(isEditRuntimeEchartsCandidate(
    '<main id="chart"></main><script src="./vendor/echarts.min.js"></script><script>echarts.init(document.querySelector("#chart"))</script>',
  ), true);
  assert.equal(isEditRuntimeEchartsCandidate(
    '<main id="chart"></main><script>document.querySelector("#chart").append(document.createElement("canvas"))</script>',
  ), false);
  assert.equal(isEditRuntimeEchartsCandidate(
    '<main id="chart"></main><script type="module">import "echarts"</script>',
  ), false);
});

test("Edit one-shot contract keeps identifiers and protocol URLs source-bound and non-ambient", () => {
  const sessionId = "0123456789abcdef0123456789abcdef";
  const executionId = "abcdefabcdefabcdefabcdef";
  const sourceSha = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const url = editRuntimeProtocolUrl(sessionId, `/.pageroot/bootstrap/${executionId}.js`);

  assert.equal(EDIT_RUNTIME_PROTOCOL_SCHEME, "pageroot-edit-runtime");
  assert.equal(isEditRuntimeSessionId(sessionId), true);
  assert.equal(isEditRuntimeExecutionId(executionId), true);
  assert.equal(isEditRuntimeRequestId("edit-runtime-12345678"), true);
  assert.equal(isEditRuntimeSourceSha256(sourceSha), true);
  assert.equal(isEditRuntimeFrameToken(`edit-runtime-frame-${executionId}`), true);
  assert.equal(isEditRuntimeProtocolUrl(url, sessionId), true);
  assert.equal(editRuntimeProtocolUrl(sessionId, "relative.js"), null);
  assert.equal(isEditRuntimeProtocolUrl("https://example.com/chart.js", sessionId), false);
  assert.equal(editRuntimeSourceMarker([]), "root");
  assert.equal(editRuntimeSourceMarker([1, 0, 3]), "1.0.3");
  assert.equal(editRuntimeSourceMarker([1, -1]), null);
  assert.equal(EDIT_AUTHOR_RUNTIME_BUDGET.cacheEntries, 8);
  assert.equal(EDIT_AUTHOR_RUNTIME_BUDGET.cacheBytes, 32 * 1024 * 1024);
  assert.equal(EDIT_AUTHOR_RUNTIME_BUDGET.hostCount, 32);
  assert.equal(EDIT_AUTHOR_RUNTIME_BUDGET.runtimeSettleMs, 1_200);
  assert.equal(EDIT_AUTHOR_RUNTIME_BUDGET.ownerDeadlineMs, 6_000);
});
