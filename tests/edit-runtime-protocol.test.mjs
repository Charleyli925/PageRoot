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
  EDIT_AUTHOR_RUNTIME_BUDGET,
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
const REMOTE_ECHARTS_HTML = HTML.replace(
  'src="vendor/echarts.js"',
  'src="https://cdnjs.cloudflare.com/ajax/libs/echarts/5.5.0/echarts.min.js"',
);

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
    netFetch: async (url) => new Response(
      String(url).startsWith("file:")
        ? "#chart-host { display: block; }"
        : "unexpected remote fetch",
      { status: String(url).startsWith("file:") ? 200 : 500 },
    ),
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

test("direct protocol never serves a capture HTML document and consumes bootstrap once", async (t) => {
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
  assert.equal(typeof controller.runtimeDocumentUrl, "undefined");
  assert.equal(
    (await handler(new Request(`pageroot-edit-runtime://${session.sessionId}/index.html`))).status,
    404,
  );
  assert.equal(
    (await handler(new Request(`pageroot-edit-runtime://${session.sessionId}/`))).status,
    404,
  );
  assert.equal(await readFile(sourcePath, "utf8"), HTML);

  const bootstrapUrl = `pageroot-edit-runtime://${session.sessionId}/.pageroot/bootstrap/${session.executionId}.js`;
  const bootstrap = await handler(new Request(bootstrapUrl));
  assert.equal(bootstrap.status, 200);
  assert.match(await bootstrap.text(), /runtimeSettleMs/u);
  assert.equal((await handler(new Request(bootstrapUrl))).status, 404);
});

test("direct protocol streams a headerless allowlisted ECharts response within the fixed byte cap", async (t) => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "pageroot-edit-runtime-remote-stream-"));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const sourcePath = path.join(temporaryRoot, "report.html");
  await writeFile(sourcePath, REMOTE_ECHARTS_HTML);

  let observedSignal = null;
  const controller = createEditRuntimeProtocolController({
    protocolApi: { handle() {} },
    netFetch: async (_url, options) => {
      observedSignal = options.signal;
      return new Response(new ReadableStream({
        start(stream) {
          stream.enqueue(Buffer.from("window.echarts={init(){}};"));
          stream.close();
        },
      }), { status: 200 });
    },
    randomSessionId: () => "4".repeat(32),
    randomExecutionId: () => "5".repeat(24),
  });

  const session = await controller.createSession({
    html: REMOTE_ECHARTS_HTML,
    sourcePath,
    bindings: BINDINGS,
  });
  assert.equal(session.scriptCount, 2);
  assert.ok(observedSignal instanceof AbortSignal);
  assert.equal(observedSignal.aborted, false);
});

test("direct protocol cancels a headerless ECharts stream as soon as it exceeds the fixed byte cap", async (t) => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "pageroot-edit-runtime-remote-cap-"));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const sourcePath = path.join(temporaryRoot, "report.html");
  await writeFile(sourcePath, REMOTE_ECHARTS_HTML);

  let canceled = false;
  let observedSignal = null;
  const controller = createEditRuntimeProtocolController({
    protocolApi: { handle() {} },
    netFetch: async (_url, options) => {
      observedSignal = options.signal;
      return new Response(new ReadableStream({
        pull(stream) {
          stream.enqueue(new Uint8Array(EDIT_AUTHOR_RUNTIME_BUDGET.scriptBytes + 1));
        },
        cancel() {
          canceled = true;
        },
      }), { status: 200 });
    },
    randomSessionId: () => "6".repeat(32),
    randomExecutionId: () => "7".repeat(24),
  });

  await assert.rejects(
    controller.createSession({ html: REMOTE_ECHARTS_HTML, sourcePath, bindings: BINDINGS }),
    /CDN script is too large/u,
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(canceled, true);
  assert.equal(observedSignal.aborted, true);
});

