import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  EDIT_RUNTIME_PROTOCOL_SCHEME,
} from "../app/domain/edit-runtime-contract.js";
import {
  createEditRuntimeProtocolController,
  prepareEditRuntimeDocument,
  registerEditRuntimeProtocolScheme,
  validateEditRuntimeHostBindings,
} from "../desktop/edit-runtime-protocol.mjs";

const SESSION_ID = "0123456789abcdef0123456789abcdef";
const PROBE_EXECUTION_ID = "abcdefabcdefabcdefabcdef";
const DIRECT_EXECUTION_ID = "1234567890abcdef12345678";
const BINDINGS = [{
  key: "edit-runtime-1",
  path: [1, 0],
  tagName: "main",
  identityAttributes: [["id", "chart-host"]],
}];
const HTML = [
  "<!doctype html><html><head><title>Report</title></head><body>",
  '<main id="chart-host" style="width:640px;height:360px"></main>',
  '<script src="vendor/echarts.js"></script>',
  "<script>window.renderChart = true;</script>",
  "</body></html>",
].join("");

test("Edit runtime protocol marks source nodes and replaces all author programs with fixed stubs", () => {
  const prepared = prepareEditRuntimeDocument({
    html: HTML,
    sessionId: SESSION_ID,
    executionId: PROBE_EXECUTION_ID,
    bindings: BINDINGS,
    probe: true,
  });

  assert.equal(prepared.scriptCount, 2);
  assert.match(prepared.html, /data-pageroot-edit-runtime-source="root"/u);
  assert.match(prepared.html, /data-pageroot-edit-runtime-host="edit-runtime-1"/u);
  assert.match(prepared.html, /data-pageroot-edit-runtime-script="0"/u);
  assert.match(prepared.html, /data-pageroot-edit-runtime-script="1"/u);
  assert.doesNotMatch(prepared.html, /window\.renderChart = true/u);
  assert.match(prepared.html, new RegExp(
    `${EDIT_RUNTIME_PROTOCOL_SCHEME}:\\/\\/${SESSION_ID}\\/\\.pageroot\\/bootstrap\\/${PROBE_EXECUTION_ID}\\.js`,
    "u",
  ));
  assert.throws(
    () => validateEditRuntimeHostBindings([{ ...BINDINGS[0], path: [-1] }]),
    /invalid/u,
  );
});

