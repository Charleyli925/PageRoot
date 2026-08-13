import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  EDIT_AUTHOR_RUNTIME_CONTRACT_VERSION,
} from "../app/domain/edit-runtime-contract.js";
import {
  EditAuthorRuntimeSession,
} from "../app/application/edit-author-runtime-session.js";

const HTML = [
  "<!doctype html><html><body>",
  '<main id="chart-host" style="width: 640px; height: 360px"></main>',
  "<script>window.echarts && window.echarts.init(document.querySelector('#chart-host'))</script>",
  "</body></html>",
].join("");
const SOURCE_SHA256 = `sha256:${createHash("sha256").update(HTML, "utf8").digest("hex")}`;

function compatibleResult(request, overrides = {}) {
  return {
    outcome: "compatible",
    grant: {
      contractVersion: EDIT_AUTHOR_RUNTIME_CONTRACT_VERSION,
      sessionId: "0123456789abcdef0123456789abcdef",
      executionId: "abcdefabcdefabcdefabcdef",
      sourceSha256: request.sourceSha256,
      resourceSha256: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      scriptCount: 1,
      byteLength: 96,
      canvasGeneration: request.canvasGeneration,
      hosts: request.hosts,
      ...overrides,
    },
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flushAsync() {
  await Promise.resolve();
  await Promise.resolve();
}

function authoritativeInput(overrides = {}) {
  return {
    html: HTML,
    sourceSha256: SOURCE_SHA256,
    canvasGeneration: 4,
    sourcePath: "/Users/demo/report.html",
    sourceIsAuthoritative: true,
    ...overrides,
  };
}

test("Edit author runtime Session starts static, then exposes only a source-bound compatible grant", async () => {
  const calls = [];
  const session = new EditAuthorRuntimeSession({
    port: {
      probe: async (request) => {
        calls.push(request);
        return compatibleResult(request);
      },
      revoke: async (sessionId) => calls.push({ revoke: sessionId }),
    },
  });
  const phases = [];
  session.subscribe((snapshot) => phases.push(snapshot.phase));

  session.refresh(authoritativeInput());
  assert.equal(session.snapshot.phase, "probing");
  await flushAsync();

  assert.equal(session.snapshot.phase, "compatible");
  assert.equal(session.snapshot.grant?.sourceSha256, SOURCE_SHA256);
  assert.equal(session.snapshot.grant?.hosts.length, 1);
  assert.equal(calls[0].sourcePath, undefined, "IPC request must not carry source path");
  assert.deepEqual(Object.keys(calls[0]).sort(), [
    "canvasGeneration",
    "contractVersion",
    "hosts",
    "html",
    "requestId",
    "sourceSha256",
  ]);
  assert.deepEqual(phases, ["static", "static", "probing", "compatible"]);
});

test("Edit author runtime Session discards a late probe and revokes its unpublishable grant", async () => {
  const pending = deferred();
  const revoked = [];
  const session = new EditAuthorRuntimeSession({
    port: {
      probe: () => pending.promise,
      revoke: async (sessionId) => revoked.push(sessionId),
    },
  });

  session.refresh(authoritativeInput());
  session.refresh(authoritativeInput({
    html: `${HTML}\n<!-- source changed -->`,
    sourceSha256: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    canvasGeneration: 5,
  }));
  pending.resolve(compatibleResult({
    sourceSha256: SOURCE_SHA256,
    canvasGeneration: 4,
    hosts: [{
      key: "edit-runtime-1",
      path: [1, 0],
      tagName: "main",
      identityAttributes: [["id", "chart-host"]],
    }],
  }));
  await flushAsync();

  assert.notEqual(session.snapshot.phase, "compatible");
  assert.deepEqual(revoked, ["0123456789abcdef0123456789abcdef"]);
});

test("Edit author runtime Session settles the one direct runtime document after it freezes", async () => {
  const revoked = [];
  const session = new EditAuthorRuntimeSession({
    port: {
      probe: async (request) => compatibleResult(request),
      revoke: async (sessionId) => revoked.push(sessionId),
    },
  });
  session.refresh(authoritativeInput());
  await flushAsync();
  const grant = session.snapshot.grant;
  assert.ok(grant);
  assert.equal(session.beginDirectLoad({
    sessionId: grant.sessionId,
    sourceSha256: grant.sourceSha256,
    canvasGeneration: grant.canvasGeneration,
  }), true);
  assert.equal(session.snapshot.phase, "loading");
  assert.equal(session.settleDirectLoad({
    sessionId: grant.sessionId,
    sourceSha256: grant.sourceSha256,
    canvasGeneration: grant.canvasGeneration,
    outcome: "ready",
  }), true);
  assert.equal(session.snapshot.phase, "ready");
  assert.equal(session.snapshot.lastOutcome, "ready");
  assert.deepEqual(revoked, [grant.sessionId]);
});

test("Edit author runtime Session never probes unpersisted or unsupported source", async () => {
  let probes = 0;
  const session = new EditAuthorRuntimeSession({
    port: {
      probe: async () => {
        probes += 1;
        return { outcome: "failed" };
      },
      revoke: async () => {},
    },
  });

  session.refresh(authoritativeInput({ sourceIsAuthoritative: false }));
  session.refresh(authoritativeInput({
    html: '<main id="chart-host"></main><script type="module">import "./chart.js"</script>',
    sourceSha256: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
  }));
  const nonEchartsHtml = '<main id="chart-host" style="width:640px;height:360px"></main><script>document.querySelector("#chart-host").append(document.createElement("canvas"))</script>';
  session.refresh(authoritativeInput({
    html: nonEchartsHtml,
    sourceSha256: `sha256:${createHash("sha256").update(nonEchartsHtml, "utf8").digest("hex")}`,
  }));
  await flushAsync();

  assert.equal(probes, 0);
  assert.equal(session.snapshot.phase, "static");
});
