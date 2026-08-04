import assert from "node:assert/strict";
import test from "node:test";

import { RuntimeVisualProjectionSession } from "../app/application/runtime-visual-projection-session.js";
import {
  RUNTIME_VISUAL_PROJECTION_PROTOCOL,
  RUNTIME_VISUAL_PROJECTION_VERSION,
  acceptRuntimeVisualProjection,
  prepareRuntimeVisualCapture,
} from "../app/domain/runtime-visual-projection.js";
import { buildSourceIndex } from "../app/lib/source-index.js";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAEElEQVR42mNk+M/wHwAEAQH/2p9Z5QAAAABJRU5ErkJggg==";

const SOURCE = `<!doctype html>
<main>
  <div id="runtime-chart"></div>
  <table><tbody id="runtime-rows"></tbody></table>
  <div id="authored">source text</div>
</main>`;

function rawProjection(payload, sourceNodeId = payload.candidates[0].sourceNodeId) {
  return {
    protocol: RUNTIME_VISUAL_PROJECTION_PROTOCOL,
    version: RUNTIME_VISUAL_PROJECTION_VERSION,
    sourceSha256: payload.sourceSha256,
    visuals: [{
      sourceNodeId,
      width: 1,
      height: 1,
      layoutWidth: 320,
      layoutHeight: 120,
      dataUrl: PNG,
    }],
  };
}

function nextTask() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

test("edit visual capture instruments only a transient copy of empty source hosts", () => {
  const original = SOURCE;
  const prepared = prepareRuntimeVisualCapture({
    html: SOURCE,
    sourcePath: "/tmp/report.html",
    viewportWidth: 1_280,
  });

  assert.ok(prepared?.payload);
  assert.equal(SOURCE, original);
  assert.equal(
    prepared.sourceSha256,
    buildSourceIndex(SOURCE).sourceSha256,
  );
  assert.equal(prepared.payload.html.includes("data-html-ai-source-node-id"), true);
  assert.equal(SOURCE.includes("data-html-ai-source-node-id"), false);
  assert.equal(prepared.candidates.length, 2);
  assert.deepEqual(
    prepared.candidates.map((candidate) => candidate.tagName),
    ["div", "tbody"],
  );
  assert.equal(
    prepared.candidates.some((candidate) => (
      buildSourceIndex(SOURCE).byNodeId.get(candidate.sourceNodeId)
        ?.stableAttributes.id === "authored"
    )),
    false,
  );
  assert.deepEqual(prepared.payload.viewport, {
    width: 1_280,
    height: 1_200,
  });
});

test("accepted projections stay bound to the exact original source hash and empty host", () => {
  const prepared = prepareRuntimeVisualCapture({
    html: SOURCE,
    sourcePath: "/tmp/report.html",
    viewportWidth: 900,
  });
  assert.ok(prepared?.payload);
  const projection = acceptRuntimeVisualProjection({
    html: SOURCE,
    documentKey: "current:/tmp/report.html",
    generation: 4,
    rawProjection: rawProjection(prepared.payload),
  });

  assert.ok(projection);
  assert.equal(projection.documentKey, "current:/tmp/report.html");
  assert.equal(projection.sourceSha256, prepared.sourceSha256);
  assert.equal(projection.visuals.length, 1);
  assert.equal(Object.isFrozen(projection), true);
  assert.equal(Object.isFrozen(projection.visuals), true);

  assert.equal(acceptRuntimeVisualProjection({
    html: SOURCE.replace("source text", "changed source text"),
    documentKey: "current:/tmp/report.html",
    generation: 5,
    rawProjection: rawProjection(prepared.payload),
  }), null);

  const authoredNodeId = [...buildSourceIndex(SOURCE).elements]
    .find((element) => element.stableAttributes.id === "authored")
    ?.nodeId;
  const authoredProjection = acceptRuntimeVisualProjection({
    html: SOURCE,
    documentKey: "current:/tmp/report.html",
    generation: 6,
    rawProjection: rawProjection(prepared.payload, authoredNodeId),
  });
  assert.ok(authoredProjection);
  assert.deepEqual(authoredProjection.visuals, []);

  const duplicate = rawProjection(prepared.payload);
  assert.deepEqual(acceptRuntimeVisualProjection({
    html: SOURCE,
    documentKey: "current:/tmp/report.html",
    generation: 7,
    rawProjection: {
      ...duplicate,
      visuals: [duplicate.visuals[0], duplicate.visuals[0]],
    },
  })?.visuals, []);
});

test("projection session drops late captures and exposes only the newest source", async () => {
  const pending = [];
  const session = new RuntimeVisualProjectionSession({
    captureDebounceMs: 0,
    capture: (payload) => new Promise((resolve) => {
      pending.push({ payload, resolve });
    }),
  });
  const snapshots = [];
  session.setObserver((snapshot) => snapshots.push(snapshot));

  session.request({
    html: SOURCE,
    sourcePath: "/tmp/report.html",
    documentKey: "current:/tmp/report.html",
    viewportWidth: 900,
  });
  await nextTask();
  assert.equal(pending.length, 1);

  const nextSource = SOURCE.replace("source text", "new source text");
  session.request({
    html: nextSource,
    sourcePath: "/tmp/report.html",
    documentKey: "current:/tmp/report.html",
    viewportWidth: 900,
  });
  await nextTask();
  assert.equal(pending.length, 2);

  pending[0].resolve(rawProjection(pending[0].payload));
  await nextTask();
  assert.notEqual(session.snapshot.status, "ready");

  pending[1].resolve(rawProjection(pending[1].payload));
  await nextTask();
  assert.equal(session.snapshot.status, "ready");
  assert.equal(
    session.snapshot.projection?.sourceSha256,
    buildSourceIndex(nextSource).sourceSha256,
  );
  assert.equal(
    snapshots.some((snapshot) => (
      snapshot.projection?.sourceSha256 === buildSourceIndex(SOURCE).sourceSha256
    )),
    false,
  );
  session.dispose();
});
