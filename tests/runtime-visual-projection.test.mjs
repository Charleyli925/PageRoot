import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { RuntimeVisualProjectionSession } from "../app/application/runtime-visual-projection-session.js";
import { RUNTIME_VISUAL_CONTRACT } from "../app/domain/runtime-visual-contract.js";
import {
  RUNTIME_VISUAL_PROJECTION_PROTOCOL,
  RUNTIME_VISUAL_PROJECTION_VERSION,
  acceptRuntimeVisualProjection,
  describeRuntimeVisualCapture,
  mergeDeferredRuntimeVisualProjection,
  prepareRuntimeVisualCapture,
  rebindRuntimeVisualProjection,
} from "../app/domain/runtime-visual-projection.js";
import { buildSourceIndex } from "../app/lib/source-index.js";
import { runtimeVisualHostilePage } from "./fixtures/runtime-visual-hostile-pages.mjs";

const PNG_BYTES = new Uint8Array(Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAEElEQVR42mNk+M/wHwAEAQH/2p9Z5QAAAABJRU5ErkJggg==",
  "base64",
));
const PNG_SHA256 = `sha256:${createHash("sha256").update(PNG_BYTES).digest("hex")}`;

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
      deviceScaleFactor: 1,
      captureBox: payload.candidates.find(
        (candidate) => candidate.sourceNodeId === sourceNodeId,
      )?.tagName === "tbody" ? "border" : "content",
      crop: { x: 0, y: 0, width: 320, height: 120 },
      sizingMode: "contain",
      runtimeContentSha256: PNG_SHA256,
      byteLength: PNG_BYTES.byteLength,
      pngBytes: PNG_BYTES,
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

test("load-time inline handlers retain their source-empty runtime hosts", () => {
  const source = `<!doctype html><body onload="document.querySelector('div').textContent = 'ready'">
      <div id="handler-chart"></div>
    </body>`;
  const prepared = prepareRuntimeVisualCapture({
    html: source,
    sourcePath: "/tmp/handler-report.html",
    viewportWidth: 900,
  });
  assert.deepEqual(
    prepared?.candidates.map((candidate) => candidate.tagName),
    ["div"],
  );
  assert.ok(prepared?.payload);
  assert.notEqual(
    prepared?.dependencySha256,
    prepareRuntimeVisualCapture({
      html: source.replace("ready", "updated"),
      sourcePath: "/tmp/handler-report.html",
      viewportWidth: 900,
    })?.dependencySha256,
  );
});

test("direct Canvas and SVG runtime hosts are capture candidates", () => {
  const source = `<!doctype html><main>
    <canvas id="direct-canvas"></canvas>
    <svg id="direct-svg"></svg>
    <script>
      const context = document.getElementById("direct-canvas").getContext("2d");
      context.fillRect(0, 0, 40, 20);
      document.getElementById("direct-svg").insertAdjacentHTML(
        "beforeend",
        "<rect width='40' height='20'></rect>",
      );
    </script>
  </main>`;
  const prepared = prepareRuntimeVisualCapture({
    html: source,
    sourcePath: "/tmp/direct.html",
    viewportWidth: 900,
  });
  assert.deepEqual(
    prepared?.candidates.map((candidate) => candidate.tagName),
    ["canvas", "svg"],
  );
});

test("external runtime scripts do not hide candidates referenced by another script", () => {
  const source = `<!doctype html><main>
    <div id="inline-chart"></div><div id="external-chart"></div>
    <script>document.getElementById("inline-chart").textContent = "ready";</script>
    <script src="./external-chart.js"></script>
  </main>`;
  const prepared = prepareRuntimeVisualCapture({
    html: source,
    sourcePath: "/tmp/mixed.html",
    viewportWidth: 900,
  });
  assert.equal(prepared?.candidates.length, 2);
});

