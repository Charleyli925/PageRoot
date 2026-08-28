import assert from "node:assert/strict";
import test from "node:test";

import {
  EDIT_RUNTIME_HOST_LIMIT,
  editRuntimeCaptureCandidate,
  resolveEditRuntimeHosts,
} from "../app/domain/runtime-snapshot-hosts.js";

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

test("Edit runtime capture candidates keep only the bounded owner binding", () => {
  const resolved = resolveEditRuntimeHosts({
    html: '<!doctype html><html><body><div id="runtime-host"></div></body></html>',
  });
  const host = resolved?.hosts[0];
  assert.ok(host);

  assert.deepEqual(editRuntimeCaptureCandidate("runtime-host-1", host), {
    key: "runtime-host-1",
    path: [1, 0],
    tagName: "div",
    kind: "host",
    identityAttributes: [["id", "runtime-host"]],
  });
  assert.equal(editRuntimeCaptureCandidate("INVALID KEY", host), null);
});
