import assert from "node:assert/strict";
import test from "node:test";

import {
  EDIT_AUTHOR_RUNTIME_CONTRACT_VERSION,
} from "../app/domain/edit-runtime-contract.js";
import {
  EditAuthorRuntimeSession,
} from "../app/application/edit-author-runtime-session.js";

const HTML = [
  "<!doctype html><html><body>",
  '<main id="chart-host" style="width:640px;height:360px"></main>',
  '<script>echarts.init(document.querySelector("#chart-host"))</script>',
  "</body></html>",
].join("");
const SOURCE_SHA = "sha256:" + "a".repeat(64);

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

function success(request, overrides = {}) {
  return {
    contractVersion: EDIT_AUTHOR_RUNTIME_CONTRACT_VERSION,
    sessionId: "0123456789abcdef0123456789abcdef",
    executionId: "abcdefabcdefabcdefabcdef",
    sourceSha256: request.sourceSha256,
    resourceSha256: "sha256:" + "b".repeat(64),
    scriptCount: 1,
    byteLength: 96,
    canvasGeneration: request.canvasGeneration,
    hosts: request.hosts,
    ...overrides,
  };
}

function input(overrides = {}) {
  return {
    html: HTML,
    sourceSha256: SOURCE_SHA,
    canvasGeneration: 4,
    sourcePath: "/Users/demo/report.html",
    sourceIsAuthoritative: true,
    ...overrides,
  };
}

test("one canvas generation prepares at most once despite source and autosave changes", async () => {
  const requests = [];
  const session = new EditAuthorRuntimeSession({
    port: {
      prepare: async (request) => {
        requests.push(request);
        return success(request);
      },
      revoke: async () => {},
    },
  });

  session.refresh(input());
  session.refresh(input({
    html: HTML + "<!-- autosave changed source -->",
    sourceSha256: "sha256:" + "c".repeat(64),
  }));
  session.refresh(input({
    html: HTML + "<!-- later autosave -->",
    sourceSha256: "sha256:" + "d".repeat(64),
  }));
  await flushAsync();

  assert.equal(requests.length, 1);
  assert.equal(session.snapshot.phase, "ready");
  assert.equal(session.snapshot.grant?.canvasGeneration, 4);
});

test("late preparation from an old generation is revoked and cannot publish", async () => {
  const oldRequest = deferred();
  const revoked = [];
  const session = new EditAuthorRuntimeSession({
    port: {
      prepare: () => oldRequest.promise,
      revoke: async (sessionId) => revoked.push(sessionId),
    },
  });

  session.refresh(input());
  session.refresh(input({
    canvasGeneration: 5,
    sourceSha256: "sha256:" + "e".repeat(64),
  }));
  oldRequest.resolve(success({
    sourceSha256: SOURCE_SHA,
    canvasGeneration: 4,
    hosts: [{
      key: "edit-runtime-1",
      path: [1, 0],
      tagName: "main",
      identityAttributes: [["id", "chart-host"]],
    }],
  }));
  await flushAsync();

  assert.notEqual(session.snapshot.canvasGeneration, 4);
  assert.deepEqual(revoked, ["0123456789abcdef0123456789abcdef"]);
});

test("runtime settles once and later grants cannot re-enter preparation", async () => {
  const requests = [];
  const revoked = [];
  const session = new EditAuthorRuntimeSession({
    port: {
      prepare: async (request) => {
        requests.push(request);
        return success(request);
      },
      revoke: async (sessionId) => revoked.push(sessionId),
    },
  });

  session.refresh(input());
  await flushAsync();
  const grant = session.snapshot.grant;
  assert.ok(grant);
  assert.equal(session.beginRuntime(grant), true);
  assert.equal(session.settleRuntime({ ...grant, outcome: "ready" }), true);
  assert.equal(session.snapshot.phase, "settled");
  session.refresh(input({
    html: HTML + "<!-- comment changed nothing in canvas key -->",
    sourceSha256: "sha256:" + "f".repeat(64),
  }));

  assert.equal(requests.length, 1);
  assert.equal(session.beginRuntime(grant), false);
  assert.deepEqual(revoked, [grant.sessionId]);
});

test("failed preparation silently reaches static fallback", async () => {
  const session = new EditAuthorRuntimeSession({
    port: {
      prepare: async () => null,
      revoke: async () => {},
    },
  });

  session.refresh(input());
  await flushAsync();

  assert.equal(session.snapshot.phase, "static-fallback");
  assert.equal(session.snapshot.grant, null);
  assert.equal(session.snapshot.lastOutcome, "prepare-failed");
});
