import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
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
  registerEditRuntimeProtocolScheme,
  validateEditRuntimeHostBindings,
} from "../desktop/edit-runtime-protocol.mjs";

const SESSION_ID = "0123456789abcdef0123456789abcdef";
const EXECUTION_ID = "abcdefabcdefabcdefabcdef";
const BINDINGS = [{
  key: "edit-runtime-1",
  path: [1, 0],
  tagName: "main",
  identityAttributes: [["id", "chart-host"]],
}];
const HTML = [
  '<!doctype html><html><head><title>Report</title><link rel="stylesheet" href="report.css"></head><body>',
  '<main id="chart-host" style="width:640px;height:360px"></main>',
  '<script src="vendor/echarts.js"></script>',
  '<script>echarts.init(document.querySelector("#chart-host"))</script>',
  "</body></html>",
].join("");

test("direct protocol serves one immutable resource session and consumes execution bytes once", async (t) => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "pageroot-edit-runtime-"));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const sourcePath = path.join(temporaryRoot, "report.html");
  await mkdir(path.join(temporaryRoot, "vendor"));
  await Promise.all([
    writeFile(sourcePath, HTML),
    writeFile(path.join(temporaryRoot, "vendor", "echarts.js"), "window.echarts={init(){}};"),
    writeFile(path.join(temporaryRoot, "report.css"), "#chart-host { display: block; }"),
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
  const controller = createEditRuntimeProtocolController({
    protocolApi,
    netFetch: async () => new Response("unexpected remote fetch", { status: 500 }),
    randomSessionId: () => SESSION_ID,
    randomExecutionId: () => EXECUTION_ID,
  });
  registerEditRuntimeProtocolScheme(protocolApi);
  controller.install();
  assert.equal(registrations[0][0].scheme, EDIT_RUNTIME_PROTOCOL_SCHEME);
  assert.equal(registrations[0][0].privileges.bypassCSP, undefined);
  assert.equal(typeof handler, "function");

  const session = await controller.createSession({
    html: HTML,
    sourcePath,
    bindings: BINDINGS,
  });
  assert.deepEqual(
    {
      contractVersion: session.contractVersion,
      sessionId: session.sessionId,
      executionId: session.executionId,
      scriptCount: session.scriptCount,
      byteLength: session.byteLength,
    },
    {
      contractVersion: 1,
      sessionId: SESSION_ID,
      executionId: EXECUTION_ID,
      scriptCount: 2,
      byteLength: 77,
    },
  );
  assert.match(session.resourceSha256, /^sha256:[a-f0-9]{64}$/u);

  const stylesheet = await handler(new Request(
    "pageroot-edit-runtime://" + SESSION_ID + "/report.css",
  ));
  assert.equal(stylesheet.status, 200);
  assert.equal(stylesheet.headers.get("content-type"), "text/css; charset=utf-8");
  assert.match(await stylesheet.text(), /display: block/u);

  const bootstrapUrl = "pageroot-edit-runtime://" + SESSION_ID
    + "/.pageroot/bootstrap/" + EXECUTION_ID + ".js";
  const bootstrap = await handler(new Request(bootstrapUrl));
  assert.equal(bootstrap.status, 200);
  assert.match(await bootstrap.text(), /runtimeSettleMs/u);
  assert.equal((await handler(new Request(bootstrapUrl))).status, 404);

  const firstAuthor = await handler(new Request(
    "pageroot-edit-runtime://" + SESSION_ID + "/.pageroot/author/0.js",
  ));
  assert.equal(await firstAuthor.text(), "window.echarts={init(){}};");
  assert.equal(
    (await handler(new Request(
      "pageroot-edit-runtime://" + SESSION_ID + "/.pageroot/author/0.js",
    ))).status,
    404,
  );
  const secondAuthor = await handler(new Request(
    "pageroot-edit-runtime://" + SESSION_ID + "/.pageroot/author/1.js",
  ));
  assert.match(await secondAuthor.text(), /echarts\.init/u);

  assert.deepEqual(controller.revokeSession(SESSION_ID), { revoked: true });
  assert.equal(controller.sessionCount(), 0);
});

