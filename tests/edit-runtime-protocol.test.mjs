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
} from "../desktop/edit-runtime-protocol.mjs";

const SESSION_ID = "0123456789abcdef0123456789abcdef";
const EXECUTION_ID = "abcdefabcdefabcdefabcdef";
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

test("direct protocol serves one reusable disposable-frame resource session", async (t) => {
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
      contractVersion: 2,
      sessionId: SESSION_ID,
      executionId: EXECUTION_ID,
      scriptCount: 2,
      byteLength: 77,
    },
  );
  assert.match(session.resourceSha256, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(session.documentBasePath, "/");

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
  assert.match(await bootstrap.text(), /proveParsedSource/u);
  assert.equal((await handler(new Request(bootstrapUrl))).status, 200);

  const firstAuthor = await handler(new Request(
    "pageroot-edit-runtime://" + SESSION_ID + "/.pageroot/author/0.js",
  ));
  assert.equal(await firstAuthor.text(), "window.echarts={init(){}};");
  assert.equal(
    (await handler(new Request(
      "pageroot-edit-runtime://" + SESSION_ID + "/.pageroot/author/0.js",
    ))).status,
    200,
  );
  const secondAuthor = await handler(new Request(
    "pageroot-edit-runtime://" + SESSION_ID + "/.pageroot/author/1.js",
  ));
  assert.match(await secondAuthor.text(), /echarts\.init/u);

  assert.deepEqual(controller.revokeSession(SESSION_ID), { revoked: true });
  assert.equal(controller.sessionCount(), 0);
});

test("direct protocol freezes scripts relative to a contained authored base", async (t) => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "pageroot-edit-runtime-base-"));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const sourcePath = path.join(temporaryRoot, "report.html");
  const html = [
    '<!doctype html><html><head><base href="./assets/">',
    '<script src="blocking.js"></script></head><body></body></html>',
  ].join("");
  await mkdir(path.join(temporaryRoot, "assets"));
  await Promise.all([
    writeFile(sourcePath, html),
    writeFile(path.join(temporaryRoot, "assets", "blocking.js"), "window.baseReady=true;"),
  ]);
  let handler = null;
  const controller = createEditRuntimeProtocolController({
    protocolApi: {
      handle(_scheme, nextHandler) {
        handler = nextHandler;
      },
    },
    netFetch: async () => new Response("unexpected", { status: 500 }),
    randomSessionId: () => "6".repeat(32),
    randomExecutionId: () => "7".repeat(24),
  });
  controller.install();
  const session = await controller.createSession({ html, sourcePath });
  assert.equal(session.documentBasePath, "/assets/");
  const authorScript = await handler(new Request(
    `pageroot-edit-runtime://${session.sessionId}/.pageroot/author/0.js`,
  ));
  assert.equal(await authorScript.text(), "window.baseReady=true;");

  await assert.rejects(
    controller.createSession({
      html: html.replace("./assets/", "../outside/"),
      sourcePath,
    }),
    /document base/u,
  );
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

  const session = await controller.createSession({ html, sourcePath });
  assert.equal(session.scriptCount, 2);
  await assert.rejects(
    controller.createSession({
      html: html.replace(
        'echarts.init(document.querySelector("#chart-host"))',
        'import("./chart.js")',
      ),
      sourcePath,
    }),
    /dynamic-or-module-import/u,
  );
});

test("direct protocol admits ordinary and visual programs", async (t) => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "pageroot-edit-runtime-custom-"));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const sourcePath = path.join(temporaryRoot, "custom.html");
  const canvasHtml = [
    '<!doctype html><html><body><canvas id="chart-host">fallback</canvas>',
    '<script>document.querySelector("#chart-host").getContext("2d").fillRect(0,0,10,10)</script>',
    "</body></html>",
  ].join("");
  await writeFile(sourcePath, canvasHtml);
  const controller = createEditRuntimeProtocolController({
    protocolApi: { handle() {} },
    netFetch: async () => new Response("unexpected", { status: 500 }),
    randomSessionId: () => "c".repeat(32),
    randomExecutionId: () => "d".repeat(24),
  });
  const session = await controller.createSession({
    html: canvasHtml,
    sourcePath,
  });
  assert.equal(session.scriptCount, 1);
  assert.equal(session.byteLength > 0, true);
  controller.revokeSession(session.sessionId);

  const nonVisualHtml = canvasHtml.replace(
    'document.querySelector("#chart-host").getContext("2d").fillRect(0,0,10,10)',
    'document.querySelector("#chart-host").addEventListener("click", () => {})',
  );
  await writeFile(sourcePath, nonVisualHtml);
  const ordinarySession = await controller.createSession({
    html: nonVisualHtml,
    sourcePath,
  });
  assert.equal(ordinarySession.scriptCount, 1);
});

test("direct protocol never serves a capture HTML document", async (t) => {
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
  const session = await controller.createSession({ html: HTML, sourcePath });
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
  assert.match(await bootstrap.text(), /proveParsedSource/u);
  assert.equal((await handler(new Request(bootstrapUrl))).status, 200);
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
  });
  assert.equal(session.scriptCount, 2);
  assert.ok(observedSignal instanceof AbortSignal);
  assert.equal(observedSignal.aborted, false);
});

