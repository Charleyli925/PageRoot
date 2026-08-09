import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  EditRuntimeSnapshotSession,
} from "../app/application/edit-runtime-snapshot-session.js";
import {
  describeRuntimeSnapshotInputs,
} from "../app/domain/runtime-snapshot-hosts.js";
import {
  sourceSha256,
} from "../app/lib/source-index.js";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAEElEQVR42mNk+M/wHwAEAQH/2p9Z5QAAAABJRU5ErkJggg==",
  "base64",
);
const UPDATED_PNG = Uint8Array.from(PNG, (value, index) => (
  index === PNG.byteLength - 1 ? value ^ 1 : value
));
const SOURCE = `<!doctype html>
<html><head><style>#chart { width: 320px; height: 120px; }</style></head>
<body><main><p>普通文字 A</p><div id="chart"></div></main>
<script>document.getElementById("chart").appendChild(document.createElement("svg"));</script>
</body></html>`;

function response(request, png = PNG) {
  const pngBytes = new Uint8Array(png);
  const pngSha256 = `sha256:${createHash("sha256").update(pngBytes).digest("hex")}`;
  return {
    outcome: "captured",
    envelope: {
      contractVersion: 1,
      sessionId: request.captureSessionId,
      sourceSha256: request.sourceSha256,
      runtimeVisualSnapshots: request.candidates.map((candidate) => ({
        key: candidate.key,
        state: "captured",
        pngSha256,
        width: 1,
        height: 1,
        byteLength: pngBytes.byteLength,
        pngBytes,
      })),
    },
  };
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
}

test("runtime input description ignores ordinary text but includes supported host and authored runtime inputs", () => {
  const textEdited = SOURCE.replace("普通文字 A", "普通文字 B");
  const chartEdited = SOURCE.replace("appendChild", "replaceChildren");
  const initial = describeRuntimeSnapshotInputs({ html: SOURCE });
  const afterText = describeRuntimeSnapshotInputs({ html: textEdited });
  const afterChart = describeRuntimeSnapshotInputs({ html: chartEdited });

  assert.ok(initial);
  assert.equal(initial.candidates.length, 1);
  assert.equal(initial.candidates[0].kind, "host");
  assert.equal(initial.runtimeInputSha256, afterText?.runtimeInputSha256);
  assert.notEqual(initial.sourceSha256, afterText?.sourceSha256);
  assert.notEqual(initial.runtimeInputSha256, afterChart?.runtimeInputSha256);
  assert.deepEqual(
    Object.keys(initial.candidates[0].captureCandidate).sort(),
    ["identityAttributes", "key", "kind", "path", "tagName"],
  );
});

test("Edit reuses a current-host screenshot across normal text and mode transitions", async () => {
  const calls = [];
  const session = new EditRuntimeSnapshotSession({
    captureDebounceMs: 0,
    capture: async (request) => {
      calls.push(request);
      return response(request);
    },
  });

  assert.equal(session.request({
    html: SOURCE,
    documentKey: "current:/report.html",
    viewportWidth: 960,
  }), true);
  await flush();
  assert.equal(calls.length, 1);
  assert.equal(session.snapshot.status, "ready");
  assert.equal(session.snapshot.projection?.visuals.length, 1);
  assert.equal(calls[0].side, "edit");
  assert.equal(calls[0].sourcePath, undefined);
  assert.equal(calls[0].presentationEntries, undefined);

  const textEdited = SOURCE.replace("普通文字 A", "普通文字 B");
  session.request({
    html: textEdited,
    documentKey: "current:/report.html",
    viewportWidth: 960,
  });
  await flush();
  assert.equal(calls.length, 1, "ordinary text uses the latest cached screenshot");
  assert.equal(session.snapshot.projection?.sourceSha256, sourceSha256(textEdited));
  assert.equal(session.snapshot.projection?.visuals.length, 1);
  assert.equal(
    session.snapshot.projection?.visuals[0]?.capturedSourceSha256,
    sourceSha256(SOURCE),
    "the cache retains the source identity that produced the reusable bitmap",
  );

  session.suspend();
  session.request({
    html: textEdited,
    documentKey: "current:/report.html",
    viewportWidth: 960,
  });
  await flush();
  assert.equal(calls.length, 1, "returning from Preview/Edit does not recapture");
  assert.equal(session.snapshot.status, "ready");
});

