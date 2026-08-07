import assert from "node:assert/strict";
import test from "node:test";

import { RuntimeVisualProjectionSession } from "../app/application/runtime-visual-projection-session.js";
import {
  RUNTIME_VISUAL_PROJECTION_PROTOCOL,
  RUNTIME_VISUAL_PROJECTION_VERSION,
  acceptRuntimeVisualProjection,
  mergeDeferredRuntimeVisualProjection,
  prepareRuntimeVisualCapture,
} from "../app/domain/runtime-visual-projection.js";
import { buildSourceIndex } from "../app/lib/source-index.js";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAEElEQVR42mNk+M/wHwAEAQH/2p9Z5QAAAABJRU5ErkJggg==";

const SOURCE = `<!doctype html>
<main>
  <div id="runtime-chart"></div>
  <table><tbody id="runtime-rows"></tbody></table>
  <div id="authored">source text</div>
  <script>
    document.getElementById("runtime-chart").replaceChildren(document.createElement("svg"));
    document.getElementById("runtime-rows").appendChild(document.createElement("tr"));
  </script>
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
      captureBox: payload.candidates.find(
        (candidate) => candidate.sourceNodeId === sourceNodeId,
      )?.tagName === "tbody" ? "border" : "content",
      dataUrl: PNG,
    }],
    deferredSourceNodeIds: [],
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

test("decorative empty elements without script causality do not open runtime capture", () => {
  const prepared = prepareRuntimeVisualCapture({
    html: "<!doctype html><main><span class=fake-title></span><div class=fake-chart></div></main>",
    sourcePath: "/tmp/static-report.html",
    viewportWidth: 900,
  });
  assert.ok(prepared);
  assert.deepEqual(prepared.candidates, []);
  assert.equal(prepared.payload, null);
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

test("hidden populated hosts retain the last committed artifact", () => {
  const prepared = prepareRuntimeVisualCapture({
    html: SOURCE,
    sourcePath: "/tmp/report.html",
    viewportWidth: 900,
  });
  const fallbackProjection = acceptRuntimeVisualProjection({
    html: SOURCE,
    documentKey: "current:/tmp/report.html",
    generation: 1,
    rawProjection: rawProjection(prepared.payload),
  });
  const deferredProjection = acceptRuntimeVisualProjection({
    html: SOURCE,
    documentKey: "current:/tmp/report.html",
    generation: 2,
    rawProjection: {
      protocol: RUNTIME_VISUAL_PROJECTION_PROTOCOL,
      version: RUNTIME_VISUAL_PROJECTION_VERSION,
      sourceSha256: prepared.sourceSha256,
      visuals: [],
      deferredSourceNodeIds: [prepared.candidates[0].sourceNodeId],
    },
  });
  const merged = mergeDeferredRuntimeVisualProjection({
    html: SOURCE,
    documentKey: "current:/tmp/report.html",
    generation: 2,
    projection: deferredProjection,
    fallbackProjection,
  });
  assert.equal(merged?.visuals.length, 1);
  assert.equal(
    merged?.visuals[0].captureKey,
    fallbackProjection?.visuals[0].captureKey,
  );
});

test("projection session rebinds non-visual source edits without recapturing", async () => {
  const pending = [];
  const session = new RuntimeVisualProjectionSession({
    captureDebounceMs: 0,
    capture: (payload) => new Promise((resolve) => {
      pending.push({ payload, resolve });
    }),
  });
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
  assert.equal(pending.length, 1);
  pending[0].resolve(rawProjection(pending[0].payload));
  await nextTask();
  assert.equal(session.snapshot.status, "ready");
  assert.equal(
    session.snapshot.projection?.sourceSha256,
    buildSourceIndex(nextSource).sourceSha256,
  );
  assert.equal(
    pending.length,
    1,
  );
  assert.equal(session.snapshot.projection?.visuals.length, 1);

  const runtimeChangedSource = nextSource.replace(
    'document.createElement("svg")',
    'document.createElement("canvas")',
  );
  session.request({
    html: runtimeChangedSource,
    sourcePath: "/tmp/report.html",
    documentKey: "current:/tmp/report.html",
    viewportWidth: 900,
  });
  await nextTask();
  assert.equal(pending.length, 2);
  assert.equal(session.snapshot.status, "capturing");
  assert.ok(session.snapshot.projection);
  session.dispose();
});

test("projection session keeps the committed bitmap while refreshing and reuses cache", async () => {
  const pending = [];
  const session = new RuntimeVisualProjectionSession({
    captureDebounceMs: 0,
    capture: (capturePayload) => new Promise((resolve) => {
      pending.push({ payload: capturePayload, resolve });
    }),
  });
  const request = (viewportWidth) => session.request({
    html: SOURCE,
    sourcePath: "/tmp/report.html",
    documentKey: "current:/tmp/report.html",
    viewportWidth,
  });

  request(900);
  await nextTask();
  pending[0].resolve(rawProjection(pending[0].payload));
  await nextTask();
  const firstProjection = session.snapshot.projection;
  assert.ok(firstProjection);

  request(1_000);
  await nextTask();
  assert.equal(session.snapshot.status, "capturing");
  assert.equal(session.snapshot.projection, firstProjection);
  pending[1].resolve(rawProjection(pending[1].payload));
  await nextTask();
  assert.equal(session.snapshot.status, "ready");

  request(900);
  assert.equal(pending.length, 2);
  assert.equal(session.snapshot.status, "ready");
  assert.equal(session.snapshot.projection?.sourceSha256, firstProjection.sourceSha256);
  session.suspend();
  assert.equal(session.snapshot.status, "ready");
  assert.ok(session.snapshot.projection);
  session.dispose();
});
