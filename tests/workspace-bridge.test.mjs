import assert from "node:assert/strict";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  createBridgeTestEnvironment,
} from "./helpers/bridge-test-environment.mjs";

const productRoot = fileURLToPath(new URL("../", import.meta.url));
const workspaceBridgeScript = join(productRoot, "bridge", "workspace-bridge.mjs");

test("workspace Bridge local imports stay inside the packaged Bridge dependency closure", async () => {
  const [bridgeSource, packageSource] = await Promise.all([
    readFile(workspaceBridgeScript, "utf8"),
    readFile(join(productRoot, "package.json"), "utf8"),
  ]);
  const packageJson = JSON.parse(packageSource);
  const packagedScripts = new Set(
    packageJson.build.extraResources.flatMap((entry) => {
      const to = String(entry.to || "");
      return to.startsWith("bridge/")
        ? [to.slice("bridge/".length)]
        : [];
    }),
  );
  const localImports = [
    ...bridgeSource.matchAll(/\bfrom\s+["']\.\/([^"']+)["']/g),
  ].map((match) => match[1]);
  assert.ok(localImports.length > 0);
  assert.deepEqual(
    [...new Set(localImports)].sort(),
    [...new Set(localImports.filter((fileName) => packagedScripts.has(fileName)))].sort(),
    "workspace-bridge.mjs imports a local module that is not packaged for the Mac app",
  );
});

test("stable Bridge preserves readiness when project repository initialization fails", async (t) => {
  const environment = await createBridgeTestEnvironment(t, {
    prefix: "pageroot-bridge-stable-degraded-",
  });
  const unavailableProjectsRoot = join(environment.root, "project-root-file");
  await writeFile(unavailableProjectsRoot, "not-a-directory");
  const bridge = await environment.start({
    HTML_AI_RUNTIME_CHANNEL: "stable",
    HTML_AI_PROJECT_FILES_ROOT: unavailableProjectsRoot,
    HTML_AI_AGENTS_ROOT: join(environment.root, "agents"),
  });
  const health = await bridge.requestJson("/health");
  assert.equal(health.response.status, 200, JSON.stringify(health.body));
  assert.equal(health.body.workspace, environment.workspace);
  assert.equal(bridge.child.exitCode, null);
});

test("preview Bridge fails before readiness when project repository initialization fails", async (t) => {
  const environment = await createBridgeTestEnvironment(t, {
    prefix: "pageroot-bridge-preview-fatal-",
  });
  const unavailableProjectsRoot = join(environment.root, "project-root-file");
  await writeFile(unavailableProjectsRoot, "not-a-directory");
  await assert.rejects(
    environment.start({
      HTML_AI_RUNTIME_CHANNEL: "preview",
      HTML_AI_PROJECT_FILES_ROOT: unavailableProjectsRoot,
      HTML_AI_AGENTS_ROOT: join(environment.root, "agents"),
    }),
    (error) => {
      assert.match(error.message, /fatal/iu);
      assert.match(error.message, /EEXIST|directory|project/u);
      return true;
    },
  );
});

test("POST /version remains a 410 tombstone", async (t) => {
  const environment = await createBridgeTestEnvironment(t, {
    prefix: "pageroot-bridge-version-tombstone-",
  });
  const bridge = await environment.start();
  const response = await bridge.postJson("/version", {
    sourcePath: join(environment.sources, "missing.html"),
    html: "<!doctype html><html><head><title>x</title></head><body></body></html>",
  });
  assert.equal(response.response.status, 410);
  assert.equal(response.body.error.code, "LOCAL_VERSIONING_REMOVED");
});

test("retired Discussion routes expose no Bridge authority", async (t) => {
  const environment = await createBridgeTestEnvironment(t, {
    prefix: "pageroot-bridge-no-discussion-",
  });
  const bridge = await environment.start();
  const responses = await Promise.all([
    bridge.postJson("/discussion/start", {}),
    bridge.requestJson("/discussion/status"),
    bridge.postJson("/discussion/cancel", {}),
  ]);
  for (const response of responses) {
    assert.equal(response.response.status, 404);
    assert.equal(response.body.error.code, "NOT_FOUND");
  }
});