test("Edit runtime protocol serves one-use bootstrap and exact frozen local script bytes only", async (t) => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "pageroot-edit-runtime-"));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const sourcePath = path.join(temporaryRoot, "report.html");
  await mkdir(path.join(temporaryRoot, "vendor"));
  await Promise.all([
    writeFile(sourcePath, HTML),
    writeFile(path.join(temporaryRoot, "vendor", "echarts.js"), "window.echarts = { init() {} };"),
  ]);

  const registrations = [];
  let handler = null;
  const protocolApi = {
    registerSchemesAsPrivileged(value) {
      registrations.push(value);
    },
    handle(scheme, nextHandler) {
      assert.equal(scheme, EDIT_RUNTIME_PROTOCOL_SCHEME);
      handler = nextHandler;
    },
  };
  const executionIds = [PROBE_EXECUTION_ID, DIRECT_EXECUTION_ID];
  const controller = createEditRuntimeProtocolController({
    protocolApi,
    netFetch: async () => new Response("unexpected remote fetch", { status: 500 }),
    randomSessionId: () => SESSION_ID,
    randomExecutionId: () => executionIds.shift(),
    randomFreezeKey: () => "f".repeat(32),
  });
  registerEditRuntimeProtocolScheme(protocolApi);
  assert.equal(registrations[0][0].scheme, EDIT_RUNTIME_PROTOCOL_SCHEME);
  assert.equal(registrations[0][0].privileges.bypassCSP, undefined);
  controller.install();
  assert.equal(typeof handler, "function");

  const session = await controller.createSession({
    html: HTML,
    sourcePath,
    bindings: BINDINGS,
  });
  assert.deepEqual(session, {
    contractVersion: 1,
    sessionId: SESSION_ID,
    probeExecutionId: PROBE_EXECUTION_ID,
    directExecutionId: DIRECT_EXECUTION_ID,
    probeUrl: `pageroot-edit-runtime://${SESSION_ID}/.pageroot/probe/index.html`,
    scriptCount: 2,
    resourceSha256: session.resourceSha256,
    byteLength: session.byteLength,
  });
  assert.match(session.resourceSha256, /^sha256:[a-f0-9]{64}$/u);

  const documentResponse = await handler(new Request(session.probeUrl));
  assert.equal(documentResponse.status, 200);
  assert.match(documentResponse.headers.get("content-security-policy") || "", /connect-src 'none'/u);
  assert.doesNotMatch(await documentResponse.text(), /window\.renderChart = true/u);

  const bootstrapUrl = `pageroot-edit-runtime://${SESSION_ID}/.pageroot/bootstrap/${PROBE_EXECUTION_ID}.js`;
  const firstBootstrap = await handler(new Request(bootstrapUrl));
  assert.equal(firstBootstrap.status, 200);
  assert.match(await firstBootstrap.text(), /author-loader/u);
  const secondBootstrap = await handler(new Request(bootstrapUrl));
  assert.equal(await secondBootstrap.text(), "void 0;");

  const localAuthorScript = await handler(new Request(
    `pageroot-edit-runtime://${SESSION_ID}/.pageroot/author/0.js`,
  ));
  assert.equal(await localAuthorScript.text(), "window.echarts = { init() {} };");
  const inlineAuthorScript = await handler(new Request(
    `pageroot-edit-runtime://${SESSION_ID}/.pageroot/author/1.js`,
  ));
  assert.equal(await inlineAuthorScript.text(), "window.renderChart = true;");
  const undeclaredScript = await handler(new Request(
    `pageroot-edit-runtime://${SESSION_ID}/.pageroot/author/2.js`,
  ));
  assert.equal(undeclaredScript.status, 404);

  assert.deepEqual(controller.revokeSession(SESSION_ID), { revoked: true });
  assert.equal((await handler(new Request(session.probeUrl))).status, 404);
});

test("Edit runtime protocol rejects source programs that need network or runtime modules", async (t) => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "pageroot-edit-runtime-reject-"));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const sourcePath = path.join(temporaryRoot, "report.html");
  const controller = createEditRuntimeProtocolController({
    protocolApi: { handle() {} },
    netFetch: async () => new Response("never"),
  });
  const networkHtml = HTML.replace(
    "window.renderChart = true;",
    "fetch('/live-data');",
  );
  await Promise.all([
    writeFile(sourcePath, networkHtml),
    mkdir(path.join(temporaryRoot, "vendor")),
  ]);
  await writeFile(path.join(temporaryRoot, "vendor", "echarts.js"), "window.echarts = {};");

  await assert.rejects(
    controller.createSession({
      html: networkHtml,
      sourcePath,
      bindings: BINDINGS,
    }),
    /runtime-network/u,
  );
  await assert.rejects(
    controller.createSession({
      html: HTML.replace(
        '<script src="vendor/echarts.js"></script>',
        '<script type="module" src="vendor/echarts.js"></script>',
      ),
      sourcePath,
      bindings: BINDINGS,
    }),
    /module-script/u,
  );
  await assert.rejects(
    controller.createSession({
      html: [
        "<!doctype html><html><body>",
        '<main id="chart-host" style="width:640px;height:360px"></main>',
        "<script>document.querySelector('#chart-host').append(document.createElement('canvas'))</script>",
        "</body></html>",
      ].join(""),
      sourcePath,
      bindings: BINDINGS,
    }),
    /ECharts candidate/u,
  );
});