test("directly referenced runtime hosts keep priority before the shared candidate cap", () => {
  const unrelatedHosts = Array.from(
    { length: RUNTIME_VISUAL_CONTRACT.candidateLimit },
    () => `<div class="chart"></div>`,
  ).join("");
  const source = `<!doctype html><main>${unrelatedHosts}
    <div id="late-chart"></div>
    <script>
      document.getElementById("late-chart").appendChild(document.createElement("svg"));
    </script>
  </main>`;
  const sourceIndex = buildSourceIndex(source);
  const prepared = prepareRuntimeVisualCapture({
    html: source,
    sourcePath: "/tmp/late-runtime-host.html",
    viewportWidth: 900,
  });
  assert.equal(prepared?.candidates.length, RUNTIME_VISUAL_CONTRACT.candidateLimit);
  const firstCandidate = prepared?.candidates[0];
  assert.equal(
    firstCandidate && sourceIndex.byNodeId.get(firstCandidate.sourceNodeId)?.stableAttributes.id,
    "late-chart",
  );
});

test("stable lookup namespaces keep an ID reference ahead of same-token classes", () => {
  const unrelatedHosts = Array.from(
    { length: RUNTIME_VISUAL_CONTRACT.candidateLimit },
    () => `<div class="chart"></div>`,
  ).join("");
  const source = `<!doctype html><main>${unrelatedHosts}
    <div id="chart"></div>
    <script>
      document.getElementById("chart").appendChild(document.createElement("svg"));
    </script>
  </main>`;
  const sourceIndex = buildSourceIndex(source);
  const prepared = prepareRuntimeVisualCapture({
    html: source,
    sourcePath: "/tmp/namespaced-runtime-host.html",
    viewportWidth: 900,
  });
  assert.equal(prepared?.candidates.length, RUNTIME_VISUAL_CONTRACT.candidateLimit);
  const firstCandidate = prepared?.candidates[0];
  assert.equal(
    firstCandidate && sourceIndex.byNodeId.get(firstCandidate.sourceNodeId)?.stableAttributes.id,
    "chart",
  );
});

test("stable ID lookup does not consume the cap with same-token name hosts", () => {
  const unrelatedHosts = Array.from(
    { length: RUNTIME_VISUAL_CONTRACT.candidateLimit },
    () => `<div name="chart"></div>`,
  ).join("");
  const source = `<!doctype html><main>${unrelatedHosts}
    <div id="chart"></div>
    <script>
      document.getElementById("chart").appendChild(document.createElement("svg"));
    </script>
  </main>`;
  const sourceIndex = buildSourceIndex(source);
  const prepared = prepareRuntimeVisualCapture({
    html: source,
    sourcePath: "/tmp/id-name-runtime-host.html",
    viewportWidth: 900,
  });
  assert.equal(prepared?.candidates.length, RUNTIME_VISUAL_CONTRACT.candidateLimit);
  const firstCandidate = prepared?.candidates[0];
  assert.equal(
    firstCandidate && sourceIndex.byNodeId.get(firstCandidate.sourceNodeId)?.stableAttributes.id,
    "chart",
  );
});

test("named ID property references retain their exact host", () => {
  const source = `<!doctype html><main>
    <div id="chart"></div>
    <script>chart.textContent = "ready";</script>
  </main>`;
  const prepared = prepareRuntimeVisualCapture({
    html: source,
    sourcePath: "/tmp/named-id-runtime-host.html",
    viewportWidth: 900,
  });
  assert.equal(prepared?.candidates.length, 1);
});

test("direct references keep punctuation identifiers distinct from class tokens", () => {
  const unrelatedHosts = Array.from(
    { length: RUNTIME_VISUAL_CONTRACT.candidateLimit },
    () => `<div class="chart"></div>`,
  ).join("");
  const source = `<!doctype html><main>${unrelatedHosts}
    <div id="late.chart"></div>
    <script>
      document.getElementById("late.chart").appendChild(document.createElement("svg"));
    </script>
  </main>`;
  const sourceIndex = buildSourceIndex(source);
  const prepared = prepareRuntimeVisualCapture({
    html: source,
    sourcePath: "/tmp/punctuation-runtime-host.html",
    viewportWidth: 900,
  });
  assert.equal(prepared?.candidates.length, RUNTIME_VISUAL_CONTRACT.candidateLimit);
  const firstCandidate = prepared?.candidates[0];
  assert.equal(
    firstCandidate && sourceIndex.byNodeId.get(firstCandidate.sourceNodeId)?.stableAttributes.id,
    "late.chart",
  );
});

