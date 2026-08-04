import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  PREVIEW_BOOTSTRAP_PATH,
  PREVIEW_PROTOCOL_SCHEME,
  createPreviewProtocolController,
  createPreviewSessionOperation,
  registerPreviewProtocolScheme,
} from "../desktop/preview-protocol.mjs";

test("preview session operation authorizes the source path before creation", async () => {
  const calls = [];
  const operation = createPreviewSessionOperation({
    authorizeSourcePath: async (sourcePath) => {
      calls.push(["authorize", sourcePath]);
      return "/canonical/report.html";
    },
    createSession: async (payload) => {
      calls.push(["create", payload]);
      return { sessionId: "session" };
    },
  });
  const result = await operation({
    html: "<p>preview</p>",
    bootstrapJavaScript: "void 0;",
    sourcePath: "/known/report.html",
    ignored: "not forwarded",
  });

  assert.deepEqual(result, { sessionId: "session" });
  assert.deepEqual(calls, [
    ["authorize", "/known/report.html"],
    ["create", {
      html: "<p>preview</p>",
      bootstrapJavaScript: "void 0;",
      sourcePath: "/canonical/report.html",
    }],
  ]);
});

test("independent preview protocol serves one volatile document and bounded local assets", async (t) => {
  const temporaryRoot = await mkdtemp(
    path.join(tmpdir(), "pageroot-preview-protocol-"),
  );
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const siteRoot = path.join(temporaryRoot, "site");
  await mkdir(siteRoot);
  const sourcePath = path.join(siteRoot, "report.html");
  const sourceHtml = [
    "<!doctype html>",
    '<link rel="stylesheet" href="styles/site.css">',
    '<script type="module" src="chart.js"></script>',
    "<style>@import \"styles/inline.css\"; .inline-sheet { background-image: url(\"assets/inline-sheet.png\"); }</style>",
    '<div style="background-image: url(\'assets/inline-attribute.png\')"></div>',
    '<script type="module">import "./inline-module.js";</script>',
    '<script src="escape.js"></script>',
    '<img src="assets/hero.png">',
    '<img src=".env">',
  ].join("\n");
  const assetPath = path.join(siteRoot, "chart.js");
  const outsidePath = path.join(temporaryRoot, "outside.js");
  await mkdir(path.join(siteRoot, "styles"));
  await mkdir(path.join(siteRoot, "assets"));
  await mkdir(path.join(siteRoot, "modules"));
  await mkdir(path.join(siteRoot, ".git"));
  await writeFile(sourcePath, sourceHtml);
  await writeFile(assetPath, 'import "./modules/helper.mjs";');
  await writeFile(path.join(siteRoot, "modules", "helper.mjs"), "window.chartLoaded = true;");
  await writeFile(
    path.join(siteRoot, "styles", "site.css"),
    '@import "theme.css"; .hero { background-image: url("../assets/hero.png"); }',
  );
  await writeFile(
    path.join(siteRoot, "styles", "theme.css"),
    '@font-face { font-family: Preview; src: url("../assets/preview.woff2"); }',
  );
  await writeFile(
    path.join(siteRoot, "styles", "inline.css"),
    '@font-face { font-family: Inline; src: url("../assets/inline.woff2"); }',
  );
  await writeFile(
    path.join(siteRoot, "inline-module.js"),
    'import "./modules/inline-helper.mjs";',
  );
  await writeFile(
    path.join(siteRoot, "modules", "inline-helper.mjs"),
    "window.inlineModuleLoaded = true;",
  );
  await writeFile(path.join(siteRoot, "assets", "hero.png"), "synthetic image");
  await writeFile(path.join(siteRoot, "assets", "preview.woff2"), "synthetic font");
  await writeFile(path.join(siteRoot, "assets", "inline-sheet.png"), "synthetic image");
  await writeFile(path.join(siteRoot, "assets", "inline-attribute.png"), "synthetic image");
  await writeFile(path.join(siteRoot, "assets", "inline.woff2"), "synthetic font");
  await writeFile(path.join(siteRoot, ".env"), "PRIVATE_TOKEN=preview-test\n");
  await writeFile(path.join(siteRoot, ".git", "config"), "[core]\nrepositoryformatversion = 0\n");
  await writeFile(path.join(siteRoot, "not-declared.js"), "window.private = true;");
  await writeFile(outsidePath, "window.escaped = true;");
  await symlink(outsidePath, path.join(siteRoot, "escape.js"));

  const registrations = [];
  let handler = null;
  const protocolApi = {
    registerSchemesAsPrivileged(value) {
      registrations.push(value);
    },
    handle(scheme, value) {
      assert.equal(scheme, PREVIEW_PROTOCOL_SCHEME);
      handler = value;
    },
  };
  const fetched = [];
  const controller = createPreviewProtocolController({
    protocolApi,
    netFetch: async (url, options) => {
      fetched.push({ url, options });
      return new Response("asset response", {
        headers: { "content-type": "text/javascript" },
      });
    },
    randomSessionId: () => "0123456789abcdef0123456789abcdef",
  });

  registerPreviewProtocolScheme(protocolApi);
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0][0].scheme, PREVIEW_PROTOCOL_SCHEME);
  assert.equal(registrations[0][0].privileges.standard, true);
  assert.equal(registrations[0][0].privileges.secure, true);
  assert.equal(
    Object.hasOwn(registrations[0][0].privileges, "bypassCSP"),
    false,
  );

  controller.install();
  assert.equal(typeof handler, "function");
  const session = await controller.createSession({
    html: sourceHtml,
    bootstrapJavaScript: "window.previewBootstrap = true;",
    sourcePath,
  });
  assert.deepEqual(session, {
    sessionId: "0123456789abcdef0123456789abcdef",
    url: "pageroot-preview://0123456789abcdef0123456789abcdef/index.html",
  });
  assert.equal(controller.sessionCount(), 1);

  const documentResponse = await handler(new Request(session.url));
  assert.equal(documentResponse.status, 200);
  assert.match(await documentResponse.text(), /chart\.js/);
  assert.equal(
    documentResponse.headers.get("cache-control"),
    "no-store",
  );
  assert.match(
    documentResponse.headers.get("content-security-policy") || "",
    /base-uri 'none'/,
  );

  const bootstrapResponse = await handler(new Request(
    `pageroot-preview://${session.sessionId}${PREVIEW_BOOTSTRAP_PATH}`,
  ));
  assert.equal(bootstrapResponse.status, 200);
  assert.match(await bootstrapResponse.text(), /previewBootstrap/);

  const assetResponse = await handler(new Request(
    `pageroot-preview://${session.sessionId}/chart.js`,
  ));
  assert.equal(assetResponse.status, 200);
  assert.equal(await assetResponse.text(), "asset response");
  assert.equal(fetched.length, 1);
  assert.match(fetched[0].url, /chart\.js$/u);

  const previewUrl = (relativePath) => (
    PREVIEW_PROTOCOL_SCHEME + "://" + session.sessionId + "/" + relativePath
  );
  const importedModule = await handler(new Request(
    previewUrl("modules/helper.mjs"),
  ));
  assert.equal(importedModule.status, 200);

  const stylesheet = await handler(new Request(
    previewUrl("styles/theme.css"),
  ));
  assert.equal(stylesheet.status, 200);

  const cssAsset = await handler(new Request(
    previewUrl("assets/preview.woff2"),
  ));
  assert.equal(cssAsset.status, 200);

  const inlineStylesheet = await handler(new Request(
    previewUrl("styles/inline.css"),
  ));
  assert.equal(inlineStylesheet.status, 200);
  const inlineSheetAsset = await handler(new Request(
    previewUrl("assets/inline-sheet.png"),
  ));
  assert.equal(inlineSheetAsset.status, 200);
  const inlineAttributeAsset = await handler(new Request(
    previewUrl("assets/inline-attribute.png"),
  ));
  assert.equal(inlineAttributeAsset.status, 200);
  const inlineCssAsset = await handler(new Request(
    previewUrl("assets/inline.woff2"),
  ));
  assert.equal(inlineCssAsset.status, 200);
  const inlineModule = await handler(new Request(
    previewUrl("inline-module.js"),
  ));
  assert.equal(inlineModule.status, 200);
  const inlineModuleDependency = await handler(new Request(
    previewUrl("modules/inline-helper.mjs"),
  ));
  assert.equal(inlineModuleDependency.status, 200);
  assert.equal(fetched.length, 10);

  const secretAsset = await handler(new Request(previewUrl(".env")));
  assert.equal(secretAsset.status, 400);
  const gitConfig = await handler(new Request(previewUrl(".git/config")));
  assert.equal(gitConfig.status, 400);
  const unlistedAsset = await handler(new Request(previewUrl("not-declared.js")));
  assert.equal(unlistedAsset.status, 404);

  const escapedAsset = await handler(new Request(
    `pageroot-preview://${session.sessionId}/escape.js`,
  ));
  assert.equal(escapedAsset.status, 404);
  assert.equal(fetched.length, 10);

  assert.deepEqual(controller.revokeSession(session.sessionId), {
    revoked: true,
  });
  assert.equal(controller.sessionCount(), 0);
  const revokedResponse = await handler(new Request(session.url));
  assert.equal(revokedResponse.status, 404);
});

test("preview protocol rejects malformed methods, payloads, and unknown sessions", async () => {
  const controller = createPreviewProtocolController({
    protocolApi: { handle() {} },
    netFetch: async () => new Response("unreachable"),
    randomSessionId: () => "fedcba9876543210fedcba9876543210",
  });

  assert.equal(
    (await controller.handleRequest({
      method: "POST",
      url: "pageroot-preview://fedcba9876543210fedcba9876543210/index.html",
    })).status,
    400,
  );
  assert.equal(
    (await controller.handleRequest(new Request(
      "pageroot-preview://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/index.html",
    ))).status,
    404,
  );
  await assert.rejects(
    controller.createSession({
      html: null,
      bootstrapJavaScript: "",
    }),
    /payload is invalid/u,
  );
  await assert.rejects(
    controller.createSession({
      html: "<p>preview</p>",
      bootstrapJavaScript: "",
      sourcePath: "relative/report.html",
    }),
    /absolute local path/u,
  );
});
