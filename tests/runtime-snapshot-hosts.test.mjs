import assert from "node:assert/strict";
import test from "node:test";

import {
  EDIT_RUNTIME_HOST_LIMIT,
  RUNTIME_SNAPSHOT_HOST_ENUMERATION_LIMIT,
  RUNTIME_SNAPSHOT_HOST_LIMIT,
  resolveEditRuntimeHosts,
  resolveRuntimeSnapshotHosts,
} from "../app/domain/runtime-snapshot-hosts.js";

test("source host resolver admits only direct paint roots and stable empty hosts", () => {
  const beforeHtml = `<!doctype html><html><body><main>
    <canvas id="sales-canvas"></canvas>
    <svg viewBox="0 0 10 10"><path d="M0 0L10 10"></path></svg>
    <svg id="empty-runtime-svg"></svg>
    <div id="id-chart"></div>
    <div data-chart="revenue"></div>
    <div class="traffic-unique"></div>
    <div class="duplicate-chart"></div><div class="duplicate-chart"></div>
    <div id="not-empty">fallback text</div>
  </main></body></html>`;
  const afterHtml = beforeHtml;
  const resolved = resolveRuntimeSnapshotHosts({ beforeHtml, afterHtml });

  assert.ok(resolved);
  assert.equal(RUNTIME_SNAPSHOT_HOST_LIMIT, 32);
  assert.deepEqual(
    resolved.hosts.map(({ before }) => before.kind),
    ["canvas", "svg", "svg", "host", "host", "host"],
  );
  assert.deepEqual(
    resolved.hosts.map(({ before }) => before.binding.tagName),
    ["canvas", "svg", "svg", "div", "div", "div"],
  );
  const emptySvg = resolved.hosts.find(({ before }) => (
    before.binding.identityAttributes.some(([name]) => name === "id")
    && before.binding.tagName === "svg"
  ));
  assert.ok(emptySvg, "a source-empty SVG keeps its source-backed identity");
  const idHost = resolved.hosts.find(({ before }) => (
    before.binding.identityAttributes.some(([name, value]) => (
      name === "id" && value === "id-chart"
    ))
  ));
  assert.ok(idHost, "a source-empty stable ID host is eligible");
  const dataHost = resolved.hosts.find(({ before }) => (
    before.binding.identityAttributes.some(([name]) => name === "data-chart")
  ));
  assert.ok(dataHost);
  assert.equal(dataHost.before.hostTargetRef.level, "subregion");
  assert.match(dataHost.before.hostTargetRef.targetId, /^target_/u);
});

test("source host resolver fails closed when a host is removed, ambiguous, or changes type", () => {
  const beforeHtml = `<!doctype html><html><body><main>
    <div id="chart-host"></div>
    <div data-chart="other"></div>
  </main></body></html>`;
  const afterHtml = `<!doctype html><html><body><main>
    <section id="chart-host"></section>
    <div data-chart="other"></div><div data-chart="other"></div>
  </main></body></html>`;
  const resolved = resolveRuntimeSnapshotHosts({ beforeHtml, afterHtml });

  assert.ok(resolved);
  assert.deepEqual(resolved.hosts, []);
});

test("direct source Canvas remains conservatively pairable by its exact source path", () => {
  const beforeHtml = "<!doctype html><html><body><canvas></canvas></body></html>";
  const afterHtml = "<!doctype html><html><body><canvas></canvas></body></html>";
  const resolved = resolveRuntimeSnapshotHosts({ beforeHtml, afterHtml });

  assert.ok(resolved);
  assert.equal(resolved.hosts.length, 1);
  assert.equal(resolved.hosts[0].before.kind, "canvas");
  assert.deepEqual(resolved.hosts[0].before.binding.identityAttributes, []);
  assert.deepEqual(resolved.hosts[0].before.binding.path, [1, 0]);
});

test("host enumeration may exceed the capture budget so callers can prioritize, but stays bounded", () => {
  const canvases = Array.from(
    { length: RUNTIME_SNAPSHOT_HOST_ENUMERATION_LIMIT + 8 },
    () => "<canvas></canvas>",
  ).join("");
  const html = `<!doctype html><html><body>${canvases}</body></html>`;
  const defaulted = resolveRuntimeSnapshotHosts({ beforeHtml: html, afterHtml: html });
  assert.equal(defaulted?.hosts.length, RUNTIME_SNAPSHOT_HOST_LIMIT, "the default remains the capture budget");
  const enumerated = resolveRuntimeSnapshotHosts({
    beforeHtml: html,
    afterHtml: html,
    maximum: RUNTIME_SNAPSHOT_HOST_ENUMERATION_LIMIT + 8,
  });
  assert.equal(
    enumerated?.hosts.length,
    RUNTIME_SNAPSHOT_HOST_ENUMERATION_LIMIT,
    "enumeration is clamped to the contract candidate limit",
  );
});

test("Edit runtime admits only uniquely bound empty non-global hosts", () => {
  const html = [
    "<!doctype html><html><body>",
    '<main id="chart-host"></main>',
    '<svg id="svg-host"></svg>',
    '<table><tbody id="table-host"></tbody></table>',
    '<div class="unique-runtime-host"></div>',
    '<div id="not-empty">author text</div>',
    '<script id="script-host"></script>',
    '<body id="body-host"></body>',
    "</body></html>",
  ].join("");
  const resolved = resolveEditRuntimeHosts({ html });

  assert.ok(resolved);
  assert.equal(EDIT_RUNTIME_HOST_LIMIT, 32);
  assert.deepEqual(
    resolved.hosts.map((host) => host.binding.tagName),
    ["main", "svg", "tbody", "div"],
  );
  assert.equal(
    resolved.hosts.every((host) => host.binding.identityAttributes.length === 1),
    true,
  );
  assert.equal(
    resolved.hosts.some((host) => ["body", "script"].includes(host.binding.tagName)),
    false,
  );
});