test("class-selector references retain class-only runtime hosts", () => {
  const source = `<!doctype html><main>
    <div class="chart"></div>
    <div id="late.chart"></div>
    <script>
      document.querySelector(".chart").textContent = "ready";
    </script>
  </main>`;
  const sourceIndex = buildSourceIndex(source);
  const prepared = prepareRuntimeVisualCapture({
    html: source,
    sourcePath: "/tmp/class-selector-runtime-host.html",
    viewportWidth: 900,
  });
  assert.deepEqual(
    prepared?.candidates.map((candidate) => (
      sourceIndex.byNodeId.get(candidate.sourceNodeId)?.selector
    )),
    ["div.chart"],
  );
});

test("class attribute-selector references retain class-only runtime hosts", () => {
  const source = `<!doctype html><main>
    <div class="chart"></div>
    <div id="late.chart"></div>
    <script>
      document.querySelector('[class~="chart"]').textContent = "ready";
    </script>
  </main>`;
  const sourceIndex = buildSourceIndex(source);
  const prepared = prepareRuntimeVisualCapture({
    html: source,
    sourcePath: "/tmp/class-attribute-selector-runtime-host.html",
    viewportWidth: 900,
  });
  assert.deepEqual(
    prepared?.candidates.map((candidate) => (
      sourceIndex.byNodeId.get(candidate.sourceNodeId)?.selector
    )),
    ["div.chart"],
  );
});

test("class equality selectors match the complete class attribute value", () => {
  const source = `<!doctype html><main>
    <div class="chart wide"></div>
    <div class="chart"></div>
    <script>
      document.querySelector('[class="chart wide"]').textContent = "ready";
    </script>
  </main>`;
  const sourceIndex = buildSourceIndex(source);
  const prepared = prepareRuntimeVisualCapture({
    html: source,
    sourcePath: "/tmp/class-equality-runtime-host.html",
    viewportWidth: 900,
  });
  assert.deepEqual(
    prepared?.candidates.map((candidate) => (
      sourceIndex.byNodeId.get(candidate.sourceNodeId)?.attributesByName
        .get("class")?.[0]?.value
    )),
    ["chart wide"],
  );
});

test("identity presence selectors retain only the matching namespace hosts", () => {
  for (const attributeName of ["id", "name"]) {
    const source = `<!doctype html><main>
      <div ${attributeName}="chart"></div>
      <div class="unrelated"></div>
      <script>
        document.querySelector('[${attributeName}]').textContent = "ready";
      </script>
    </main>`;
    const sourceIndex = buildSourceIndex(source);
    const prepared = prepareRuntimeVisualCapture({
      html: source,
      sourcePath: `/tmp/${attributeName}-presence-runtime-host.html`,
      viewportWidth: 900,
    });
    assert.deepEqual(
      prepared?.candidates.map((candidate) => (
        sourceIndex.byNodeId.get(candidate.sourceNodeId)?.attributesByName
          .get(attributeName)?.[0]?.value
      )),
      ["chart"],
      attributeName,
    );
  }
});

test("script-referenced data containers participate in the runtime dependency", () => {
  const source = `<!doctype html><main>
    <div id="chart"></div><div id="chart-data">1,2,3</div>
    <script>
      document.querySelector("#chart").textContent =
        document.querySelector("#chart-data").textContent;
    </script>
  </main>`;
  const first = describeRuntimeVisualCapture({
    html: source,
    sourcePath: "/tmp/data.html",
    viewportWidth: 900,
  });
  const changed = describeRuntimeVisualCapture({
    html: source.replace("1,2,3", "3,2,1"),
    sourcePath: "/tmp/data.html",
    viewportWidth: 900,
  });
  const unrelated = describeRuntimeVisualCapture({
    html: source.replace("<main>", "<main><p>ordinary copy</p>"),
    sourcePath: "/tmp/data.html",
    viewportWidth: 900,
  });
  assert.notEqual(first?.dependencySha256, changed?.dependencySha256);
  assert.equal(first?.dependencySha256, unrelated?.dependencySha256);
});