test("direct protocol keeps CSP instead of keyword-rejecting fetch and workers", async (t) => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "pageroot-edit-runtime-csp-"));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const sourcePath = path.join(temporaryRoot, "report.html");
  const html = HTML.replace(
    'echarts.init(document.querySelector("#chart-host"))',
    'fetch("/data"); new Worker("worker.js"); echarts.init(document.querySelector("#chart-host"))',
  );
  await mkdir(path.join(temporaryRoot, "vendor"));
  await Promise.all([
    writeFile(sourcePath, html),
    writeFile(path.join(temporaryRoot, "vendor", "echarts.js"), "window.echarts={init(){}};"),
  ]);
  const controller = createEditRuntimeProtocolController({
    protocolApi: { handle() {} },
    netFetch: async () => new Response("unexpected"),
    randomSessionId: () => "11111111111111111111111111111111",
    randomExecutionId: () => "222222222222222222222222",
  });

  const session = await controller.createSession({ html, sourcePath, bindings: BINDINGS });
  assert.equal(session.scriptCount, 2);
  await assert.rejects(
    controller.createSession({
      html: html.replace(
        'echarts.init(document.querySelector("#chart-host"))',
        'import("./chart.js")',
      ),
      sourcePath,
      bindings: BINDINGS,
    }),
    /dynamic-or-module-import/u,
  );
  assert.throws(
    () => validateEditRuntimeHostBindings([{ ...BINDINGS[0], path: [-1] }]),
    /invalid/u,
  );
});

test("runtime document exposes only fixed bootstrap and inert source-script stubs", async (t) => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "pageroot-edit-runtime-document-"));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const sourcePath = path.join(temporaryRoot, "report.html");
  await mkdir(path.join(temporaryRoot, "vendor"));
  await Promise.all([
    writeFile(sourcePath, HTML),
    writeFile(path.join(temporaryRoot, "vendor", "echarts.js"), "window.echarts={init(){}};"),
  ]);

  let handler = null;
  const controller = createEditRuntimeProtocolController({
    protocolApi: {
      handle(_scheme, nextHandler) {
        handler = nextHandler;
      },
    },
    netFetch: async () => new Response("unexpected"),
    randomSessionId: () => "3".repeat(32),
    randomExecutionId: () => "4".repeat(24),
  });
  controller.install();
  const session = await controller.createSession({ html: HTML, sourcePath, bindings: BINDINGS });
  const runtimeUrl = controller.runtimeDocumentUrl(session.sessionId);
  assert.equal(runtimeUrl, `pageroot-edit-runtime://${session.sessionId}/index.html`);

  const runtimeDocument = await handler(new Request(runtimeUrl));
  assert.equal(runtimeDocument.status, 200);
  assert.match(runtimeDocument.headers.get("content-security-policy") || "", /default-src 'none'/u);
  const body = await runtimeDocument.text();
  assert.match(body, /data-pageroot-edit-runtime-source="root"/u);
  assert.match(body, /data-pageroot-edit-runtime-host="edit-runtime-1"/u);
  assert.match(body, /data-pageroot-edit-runtime-bootstrap="true"/u);
  assert.match(body, /application\/x-pageroot-edit-runtime-source/u);
  assert.doesNotMatch(body, /<script[^>]+src="vendor\/echarts\.js"/u);
  assert.doesNotMatch(body, /echarts\.init\(document\.querySelector/u);
  assert.equal(await readFile(sourcePath, "utf8"), HTML);

  const bootstrapUrl = `pageroot-edit-runtime://${session.sessionId}/.pageroot/bootstrap/${session.executionId}.js`;
  assert.equal((await handler(new Request(bootstrapUrl))).status, 200);
  assert.equal((await handler(new Request(bootstrapUrl))).status, 404);
});