test("retired source history action route exposes no Bridge authority", async (t) => {
  const environment = await createBridgeTestEnvironment(t, {
    prefix: "pageroot-bridge-no-source-history-action-",
  });
  const bridge = await environment.start();
  const response = await bridge.postJson("/source-history/action", {});
  assert.equal(response.response.status, 404);
  assert.equal(response.body.error.code, "NOT_FOUND");
});

test("configured bridge authentication protects every route and leaves CORS preflight usable", async (t) => {
  const environment = await createBridgeTestEnvironment(t, {
    prefix: "pageroot-bridge-auth-",
  });
  const authToken = "bridge-test-token-with-sufficient-entropy";
  const bridge = await environment.start({
    HTML_AI_BRIDGE_AUTH_TOKEN: authToken,
  });

  const missing = await bridge.requestJson("/health", undefined, {
    auth: false,
  });
  assert.equal(missing.response.status, 401);
  assert.equal(missing.body.error.code, "UNAUTHORIZED");

  const incorrect = await bridge.requestJson("/health", {
    headers: { "x-html-ai-bridge-token": "wrong-token" },
  });
  assert.equal(incorrect.response.status, 401);
  assert.equal(incorrect.body.error.code, "UNAUTHORIZED");

  const authorized = await bridge.requestJson("/health");
  assert.equal(authorized.response.status, 200);
  assert.equal(authorized.body.ok, true);

  const unauthorizedUnknownRoute = await bridge.requestJson(
    "/not-a-route",
    undefined,
    { auth: false },
  );
  assert.equal(unauthorizedUnknownRoute.response.status, 401);

  const unauthorizedClassification = await bridge.postJson(
    "/project/open-classification",
    { sourcePath: join(environment.sources, "missing.html") },
    undefined,
    { auth: false },
  );
  assert.equal(unauthorizedClassification.response.status, 401);

  const preflight = await fetch(`${bridge.baseUrl}/workspace`, {
    method: "OPTIONS",
    headers: {
      origin: "http://localhost:3000",
      "access-control-request-method": "GET",
      "access-control-request-headers":
        "content-type,x-html-ai-bridge-token",
    },
  });
  assert.equal(preflight.status, 204);
  assert.match(
    preflight.headers.get("access-control-allow-headers") ?? "",
    /X-HTML-AI-Bridge-Token/i,
  );
});

test("workspace Bridge rejects non-UTF-8 source bytes without creating a project or rewriting the file", async (t) => {
  const environment = await createBridgeTestEnvironment(t, {
    prefix: "pageroot-bridge-encoding-",
  });
  const sourcePath = join(environment.sources, "legacy-encoding.html");
  const original = Buffer.concat([
    Buffer.from("<!doctype html><html><body>", "utf8"),
    Buffer.from([0xff, 0xfe]),
    Buffer.from("</body></html>", "utf8"),
  ]);
  await writeFile(sourcePath, original);
  const bridge = await environment.start();

  const preview = await bridge.requestJson(
    `/workspace?sourcePath=${encodeURIComponent(sourcePath)}`,
  );
  assert.equal(preview.response.status, 415);
  assert.equal(preview.body.error.code, "UNSUPPORTED_HTML_ENCODING");
  assert.deepEqual(await readFile(sourcePath), original);

  const ensure = await bridge.postJson("/project/ensure", {
    sourcePath,
    expectedSourceSha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  });
  assert.equal(ensure.response.status, 415);
  assert.equal(ensure.body.error.code, "UNSUPPORTED_HTML_ENCODING");
  assert.deepEqual(await readFile(sourcePath), original);
  const projectEntries = await readdir(join(environment.root, "project-files"))
    .catch(() => []);
  // Startup now initializes Repository even before the first import. An empty
  // registry is service metadata; rejected bytes must still create no project.
  assert.deepEqual(projectEntries, [".pageroot-registry.json"]);
  const registry = JSON.parse(await readFile(
    join(environment.root, "project-files", ".pageroot-registry.json"), "utf8",
  ));
  assert.deepEqual(registry.projects, {});
});