test("indirect DOM reads conservatively invalidate the runtime dependency", () => {
  const source = `<!doctype html><body>
    <span>1,2,3</span><div id="chart"></div>
    <script>
      const series = document.body.children[0].textContent;
      document.getElementById("chart").textContent = series;
    </script>
  </body>`;
  const first = describeRuntimeVisualCapture({
    html: source,
    sourcePath: "/tmp/indirect-data.html",
    viewportWidth: 900,
  });
  const changedData = describeRuntimeVisualCapture({
    html: source.replace("1,2,3", "3,2,1"),
    sourcePath: "/tmp/indirect-data.html",
    viewportWidth: 900,
  });
  const unrelated = describeRuntimeVisualCapture({
    html: source.replace("<span>", "<p>ordinary copy</p><span>"),
    sourcePath: "/tmp/indirect-data.html",
    viewportWidth: 900,
  });
  assert.ok(first?.candidates.length);
  assert.notEqual(first?.dependencySha256, changedData?.dependencySha256);
  assert.notEqual(first?.dependencySha256, unrelated?.dependencySha256);
});

test("literal tag selectors conservatively invalidate the runtime dependency", () => {
  const source = `<!doctype html><main>
    <p>1,2,3</p><div id="chart"></div>
    <script>
      document.getElementById("chart").textContent =
        document.querySelector("p").textContent;
    </script>
  </main>`;
  const first = describeRuntimeVisualCapture({
    html: source,
    sourcePath: "/tmp/literal-selector-data.html",
    viewportWidth: 900,
  });
  const changedData = describeRuntimeVisualCapture({
    html: source.replace("1,2,3", "3,2,1"),
    sourcePath: "/tmp/literal-selector-data.html",
    viewportWidth: 900,
  });
  assert.ok(first?.candidates.length);
  assert.notEqual(first?.dependencySha256, changedData?.dependencySha256);
});

test("generic selectors retain anonymous exact visual hosts", () => {
  const fixture = runtimeVisualHostilePage("pr105-generic-selector-host");
  const prepared = prepareRuntimeVisualCapture({
    html: fixture.html,
    sourcePath: "/tmp/generic-selector.html",
    viewportWidth: 900,
  });
  assert.deepEqual(
    prepared?.candidates.map(({ tagName }) => tagName),
    ["canvas"],
    fixture.contract,
  );
});

test("computed element lookup fails closed to the full source dependency", () => {
  const fixture = runtimeVisualHostilePage("pr105-dynamic-id-dependency");
  const before = describeRuntimeVisualCapture({
    html: fixture.html,
    sourcePath: "/tmp/dynamic-id.html",
    viewportWidth: 900,
  });
  const after = describeRuntimeVisualCapture({
    html: fixture.changedHtml,
    sourcePath: "/tmp/dynamic-id.html",
    viewportWidth: 900,
  });
  assert.equal(before?.candidates.length, 1);
  assert.notEqual(before?.sourceSha256, after?.sourceSha256);
  assert.notEqual(before?.dependencySha256, after?.dependencySha256, fixture.contract);
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
  assert.equal(
    projection.visuals[0].runtimeContentSha256,
    PNG_SHA256,
  );

  const invalidContentHash = rawProjection(prepared.payload);
  invalidContentHash.visuals[0].runtimeContentSha256 = `sha256:${"0".repeat(64)}`;
  assert.deepEqual(acceptRuntimeVisualProjection({
    html: SOURCE,
    documentKey: "current:/tmp/report.html",
    generation: 4,
    rawProjection: invalidContentHash,
  })?.visuals, []);

  assert.equal(acceptRuntimeVisualProjection({
    html: SOURCE.replace("source text", "changed source text"),
    documentKey: "current:/tmp/report.html",
    generation: 5,
    rawProjection: rawProjection(prepared.payload),
  }), null);
  assert.equal(rebindRuntimeVisualProjection({
    html: SOURCE.replace("source text", "changed source text"),
    documentKey: "current:/tmp/report.html",
    generation: 5,
    projection,
  }), null);
  assert.equal(rebindRuntimeVisualProjection({
    html: SOURCE,
    documentKey: "current:/tmp/report.html",
    generation: 5,
    projection,
  })?.sourceSha256, prepared.sourceSha256);

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
  assert.equal(mergeDeferredRuntimeVisualProjection({
    html: SOURCE,
    documentKey: "current:/tmp/report.html",
    generation: 2,
    projection: { ...deferredProjection },
    fallbackProjection,
  }), null);

  const overlappingProjection = rawProjection(prepared.payload);
  overlappingProjection.deferredSourceNodeIds = [
    prepared.candidates[0].sourceNodeId,
  ];
  assert.equal(acceptRuntimeVisualProjection({
    html: SOURCE,
    documentKey: "current:/tmp/report.html",
    generation: 3,
    rawProjection: overlappingProjection,
  }), null);
});