test("direct protocol aborts a stalled headerless ECharts stream by the existing runtime deadline", async (t) => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "pageroot-edit-runtime-remote-timeout-"));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const sourcePath = path.join(temporaryRoot, "report.html");
  await writeFile(sourcePath, REMOTE_ECHARTS_HTML);

  let observedSignal = null;
  const controller = createEditRuntimeProtocolController({
    protocolApi: { handle() {} },
    netFetch: async (_url, options) => {
      observedSignal = options.signal;
      return new Response(new ReadableStream({
        pull() {},
      }), { status: 200 });
    },
    runtimePreparationDeadlineMs: 20,
    randomSessionId: () => "8".repeat(32),
    randomExecutionId: () => "9".repeat(24),
  });

  await assert.rejects(
    controller.createSession({ html: REMOTE_ECHARTS_HTML, sourcePath, bindings: BINDINGS }),
    /timed out/u,
  );
  assert.ok(observedSignal instanceof AbortSignal);
  assert.equal(observedSignal.aborted, true);
});

test("direct protocol streams bounded declared assets and never buffers an oversized asset in Main", async (t) => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "pageroot-edit-runtime-assets-"));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const sourcePath = path.join(temporaryRoot, "report.html");
  const html = HTML.replace(
    "</body>",
    '<img src="small.png"><img src="oversized.png"></body>',
  );
  await mkdir(path.join(temporaryRoot, "vendor"));
  await Promise.all([
    writeFile(sourcePath, html),
    writeFile(path.join(temporaryRoot, "vendor", "echarts.js"), "window.echarts={init(){}};"),
    writeFile(path.join(temporaryRoot, "small.png"), "small asset"),
    writeFile(
      path.join(temporaryRoot, "oversized.png"),
      new Uint8Array(EDIT_AUTHOR_RUNTIME_BUDGET.declaredAssetBytes + 1),
    ),
  ]);

  let handler = null;
  const fetchedFileUrls = [];
  const controller = createEditRuntimeProtocolController({
    protocolApi: {
      handle(_scheme, nextHandler) {
        handler = nextHandler;
      },
    },
    netFetch: async (url) => {
      fetchedFileUrls.push(String(url));
      return new Response("streamed asset", { status: 200 });
    },
    readFileImpl: async (filePath) => {
      if (String(filePath).endsWith("vendor/echarts.js")) {
        return "window.echarts={init(){}};";
      }
      throw new Error("Declared assets must not use readFile.");
    },
    randomSessionId: () => "a".repeat(32),
    randomExecutionId: () => "b".repeat(24),
  });
  controller.install();
  const session = await controller.createSession({ html, sourcePath, bindings: BINDINGS });

  const small = await handler(new Request(
    `pageroot-edit-runtime://${session.sessionId}/small.png`,
  ));
  assert.equal(small.status, 200);
  assert.equal(await small.text(), "streamed asset");
  assert.equal(fetchedFileUrls.length, 1);
  assert.match(fetchedFileUrls[0], /^file:/u);

  const oversized = await handler(new Request(
    `pageroot-edit-runtime://${session.sessionId}/oversized.png`,
  ));
  assert.equal(oversized.status, 404);
  assert.equal(fetchedFileUrls.length, 1);
});

test("direct protocol bounds declared-asset discovery by the shared preparation deadline", async (t) => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "pageroot-edit-runtime-assets-timeout-"));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const sourcePath = path.join(temporaryRoot, "report.html");
  await mkdir(path.join(temporaryRoot, "vendor"));
  await Promise.all([
    writeFile(sourcePath, HTML),
    writeFile(path.join(temporaryRoot, "vendor", "echarts.js"), "window.echarts={init(){}};"),
  ]);

  let observedSignal = null;
  const controller = createEditRuntimeProtocolController({
    protocolApi: { handle() {} },
    netFetch: async () => new Response("unexpected"),
    collectDeclaredAssets: async ({ signal }) => {
      observedSignal = signal;
      await new Promise(() => {});
    },
    runtimePreparationDeadlineMs: 20,
    randomSessionId: () => "c".repeat(32),
    randomExecutionId: () => "d".repeat(24),
  });

  await assert.rejects(
    controller.createSession({ html: HTML, sourcePath, bindings: BINDINGS }),
    /preparation timed out/u,
  );
  assert.ok(observedSignal instanceof AbortSignal);
  assert.equal(observedSignal.aborted, true);
});