test("separate runtime sessions do not retain a hidden script-preparation cache", async (t) => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "pageroot-edit-runtime-no-cache-"));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const sourcePath = path.join(temporaryRoot, "report.html");
  await writeFile(sourcePath, REMOTE_ECHARTS_HTML);
  let fetches = 0;
  let sessionSequence = 7;
  const controller = createEditRuntimeProtocolController({
    protocolApi: { handle() {} },
    netFetch: async () => {
      fetches += 1;
      return new Response("window.echarts={init(){return {}}};", { status: 200 });
    },
    randomSessionId: () => String(++sessionSequence).repeat(32),
    randomExecutionId: () => "9".repeat(24),
  });
  const first = await controller.createSession({
    html: REMOTE_ECHARTS_HTML,
    sourcePath,
  });
  const second = await controller.createSession({
    html: REMOTE_ECHARTS_HTML,
    sourcePath,
  });
  assert.equal(first.resourceSha256, second.resourceSha256);
  assert.equal(fetches, 2);
  assert.equal("preparedScriptCount" in controller, false);
});

test("an active reusable resource session survives the orphan cleanup window", async (t) => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "pageroot-edit-runtime-reuse-"));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const sourcePath = path.join(temporaryRoot, "report.html");
  const inlineHtml = [
    "<!doctype html><html><head><title>Reuse</title></head><body>",
    "<script>window.ready=true</script></body></html>",
  ].join("");
  await writeFile(sourcePath, inlineHtml);
  let currentTime = 1_000;
  let handler = null;
  const controller = createEditRuntimeProtocolController({
    protocolApi: {
      handle(_scheme, nextHandler) {
        handler = nextHandler;
      },
    },
    netFetch: async () => new Response("unexpected"),
    now: () => currentTime,
    orphanSessionTtlMs: 10,
    randomSessionId: () => "8".repeat(32),
    randomExecutionId: () => "7".repeat(24),
  });
  controller.install();
  const session = await controller.createSession({ html: inlineHtml, sourcePath });
  currentTime += 20;
  const bootstrap = await handler(new Request(
    `pageroot-edit-runtime://${session.sessionId}/.pageroot/bootstrap/${session.executionId}.js`,
  ));
  assert.equal(bootstrap.status, 200);
  assert.equal(controller.sessionCount(), 1);
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
    controller.createSession({ html: REMOTE_ECHARTS_HTML, sourcePath }),
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
    resolveSourceRoot: () => temporaryRoot,
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
    controller.createSession({ html: REMOTE_ECHARTS_HTML, sourcePath }),
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
  const session = await controller.createSession({ html, sourcePath });

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

test("direct protocol never serves executable bytes from the generic declared-asset route", async (t) => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "pageroot-edit-runtime-script-asset-"));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const sourcePath = path.join(temporaryRoot, "report.html");
  const scriptPath = path.join(temporaryRoot, "extra.js");
  const inlineHtml = [
    "<!doctype html><html><head>",
    '<link rel="preload" as="script" href="extra.js">',
    "</head><body><script>window.ready=true</script></body></html>",
  ].join("");
  await Promise.all([
    writeFile(sourcePath, inlineHtml),
    writeFile(scriptPath, "window.bypassed=true"),
  ]);
  let handler = null;
  let assetFetches = 0;
  const controller = createEditRuntimeProtocolController({
    protocolApi: {
      handle(_scheme, nextHandler) {
        handler = nextHandler;
      },
    },
    netFetch: async () => {
      assetFetches += 1;
      return new Response("window.bypassed=true", { status: 200 });
    },
    collectDeclaredAssets: async () => new Map([
      ["extra.js", Object.freeze({ relativePath: "extra.js", resolvedPath: scriptPath })],
    ]),
    randomSessionId: () => "1".repeat(32),
    randomExecutionId: () => "2".repeat(24),
  });
  controller.install();
  const session = await controller.createSession({ html: inlineHtml, sourcePath });

  const response = await handler(new Request(
    `pageroot-edit-runtime://${session.sessionId}/extra.js`,
  ));
  assert.equal(response.status, 404);
  assert.equal(assetFetches, 0);
});

test("direct protocol bounds declared-asset discovery by the shared preparation deadline", async (t) => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "pageroot-edit-runtime-assets-timeout-"));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const sourcePath = path.join(temporaryRoot, "report.html");
  const fixedEchartsBytes = Buffer.from("window.echarts={init(){}};");

  let observedSignal = null;
  const controller = createEditRuntimeProtocolController({
    protocolApi: { handle() {} },
    resolveSourceRoot: () => temporaryRoot,
    realpathImpl: async (value) => value,
    statImpl: async () => ({
      isFile: () => true,
      size: fixedEchartsBytes.byteLength,
    }),
    readFileImpl: async () => fixedEchartsBytes,
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
    controller.createSession({ html: HTML, sourcePath }),
    /preparation timed out/u,
  );
  assert.ok(observedSignal instanceof AbortSignal);
  assert.equal(observedSignal.aborted, true);
});

test("direct protocol keeps an incomplete injected source-root resolver inside the shared preparation deadline", async (t) => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "pageroot-edit-runtime-source-root-timeout-"));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const sourcePath = path.join(temporaryRoot, "report.html");

  let resolverCalls = 0;
  let netFetchCalls = 0;
  const controller = createEditRuntimeProtocolController({
    protocolApi: { handle() {} },
    resolveSourceRoot: async () => {
      resolverCalls += 1;
      await new Promise(() => {});
    },
    netFetch: async () => {
      netFetchCalls += 1;
      return new Response("unexpected");
    },
    runtimePreparationDeadlineMs: 20,
    randomSessionId: () => "e".repeat(32),
    randomExecutionId: () => "f".repeat(24),
  });

  await assert.rejects(
    controller.createSession({ html: REMOTE_ECHARTS_HTML, sourcePath }),
    /preparation timed out/u,
  );
  assert.equal(resolverCalls, 1);
  assert.equal(netFetchCalls, 0);
});