test("Edit retains a verified image while a changed chart input captures in the background", async () => {
  const calls = [];
  let resolveSecond;
  const session = new EditRuntimeSnapshotSession({
    captureDebounceMs: 0,
    capture: (request) => {
      calls.push(request);
      if (calls.length === 1) return Promise.resolve(response(request));
      return new Promise((resolve) => {
        resolveSecond = () => resolve(response(request, UPDATED_PNG));
      });
    },
  });

  session.request({
    html: SOURCE,
    documentKey: "current:/report.html",
    viewportWidth: 960,
  });
  await flush();
  const originalHash = session.snapshot.projection?.visuals[0]?.pngSha256;
  const chartEdited = SOURCE.replace("appendChild", "replaceChildren");
  session.request({
    html: chartEdited,
    documentKey: "current:/report.html",
    viewportWidth: 960,
  });
  await flush();

  assert.equal(calls.length, 2);
  assert.equal(session.snapshot.projection?.sourceSha256, sourceSha256(chartEdited));
  assert.equal(
    session.snapshot.projection?.visuals[0]?.pngSha256,
    originalHash,
    "the existing image remains mounted until its replacement has decoded",
  );
  resolveSecond?.();
  await flush();
  assert.equal(session.snapshot.status, "ready");
  assert.notEqual(session.snapshot.projection?.visuals[0]?.pngSha256, originalHash);
  assert.equal(
    session.snapshot.projection?.visuals[0]?.capturedSourceSha256,
    sourceSha256(chartEdited),
  );
});

test("Edit clears a stale image when the changed runtime input cannot be captured", async () => {
  let callCount = 0;
  const session = new EditRuntimeSnapshotSession({
    captureDebounceMs: 0,
    capture: async (request) => {
      callCount += 1;
      return callCount === 1
        ? response(request)
        : { outcome: "failed", reason: "capture-failed" };
    },
  });

  session.request({
    html: SOURCE,
    documentKey: "current:/report.html",
    viewportWidth: 960,
  });
  await flush();
  session.request({
    html: SOURCE.replace("appendChild", "replaceChildren"),
    documentKey: "current:/report.html",
    viewportWidth: 960,
  });
  await flush();
  assert.equal(session.snapshot.status, "unavailable");
  assert.equal(session.snapshot.projection, null);
});

test("Edit never reuses a runtime snapshot cache across documents", async () => {
  const calls = [];
  const session = new EditRuntimeSnapshotSession({
    captureDebounceMs: 0,
    capture: async (request) => {
      calls.push(request);
      return response(request);
    },
  });

  session.request({
    html: SOURCE,
    documentKey: "current:/first.html",
    viewportWidth: 960,
  });
  await flush();
  session.request({
    html: SOURCE,
    documentKey: "current:/second.html",
    viewportWidth: 960,
  });
  await flush();

  assert.equal(calls.length, 2);
  assert.notEqual(
    calls[0].captureSessionId,
    calls[1].captureSessionId,
    "a new document retires the prior owner identity as well as its cache",
  );
});

test("Edit discards a capture result that arrives after a newer runtime input", async () => {
  const resolvers = [];
  const session = new EditRuntimeSnapshotSession({
    captureDebounceMs: 0,
    capture: (request) => new Promise((resolve) => {
      const captureIndex = resolvers.length;
      resolvers.push(() => resolve(response(
        request,
        captureIndex === 0 ? PNG : UPDATED_PNG,
      )));
    }),
  });

  session.request({
    html: SOURCE,
    documentKey: "current:/report.html",
    viewportWidth: 960,
  });
  await flush();
  const chartEdited = SOURCE.replace("appendChild", "replaceChildren");
  session.request({
    html: chartEdited,
    documentKey: "current:/report.html",
    viewportWidth: 960,
  });
  await flush();

  assert.equal(resolvers.length, 2);
  resolvers[0]();
  await flush();
  assert.equal(session.snapshot.projection, null);
  resolvers[1]();
  await flush();
  assert.equal(session.snapshot.status, "ready");
  assert.equal(session.snapshot.projection?.sourceSha256, sourceSha256(chartEdited));
});