test("projection session never caches an all-deferred capture as ready", async () => {
  let captures = 0;
  const session = new RuntimeVisualProjectionSession({
    captureDebounceMs: 0,
    capture: async (capturePayload) => {
      captures += 1;
      return {
        protocol: RUNTIME_VISUAL_PROJECTION_PROTOCOL,
        version: RUNTIME_VISUAL_PROJECTION_VERSION,
        sourceSha256: capturePayload.sourceSha256,
        visuals: [],
        deferredSourceNodeIds: capturePayload.candidates.map(
          (candidate) => candidate.sourceNodeId,
        ),
      };
    },
  });
  const request = () => session.request({
    html: SOURCE,
    sourcePath: "/tmp/report.html",
    documentKey: "current:/tmp/report.html",
    viewportWidth: 900,
  });

  request();
  await nextTask();
  await nextTask();
  assert.equal(captures, 1);
  assert.equal(session.snapshot.status, "unavailable");
  assert.equal(session.snapshot.projection, null);

  request();
  await nextTask();
  await nextTask();
  assert.equal(captures, 2);
  assert.equal(session.snapshot.status, "unavailable");
  session.dispose();
});

test("projection session commits a non-deferred empty capture as a clear", async () => {
  const pending = [];
  const session = new RuntimeVisualProjectionSession({
    captureDebounceMs: 0,
    capture: (payload) => new Promise((resolve) => {
      pending.push({ payload, resolve });
    }),
  });
  const request = (html) => session.request({
    html,
    sourcePath: "/tmp/report.html",
    documentKey: "current:/tmp/report.html",
    viewportWidth: 900,
  });

  request(SOURCE);
  await nextTask();
  pending[0].resolve(rawProjection(pending[0].payload));
  await nextTask();
  assert.equal(session.snapshot.projection?.visuals.length, 1);

  const clearedSource = SOURCE.replace(
    'document.createElement("svg")',
    'document.createElement("canvas")',
  );
  request(clearedSource);
  await nextTask();
  assert.equal(pending.length, 2);
  pending[1].resolve({
    protocol: RUNTIME_VISUAL_PROJECTION_PROTOCOL,
    version: RUNTIME_VISUAL_PROJECTION_VERSION,
    sourceSha256: pending[1].payload.sourceSha256,
    visuals: [],
    deferredSourceNodeIds: [],
  });
  await nextTask();
  assert.equal(session.snapshot.status, "ready");
  assert.equal(session.snapshot.projection?.visuals.length, 0);
  assert.equal(
    session.snapshot.projection?.sourceSha256,
    buildSourceIndex(clearedSource).sourceSha256,
  );

  request(clearedSource);
  assert.equal(pending.length, 2);
  session.dispose();
});

test("projection session invalidates first on every full source hash change", async () => {
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
  pending[0].resolve(rawProjection(pending[0].payload));
  await nextTask();
  assert.equal(session.snapshot.status, "ready");

  const nextSource = SOURCE.replace("source text", "new source text");
  session.request({
    html: nextSource,
    sourcePath: "/tmp/report.html",
    documentKey: "current:/tmp/report.html",
    viewportWidth: 900,
  });
  assert.equal(session.snapshot.status, "scheduled");
  assert.equal(session.snapshot.projection, null);
  await nextTask();
  assert.equal(pending.length, 2);
  pending[1].resolve(rawProjection(pending[1].payload));
  await nextTask();
  assert.equal(session.snapshot.status, "ready");
  assert.equal(
    session.snapshot.projection?.sourceSha256,
    buildSourceIndex(nextSource).sourceSha256,
  );
  assert.equal(pending.length, 2);
  assert.equal(session.snapshot.projection?.visuals.length, 1);
  const secondTextEdit = nextSource.replace("new source text", "newer source text");
  session.request({
    html: secondTextEdit,
    sourcePath: "/tmp/report.html",
    documentKey: "current:/tmp/report.html",
    viewportWidth: 900,
  });
  assert.equal(session.snapshot.projection, null);
  await nextTask();
  assert.equal(pending.length, 3);
  assert.equal(session.snapshot.status, "capturing");
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

  request(901);
  assert.equal(pending.length, 1);
  assert.equal(session.snapshot.projection?.visuals[0], firstProjection.visuals[0]);

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
