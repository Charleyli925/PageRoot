import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import {
  assertProjectStorageDirectoryName,
  comparisonSha256,
  injectManagedMeta,
  projectDisplayName,
  projectStorageDirectoryName,
  recordUserSupplement,
} from "../scripts/lifecycle-core.mjs";
import { ensureManagedWelcomeHtml } from "../desktop/project-files.mjs";
import { buildSourceIndex } from "../scripts/source-index.mjs";
import {
  createTargetRef,
  resolveTargetRef,
} from "../scripts/target-resolver.mjs";
import { rebaseDraftMutation } from "../scripts/draft-aggregate.mjs";

const execFileAsync = promisify(execFile);
const productRoot = fileURLToPath(new URL("../", import.meta.url));
const bridgeScript = join(productRoot, "scripts", "workspace-bridge.mjs");
const finalizerScript = join(productRoot, "scripts", "finalize-attempt.mjs");

async function registeredProjectRoot(workspace, projectId) {
  const registry = JSON.parse(
    await readFile(join(workspace, "project-registry.json"), "utf8"),
  );
  return join(
    workspace,
    "projects",
    registry.projects[projectId].storageDirectoryName,
  );
}

function projectRootFromRun(run) {
  return dirname(dirname(run.requestPath));
}

test("readable project directory names stay safe, bounded, and tied to project identity", () => {
  const projectId = "project_0123456789abcdef0123456789abcdef";
  const displayName = projectDisplayName("/tmp/  .季度:报告?.html");
  assert.equal(displayName, ".季度:报告?");
  const storageDirectoryName = projectStorageDirectoryName({
    displayName: `${displayName}${"很长".repeat(100)}`,
    createdAt: "2026-07-28T04:43:15.000Z",
    projectId,
  });
  assert.match(
    storageDirectoryName,
    /^季度-报告-.+__\d{8}-\d{6}__01234567$/,
  );
  assert.equal(Buffer.byteLength(storageDirectoryName, "utf8") <= 240, true);
  assert.doesNotMatch(storageDirectoryName, /[/\\:*?"<>|]/);
  assert.throws(
    () => assertProjectStorageDirectoryName("季度报告", projectId),
    /does not match projectId/,
  );
});

test("workspace Bridge local imports stay inside the packaged Bridge dependency closure", async () => {
  const [bridgeSource, packageSource] = await Promise.all([
    readFile(bridgeScript, "utf8"),
    readFile(join(productRoot, "package.json"), "utf8"),
  ]);
  const packageJson = JSON.parse(packageSource);
  const packagedScripts = new Set(
    packageJson.build.extraResources.flatMap((entry) => {
      const from = String(entry.from || "");
      const to = String(entry.to || "");
      return from.startsWith("scripts/") && to.startsWith("bridge/")
        ? [from.slice("scripts/".length)]
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

function htmlPage(label, extra = "") {
  return `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>${label}</title></head>
<body><main><h1>${label}</h1>${extra}<p>用于验证 HTML AI 版本生命周期。</p></main></body>
</html>`;
}

function withDocumentIdentity(html, documentId) {
  const withoutIdentity = String(html).replace(
    /<meta\b[^>]*\bname\s*=\s*(?:"html-ai-document-id"|'html-ai-document-id'|html-ai-document-id)[^>]*>/gi,
    "",
  );
  return withoutIdentity.replace(
    /<\/head>/i,
    `<meta name="html-ai-document-id" content="${documentId}"></head>`,
  );
}

function hash(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

async function reservePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const port = address.port;
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
  return port;
}

async function requestJson(baseUrl, pathname, init) {
  const response = await fetch(`${baseUrl}${pathname}`, init);
  const body = await response.json();
  return { response, body };
}

async function waitForHealth(baseUrl, child, logs, authToken = "") {
  const deadline = Date.now() + 15_000;
  let lastError;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `bridge exited with ${child.exitCode}\n${logs.stdout}\n${logs.stderr}`,
      );
    }
    try {
      const result = await requestJson(baseUrl, "/health", {
        headers: authToken
          ? { "x-html-ai-bridge-token": authToken }
          : undefined,
      });
      if (result.response.status === 200) return result.body;
    } catch (error) {
      lastError = error;
    }
    await delay(30);
  }
  throw new Error(
    `bridge health timeout: ${lastError ?? "unknown"}\n${logs.stdout}\n${logs.stderr}`,
  );
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  const exited = new Promise((resolve) => child.once("exit", resolve));
  const timedOut = await Promise.race([
    exited.then(() => false),
    delay(2_000).then(() => true),
  ]);
  if (timedOut && child.exitCode === null) {
    child.kill("SIGKILL");
    await new Promise((resolve) => child.once("exit", resolve));
  }
}

async function startBridge(workspace, extraEnvironment = {}) {
  const port = await reservePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const logs = { stdout: "", stderr: "" };
  const child = spawn(process.execPath, [bridgeScript], {
    cwd: productRoot,
    env: {
      ...process.env,
      HTML_AI_WORKSPACE: workspace,
      HTML_AI_BRIDGE_PORT: String(port),
      ...extraEnvironment,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    logs.stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    logs.stderr += chunk;
  });
  await waitForHealth(
    baseUrl,
    child,
    logs,
    extraEnvironment.HTML_AI_BRIDGE_AUTH_TOKEN ?? "",
  );
  return { child, baseUrl, logs };
}

async function createEnvironment(t) {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "html-ai-lifecycle-v3-")),
  );
  const workspace = join(root, "workspace");
  const sources = join(root, "sources");
  await mkdir(workspace);
  await mkdir(sources);
  const children = [];
  t.after(async () => {
    for (const child of children) await stopChild(child);
    await rm(root, { recursive: true, force: true });
  });
  return {
    root,
    workspace,
    sources,
    children,
    async start(extraEnvironment) {
      const bridge = await startBridge(workspace, extraEnvironment);
      children.push(bridge.child);
      return bridge;
    },
  };
}

async function previewWorkspace(baseUrl, sourcePath) {
  return requestJson(
    baseUrl,
    `/workspace?sourcePath=${encodeURIComponent(sourcePath)}`,
  );
}

async function openWorkspace(baseUrl, sourcePath) {
  const preview = await previewWorkspace(baseUrl, sourcePath);
  if (
    preview.response.status !== 200
    || preview.body.registered !== false
  ) return preview;
  return postJson(baseUrl, "/project/ensure", {
    sourcePath,
    expectedSourceSha256: preview.body.currentHtmlSha256,
  });
}

test("fresh launch and read-only preview do not create PageRoot storage", async (t) => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "html-ai-lazy-workspace-")),
  );
  const workspace = join(root, "PageRoot", "项目记录");
  const sources = join(root, "sources");
  await mkdir(sources);
  const sourcePath = join(sources, "first-open.html");
  await writeFile(sourcePath, htmlPage("首次打开"), "utf8");
  const bridge = await startBridge(workspace);
  t.after(async () => {
    await stopChild(bridge.child);
    await rm(root, { recursive: true, force: true });
  });

  await assert.rejects(access(workspace));
  const preview = await previewWorkspace(bridge.baseUrl, sourcePath);
  assert.equal(preview.response.status, 200, JSON.stringify(preview.body));
  assert.equal(preview.body.registered, false);
  await assert.rejects(access(workspace));

  const ensured = await postJson(bridge.baseUrl, "/project/ensure", {
    sourcePath,
    expectedSourceSha256: preview.body.currentHtmlSha256,
  });
  assert.equal(ensured.response.status, 200, JSON.stringify(ensured.body));
  assert.equal(ensured.body.registered, true);
  await access(join(workspace, "projects"));
  await access(join(workspace, "project-registry.json"));
});

test("managed welcome HTML registers the same workspace and V1 lifecycle as any opened HTML", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pageroot-welcome-workspace-"));
  const workspace = join(root, "PageRoot", "项目记录");
  const welcome = await ensureManagedWelcomeHtml({ workspaceRoot: workspace });
  const bridge = await startBridge(workspace);
  t.after(async () => {
    await stopChild(bridge.child);
    await rm(root, { recursive: true, force: true });
  });

  await assert.rejects(access(workspace));
  const preview = await previewWorkspace(bridge.baseUrl, welcome.sourcePath);
  assert.equal(preview.response.status, 200, JSON.stringify(preview.body));
  assert.equal(preview.body.registered, false);

  const ensured = await postJson(bridge.baseUrl, "/project/ensure", {
    sourcePath: welcome.sourcePath,
    expectedSourceSha256: welcome.sha256,
  });
  const canonicalWelcomePath = await realpath(welcome.sourcePath);
  assert.equal(ensured.response.status, 200, JSON.stringify(ensured.body));
  assert.equal(ensured.body.registered, true);
  assert.equal(ensured.body.sourcePath, canonicalWelcomePath);
  assert.equal(ensured.body.currentHtmlSha256, welcome.sha256);
  assert.equal(ensured.body.versions.length, 1);
  assert.equal(ensured.body.versions[0].versionId, "ver_0001");
  const projectRoot = await registeredProjectRoot(
    workspace,
    ensured.body.projectId,
  );
  assert.equal(projectRoot, ensured.body.projectRoot);
  assert.match(
    basename(projectRoot),
    /^欢迎来到源页__\d{8}-\d{6}__[a-f0-9]{8}$/,
  );
  await access(projectRoot);
  await access(join(workspace, "project-registry.json"));
});

test("workspace Bridge rejects non-UTF-8 source bytes without creating a project or rewriting the file", async (t) => {
  const environment = await createEnvironment(t);
  const sourcePath = join(environment.sources, "legacy-encoding.html");
  const original = Buffer.concat([
    Buffer.from("<!doctype html><html><body>", "utf8"),
    Buffer.from([0xff, 0xfe]),
    Buffer.from("</body></html>", "utf8"),
  ]);
  await writeFile(sourcePath, original);
  const bridge = await environment.start();

  const response = await previewWorkspace(bridge.baseUrl, sourcePath);
  assert.equal(response.response.status, 415);
  assert.equal(response.body.error.code, "UNSUPPORTED_HTML_ENCODING");
  assert.deepEqual(await readFile(sourcePath), original);
  const projectEntries = await readdir(join(environment.workspace, "projects"))
    .catch(() => []);
  assert.deepEqual(projectEntries, []);
});

function exactDocumentTarget() {
  return {
    targetId: "target_document",
    label: "整个页面",
    level: "module",
    selector: "html",
    resolution: "exact",
  };
}

async function postJson(baseUrl, pathname, body) {
  const requestBody =
    pathname === "/request" && !Object.hasOwn(body, "targets")
      ? { ...body, targets: [exactDocumentTarget()] }
      : body;
  return requestJson(baseUrl, pathname, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(requestBody),
  });
}

async function activateReadyVersion(baseUrl, ready) {
  assert.equal(ready.status, "ready-to-open");
  const activated = await postJson(baseUrl, "/ready-version/activate", {
    sourcePath: ready.sourcePath,
    projectId: ready.projectId,
    documentId: ready.documentId,
    requestId: ready.requestId,
    attemptId: ready.attemptId,
    versionId: ready.versionId,
  });
  assert.equal(
    activated.response.status,
    200,
    JSON.stringify(activated.body),
  );
  assert.equal(activated.body.status, "version-activated");
  return activated.body;
}

async function runFinalizer(workspace, run, overrides = {}) {
  return execFileAsync(
    process.execPath,
    [
      finalizerScript,
      "--workspace",
      workspace,
      "--project-id",
      overrides.projectId ?? run.projectId,
      "--request-id",
      overrides.requestId ?? run.requestId,
      "--attempt-id",
      overrides.attemptId ?? run.attemptId,
    ],
    {
      env: {
        ...process.env,
        ...(overrides.environment ?? {}),
      },
    },
  );
}

function manualCompletionFor(run, baseHtml, outputHtml) {
  return {
    schemaVersion: "1.0.0",
    finalizerVersion: "1.0.0",
    status: "completed",
    projectId: run.projectId,
    documentId: run.documentId,
    requestId: run.requestId,
    attemptId: run.attemptId,
    basedOnVersionId: run.basedOnVersionId,
    previousVersionId: run.previousVersionId,
    candidateVersionId: run.candidateVersionId,
    candidateVersionOrdinal: run.activeRun.candidateVersionOrdinal,
    candidateVersionLabel: run.candidateVersionLabel,
    baseSnapshotSha256: run.activeRun.baseSnapshotSha256,
    inputManifestSha256: run.activeRun.inputManifestSha256,
    outputRelativePath: "output/index.html",
    outputSha256: hash(outputHtml),
    baseComparisonSha256: comparisonSha256(baseHtml),
    outputComparisonSha256: comparisonSha256(outputHtml),
    canonicalizationVersion: "1",
    completedAt: new Date().toISOString(),
  };
}

test("v2 registries are rejected without migration or mutation", async (t) => {
  const environment = await createEnvironment(t);
  const registryPath = join(
    environment.workspace,
    "project-registry.json",
  );
  const v2Registry = `${JSON.stringify(
    {
      schemaVersion: "2.0.0",
      updatedAt: "2026-07-18T00:00:00.000Z",
      sources: {},
      projects: {},
      documents: {},
    },
    null,
    2,
  )}\n`;
  await writeFile(registryPath, v2Registry, "utf8");

  await assert.rejects(
    startBridge(environment.workspace),
    /schema 3\.0\.0/,
  );
  assert.equal(await readFile(registryPath, "utf8"), v2Registry);
  await assert.rejects(
    access(join(environment.workspace, "migration-v2-report.json")),
  );
  await assert.rejects(
    access(join(environment.workspace, "migration-v2-intent.json")),
  );
});

test("legacy UUID project directories are rejected without migration or deletion", async (t) => {
  const environment = await createEnvironment(t);
  const projectId = "project_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const legacyProjectRoot = join(
    environment.workspace,
    "projects",
    projectId,
  );
  await mkdir(legacyProjectRoot, { recursive: true });
  const markerPath = join(legacyProjectRoot, "legacy-marker.txt");
  await writeFile(markerPath, "保留旧目录", "utf8");
  const registryPath = join(
    environment.workspace,
    "project-registry.json",
  );
  const legacyRegistry = `${JSON.stringify(
    {
      schemaVersion: "3.0.0",
      updatedAt: "2026-07-28T00:00:00.000Z",
      sources: {},
      projects: {
        [projectId]: {
          documentId: "doc_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          sourcePath: join(environment.sources, "legacy.html"),
        },
      },
      documents: {},
    },
    null,
    2,
  )}\n`;
  await writeFile(registryPath, legacyRegistry, "utf8");

  await assert.rejects(
    startBridge(environment.workspace),
    /metadata is invalid/,
  );
  assert.equal(await readFile(registryPath, "utf8"), legacyRegistry);
  assert.equal(await readFile(markerPath, "utf8"), "保留旧目录");
});

test("registration and first edit keep document identity sidecar-only", async (t) => {
  const environment = await createEnvironment(t);
  const sourcePath = join(environment.sources, "stale-v2-snapshot.html");
  const staleDocumentId = "doc_1111111111111111";
  const staleHtml = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="html-ai-document-id" content="${staleDocumentId}">
<meta name="html-ai-version-id" content="ver_0099">
<meta name="html-ai-version-label" content="V99">
<meta name="html-ai-based-on-version-id" content="ver_0042">
<meta name="html-ai-request-id" content="req_0099">
<title>旧快照</title>
</head>
<body><main><h1>旧快照正文保持原样</h1></main></body>
</html>`;
  await writeFile(sourcePath, staleHtml, "utf8");
  const bridge = await environment.start();
  const registryPath = join(environment.workspace, "project-registry.json");
  const registryBefore = await readFile(registryPath, "utf8");
  const projectsBefore = await readdir(join(environment.workspace, "projects"));

  const preview = await previewWorkspace(bridge.baseUrl, sourcePath);
  assert.equal(preview.response.status, 200);
  assert.equal(preview.body.registered, false);
  assert.equal(preview.body.projectId, null);
  assert.equal(preview.body.projectRoot, null);
  assert.equal(preview.body.paths.currentHtml, sourcePath);
  assert.equal(preview.body.paths.projectRecords, null);
  assert.deepEqual(preview.body.versions, []);
  assert.equal(await readFile(sourcePath, "utf8"), staleHtml);

  const sourcePreview = await requestJson(
    bridge.baseUrl,
    `/source?sourcePath=${encodeURIComponent(sourcePath)}`,
  );
  assert.equal(sourcePreview.response.status, 200);
  assert.equal(sourcePreview.body.registered, false);
  assert.equal(sourcePreview.body.content, staleHtml);
  for (const endpoint of [
    `/project-file?sourcePath=${encodeURIComponent(sourcePath)}`,
    `/file?sourcePath=${encodeURIComponent(sourcePath)}&path=PROJECT.md`,
  ]) {
    const result = await requestJson(bridge.baseUrl, endpoint);
    assert.equal(result.response.status, 404);
    assert.equal(result.body.error.code, "PROJECT_NOT_FOUND");
  }
  assert.equal(await readFile(sourcePath, "utf8"), staleHtml);
  assert.equal(await readFile(registryPath, "utf8"), registryBefore);
  assert.deepEqual(
    await readdir(join(environment.workspace, "projects")),
    projectsBefore,
  );

  const opened = await postJson(bridge.baseUrl, "/project/ensure", {
    sourcePath,
    expectedSourceSha256: hash(staleHtml),
  });
  assert.equal(opened.response.status, 200);
  assert.equal(opened.body.registered, true);
  assert.equal(opened.body.latestVersionId, "ver_0001");
  assert.equal(opened.body.versions.length, 1);
  assert.notEqual(opened.body.documentId, staleDocumentId);
  assert.equal(opened.body.paths.currentHtml, sourcePath);
  assert.equal(opened.body.paths.projectRecords, opened.body.projectRoot);
  const projectRules = await readFile(
    join(opened.body.projectRoot, "PROJECT.md"),
    "utf8",
  );
  assert.match(projectRules, /^# stale-v2-snapshot · 项目长期规则$/m);
  assert.match(projectRules, /适用于本项目之后的每次 AI 修改/);
  assert.match(projectRules, /完成要求所必需的关联内容/);
  const registeredHtml = await readFile(sourcePath, "utf8");
  assert.equal(registeredHtml, staleHtml);
  assert.equal(registeredHtml, opened.body.content);
  assert.doesNotMatch(registeredHtml, new RegExp(opened.body.documentId));
  assert.match(registeredHtml, /ver_0099|V99|ver_0042|req_0099/);
  assert.match(registeredHtml, /旧快照正文保持原样/);
  const ensuredAgain = await postJson(bridge.baseUrl, "/project/ensure", {
    sourcePath,
    expectedSourceSha256: opened.body.currentHtmlSha256,
  });
  assert.equal(ensuredAgain.response.status, 200);
  assert.equal(ensuredAgain.body.projectId, opened.body.projectId);
  assert.deepEqual(
    await readdir(join(environment.workspace, "projects")),
    [basename(opened.body.projectRoot)],
  );

  const edited = staleHtml.replace(
    "旧快照正文保持原样",
    "第一次真实编辑",
  );
  const autosaved = await postJson(bridge.baseUrl, "/autosave", {
    sourcePath,
    projectId: opened.body.projectId,
    documentId: opened.body.documentId,
    expectedSourceSha256: opened.body.currentHtmlSha256,
    editRevision: 1,
    html: edited,
  });
  assert.equal(autosaved.response.status, 200);
  assert.equal(hash(autosaved.body.content), autosaved.body.sha256);

  const importedHtml = await readFile(sourcePath, "utf8");
  assert.equal(importedHtml, edited);
  assert.doesNotMatch(importedHtml, new RegExp(opened.body.documentId));
  assert.match(importedHtml, /ver_0099|V99|ver_0042|req_0099/);
  assert.match(importedHtml, /第一次真实编辑/);
  assert.equal(
    (importedHtml.match(/name="html-ai-document-id"/g) ?? []).length,
    1,
  );
  for (const name of [
    "html-ai-version-id",
    "html-ai-version-label",
    "html-ai-based-on-version-id",
    "html-ai-request-id",
  ]) {
    assert.equal(importedHtml.includes(`name="${name}"`), true);
  }

  const projectRoot = opened.body.projectRoot;
  const [project, manifest, versionHtml] = await Promise.all([
    readFile(join(projectRoot, "project.json"), "utf8").then(JSON.parse),
    readFile(
      join(projectRoot, "versions", "ver_0001", "version.json"),
      "utf8",
    ).then(JSON.parse),
    readFile(
      join(projectRoot, "versions", "ver_0001", "files", "index.html"),
      "utf8",
    ),
  ]);
  assert.equal(project.schemaVersion, "3.0.0");
  assert.equal(project.displayName, "stale-v2-snapshot");
  assert.equal(project.storageDirectoryName, basename(projectRoot));
  assert.equal(project.createdAt, manifest.generatedAt);
  assert.equal("migration" in project, false);
  assert.equal(manifest.schemaVersion, "3.0.0");
  assert.equal(manifest.sourceType, "initial");
  assert.equal(versionHtml, staleHtml);
  assert.equal(versionHtml, registeredHtml);
  assert.equal(manifest.contentSha256, hash(registeredHtml));
  const registry = JSON.parse(await readFile(registryPath, "utf8"));
  assert.deepEqual(
    {
      displayName: registry.projects[opened.body.projectId].displayName,
      createdAt: registry.projects[opened.body.projectId].createdAt,
      storageDirectoryName:
        registry.projects[opened.body.projectId].storageDirectoryName,
    },
    {
      displayName: project.displayName,
      createdAt: project.createdAt,
      storageDirectoryName: project.storageDirectoryName,
    },
  );
  const sourceRecord = registry.sources[registry.projects[opened.body.projectId].sourceFingerprint];
  assert.deepEqual(Object.keys(sourceRecord.fileIdentity).sort(), ["birthtimeMs", "dev", "ino"]);
  assert.equal(sourceRecord.confirmedSourceSha256, autosaved.body.currentHtmlSha256);
});

test("registered v3 artifacts reject v2 schema versions", async (t) => {
  const environment = await createEnvironment(t);
  const sourcePath = join(environment.sources, "strict-v3.html");
  await writeFile(sourcePath, htmlPage("严格 V3"), "utf8");
  const bridge = await environment.start();
  const opened = (await openWorkspace(bridge.baseUrl, sourcePath)).body;
  const projectRoot = opened.projectRoot;
  const projectPath = join(projectRoot, "project.json");
  const runtimePath = join(projectRoot, "runtime-state.json");
  const manifestPath = join(
    projectRoot,
    "versions",
    "ver_0001",
    "version.json",
  );

  for (const artifactPath of [projectPath, runtimePath, manifestPath]) {
    const original = await readFile(artifactPath, "utf8");
    const artifact = JSON.parse(original);
    artifact.schemaVersion = "2.0.0";
    await writeFile(
      artifactPath,
      `${JSON.stringify(artifact, null, 2)}\n`,
      "utf8",
    );
    const rejected = await openWorkspace(bridge.baseUrl, sourcePath);
    assert.equal(rejected.response.status, 409);
    assert.equal(
      rejected.body.error.code,
      "UNSUPPORTED_SCHEMA_VERSION",
    );
    await writeFile(artifactPath, original);
  }

  const run = (
    await postJson(bridge.baseUrl, "/request", {
      sourcePath,
      expectedSourceSha256: opened.currentHtmlSha256,
      freezeCutoffRevision: 0,
      summary: "验证冻结工件严格版本",
    })
  ).body;
  const changeRequestPath = join(run.requestPath, "change-request.json");
  const annotationsPath = join(
    run.requestPath,
    "input",
    "annotations",
    "records.json",
  );
  for (const artifactPath of [changeRequestPath, annotationsPath]) {
    const original = await readFile(artifactPath, "utf8");
    const artifact = JSON.parse(original);
    artifact.schemaVersion = "2.0.0";
    await writeFile(
      artifactPath,
      `${JSON.stringify(artifact, null, 2)}\n`,
      "utf8",
    );
    const rejected = await openWorkspace(bridge.baseUrl, sourcePath);
    assert.equal(rejected.response.status, 409);
    assert.equal(
      rejected.body.error.code,
      "UNSUPPORTED_SCHEMA_VERSION",
    );
    await writeFile(artifactPath, original);
  }
});

test("finalizer rejects old or missing persisted schemas before mutating output", async (t) => {
  const environment = await createEnvironment(t);
  const sourcePath = join(environment.sources, "finalizer-schema.html");
  await writeFile(sourcePath, htmlPage("最终化 Schema"), "utf8");
  const bridge = await environment.start();
  const opened = (await openWorkspace(bridge.baseUrl, sourcePath)).body;
  const run = (
    await postJson(bridge.baseUrl, "/request", {
      sourcePath,
      expectedSourceSha256: opened.currentHtmlSha256,
      freezeCutoffRevision: 0,
      summary: "Schema 错误不得改写输出",
    })
  ).body;
  const rawOutput = htmlPage("最终化 Schema", "<p>raw candidate</p>");
  await writeFile(run.outputPath, rawOutput, "utf8");
  const projectRoot = projectRootFromRun(run);
  const cases = [
    [join(projectRoot, "project.json"), "2.0.0"],
    [join(projectRoot, "runtime-state.json"), null],
    [join(run.requestPath, "change-request.json"), "2.0.0"],
    [
      join(run.requestPath, "input", "annotations", "records.json"),
      null,
    ],
    [join(run.requestPath, "input-manifest.json"), "2.0.0"],
  ];
  for (const [artifactPath, schemaVersion] of cases) {
    const original = await readFile(artifactPath, "utf8");
    const artifact = JSON.parse(original);
    if (schemaVersion === null) delete artifact.schemaVersion;
    else artifact.schemaVersion = schemaVersion;
    await writeFile(
      artifactPath,
      `${JSON.stringify(artifact, null, 2)}\n`,
      "utf8",
    );
    await assert.rejects(
      runFinalizer(environment.workspace, run),
      (error) => {
        assert.match(
          String(error.stderr ?? error.message),
          /UNSUPPORTED_SCHEMA_VERSION|must use schema/,
        );
        return true;
      },
    );
    assert.equal(await readFile(run.outputPath, "utf8"), rawOutput);
    await assert.rejects(access(run.completionPath));
    await writeFile(artifactPath, original, "utf8");
  }
  const unsupportedCompletion = `${JSON.stringify({
    schemaVersion: "2.0.0",
  }, null, 2)}\n`;
  await writeFile(run.completionPath, unsupportedCompletion, "utf8");
  await assert.rejects(
    runFinalizer(environment.workspace, run),
    (error) => {
      assert.match(
        String(error.stderr ?? error.message),
        /UNSUPPORTED_SCHEMA_VERSION|must use schema/,
      );
      return true;
    },
  );
  assert.equal(await readFile(run.outputPath, "utf8"), rawOutput);
  assert.equal(
    await readFile(run.completionPath, "utf8"),
    unsupportedCompletion,
  );
});

test("manual completion cannot commit spoofed or duplicate lifecycle metadata", async (t) => {
  const environment = await createEnvironment(t);
  const sourcePath = join(environment.sources, "managed-meta-spoof.html");
  await writeFile(sourcePath, htmlPage("Meta spoof"), "utf8");
  const bridge = await environment.start();
  let workspaceState = (await openWorkspace(bridge.baseUrl, sourcePath)).body;
  const originalSource = await readFile(sourcePath, "utf8");

  const attempts = [
    {
      label: "wrong value",
      mutate(html) {
        return html.replace(
          'name="html-ai-version-id" content="ver_0002"',
          'name="html-ai-version-id" content="ver_9999"',
        );
      },
    },
    {
      label: "duplicate",
      mutate(html, run) {
        return html.replace(
          "</head>",
          `<meta name="html-ai-document-id" content="${run.documentId}"></head>`,
        );
      },
    },
  ];

  for (const item of attempts) {
    const run = (
      await postJson(bridge.baseUrl, "/request", {
        sourcePath,
        expectedSourceSha256: workspaceState.currentHtmlSha256,
        freezeCutoffRevision: workspaceState.runtimeState.editRevision,
        summary: `manual completion ${item.label}`,
      })
    ).body;
    assert.equal(run.candidateVersionId, "ver_0002");
    const baseHtml = await readFile(run.inputPath, "utf8");
    const canonical = injectManagedMeta(
      htmlPage("Meta spoof", `<p>${item.label}</p>`),
      {
        documentId: run.documentId,
        versionId: run.candidateVersionId,
        versionLabel: run.candidateVersionLabel,
        basedOnVersionId: run.basedOnVersionId,
        requestId: run.requestId,
      },
    );
    const spoofed = item.mutate(canonical, run);
    await writeFile(run.outputPath, spoofed, "utf8");
    await writeFile(
      run.completionPath,
      `${JSON.stringify(
        manualCompletionFor(run, baseHtml, spoofed),
        null,
        2,
      )}\n`,
      "utf8",
    );
    const rejected = await requestJson(
      bridge.baseUrl,
      `/status?sourcePath=${encodeURIComponent(sourcePath)}&requestId=${run.requestId}&attemptId=${run.attemptId}`,
    );
    assert.equal(rejected.response.status, 200, item.label);
    assert.equal(rejected.body.status, "error", item.label);
    assert.equal(
      rejected.body.error.code,
      "OUTPUT_MANAGED_META_MISMATCH",
      item.label,
    );
    await access(join(run.attemptPath, "outcome.json"));
    assert.equal(await readFile(sourcePath, "utf8"), originalSource);
    workspaceState = (await openWorkspace(bridge.baseUrl, sourcePath)).body;
    assert.equal(workspaceState.versions.length, 1);
    assert.equal(workspaceState.runtimeState.lifecycleState, "editing");
  }
});

test("status rejects an unsupported completion schema without mutating run state", async (t) => {
  const environment = await createEnvironment(t);
  const sourcePath = join(environment.sources, "completion-schema.html");
  await writeFile(sourcePath, htmlPage("Completion schema"), "utf8");
  const bridge = await environment.start();
  const opened = (await openWorkspace(bridge.baseUrl, sourcePath)).body;
  const run = (
    await postJson(bridge.baseUrl, "/request", {
      sourcePath,
      expectedSourceSha256: opened.currentHtmlSha256,
      freezeCutoffRevision: 0,
      summary: "completion schema fail closed",
    })
  ).body;
  await writeFile(
    run.outputPath,
    htmlPage("Completion schema", "<p>candidate</p>"),
    "utf8",
  );
  await runFinalizer(environment.workspace, run);
  const completion = JSON.parse(
    await readFile(run.completionPath, "utf8"),
  );
  delete completion.schemaVersion;
  await writeFile(
    run.completionPath,
    `${JSON.stringify(completion, null, 2)}\n`,
    "utf8",
  );
  const projectRoot = projectRootFromRun(run);
  const runtimePath = join(projectRoot, "runtime-state.json");
  const runtimeBefore = await readFile(runtimePath, "utf8");
  const sourceBefore = await readFile(sourcePath, "utf8");
  const rejected = await requestJson(
    bridge.baseUrl,
    `/status?sourcePath=${encodeURIComponent(sourcePath)}&requestId=${run.requestId}&attemptId=${run.attemptId}`,
  );
  assert.equal(rejected.response.status, 409);
  assert.equal(rejected.body.error.code, "UNSUPPORTED_SCHEMA_VERSION");
  assert.equal(await readFile(runtimePath, "utf8"), runtimeBefore);
  assert.equal(await readFile(sourcePath, "utf8"), sourceBefore);
  await assert.rejects(access(join(run.attemptPath, "outcome.json")));
  assert.deepEqual(
    (await readdir(join(projectRoot, "versions"))).sort(),
    ["ver_0001"],
  );
});

test("Request submission rejects missing, unresolved, and compatibility TargetRefs", async (t) => {
  const environment = await createEnvironment(t);
  const sourcePath = join(environment.sources, "strict-targets.html");
  await writeFile(sourcePath, htmlPage("严格目标"), "utf8");
  const bridge = await environment.start();
  const opened = (await openWorkspace(bridge.baseUrl, sourcePath)).body;
  const baseBody = {
    sourcePath,
    expectedSourceSha256: opened.currentHtmlSha256,
    freezeCutoffRevision: 0,
    summary: "目标必须可安全解析",
  };

  const cases = [
    {
      targets: [],
      code: "TARGET_REFS_REQUIRED",
    },
    {
      targets: [
        {
          targetId: "target_missing_resolution",
          label: "缺解析状态",
          level: "module",
          selector: "main",
        },
      ],
      code: "TARGET_UNRESOLVED",
    },
    {
      targets: [
        {
          targetId: "target_ambiguous",
          label: "歧义目标",
          level: "module",
          selector: "main",
          resolution: "ambiguous",
        },
      ],
      code: "TARGET_UNRESOLVED",
    },
    {
      targets: [
        {
          targetId: "target_orphaned",
          label: "失联目标",
          level: "module",
          selector: "main",
          resolution: "orphaned",
        },
      ],
      code: "TARGET_UNRESOLVED",
    },
    {
      targets: [
        {
          id: "target_old_alias",
          name: "旧别名",
          level: "module",
          resolution: "exact",
        },
      ],
      code: "INVALID_TARGET_REF",
    },
    {
      targets: [
        {
          targetId: "target_no_locator",
          label: "无定位证据",
          level: "module",
          resolution: "exact",
        },
      ],
      code: "INVALID_TARGET_REF",
    },
    {
      targets: [exactDocumentTarget(), exactDocumentTarget()],
      code: "DUPLICATE_TARGET_ID",
    },
  ];
  for (const item of cases) {
    const rejected = await postJson(bridge.baseUrl, "/request", {
      ...baseBody,
      targets: item.targets,
    });
    assert.equal(rejected.response.status, 422);
    assert.equal(rejected.body.error.code, item.code);
    const state = (await openWorkspace(bridge.baseUrl, sourcePath)).body;
    assert.equal(state.runtimeState.lifecycleState, "editing");
    assert.equal(state.versions.length, 1);
  }

  const accepted = await postJson(bridge.baseUrl, "/request", {
    ...baseBody,
    targets: [
      {
        targetId: "target_rebound",
        label: "安全重绑定目标",
        level: "module",
        selector: "main",
        resolution: "rebound",
      },
    ],
  });
  assert.equal(accepted.response.status, 201);
});

test("AI readOrder excludes the full audit archive and compacts long module quotes", async (t) => {
  const environment = await createEnvironment(t);
  const sourcePath = join(environment.sources, "compact-ai-input.html");
  await writeFile(sourcePath, htmlPage("精简 AI 输入"), "utf8");
  const bridge = await environment.start();
  const opened = (await openWorkspace(bridge.baseUrl, sourcePath)).body;
  const longTextQuote = `整页可见文本 ${"上下文".repeat(2_000)}`.slice(0, 5_000);
  const target = {
    targetId: "target_compact_document",
    label: "整个页面",
    level: "module",
    selector: "body",
    textQuote: longTextQuote,
    sourceAnchor: {
      startOffset: 0,
      endOffset: (await readFile(sourcePath, "utf8")).length,
      sourceSha256: opened.currentHtmlSha256,
    },
    resolution: "exact",
  };
  const submitted = await postJson(bridge.baseUrl, "/request", {
    sourcePath,
    expectedSourceSha256: opened.currentHtmlSha256,
    freezeCutoffRevision: 0,
    summary: "如实执行整页评论",
    targets: [target],
    instructions: [{
      instructionId: "instruction_compact_document",
      text: "检查整个页面并保持美观",
      targetRefs: [target.targetId],
    }],
    comments: [{
      commentId: "comment_compact_document",
      text: "检查整个页面并保持美观",
      target,
    }],
    changeEvents: [],
  });
  assert.equal(submitted.response.status, 201, JSON.stringify(submitted.body));
  assert.match(submitted.body.handoffMessage, /中的单轮任务/);
  assert.match(submitted.body.handoffMessage, /最终化（finalizer）命令/);

  const [changeRequest, annotations, inputManifest, prompt, aiRules] =
    await Promise.all([
      readFile(join(submitted.body.requestPath, "change-request.json"), "utf8").then(JSON.parse),
      readFile(
        join(submitted.body.requestPath, "input", "annotations", "records.json"),
        "utf8",
      ).then(JSON.parse),
      readFile(join(submitted.body.requestPath, "input-manifest.json"), "utf8").then(JSON.parse),
      readFile(join(submitted.body.requestPath, "PROMPT.md"), "utf8"),
      readFile(join(submitted.body.requestPath, "input", "AI_RULES.md"), "utf8"),
    ]);

  assert.equal(
    changeRequest.requirements.instructions[0].text,
    annotations.comments[0].text,
  );
  assert.equal(annotations.comments[0].target.textQuote, longTextQuote);
  assert.equal("textQuote" in changeRequest.requirements.targets[0], false);
  assert.ok(inputManifest.files.some((file) => (
    file.path === "input/annotations/records.json"
    && file.role === "annotations"
  )));
  assert.equal(
    inputManifest.readOrder.includes("input/annotations/records.json"),
    false,
  );
  assert.doesNotMatch(prompt, /input\/annotations\/records\.json/);
  assert.match(prompt, /^# PageRoot 本轮修改 · compact-ai-input$/m);
  assert.match(prompt, /不要读取未列入 readOrder 的审计归档/);
  assert.match(
    prompt,
    new RegExp(`${submitted.body.projectId}.*${submitted.body.documentId}`),
  );
  assert.match(
    prompt,
    new RegExp(`${submitted.body.requestId}.*${submitted.body.attemptId}`),
  );
  assert.match(prompt, /record-user-supplement\.mjs/);
  assert.match(prompt, /失败时停止该条修改并说明原因/);
  assert.match(prompt, /命令返回 `ok=true` 后才能执行该条要求/);
  assert.match(prompt, /evidenceState=description-only/);
  assert.doesNotMatch(prompt, /## 本轮附件/);
  assert.match(
    aiRules,
    /本轮有效要求由 change-request\.json 中的冻结要求，以及当前 Attempt 的 USER_SUPPLEMENT\.json/,
  );
  assert.match(aiRules, /^# PageRoot 通用执行规则$/m);
  assert.match(aiRules, /files 中未列入 readOrder 的条目只用于审计，不得读取/);
});

test("historical direct-edit targets never block a resolved Request", async (t) => {
  const environment = await createEnvironment(t);
  const sourcePath = join(environment.sources, "historical-audit-target.html");
  await writeFile(sourcePath, htmlPage("历史修改目标"), "utf8");
  const bridge = await environment.start();
  const opened = (await openWorkspace(bridge.baseUrl, sourcePath)).body;
  const currentHtml = await readFile(sourcePath, "utf8");
  const nextHtml = currentHtml.replace("</body>", "<p>已直接修改</p></body>");
  const saved = await postJson(bridge.baseUrl, "/autosave", {
    sourcePath,
    editRevision: 1,
    expectedSourceSha256: opened.currentHtmlSha256,
    html: nextHtml,
    changeEvents: [],
  });
  assert.equal(saved.response.status, 200);

  for (const resolution of ["ambiguous", "orphaned"]) {
    const requestSource = resolution === "ambiguous"
      ? sourcePath
      : join(environment.sources, "historical-audit-target-orphaned.html");
    let requestHash = saved.body.currentHtmlSha256;
    if (requestSource !== sourcePath) {
      await writeFile(requestSource, htmlPage("历史失联目标"), "utf8");
      const secondOpened = (await openWorkspace(bridge.baseUrl, requestSource)).body;
      const secondHtml = await readFile(requestSource, "utf8");
      const secondSaved = await postJson(bridge.baseUrl, "/autosave", {
        sourcePath: requestSource,
        editRevision: 1,
        expectedSourceSha256: secondOpened.currentHtmlSha256,
        html: secondHtml.replace("</body>", "<p>已直接修改</p></body>"),
        changeEvents: [],
      });
      assert.equal(secondSaved.response.status, 200);
      requestHash = secondSaved.body.currentHtmlSha256;
    }
    const historicalTarget = {
      ...exactDocumentTarget(),
      targetId: `target_historical_${resolution}`,
      resolution,
    };
    const submitted = await postJson(bridge.baseUrl, "/request", {
      sourcePath: requestSource,
      expectedSourceSha256: requestHash,
      freezeCutoffRevision: 1,
      summary: "历史审计目标不能阻断新任务",
      changeEvents: [{
        eventId: `change_historical_${resolution}`,
        revision: 1,
        kind: "style",
        property: "fontWeight",
        target: historicalTarget,
        before: "normal",
        after: "700",
      }],
    });
    assert.equal(submitted.response.status, 201);
    const annotations = JSON.parse(await readFile(
      join(submitted.body.requestPath, "input", "annotations", "records.json"),
      "utf8",
    ));
    assert.equal(annotations.editEvents[0].target.resolution, resolution);
  }
});

test("autosave writes the real source without Versions and projects stay isolated", async (t) => {
  const environment = await createEnvironment(t);
  const sourceA = join(environment.sources, "A.html");
  const sourceB = join(environment.sources, "B.html");
  const initialA = htmlPage(
    "项目 A",
    '<p id="stable-comment-target">跨历史保留的评论目标</p>',
  );
  const initialB = htmlPage("项目 B");
  await writeFile(sourceA, initialA, "utf8");
  await writeFile(sourceB, initialB, "utf8");
  const bridge = await environment.start();

  const openedA = await openWorkspace(bridge.baseUrl, sourceA);
  assert.equal(openedA.response.status, 200);
  assert.equal(openedA.body.latestVersionId, "ver_0001");
  assert.equal(openedA.body.currentBasedOnVersionId, "ver_0001");
  assert.equal(openedA.body.currentExactVersionId, "ver_0001");
  assert.equal(openedA.body.versions.length, 1);
  assert.match(openedA.body.projectId, /^project_[a-f0-9]+$/);
  assert.match(openedA.body.documentId, /^doc_[a-f0-9]+$/);
  const initialSourceA = initialA;
  assert.equal(await readFile(sourceA, "utf8"), initialSourceA);
  assert.equal(openedA.body.currentHtmlSha256, hash(initialSourceA));

  let expectedSourceSha256 = openedA.body.currentHtmlSha256;
  for (let revision = 1; revision <= 20; revision += 1) {
    const nextHtml = htmlPage(
      "项目 A",
      [
        '<p id="stable-comment-target">跨历史保留的评论目标</p>',
        `<p id="revision">第 ${revision} 次自动写回</p>`,
      ].join(""),
    );
    const saved = await postJson(bridge.baseUrl, "/autosave", {
      sourcePath: sourceA,
      editRevision: revision,
      expectedSourceSha256,
      html: nextHtml,
      changeEvents: [
        {
          eventId: `event_${revision}`,
          kind: "text",
          before: revision - 1,
          after: revision,
        },
      ],
    });
    assert.equal(saved.response.status, 200);
    assert.equal(saved.body.status, "source-updated");
    assert.equal(saved.body.versionCreated, false);
    expectedSourceSha256 = saved.body.currentHtmlSha256;
    assert.equal(
      await readFile(sourceA, "utf8"),
      nextHtml,
    );
  }

  const afterTwenty = await openWorkspace(bridge.baseUrl, sourceA);
  assert.equal(afterTwenty.body.versions.length, 1);
  assert.equal(afterTwenty.body.latestVersionId, "ver_0001");
  assert.equal(afterTwenty.body.currentExactVersionId, null);
  assert.equal(afterTwenty.body.runtimeState.editRevision, 20);
  assert.equal(afterTwenty.body.runtimeState.lastPersistedRevision, 20);

  const lateRevision = await postJson(bridge.baseUrl, "/autosave", {
    sourcePath: sourceA,
    editRevision: 19,
    expectedSourceSha256,
    html: htmlPage("不应覆盖"),
  });
  assert.equal(lateRevision.body.status, "stale-revision-ignored");
  assert.match(await readFile(sourceA, "utf8"), /第 20 次自动写回/);

  const removedVersionEndpoint = await postJson(
    bridge.baseUrl,
    "/version",
    {
      sourcePath: sourceA,
      html: htmlPage("不能建版本"),
    },
  );
  assert.equal(removedVersionEndpoint.response.status, 410);
  assert.equal(
    removedVersionEndpoint.body.error.code,
    "LOCAL_VERSIONING_REMOVED",
  );

  const draftSource = await readFile(sourceA, "utf8");
  const draftSourceIndex = buildSourceIndex(draftSource);
  const stableCommentElement = draftSourceIndex.elements.find(
    (element) =>
      element.stableAttributes.id === "stable-comment-target",
  );
  assert.ok(stableCommentElement);
  const stableCommentTarget = createTargetRef(
    draftSourceIndex,
    stableCommentElement,
    {
      targetId: "target_stable_comment",
      label: "跨历史保留的评论目标",
      level: "subregion",
    },
  );
  const draft = await postJson(bridge.baseUrl, "/draft", {
    sourcePath: sourceA,
    expectedDraftRevision: 0,
    comments: [
      {
        commentId: "comment_a",
        text: "这条评论必须跨刷新保留。",
        target: stableCommentTarget,
      },
    ],
    changeEvents: [{
      eventId: "pending_edit",
      kind: "style",
      target: stableCommentTarget,
    }],
  });
  assert.equal(draft.body.activeDraft.comments[0].commentId, "comment_a");
  const draftReloaded = await openWorkspace(bridge.baseUrl, sourceA);
  assert.equal(
    draftReloaded.body.runtimeState.draft.comments[0].commentId,
    "comment_a",
  );

  const openedB = await openWorkspace(bridge.baseUrl, sourceB);
  assert.equal(openedB.body.versions.length, 1);
  assert.notEqual(openedB.body.projectId, openedA.body.projectId);
  assert.notEqual(openedB.body.documentId, openedA.body.documentId);
  assert.equal(
    openedB.body.currentHtmlSha256,
    hash(initialB),
  );
  const aStillIndependent = await openWorkspace(bridge.baseUrl, sourceA);
  assert.equal(aStillIndependent.body.versions.length, 1);
  assert.equal(aStillIndependent.body.projectId, openedA.body.projectId);

  const restoreUnavailable = await postJson(bridge.baseUrl, "/restore", {
    sourcePath: sourceA,
    versionId: "ver_0001",
    expectedSourceSha256,
  });
  assert.equal(restoreUnavailable.response.status, 404);
  assert.equal(restoreUnavailable.body.error.code, "NOT_FOUND");
  assert.equal(await readFile(sourceA, "utf8"), draftSource);
  const afterUnavailableRestore = await openWorkspace(bridge.baseUrl, sourceA);
  assert.equal(afterUnavailableRestore.body.versions.length, 1);
  assert.equal(afterUnavailableRestore.body.currentBasedOnVersionId, "ver_0001");
  assert.equal(afterUnavailableRestore.body.currentExactVersionId, null);
  assert.deepEqual(
    afterUnavailableRestore.body.activeDraft.comments.map((comment) => comment.commentId),
    ["comment_a"],
  );
  assert.deepEqual(
    afterUnavailableRestore.body.activeDraft.changeEvents.map((event) => event.eventId),
    ["pending_edit"],
  );
  const preservedCommentResolution = resolveTargetRef(
    buildSourceIndex(draftSource),
    afterUnavailableRestore.body.activeDraft.comments[0].target,
  );
  assert.equal(preservedCommentResolution.resolution, "exact");
  assert.ok(preservedCommentResolution.target);

  const exactHistory = await requestJson(
    bridge.baseUrl,
    `/version-file?sourcePath=${encodeURIComponent(sourceA)}&versionId=ver_0001`,
  );
  assert.equal(exactHistory.body.readOnly, true);
  assert.equal(exactHistory.body.content, initialSourceA);
  assert.equal(exactHistory.body.sha256, hash(initialSourceA));

  const currentSource = await requestJson(
    bridge.baseUrl,
    `/source?sourcePath=${encodeURIComponent(sourceA)}`,
  );
  assert.equal(currentSource.body.content, draftSource);
  assert.equal(currentSource.body.sha256, hash(draftSource));
  const requestAfterUnavailableRestore = await postJson(bridge.baseUrl, "/request", {
    sourcePath: sourceA,
    projectId: afterUnavailableRestore.body.projectId,
    documentId: afterUnavailableRestore.body.documentId,
    expectedSourceSha256: afterUnavailableRestore.body.currentHtmlSha256,
    freezeCutoffRevision: afterUnavailableRestore.body.runtimeState.editRevision,
    lastPersistedRevision:
      afterUnavailableRestore.body.runtimeState.lastPersistedRevision,
    summary: "历史保持只读，只携带当前仍然存在的评论。",
    targets: [
      afterUnavailableRestore.body.activeDraft.comments[0].target,
    ],
    comments: afterUnavailableRestore.body.activeDraft.comments,
    changeEvents: afterUnavailableRestore.body.activeDraft.changeEvents,
  });
  assert.equal(
    requestAfterUnavailableRestore.response.status,
    201,
    JSON.stringify(requestAfterUnavailableRestore.body),
  );
  const frozenAfterUnavailableRestore = JSON.parse(
    await readFile(
      join(
        requestAfterUnavailableRestore.body.requestPath,
        "input",
        "annotations",
        "records.json",
      ),
      "utf8",
    ),
  );
  assert.deepEqual(
    frozenAfterUnavailableRestore.comments.map((comment) => comment.commentId),
    ["comment_a"],
  );
  assert.deepEqual(
    frozenAfterUnavailableRestore.editEvents.map((event) => event.eventId),
    ["edit_pending_edit"],
  );
  assert.deepEqual(
    requestAfterUnavailableRestore.body.activeRun.frozenEditEventIds,
    ["edit_pending_edit"],
  );
  const auditPath = join(
    openedA.body.projectRoot,
    "edit-audit.jsonl",
  );
  const auditLines = (await readFile(auditPath, "utf8")).trim().split("\n");
  assert.equal(auditLines.length, 20);
});

test("version history stays read-only and the restore endpoint is unavailable", async (t) => {
  const environment = await createEnvironment(t);
  const sourcePath = join(environment.sources, "read-only-history.html");
  await writeFile(sourcePath, htmlPage("只读历史"), "utf8");
  const bridge = await environment.start();
  const opened = (await openWorkspace(bridge.baseUrl, sourcePath)).body;
  const version = await requestJson(
    bridge.baseUrl,
    `/version-file?sourcePath=${encodeURIComponent(sourcePath)}&versionId=ver_0001`,
  );
  assert.equal(version.response.status, 200);
  assert.equal(version.body.readOnly, true);
  const restoreUnavailable = await postJson(bridge.baseUrl, "/restore", {
    sourcePath,
    projectId: opened.projectId,
    documentId: opened.documentId,
    versionId: "ver_0001",
    expectedSourceSha256: opened.currentHtmlSha256,
  });
  assert.equal(restoreUnavailable.response.status, 404);
  assert.equal(restoreUnavailable.body.error.code, "NOT_FOUND");
  const unchanged = (await openWorkspace(bridge.baseUrl, sourcePath)).body;
  assert.equal(unchanged.currentHtmlSha256, opened.currentHtmlSha256);
  assert.equal(unchanged.currentExactVersionId, "ver_0001");
});

test("sequential AI successes preserve every prior source and activate semantic working files", async (t) => {
  const environment = await createEnvironment(t);
  const originalPath = join(environment.sources, "复杂HTML综合测试页.html");
  await writeFile(originalPath, htmlPage("不可覆盖的原文件"), "utf8");
  let bridge = await environment.start();
  const opened = (await openWorkspace(bridge.baseUrl, originalPath)).body;
  const originalBytes = await readFile(originalPath);
  const originalSha256 = hash(originalBytes);

  const firstRun = (
    await postJson(bridge.baseUrl, "/request", {
      sourcePath: originalPath,
      expectedSourceSha256: opened.currentHtmlSha256,
      freezeCutoffRevision: opened.runtimeState.editRevision,
      summary: "生成第一个非覆盖 AI 版本",
    })
  ).body;
  assert.equal(firstRun.candidateVersionId, "ver_0002");
  assert.equal(firstRun.candidateDisplayVersionLabel, "版本 2");
  assert.equal(await readFile(firstRun.inputPath, "utf8"), originalBytes.toString("utf8"));
  await writeFile(
    firstRun.outputPath,
    htmlPage("第一个 AI 版本", '<p id="ai-v11">V1.1 完整结果</p>'),
    "utf8",
  );
  await runFinalizer(environment.workspace, firstRun);
  const firstReady = (
    await requestJson(
      bridge.baseUrl,
      `/status?sourcePath=${encodeURIComponent(originalPath)}&requestId=${firstRun.requestId}&attemptId=${firstRun.attemptId}`,
    )
  ).body;
  assert.equal(firstReady.status, "ready-to-open");
  assert.equal(firstReady.candidateDisplayVersionLabel, "版本 2");
  assert.equal(firstReady.currentPath, originalPath);
  assert.equal(firstReady.workingCopyPath, firstRun.plannedWorkingCopyPath);
  assert.match(firstReady.workingCopyPath, /\/working\/复杂HTML综合测试页-V1\.1\.html$/u);
  assert.notEqual(firstReady.workingCopyPath, originalPath);
  assert.equal(hash(await readFile(originalPath)), originalSha256);
  assert.deepEqual(await readFile(originalPath), originalBytes);
  const firstWorkingBytes = await readFile(firstReady.workingCopyPath);
  assert.equal(hash(firstWorkingBytes), firstReady.contentSha256);
  assert.deepEqual(
    await readFile(firstReady.versionEntryPath),
    firstWorkingBytes,
  );
  const firstCreated = await activateReadyVersion(bridge.baseUrl, firstReady);
  assert.equal(firstCreated.currentPath, firstReady.workingCopyPath);

  const workingAliasRoot = join(environment.root, "working-directory-alias");
  await symlink(dirname(firstCreated.currentPath), workingAliasRoot, "dir");
  const aliasedFirstWorkingPath = join(
    workingAliasRoot,
    basename(firstCreated.currentPath),
  );
  const canonicalFirstWorkingPath = join(
    await realpath(dirname(firstCreated.currentPath)),
    basename(firstCreated.currentPath),
  );
  const openedThroughAlias = (
    await openWorkspace(bridge.baseUrl, aliasedFirstWorkingPath)
  ).body;
  assert.equal(openedThroughAlias.projectId, opened.projectId);
  assert.equal(openedThroughAlias.documentId, opened.documentId);
  assert.equal(openedThroughAlias.sourcePath, canonicalFirstWorkingPath);

  const afterFirst = (await openWorkspace(bridge.baseUrl, originalPath)).body;
  assert.equal(afterFirst.sourcePath, firstCreated.currentPath);
  const secondRun = (
    await postJson(bridge.baseUrl, "/request", {
      // Desktop state may spell the same workspace directory through a
      // symlink alias such as /private/var instead of /var.
      sourcePath: aliasedFirstWorkingPath,
      expectedSourceSha256: afterFirst.currentHtmlSha256,
      freezeCutoffRevision: afterFirst.runtimeState.editRevision,
      summary: "生成第二个非覆盖 AI 版本",
    })
  ).body;
  assert.equal(secondRun.candidateVersionId, "ver_0003");
  assert.equal(secondRun.candidateDisplayVersionLabel, "版本 3");
  assert.equal(
    await readFile(secondRun.inputPath, "utf8"),
    firstWorkingBytes.toString("utf8"),
  );
  await writeFile(
    secondRun.outputPath,
    htmlPage("第二个 AI 版本", '<p id="ai-v12">V1.2 完整结果</p>'),
    "utf8",
  );
  await runFinalizer(environment.workspace, secondRun);
  const secondReady = (
    await requestJson(
      bridge.baseUrl,
      `/status?sourcePath=${encodeURIComponent(firstCreated.currentPath)}&requestId=${secondRun.requestId}&attemptId=${secondRun.attemptId}`,
    )
  ).body;
  assert.equal(secondReady.status, "ready-to-open");
  assert.equal(secondReady.candidateDisplayVersionLabel, "版本 3");
  assert.equal(secondReady.currentPath, firstCreated.currentPath);
  assert.match(secondReady.workingCopyPath, /\/working\/复杂HTML综合测试页-V1\.2\.html$/u);
  assert.doesNotMatch(secondReady.workingCopyPath, /V1\.1-V1\.2/u);
  assert.notEqual(secondReady.workingCopyPath, firstCreated.currentPath);
  assert.deepEqual(await readFile(originalPath), originalBytes);
  assert.deepEqual(await readFile(firstCreated.currentPath), firstWorkingBytes);
  assert.deepEqual(
    await readFile(secondReady.versionEntryPath),
    await readFile(secondReady.workingCopyPath),
  );
  const secondCreated = await activateReadyVersion(bridge.baseUrl, secondReady);

  const registry = JSON.parse(
    await readFile(
      join(environment.workspace, "project-registry.json"),
      "utf8",
    ),
  );
  assert.equal(
    registry.projects[opened.projectId].sourcePath,
    secondCreated.currentPath,
  );
  const projectSources = Object.values(registry.sources).filter(
    (record) => record.projectId === opened.projectId,
  );
  assert.equal(
    projectSources.filter((record) => record.role === "current").length,
    1,
  );
  assert.equal(
    projectSources.find((record) => record.role === "current")?.sourcePath,
    secondCreated.currentPath,
  );
  assert.ok(
    projectSources.some(
      (record) =>
        record.sourcePath === originalPath
        && record.canonicalSourcePath === secondCreated.currentPath,
    ),
  );
  assert.ok(
    projectSources.some(
      (record) =>
        record.sourcePath === firstCreated.currentPath
        && record.canonicalSourcePath === secondCreated.currentPath,
    ),
  );

  await stopChild(bridge.child);
  bridge = await environment.start();
  const afterRestart = (await openWorkspace(bridge.baseUrl, originalPath)).body;
  assert.equal(afterRestart.projectId, opened.projectId);
  assert.equal(afterRestart.documentId, opened.documentId);
  assert.equal(afterRestart.sourcePath, secondCreated.currentPath);
  assert.equal(afterRestart.currentHtmlSha256, secondCreated.contentSha256);

  const afterSecond = (await openWorkspace(bridge.baseUrl, originalPath)).body;
  const noChangeRun = (
    await postJson(bridge.baseUrl, "/request", {
      sourcePath: originalPath,
      expectedSourceSha256: afterSecond.currentHtmlSha256,
      freezeCutoffRevision: afterSecond.runtimeState.editRevision,
      summary: "无变化不生成 V1.3",
    })
  ).body;
  assert.equal(noChangeRun.candidateDisplayVersionLabel, "版本 4");
  await writeFile(
    noChangeRun.outputPath,
    await readFile(noChangeRun.inputPath),
  );
  await runFinalizer(environment.workspace, noChangeRun);
  const noChange = (
    await requestJson(
      bridge.baseUrl,
      `/status?sourcePath=${encodeURIComponent(originalPath)}&requestId=${noChangeRun.requestId}&attemptId=${noChangeRun.attemptId}`,
    )
  ).body;
  assert.equal(noChange.status, "no-change");
  await assert.rejects(access(noChangeRun.plannedWorkingCopyPath));

  const afterNoChange = (await openWorkspace(bridge.baseUrl, originalPath)).body;
  const cancelledRun = (
    await postJson(bridge.baseUrl, "/request", {
      sourcePath: originalPath,
      expectedSourceSha256: afterNoChange.currentHtmlSha256,
      freezeCutoffRevision: afterNoChange.runtimeState.editRevision,
      summary: "取消不生成 V1.3",
    })
  ).body;
  assert.equal(cancelledRun.candidateDisplayVersionLabel, "版本 4");
  const cancelled = await postJson(bridge.baseUrl, "/active-run/cancel", {
    sourcePath: originalPath,
    requestId: cancelledRun.requestId,
    attemptId: cancelledRun.attemptId,
  });
  assert.equal(cancelled.body.status, "cancelled");
  await assert.rejects(access(cancelledRun.plannedWorkingCopyPath));
  assert.deepEqual(await readFile(originalPath), originalBytes);
  assert.deepEqual(await readFile(firstCreated.currentPath), firstWorkingBytes);
});

test("document identity survives a move and same-path replacement starts isolated history", async (t) => {
  const environment = await createEnvironment(t);
  const originalPath = join(environment.sources, "identity-original.html");
  const movedPath = join(environment.sources, "identity-moved.html");
  const initial = htmlPage(
    "稳定身份",
    '<p id="stable-document">移动文件后仍属于同一文档</p>',
  );
  await writeFile(originalPath, initial, "utf8");
  const bridge = await environment.start();

  const original = (await openWorkspace(bridge.baseUrl, originalPath)).body;
  assert.equal(await readFile(originalPath, "utf8"), initial);
  assert.equal(original.currentExactVersionId, "ver_0001");

  const registryPath = join(environment.workspace, "project-registry.json");
  const staleRegistry = JSON.parse(await readFile(registryPath, "utf8"));
  const originalFingerprint = staleRegistry.projects[original.projectId].sourceFingerprint;
  staleRegistry.sources[originalFingerprint].fileIdentity.ino = "stale-owned-write-window";
  staleRegistry.projects[original.projectId].fileIdentity.ino = "stale-owned-write-window";
  staleRegistry.documents[original.documentId].fileIdentity.ino = "stale-owned-write-window";
  await writeFile(registryPath, `${JSON.stringify(staleRegistry, null, 2)}\n`, "utf8");
  const repaired = (await openWorkspace(bridge.baseUrl, originalPath)).body;
  assert.equal(repaired.projectId, original.projectId);
  assert.equal(repaired.documentId, original.documentId);
  const repairedRegistry = JSON.parse(await readFile(registryPath, "utf8"));
  assert.notEqual(
    repairedRegistry.sources[originalFingerprint].fileIdentity.ino,
    "stale-owned-write-window",
  );

  await rename(originalPath, movedPath);
  const movedResponse = await openWorkspace(bridge.baseUrl, movedPath);
  assert.equal(movedResponse.response.status, 200);
  const moved = movedResponse.body;
  assert.equal(moved.projectId, original.projectId);
  assert.equal(moved.documentId, original.documentId);
  assert.equal(moved.latestVersionId, "ver_0001");
  assert.equal(moved.currentExactVersionId, "ver_0001");
  assert.equal(moved.versions.length, 1);
  assert.equal(moved.project.name, "identity-moved");
  const movedProject = JSON.parse(
    await readFile(
      join(
        original.projectRoot,
        "project.json",
      ),
      "utf8",
    ),
  );
  assert.equal(movedProject.sourcePath, movedPath);
  assert.equal(movedProject.name, "identity-moved");

  const replacement = htmlPage(
    "替换文件",
    '<p id="new-document">相同路径上的全新文档</p>',
  );
  const replacementPath = join(environment.sources, "identity-replacement.tmp");
  await writeFile(replacementPath, replacement, "utf8");
  await rename(replacementPath, movedPath);
  const replacementResponse = await openWorkspace(bridge.baseUrl, movedPath);
  assert.equal(replacementResponse.response.status, 200);
  const replacementWorkspace = replacementResponse.body;
  assert.notEqual(replacementWorkspace.projectId, original.projectId);
  assert.notEqual(replacementWorkspace.documentId, original.documentId);
  assert.equal(replacementWorkspace.latestVersionId, "ver_0001");
  assert.equal(replacementWorkspace.currentExactVersionId, "ver_0001");
  assert.equal(replacementWorkspace.versions.length, 1);
  assert.equal(
    await readFile(movedPath, "utf8"),
    replacement,
  );
  assert.equal(
    await readFile(
      join(
        original.projectRoot,
        "versions",
        "ver_0001",
        "files",
        "index.html",
      ),
      "utf8",
    ),
    initial,
  );
});

test("a legacy embedded document id only relinks a registry that has no file identity", async (t) => {
  const environment = await createEnvironment(t);
  const sourcePath = join(environment.sources, "legacy-sidecar-source.html");
  const movedPath = join(environment.sources, "legacy-sidecar-moved.html");
  const initial = htmlPage("旧身份兼容");
  await writeFile(sourcePath, initial, "utf8");
  const bridge = await environment.start();
  const opened = (await openWorkspace(bridge.baseUrl, sourcePath)).body;
  const legacyHtml = withDocumentIdentity(initial, opened.documentId);
  const saved = await postJson(bridge.baseUrl, "/autosave", {
    sourcePath,
    projectId: opened.projectId,
    documentId: opened.documentId,
    expectedSourceSha256: opened.currentHtmlSha256,
    editRevision: 1,
    html: legacyHtml,
  });
  assert.equal(saved.response.status, 200);
  assert.equal(await readFile(sourcePath, "utf8"), legacyHtml);

  const registryPath = join(environment.workspace, "project-registry.json");
  const registry = JSON.parse(await readFile(registryPath, "utf8"));
  const sourceRecord = Object.values(registry.sources).find(
    (record) => record.projectId === opened.projectId,
  );
  delete sourceRecord.fileIdentity;
  delete registry.projects[opened.projectId].fileIdentity;
  delete registry.documents[opened.documentId].fileIdentity;
  await writeFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`, "utf8");

  await rename(sourcePath, movedPath);
  const moved = (await openWorkspace(bridge.baseUrl, movedPath)).body;
  assert.equal(moved.projectId, opened.projectId);
  assert.equal(moved.documentId, opened.documentId);
  assert.equal(await readFile(movedPath, "utf8"), legacyHtml);
  const migratedRegistry = JSON.parse(await readFile(registryPath, "utf8"));
  assert.ok(migratedRegistry.documents[opened.documentId].fileIdentity);
});

test("configured bridge authentication protects every route and leaves CORS preflight usable", async (t) => {
  const environment = await createEnvironment(t);
  const authToken = "bridge-test-token-with-sufficient-entropy";
  const bridge = await environment.start({
    HTML_AI_BRIDGE_AUTH_TOKEN: authToken,
  });

  const missing = await requestJson(bridge.baseUrl, "/health");
  assert.equal(missing.response.status, 401);
  assert.equal(missing.body.error.code, "UNAUTHORIZED");

  const incorrect = await requestJson(bridge.baseUrl, "/health", {
    headers: { "x-html-ai-bridge-token": "wrong-token" },
  });
  assert.equal(incorrect.response.status, 401);
  assert.equal(incorrect.body.error.code, "UNAUTHORIZED");

  const authorized = await requestJson(bridge.baseUrl, "/health", {
    headers: { "x-html-ai-bridge-token": authToken },
  });
  assert.equal(authorized.response.status, 200);
  assert.equal(authorized.body.ok, true);

  const unauthorizedUnknownRoute = await requestJson(
    bridge.baseUrl,
    "/not-a-route",
  );
  assert.equal(unauthorizedUnknownRoute.response.status, 401);

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

test("autosave conflict preserves its exact candidate across restart and keep-external creates no Version", async (t) => {
  const environment = await createEnvironment(t);
  const sourcePath = join(environment.sources, "autosave-conflict.html");
  const initialHtml = htmlPage("自动保存冲突基线");
  await writeFile(sourcePath, initialHtml, "utf8");
  const firstBridge = await environment.start();
  const opened = (await openWorkspace(firstBridge.baseUrl, sourcePath)).body;

  const editorHtml = htmlPage(
    "自动保存冲突基线",
    '<p id="saved-editor-change">先完成一次正常写回</p>',
  );
  const saved = await postJson(firstBridge.baseUrl, "/autosave", {
    sourcePath,
    editRevision: 1,
    expectedSourceSha256: opened.currentHtmlSha256,
    html: editorHtml,
  });
  assert.equal(saved.response.status, 200);
  assert.equal(saved.body.versionCreated, false);

  const externalHtml = htmlPage(
    "外部修改",
    '<p id="external-wins">工作台之外修改的内容</p>',
  );
  await writeFile(sourcePath, externalHtml, "utf8");
  const candidateHtml = htmlPage(
    "编辑器恢复候选",
    '<p id="candidate-only">尚未覆盖外部文件的编辑器内容</p>',
  );
  const conflicted = await postJson(firstBridge.baseUrl, "/autosave", {
    sourcePath,
    editRevision: 2,
    expectedSourceSha256: saved.body.currentHtmlSha256,
    html: candidateHtml,
  });
  assert.equal(conflicted.response.status, 409);
  assert.equal(conflicted.body.error.code, "SOURCE_CHANGED");
  assert.equal(conflicted.body.error.details.type, "autosave-source");
  assert.equal(
    conflicted.body.error.details.expectedSourceSha256,
    saved.body.currentHtmlSha256,
  );
  assert.equal(
    conflicted.body.error.details.externalSourceSha256,
    hash(externalHtml),
  );
  assert.equal(
    conflicted.body.error.details.candidateContentSha256,
    hash(candidateHtml),
  );
  assert.equal(await readFile(sourcePath, "utf8"), externalHtml);

  const draftWhileConflicted = await postJson(firstBridge.baseUrl, "/draft", {
    sourcePath,
    projectId: opened.projectId,
    documentId: opened.documentId,
    comments: [{
      commentId: "comment_must_wait_for_conflict",
      text: "冲突解决前不能改写评论事实源。",
    }],
    changeEvents: [],
  });
  assert.equal(draftWhileConflicted.response.status, 423);
  assert.equal(draftWhileConflicted.body.error.code, "PROJECT_LOCKED");

  await stopChild(firstBridge.child);
  const restartedBridge = await environment.start();
  const reloaded = await openWorkspace(restartedBridge.baseUrl, sourcePath);
  assert.equal(reloaded.response.status, 200);
  assert.equal(
    reloaded.body.runtimeState.lifecycleState,
    "awaiting-conflict-resolution",
  );
  assert.equal(reloaded.body.runtimeState.conflict.type, "autosave-source");
  assert.equal(
    reloaded.body.runtimeState.conflict.conflictId,
    conflicted.body.error.details.conflictId,
  );
  assert.equal(reloaded.body.versions.length, 1);

  const candidate = await requestJson(
    restartedBridge.baseUrl,
    `/conflict-candidate?sourcePath=${encodeURIComponent(sourcePath)}`,
  );
  assert.equal(candidate.response.status, 200);
  assert.equal(candidate.body.conflictId, conflicted.body.error.details.conflictId);
  assert.equal(candidate.body.content, candidateHtml);
  assert.equal(candidate.body.sha256, hash(candidateHtml));
  assert.equal(candidate.body.expectedSourceSha256, saved.body.currentHtmlSha256);
  assert.equal(candidate.body.externalSourceSha256, hash(externalHtml));
  assert.equal(candidate.body.editRevision, 2);

  const kept = await postJson(restartedBridge.baseUrl, "/conflict/resolve", {
    sourcePath,
    action: "keep-external",
  });
  assert.equal(kept.response.status, 200);
  assert.equal(kept.body.status, "conflict-kept-external");
  assert.equal(kept.body.versionCreated, false);
  assert.equal(kept.body.sourceSha256, hash(externalHtml));
  assert.equal(await readFile(sourcePath, "utf8"), externalHtml);

  const afterKeep = await openWorkspace(restartedBridge.baseUrl, sourcePath);
  assert.equal(afterKeep.response.status, 200);
  assert.equal(afterKeep.body.runtimeState.lifecycleState, "editing");
  assert.equal(afterKeep.body.runtimeState.conflict, null);
  assert.equal(afterKeep.body.runtimeState.activeRun, null);
  assert.equal(afterKeep.body.versions.length, 1);
  assert.equal(afterKeep.body.latestVersionId, "ver_0001");

  const draftAfterResolution = await postJson(
    restartedBridge.baseUrl,
    "/draft",
    {
      sourcePath,
      projectId: opened.projectId,
      documentId: opened.documentId,
      expectedDraftRevision: afterKeep.body.runtimeState.draft.draftRevision,
      comments: [{
        commentId: "comment_after_conflict",
        text: "冲突解决后恢复评论写入。",
      }],
      changeEvents: [],
    },
  );
  assert.equal(draftAfterResolution.response.status, 200);
  assert.deepEqual(
    draftAfterResolution.body.activeDraft.comments.map(
      (comment) => comment.commentId,
    ),
    ["comment_after_conflict"],
  );

  const removedCandidate = await requestJson(
    restartedBridge.baseUrl,
    `/conflict-candidate?sourcePath=${encodeURIComponent(sourcePath)}`,
  );
  assert.equal(removedCandidate.response.status, 404);
  assert.equal(
    removedCandidate.body.error.code,
    "AUTOSAVE_CONFLICT_NOT_FOUND",
  );
});

test("request body is the authoritative frozen snapshot after a draft deletion", async (t) => {
  const environment = await createEnvironment(t);
  const sourcePath = join(environment.sources, "authoritative-freeze.html");
  await writeFile(sourcePath, htmlPage("精确冻结"), "utf8");
  const bridge = await environment.start();
  const opened = (await openWorkspace(bridge.baseUrl, sourcePath)).body;
  const submittedTarget = exactDocumentTarget();

  const staleDraft = await postJson(bridge.baseUrl, "/draft", {
    sourcePath,
    projectId: opened.projectId,
    documentId: opened.documentId,
    expectedDraftRevision: 0,
    comments: [
      {
        commentId: "comment_deleted_before_submit",
        text: "这条评论已在提交前删除，不能复活。",
      },
      {
        commentId: "comment_replaced",
        text: "服务端尚未收到的旧文案。",
      },
    ],
    changeEvents: [
      {
        eventId: "event_stale",
        kind: "style",
        capturedRevision: 0,
      },
    ],
  });
  assert.equal(staleDraft.response.status, 200);

  const frozen = await postJson(bridge.baseUrl, "/request", {
    sourcePath,
    projectId: opened.projectId,
    documentId: opened.documentId,
    expectedSourceSha256: opened.currentHtmlSha256,
    freezeCutoffRevision: 0,
    lastPersistedRevision: 0,
    summary: "只冻结提交瞬间仍然存在的评论。",
    comments: [
      {
        commentId: "comment_replaced",
        text: "提交瞬间的精确新文案。",
        target: submittedTarget,
      },
      {
        commentId: "comment_current",
        text: "提交瞬间新增的评论。",
        target: submittedTarget,
      },
    ],
    changeEvents: [
      {
        eventId: "event_current",
        kind: "style",
        capturedRevision: 0,
        target: submittedTarget,
      },
    ],
  });
  assert.equal(frozen.response.status, 201);

  const annotations = JSON.parse(
    await readFile(
      join(
        frozen.body.requestPath,
        "input",
        "annotations",
        "records.json",
      ),
      "utf8",
    ),
  );
  assert.deepEqual(
    annotations.comments.map((comment) => comment.commentId),
    ["comment_replaced", "comment_current"],
  );
  assert.equal(annotations.comments[0].text, "提交瞬间的精确新文案。");
  assert.deepEqual(
    annotations.editEvents.map((event) => event.eventId),
    ["edit_event_current"],
  );
  assert.equal(
    annotations.comments.some(
      (comment) => comment.commentId === "comment_deleted_before_submit",
    ),
    false,
  );
  assert.deepEqual(
    frozen.body.activeRun.frozenCommentIds,
    ["comment_replaced", "comment_current"],
  );
  assert.deepEqual(
    frozen.body.activeRun.frozenEditEventIds,
    ["edit_event_current"],
  );
});

test("comment attachments persist in the project and freeze with comment-target relationships", async (t) => {
  const environment = await createEnvironment(t);
  const sourcePath = join(environment.sources, "comment-attachments.html");
  await writeFile(sourcePath, htmlPage("评论附件"), "utf8");
  const bridge = await environment.start();
  const opened = (await openWorkspace(bridge.baseUrl, sourcePath)).body;
  const target = exactDocumentTarget();
  const imageBytes = Buffer.from("project-local-comment-image");

  const uploaded = await postJson(bridge.baseUrl, "/attachment", {
    sourcePath,
    projectId: opened.projectId,
    documentId: opened.documentId,
    commentId: "comment_attachment_flow",
    attachmentId: "attachment_reference_image",
    fileName: "参考图.png",
    mediaType: "image/png",
    byteLength: imageBytes.byteLength,
    kind: "image",
    source: "clipboard",
    dataBase64: imageBytes.toString("base64"),
  });
  assert.equal(uploaded.response.status, 201);
  assert.equal(uploaded.body.attachment.kind, "image");
  assert.match(
    uploaded.body.attachment.relativePath,
    /^draft\/attachments\/comment_attachment_flow\//,
  );

  const attachmentResponse = await fetch(
    `${bridge.baseUrl}/attachment?sourcePath=${encodeURIComponent(sourcePath)}&relativePath=${encodeURIComponent(uploaded.body.attachment.relativePath)}`,
  );
  assert.equal(attachmentResponse.status, 200);
  assert.deepEqual(
    Buffer.from(await attachmentResponse.arrayBuffer()),
    imageBytes,
  );

  const savedDraft = await postJson(bridge.baseUrl, "/draft", {
    sourcePath,
    projectId: opened.projectId,
    documentId: opened.documentId,
    expectedDraftRevision: 0,
    comments: [
      {
        commentId: "comment_attachment_flow",
        text: "请按参考图调整这个模块。",
        target,
        attachments: [uploaded.body.attachment],
      },
    ],
    changeEvents: [],
  });
  assert.equal(savedDraft.response.status, 200);
  assert.equal(
    savedDraft.body.activeDraft.comments[0].attachments[0].attachmentId,
    "attachment_reference_image",
  );

  const submitted = await postJson(bridge.baseUrl, "/request", {
    sourcePath,
    projectId: opened.projectId,
    documentId: opened.documentId,
    expectedSourceSha256: opened.currentHtmlSha256,
    freezeCutoffRevision: 0,
    lastPersistedRevision: 0,
    summary: "按评论附件修改整个页面。",
    targets: [target],
    comments: savedDraft.body.activeDraft.comments,
    changeEvents: [],
  });
  assert.equal(submitted.response.status, 201, JSON.stringify(submitted.body));

  const annotations = JSON.parse(await readFile(
    join(submitted.body.requestPath, "input", "annotations", "records.json"),
    "utf8",
  ));
  const [frozenAttachment] = annotations.comments[0].attachments;
  assert.equal(frozenAttachment.attachmentId, "attachment_reference_image");
  assert.equal(frozenAttachment.source, "clipboard");
  assert.match(
    frozenAttachment.relativePath,
    new RegExp(`^requests/${submitted.body.requestId}/input/attachments/`),
  );
  assert.match(frozenAttachment.requestRelativePath, /^input\/attachments\//);
  assert.deepEqual(
    await readFile(join(submitted.body.requestPath, frozenAttachment.requestRelativePath)),
    imageBytes,
  );

  const changeRequest = JSON.parse(await readFile(
    join(submitted.body.requestPath, "change-request.json"),
    "utf8",
  ));
  const [requestAttachment] = changeRequest.requirements.attachments;
  assert.equal(requestAttachment.commentId, "comment_attachment_flow");
  assert.equal(requestAttachment.targetRef, "target_document");
  assert.equal(
    requestAttachment.localPath,
    join(submitted.body.requestPath, frozenAttachment.requestRelativePath),
  );
  assert.equal(
    await readFile(requestAttachment.localPath, "utf8"),
    imageBytes.toString("utf8"),
  );
  assert.deepEqual(
    changeRequest.requirements.instructions[0].attachmentRefs,
    ["attachment_reference_image"],
  );
  assert.equal(changeRequest.annotations.attachmentCount, 1);

  const inputManifest = JSON.parse(await readFile(
    join(submitted.body.requestPath, "input-manifest.json"),
    "utf8",
  ));
  assert.equal(
    inputManifest.readOrder.includes("input/annotations/records.json"),
    false,
  );
  assert.ok(inputManifest.files.some((file) => (
    file.path === "input/annotations/records.json"
    && file.role === "annotations"
  )));
  assert.ok(inputManifest.readOrder.includes(frozenAttachment.requestRelativePath));
  assert.ok(inputManifest.files.some((file) => (
    file.path === frozenAttachment.requestRelativePath
    && file.role === "reference"
    && file.mediaType === "image/png"
  )));
  const prompt = await readFile(
    join(submitted.body.requestPath, "PROMPT.md"),
    "utf8",
  );
  assert.doesNotMatch(prompt, /input\/annotations\/records\.json/);
  assert.match(prompt, /change-request\.json 已包含完整的评论、目标和附件关系/);
  assert.match(prompt, /本轮附件/);
  assert.match(prompt, /目标版本：\*\*版本 2\*\*/);
  assert.match(prompt, /严格按 input-manifest\.json 的 readOrder/);
  assert.match(prompt, /不要扫描其他任务、版本或项目/);
  assert.match(prompt, /只修改用户明确指定的区域/);
  assert.match(prompt, /只把一个完整 HTML 写入当前 Attempt 的 output\/index\.html/);
  assert.match(prompt, /不得直接编辑 USER_SUPPLEMENT\.json、PROJECT\.md、冻结输入或其他协议文件/);
  assert.match(prompt, new RegExp(requestAttachment.localPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(prompt, /dataBase64|project-local-comment-image/);
  const aiRules = await readFile(
    join(submitted.body.requestPath, "input", "AI_RULES.md"),
    "utf8",
  );
  assert.match(aiRules, /^# PageRoot 通用执行规则$/m);
  assert.match(aiRules, /严格按 input-manifest\.json 的 readOrder 读取冻结输入/);
  assert.match(
    aiRules,
    /本轮有效要求由 change-request\.json 中的冻结要求，以及当前 Attempt 的 USER_SUPPLEMENT\.json/,
  );
  assert.match(aiRules, /不得扫描其他 Request、Attempt、Version、项目目录或用户文件/);
  assert.match(aiRules, /只修改用户明确指定的区域/);
  assert.match(aiRules, /不得修改 PROJECT\.md、冻结输入或协议文件/);

  await rm(join(
    opened.projectRoot,
    ...uploaded.body.attachment.relativePath.split("/"),
  ));
  assert.deepEqual(
    await readFile(requestAttachment.localPath),
    imageBytes,
    "the immutable Request snapshot must survive draft cleanup",
  );
});

test("request creation rejects a project attachment changed after selection", async (t) => {
  const environment = await createEnvironment(t);
  const sourcePath = join(environment.sources, "changed-comment-attachment.html");
  await writeFile(sourcePath, htmlPage("附件变更"), "utf8");
  const bridge = await environment.start();
  const opened = (await openWorkspace(bridge.baseUrl, sourcePath)).body;
  const target = exactDocumentTarget();
  const originalBytes = Buffer.from("original-attachment");

  const uploaded = await postJson(bridge.baseUrl, "/attachment", {
    sourcePath,
    projectId: opened.projectId,
    documentId: opened.documentId,
    commentId: "comment_changed_attachment",
    attachmentId: "attachment_changed_after_selection",
    fileName: "参考资料.txt",
    mediaType: "text/plain",
    byteLength: originalBytes.byteLength,
    kind: "file",
    source: "file-picker",
    dataBase64: originalBytes.toString("base64"),
  });
  assert.equal(uploaded.response.status, 201);

  const draftAttachmentPath = join(
    opened.projectRoot,
    ...uploaded.body.attachment.relativePath.split("/"),
  );
  await writeFile(draftAttachmentPath, "changed-after-selection", "utf8");

  const submitted = await postJson(bridge.baseUrl, "/request", {
    sourcePath,
    projectId: opened.projectId,
    documentId: opened.documentId,
    expectedSourceSha256: opened.currentHtmlSha256,
    freezeCutoffRevision: 0,
    lastPersistedRevision: 0,
    summary: "不能使用已变更的附件。",
    targets: [target],
    comments: [
      {
        commentId: "comment_changed_attachment",
        text: "请读取附件。",
        target,
        attachments: [uploaded.body.attachment],
      },
    ],
    changeEvents: [],
  });
  assert.equal(submitted.response.status, 409);
  assert.equal(submitted.body.error.code, "ATTACHMENT_CHANGED");
  assert.equal(
    (await openWorkspace(bridge.baseUrl, sourcePath)).body.activeRun,
    null,
  );
});

test("read-only file inspector exposes only runtime, audit, and request artifacts", async (t) => {
  const environment = await createEnvironment(t);
  const sourcePath = join(environment.sources, "file-inspector.html");
  await writeFile(sourcePath, htmlPage("只读检查器"), "utf8");
  const bridge = await environment.start();
  const opened = (await openWorkspace(bridge.baseUrl, sourcePath)).body;

  const saved = await postJson(bridge.baseUrl, "/autosave", {
    sourcePath,
    editRevision: 1,
    expectedSourceSha256: opened.currentHtmlSha256,
    html: htmlPage(
      "只读检查器",
      '<p id="audited">生成一条可检查的编辑审计记录</p>',
    ),
    changeEvents: [
      {
        eventId: "inspectable_audit_event",
        kind: "text",
        summary: "验证只读文件检查器",
      },
    ],
  });
  assert.equal(saved.response.status, 200);

  const run = (
    await postJson(bridge.baseUrl, "/request", {
      sourcePath,
      expectedSourceSha256: saved.body.currentHtmlSha256,
      freezeCutoffRevision: 1,
      summary: "生成可检查的请求文件",
      instructions: ["只用于验证只读检查，不提交新版本。"],
    })
  ).body;

  const inspect = (relativePath) =>
    requestJson(
      bridge.baseUrl,
      `/file?sourcePath=${encodeURIComponent(sourcePath)}&path=${encodeURIComponent(relativePath)}`,
    );
  const readableArtifacts = [
    "runtime-state.json",
    "edit-audit.jsonl",
    `requests/${run.requestId}/PROMPT.md`,
    `requests/${run.requestId}/change-request.json`,
    `requests/${run.requestId}/input-manifest.json`,
    `requests/${run.requestId}/input/AI_RULES.md`,
  ];
  for (const relativePath of readableArtifacts) {
    const inspected = await inspect(relativePath);
    assert.equal(inspected.response.status, 200, relativePath);
    assert.equal(inspected.body.relativePath, relativePath);
    assert.equal(inspected.body.readOnly, true);
    assert.equal(inspected.body.sha256, hash(inspected.body.content));
  }

  const runtime = await inspect("runtime-state.json");
  const runtimeState = JSON.parse(runtime.body.content);
  assert.equal(runtimeState.activeRun.requestId, run.requestId);
  assert.equal(runtimeState.lifecycleState, "processing");

  const audit = await inspect("edit-audit.jsonl");
  assert.match(audit.body.content, /inspectable_audit_event/);
  const prompt = await inspect(`requests/${run.requestId}/PROMPT.md`);
  assert.match(prompt.body.content, new RegExp(run.requestId));
  const changeRequest = await inspect(
    `requests/${run.requestId}/change-request.json`,
  );
  assert.equal(JSON.parse(changeRequest.body.content).requestId, run.requestId);

  const traversal = await inspect("../runtime-state.json");
  assert.equal(traversal.response.status, 403);
  assert.equal(
    traversal.body.error.code,
    "PROJECT_FILE_NOT_INSPECTABLE",
  );
  const absoluteTraversal = await inspect("/etc/passwd");
  assert.equal(absoluteTraversal.response.status, 403);
  assert.equal(
    absoluteTraversal.body.error.code,
    "PROJECT_FILE_NOT_INSPECTABLE",
  );
  const unsupportedProjectFile = await inspect("project.json");
  assert.equal(unsupportedProjectFile.response.status, 403);
  assert.equal(
    unsupportedProjectFile.body.error.code,
    "PROJECT_FILE_NOT_INSPECTABLE",
  );
  const unsupportedAttemptOutput = await inspect(
    `requests/${run.requestId}/attempts/${run.attemptId}/output/index.html`,
  );
  assert.equal(unsupportedAttemptOutput.response.status, 403);
  assert.equal(
    unsupportedAttemptOutput.body.error.code,
    "PROJECT_FILE_NOT_INSPECTABLE",
  );

  await postJson(bridge.baseUrl, "/active-run/cancel", {
    sourcePath,
    requestId: run.requestId,
    attemptId: run.attemptId,
  });
});

test("mandatory finalizer controls completion, identity, no-change, and cancellation", async (t) => {
  const environment = await createEnvironment(t);
  const sourcePath = join(environment.sources, "finalizer.html");
  await writeFile(sourcePath, htmlPage("最终化"), "utf8");
  const bridge = await environment.start();
  const opened = (await openWorkspace(bridge.baseUrl, sourcePath)).body;
  const originalSource = await readFile(sourcePath, "utf8");
  const originalSourceSha256 = hash(originalSource);

  const run = (
    await postJson(bridge.baseUrl, "/request", {
      sourcePath,
      expectedSourceSha256: opened.currentHtmlSha256,
      freezeCutoffRevision: 0,
      summary: "生成真正的 V2",
      instructions: ["增加一段结论。"],
    })
  ).body;
  assert.equal(run.candidateVersionId, "ver_0002");
  assert.equal(run.candidateVersionLabel, "V2");
  assert.equal(run.previousVersionId, "ver_0001");
  assert.equal(run.basedOnVersionId, "ver_0001");
  assert.equal(run.activeRun.status, "processing");
  assert.match(await readFile(run.promptPath, "utf8"), /finalize-attempt\.mjs/);
  await writeFile(
    run.outputPath,
    htmlPage("最终化", '<section id="ai-result">AI 完成的内容</section>'),
    "utf8",
  );
  await writeFile(join(run.attemptPath, ".DS_Store"), "Finder metadata");
  await writeFile(
    join(dirname(run.outputPath), ".DS_Store"),
    "Finder metadata",
  );

  for (let index = 0; index < 2; index += 1) {
    await delay(120);
    const waiting = await requestJson(
      bridge.baseUrl,
      `/status?sourcePath=${encodeURIComponent(sourcePath)}&requestId=${run.requestId}&attemptId=${run.attemptId}`,
    );
    assert.equal(waiting.response.status, 200);
    assert.equal(waiting.body.status, "waiting");
    assert.equal(
      waiting.body.waitingReason,
      "awaiting-mandatory-completion",
    );
  }
  assert.equal((await openWorkspace(bridge.baseUrl, sourcePath)).body.versions.length, 1);

  const frozenPrompt = await readFile(run.promptPath, "utf8");
  await writeFile(run.promptPath, `${frozenPrompt}\n被篡改\n`, "utf8");
  await assert.rejects(
    runFinalizer(environment.workspace, run),
    /FROZEN_INPUT_HASH_MISMATCH|no longer matches input-manifest/,
  );
  await writeFile(run.promptPath, frozenPrompt, "utf8");
  await runFinalizer(environment.workspace, run);
  await access(run.completionPath);
  const completionEvidence = JSON.parse(
    await readFile(run.completionPath, "utf8"),
  );
  await delay(20);
  const ready = await requestJson(
    bridge.baseUrl,
    `/status?sourcePath=${encodeURIComponent(sourcePath)}&requestId=${run.requestId}&attemptId=${run.attemptId}`,
  );
  assert.equal(ready.response.status, 200);
  assert.equal(ready.body.status, "ready-to-open");
  assert.equal(ready.body.versionId, "ver_0002");
  assert.equal(ready.body.currentPath, sourcePath);
  assert.notEqual(ready.body.workingCopyPath, sourcePath);
  assert.notEqual(ready.body.contentSha256, ready.body.sourceSha256);
  assert.equal(
    ready.body.completion.completedAt,
    completionEvidence.completedAt,
  );
  assert.equal(hash(await readFile(sourcePath, "utf8")), originalSourceSha256);
  assert.equal(await readFile(sourcePath, "utf8"), originalSource);
  const activated = await activateReadyVersion(bridge.baseUrl, ready.body);
  const created = {
    response: ready.response,
    body: { ...ready.body, ...activated },
  };
  assert.notEqual(created.body.currentPath, sourcePath);
  assert.match(created.body.currentPath, /\/working\/finalizer-V1\.1\.html$/);
  assert.equal(created.body.contentSha256, created.body.sourceSha256);
  assert.match(
    await readFile(created.body.currentPath, "utf8"),
    /html-ai-version-id/,
  );
  assert.match(
    await readFile(created.body.currentPath, "utf8"),
    /content="ver_0002"/,
  );
  const projectRoot = projectRootFromRun(run);
  const attemptRoot = join(
    projectRoot,
    "requests",
    run.requestId,
    "attempts",
    run.attemptId,
  );
  const archivedAnnotations = await readFile(
    join(attemptRoot, "annotations.json"),
  );
  const archivedOutcome = JSON.parse(
    await readFile(join(attemptRoot, "outcome.json"), "utf8"),
  );
  const manifest = JSON.parse(
    await readFile(
      join(projectRoot, "versions", "ver_0002", "version.json"),
      "utf8",
    ),
  );
  const committed = JSON.parse(
    await readFile(
      join(projectRoot, "versions", "ver_0002", "committed.json"),
      "utf8",
    ),
  );
  const transaction = JSON.parse(
    await readFile(
      join(
        projectRoot,
        "transactions",
        `txn_${run.requestId}_${run.attemptId}`,
        "transaction.json",
      ),
      "utf8",
    ),
  );
  assert.equal(archivedOutcome.status, "version-created");
  assert.equal(created.body.version.generatedAt, manifest.generatedAt);
  assert.equal(created.body.committedAt, committed.committedAt);
  assert.equal(archivedOutcome.committedAt, committed.committedAt);
  assert.ok(
    Date.parse(completionEvidence.completedAt)
      <= Date.parse(manifest.generatedAt),
  );
  assert.equal(manifest.generatedAt, committed.committedAt);
  assert.equal(transaction.versionGeneratedAt, committed.committedAt);
  assert.equal(manifest.inputManifestSha256, run.activeRun.inputManifestSha256);
  assert.equal(manifest.annotationArchive.sha256, hash(archivedAnnotations));
  assert.equal(committed.manifestSha256, hash(
    await readFile(
      join(projectRoot, "versions", "ver_0002", "version.json"),
    ),
  ));
  assert.equal(transaction.state, "cache-rebuilt");
  assert.equal(
    transaction.baseSnapshotSha256,
    run.activeRun.baseSnapshotSha256,
  );
  assert.equal(
    transaction.candidateContentSha256,
    created.body.contentSha256,
  );
  const exactV2 = await requestJson(
    bridge.baseUrl,
    `/version-file?sourcePath=${encodeURIComponent(sourcePath)}&versionId=ver_0002`,
  );
  assert.equal(exactV2.body.sha256, created.body.contentSha256);
  assert.equal(
    exactV2.body.content,
    await readFile(created.body.currentPath, "utf8"),
  );
  const committedSource = await readFile(created.body.currentPath, "utf8");
  await writeFile(
    run.outputPath,
    htmlPage("完成后篡改", "<p>不得静默改变已提交 V2</p>"),
    "utf8",
  );
  const mutationDetected = await requestJson(
    bridge.baseUrl,
    `/status?sourcePath=${encodeURIComponent(sourcePath)}&requestId=${run.requestId}&attemptId=${run.attemptId}`,
  );
  assert.equal(
    mutationDetected.body.protocolViolation.code,
    "OUTPUT_MUTATED_AFTER_FINALIZATION",
  );
  assert.equal(
    await readFile(created.body.currentPath, "utf8"),
    committedSource,
  );
  assert.equal(hash(await readFile(sourcePath, "utf8")), originalSourceSha256);
  assert.equal(
    (
      await requestJson(
        bridge.baseUrl,
        `/version-file?sourcePath=${encodeURIComponent(sourcePath)}&versionId=ver_0002`,
      )
    ).body.content,
    committedSource,
  );

  const afterV2 = (await openWorkspace(bridge.baseUrl, sourcePath)).body;
  const restoreUnavailable = await postJson(bridge.baseUrl, "/restore", {
    projectId: afterV2.projectId,
    documentId: afterV2.documentId,
    sourcePath,
    versionId: "ver_0001",
    expectedSourceSha256: afterV2.currentHtmlSha256,
  });
  assert.equal(restoreUnavailable.response.status, 404);
  assert.equal(restoreUnavailable.body.error.code, "NOT_FOUND");
  assert.equal(hash(await readFile(sourcePath, "utf8")), originalSourceSha256);

  const invalidIdentityRun = (
    await postJson(bridge.baseUrl, "/request", {
      sourcePath,
      expectedSourceSha256: afterV2.currentHtmlSha256,
      freezeCutoffRevision: afterV2.runtimeState.editRevision,
      summary: "身份错误必须被拒绝",
    })
  ).body;
  await writeFile(
    invalidIdentityRun.outputPath,
    htmlPage("身份错误", "<p>候选内容</p>"),
    "utf8",
  );
  await assert.rejects(
    runFinalizer(environment.workspace, invalidIdentityRun, {
      requestId: "req_9999",
    }),
  );
  await runFinalizer(environment.workspace, invalidIdentityRun);
  const tamperedCompletion = JSON.parse(
    await readFile(invalidIdentityRun.completionPath, "utf8"),
  );
  tamperedCompletion.candidateVersionId = "ver_9999";
  await writeFile(
    invalidIdentityRun.completionPath,
    `${JSON.stringify(tamperedCompletion, null, 2)}\n`,
    "utf8",
  );
  const rejectedIdentity = await requestJson(
    bridge.baseUrl,
    `/status?sourcePath=${encodeURIComponent(sourcePath)}&requestId=${invalidIdentityRun.requestId}&attemptId=${invalidIdentityRun.attemptId}`,
  );
  assert.equal(rejectedIdentity.response.status, 200);
  assert.equal(rejectedIdentity.body.status, "error");
  assert.equal(
    rejectedIdentity.body.error.code,
    "COMPLETION_IDENTITY_MISMATCH",
  );

  const beforeNoChange = (await openWorkspace(bridge.baseUrl, sourcePath)).body;
  const noChangeRun = (
    await postJson(bridge.baseUrl, "/request", {
      sourcePath,
      expectedSourceSha256: beforeNoChange.currentHtmlSha256,
      freezeCutoffRevision: beforeNoChange.runtimeState.editRevision,
      summary: "只改变工作台身份元数据不应建版",
    })
  ).body;
  assert.equal(noChangeRun.candidateVersionId, "ver_0003");
  await writeFile(
    noChangeRun.outputPath,
    await readFile(noChangeRun.inputPath, "utf8"),
    "utf8",
  );
  await runFinalizer(environment.workspace, noChangeRun);
  const noChange = await requestJson(
    bridge.baseUrl,
    `/status?sourcePath=${encodeURIComponent(sourcePath)}&requestId=${noChangeRun.requestId}&attemptId=${noChangeRun.attemptId}`,
  );
  assert.equal(noChange.response.status, 200);
  assert.equal(noChange.body.status, "no-change");
  const afterNoChange = (await openWorkspace(bridge.baseUrl, sourcePath)).body;
  assert.equal(afterNoChange.versions.length, 2);

  const cancelledRun = (
    await postJson(bridge.baseUrl, "/request", {
      sourcePath,
      expectedSourceSha256: afterNoChange.currentHtmlSha256,
      freezeCutoffRevision: afterNoChange.runtimeState.editRevision,
      summary: "候选 V3 可复用且取消后迟到完成无效",
    })
  ).body;
  assert.equal(cancelledRun.candidateVersionId, "ver_0003");
  await writeFile(
    cancelledRun.outputPath,
    htmlPage("迟到结果", "<p>不得建版</p>"),
    "utf8",
  );
  const cancelled = await postJson(
    bridge.baseUrl,
    "/active-run/cancel",
    {
      sourcePath,
      requestId: cancelledRun.requestId,
      attemptId: cancelledRun.attemptId,
    },
  );
  assert.equal(cancelled.body.status, "cancelled");
  await assert.rejects(runFinalizer(environment.workspace, cancelledRun));
  assert.equal((await openWorkspace(bridge.baseUrl, sourcePath)).body.versions.length, 2);
});

test("Bridge enforces the complete completion.v1 runtime contract before committing", async (t) => {
  const environment = await createEnvironment(t);
  const sourcePath = join(environment.sources, "strict-completion.html");
  await writeFile(sourcePath, htmlPage("严格完成信号"), "utf8");
  const bridge = await environment.start();
  const malformedCases = [
    {
      label: "unknown field",
      mutate(completion) {
        completion.handwritten = true;
      },
    },
    {
      label: "missing completedAt",
      mutate(completion) {
        delete completion.completedAt;
      },
    },
    {
      label: "invalid completedAt",
      mutate(completion) {
        completion.completedAt = "2026-02-30T25:61:61Z";
      },
    },
    {
      label: "invalid enum",
      mutate(completion) {
        completion.status = "looks-complete";
      },
    },
    {
      label: "invalid integer type",
      mutate(completion) {
        completion.candidateVersionOrdinal = "2";
      },
    },
    {
      label: "invalid sha256",
      mutate(completion) {
        completion.outputSha256 = "sha256:not-a-valid-digest";
      },
    },
  ];

  for (const [index, malformedCase] of malformedCases.entries()) {
    const current = (await openWorkspace(bridge.baseUrl, sourcePath)).body;
    const run = (
      await postJson(bridge.baseUrl, "/request", {
        sourcePath,
        expectedSourceSha256: current.currentHtmlSha256,
        freezeCutoffRevision: current.runtimeState.editRevision,
        summary: `拒绝 ${malformedCase.label}`,
      })
    ).body;
    await writeFile(
      run.outputPath,
      htmlPage(
        `非法完成信号 ${index + 1}`,
        `<p>case: ${malformedCase.label}</p>`,
      ),
      "utf8",
    );
    await runFinalizer(environment.workspace, run);
    const completion = JSON.parse(
      await readFile(run.completionPath, "utf8"),
    );
    malformedCase.mutate(completion);
    await writeFile(
      run.completionPath,
      `${JSON.stringify(completion, null, 2)}\n`,
      "utf8",
    );

    const rejected = await requestJson(
      bridge.baseUrl,
      `/status?sourcePath=${encodeURIComponent(sourcePath)}&requestId=${run.requestId}&attemptId=${run.attemptId}`,
    );
    assert.equal(rejected.response.status, 200, malformedCase.label);
    assert.equal(rejected.body.status, "error", malformedCase.label);
    assert.equal(rejected.body.completionObserved, true, malformedCase.label);
    assert.equal(
      rejected.body.error.code,
      "COMPLETION_SCHEMA_INVALID",
      malformedCase.label,
    );
    assert.equal(
      rejected.body.protocolViolation.code,
      "COMPLETION_SCHEMA_INVALID",
      malformedCase.label,
    );
    assert.equal(
      (await openWorkspace(bridge.baseUrl, sourcePath)).body.versions.length,
      1,
      `${malformedCase.label} must not create a Version`,
    );
  }

  const current = (await openWorkspace(bridge.baseUrl, sourcePath)).body;
  const validRun = (
    await postJson(bridge.baseUrl, "/request", {
      sourcePath,
      expectedSourceSha256: current.currentHtmlSha256,
      freezeCutoffRevision: current.runtimeState.editRevision,
      summary: "严格完成信号通过后创建 V2",
    })
  ).body;
  await writeFile(
    validRun.outputPath,
    htmlPage("严格完成信号 V2", "<p>由官方 finalizer 完成。</p>"),
    "utf8",
  );
  await runFinalizer(environment.workspace, validRun);
  const accepted = await requestJson(
    bridge.baseUrl,
    `/status?sourcePath=${encodeURIComponent(sourcePath)}&requestId=${validRun.requestId}&attemptId=${validRun.attemptId}`,
  );
  assert.equal(accepted.response.status, 200);
  assert.equal(accepted.body.status, "ready-to-open");
  assert.equal(accepted.body.versionId, "ver_0002");
  assert.equal((await openWorkspace(bridge.baseUrl, sourcePath)).body.versions.length, 2);
});

test("external changes become persistent conflicts with keep-external and adopt-ai outcomes", async (t) => {
  const environment = await createEnvironment(t);
  const sourcePath = join(environment.sources, "conflict.html");
  await writeFile(sourcePath, htmlPage("冲突基线"), "utf8");
  const bridge = await environment.start();
  const opened = (await openWorkspace(bridge.baseUrl, sourcePath)).body;

  const firstRun = (
    await postJson(bridge.baseUrl, "/request", {
      sourcePath,
      expectedSourceSha256: opened.currentHtmlSha256,
      freezeCutoffRevision: 0,
      summary: "第一轮冲突保留外部内容",
    })
  ).body;
  await writeFile(
    firstRun.outputPath,
    htmlPage("AI 候选一", "<p>AI candidate one</p>"),
    "utf8",
  );
  await runFinalizer(environment.workspace, firstRun);
  const externalOne = htmlPage("外部内容一", "<p>external one</p>");
  await writeFile(sourcePath, externalOne, "utf8");
  const conflictedOne = await requestJson(
    bridge.baseUrl,
    `/status?sourcePath=${encodeURIComponent(sourcePath)}&requestId=${firstRun.requestId}&attemptId=${firstRun.attemptId}`,
  );
  assert.equal(conflictedOne.body.status, "awaiting-conflict-resolution");
  assert.equal(
    conflictedOne.body.conflict.externalSourceSha256,
    hash(externalOne),
  );
  const persistedConflict = (await openWorkspace(bridge.baseUrl, sourcePath)).body;
  assert.equal(
    persistedConflict.runtimeState.lifecycleState,
    "awaiting-conflict-resolution",
  );
  const kept = await postJson(bridge.baseUrl, "/conflict/resolve", {
    sourcePath,
    action: "keep-external",
  });
  assert.equal(kept.body.status, "conflict-kept-external");
  assert.equal(kept.body.versionCreated, false);
  assert.equal(await readFile(sourcePath, "utf8"), externalOne);
  assert.equal((await openWorkspace(bridge.baseUrl, sourcePath)).body.versions.length, 1);

  const afterKeep = (await openWorkspace(bridge.baseUrl, sourcePath)).body;
  const secondRun = (
    await postJson(bridge.baseUrl, "/request", {
      sourcePath,
      expectedSourceSha256: afterKeep.currentHtmlSha256,
      freezeCutoffRevision: afterKeep.runtimeState.editRevision,
      summary: "第二轮明确采用 AI",
    })
  ).body;
  assert.equal(secondRun.candidateVersionId, "ver_0002");
  const aiCandidateTwo = htmlPage("AI 候选二", "<p>AI candidate two</p>");
  await writeFile(secondRun.outputPath, aiCandidateTwo, "utf8");
  await runFinalizer(environment.workspace, secondRun);
  const externalTwo = htmlPage("外部内容二", "<p>external two</p>");
  await writeFile(sourcePath, externalTwo, "utf8");
  const conflictedTwo = await requestJson(
    bridge.baseUrl,
    `/status?sourcePath=${encodeURIComponent(sourcePath)}&requestId=${secondRun.requestId}&attemptId=${secondRun.attemptId}`,
  );
  assert.equal(conflictedTwo.body.status, "awaiting-conflict-resolution");
  const secondTransactionRoot = join(
    projectRootFromRun(secondRun),
    "transactions",
    `txn_${secondRun.requestId}_${secondRun.attemptId}`,
  );
  const provisionalManifest = JSON.parse(
    await readFile(
      join(secondTransactionRoot, "prepared-version", "version.json"),
      "utf8",
    ),
  );
  await delay(30);
  const adopted = await postJson(bridge.baseUrl, "/conflict/resolve", {
    sourcePath,
    action: "adopt-ai",
    confirmedSourceSha256: hash(externalTwo),
  });
  assert.equal(
    adopted.response.status,
    200,
    JSON.stringify(adopted.body),
  );
  assert.equal(adopted.body.status, "ready-to-open");
  assert.equal(adopted.body.versionId, "ver_0002");
  assert.equal(await readFile(sourcePath, "utf8"), externalTwo);
  assert.equal(adopted.body.currentPath, sourcePath);
  const adoptedVersion = await activateReadyVersion(
    bridge.baseUrl,
    adopted.body,
  );
  assert.match(
    await readFile(adoptedVersion.currentPath, "utf8"),
    /AI candidate two/,
  );
  const committedManifest = JSON.parse(
    await readFile(
      join(
        projectRootFromRun(secondRun),
        "versions",
        "ver_0002",
        "version.json",
      ),
      "utf8",
    ),
  );
  const committedMarker = JSON.parse(
    await readFile(
      join(
        projectRootFromRun(secondRun),
        "versions",
        "ver_0002",
        "committed.json",
      ),
      "utf8",
    ),
  );
  const committedTransaction = JSON.parse(
    await readFile(
      join(secondTransactionRoot, "transaction.json"),
      "utf8",
    ),
  );
  assert.notEqual(
    committedManifest.generatedAt,
    provisionalManifest.generatedAt,
  );
  assert.equal(
    committedManifest.generatedAt,
    committedMarker.committedAt,
  );
  assert.equal(
    committedTransaction.versionGeneratedAt,
    committedMarker.committedAt,
  );
  const afterAdopt = (await openWorkspace(bridge.baseUrl, sourcePath)).body;
  assert.equal(afterAdopt.versions.length, 2);
  assert.equal(afterAdopt.latestVersionId, "ver_0002");
  assert.equal(afterAdopt.currentExactVersionId, "ver_0002");
});

test("AI conflict candidate and both hashes survive restart for read-only comparison", async (t) => {
  const environment = await createEnvironment(t);
  const sourcePath = join(environment.sources, "ai-conflict-candidate.html");
  await writeFile(sourcePath, htmlPage("AI 冲突候选"), "utf8");
  const firstBridge = await environment.start();
  const opened = (await openWorkspace(firstBridge.baseUrl, sourcePath)).body;
  const run = (
    await postJson(firstBridge.baseUrl, "/request", {
      sourcePath,
      expectedSourceSha256: opened.currentHtmlSha256,
      freezeCutoffRevision: 0,
      summary: "生成可比较的 AI 冲突候选",
    })
  ).body;
  await writeFile(
    run.outputPath,
    htmlPage("AI 冲突候选", '<p id="candidate">候选内容</p>'),
  );
  await runFinalizer(environment.workspace, run);
  const candidateContent = await readFile(run.outputPath, "utf8");
  const candidateOutputSha256 = hash(candidateContent);
  const externalContent = htmlPage(
    "外部冲突",
    '<p id="external">外部内容</p>',
  );
  await writeFile(sourcePath, externalContent);
  const externalSourceSha256 = hash(externalContent);

  const conflicted = await requestJson(
    firstBridge.baseUrl,
    `/status?sourcePath=${encodeURIComponent(sourcePath)}&requestId=${run.requestId}&attemptId=${run.attemptId}`,
  );
  assert.equal(conflicted.body.status, "awaiting-conflict-resolution");
  assert.equal(
    conflicted.body.conflict.candidateOutputSha256,
    candidateOutputSha256,
  );
  assert.equal(
    conflicted.body.conflict.externalSourceSha256,
    externalSourceSha256,
  );
  const candidateBeforeRestart = await requestJson(
    firstBridge.baseUrl,
    `/conflict-candidate?sourcePath=${encodeURIComponent(sourcePath)}`,
  );
  assert.equal(candidateBeforeRestart.response.status, 200);
  assert.equal(candidateBeforeRestart.body.type, "ai-source");
  assert.equal(candidateBeforeRestart.body.projectId, opened.projectId);
  assert.equal(candidateBeforeRestart.body.documentId, opened.documentId);
  assert.equal(candidateBeforeRestart.body.requestId, run.requestId);
  assert.equal(candidateBeforeRestart.body.attemptId, run.attemptId);
  assert.equal(
    candidateBeforeRestart.body.candidateVersionId,
    run.candidateVersionId,
  );
  assert.equal(
    candidateBeforeRestart.body.candidateOutputSha256,
    candidateOutputSha256,
  );
  assert.equal(
    candidateBeforeRestart.body.externalSourceSha256,
    externalSourceSha256,
  );
  assert.equal(candidateBeforeRestart.body.content, candidateContent);
  assert.equal(candidateBeforeRestart.body.sha256, candidateOutputSha256);

  await stopChild(firstBridge.child);
  const restarted = await environment.start();
  const restoredWorkspace = (
    await openWorkspace(restarted.baseUrl, sourcePath)
  ).body;
  assert.equal(
    restoredWorkspace.runtimeState.lifecycleState,
    "awaiting-conflict-resolution",
  );
  assert.equal(
    restoredWorkspace.runtimeState.conflict.candidateOutputSha256,
    candidateOutputSha256,
  );
  assert.equal(
    restoredWorkspace.runtimeState.conflict.externalSourceSha256,
    externalSourceSha256,
  );
  const restoredStatus = await requestJson(
    restarted.baseUrl,
    `/status?sourcePath=${encodeURIComponent(sourcePath)}&requestId=${run.requestId}&attemptId=${run.attemptId}`,
  );
  assert.equal(restoredStatus.body.status, "awaiting-conflict-resolution");
  assert.equal(
    restoredStatus.body.conflict.candidateOutputSha256,
    candidateOutputSha256,
  );
  assert.equal(
    restoredStatus.body.conflict.externalSourceSha256,
    externalSourceSha256,
  );
  const candidateAfterRestart = await requestJson(
    restarted.baseUrl,
    `/conflict-candidate?sourcePath=${encodeURIComponent(sourcePath)}`,
  );
  assert.equal(candidateAfterRestart.response.status, 200);
  assert.equal(candidateAfterRestart.body.content, candidateContent);
  assert.equal(candidateAfterRestart.body.sha256, candidateOutputSha256);

  const kept = await postJson(restarted.baseUrl, "/conflict/resolve", {
    sourcePath,
    action: "keep-external",
  });
  assert.equal(kept.body.status, "conflict-kept-external");
  assert.equal(await readFile(sourcePath, "utf8"), externalContent);
});

test("source-applied transaction is recovered on bridge restart", async (t) => {
  const environment = await createEnvironment(t);
  const sourcePath = join(environment.sources, "recovery.html");
  await writeFile(sourcePath, htmlPage("事务恢复"), "utf8");
  const firstBridge = await environment.start({
    HTML_AI_FAILPOINT: "after-source-applied",
  });
  const opened = (await openWorkspace(firstBridge.baseUrl, sourcePath)).body;
  const run = (
    await postJson(firstBridge.baseUrl, "/request", {
      sourcePath,
      expectedSourceSha256: opened.currentHtmlSha256,
      freezeCutoffRevision: 0,
      summary: "在 source-applied 后模拟崩溃",
    })
  ).body;
  await writeFile(
    run.outputPath,
    htmlPage("事务恢复", "<p id=\"recovered\">恢复同一 V2</p>"),
    "utf8",
  );
  await runFinalizer(environment.workspace, run);
  const failedAtBoundary = await requestJson(
    firstBridge.baseUrl,
    `/status?sourcePath=${encodeURIComponent(sourcePath)}&requestId=${run.requestId}&attemptId=${run.attemptId}`,
  );
  assert.equal(failedAtBoundary.response.status, 500);
  assert.doesNotMatch(await readFile(sourcePath, "utf8"), /recovered/);
  assert.match(
    await readFile(run.plannedWorkingCopyPath, "utf8"),
    /recovered/,
  );
  await stopChild(firstBridge.child);

  const secondBridge = await environment.start();
  const recoveredStatus = await requestJson(
    secondBridge.baseUrl,
    `/status?sourcePath=${encodeURIComponent(sourcePath)}&requestId=${run.requestId}&attemptId=${run.attemptId}`,
  );
  assert.equal(recoveredStatus.response.status, 200);
  assert.equal(recoveredStatus.body.status, "ready-to-open");
  assert.equal(recoveredStatus.body.versionId, "ver_0002");
  assert.doesNotMatch(await readFile(sourcePath, "utf8"), /recovered/);
  await activateReadyVersion(secondBridge.baseUrl, recoveredStatus.body);
  const workspace = (await openWorkspace(secondBridge.baseUrl, sourcePath)).body;
  assert.equal(workspace.versions.length, 2);
  assert.equal(workspace.latestVersionId, "ver_0002");
  assert.equal(workspace.runtimeState.activeRun, null);
});

test("a ready Version survives restart without replacing the current HTML", async (t) => {
  const environment = await createEnvironment(t);
  const sourcePath = join(environment.sources, "ready-after-restart.html");
  const originalHtml = htmlPage("重启前的当前版");
  await writeFile(sourcePath, originalHtml, "utf8");
  const firstBridge = await environment.start();
  const opened = (await openWorkspace(firstBridge.baseUrl, sourcePath)).body;
  const run = (
    await postJson(firstBridge.baseUrl, "/request", {
      sourcePath,
      expectedSourceSha256: opened.currentHtmlSha256,
      freezeCutoffRevision: 0,
      summary: "最新版等待用户打开时重启",
    })
  ).body;
  await writeFile(
    run.outputPath,
    htmlPage("重启后待打开", '<p id="ready-after-restart">已返回</p>'),
    "utf8",
  );
  await runFinalizer(environment.workspace, run);
  const beforeRestart = await requestJson(
    firstBridge.baseUrl,
    `/status?sourcePath=${encodeURIComponent(sourcePath)}&requestId=${run.requestId}&attemptId=${run.attemptId}`,
  );
  assert.equal(beforeRestart.body.status, "ready-to-open");
  assert.equal(beforeRestart.body.currentPath, sourcePath);
  assert.equal(await readFile(sourcePath, "utf8"), originalHtml);
  await stopChild(firstBridge.child);

  const restarted = await environment.start();
  const restoredWorkspace = (
    await openWorkspace(restarted.baseUrl, sourcePath)
  ).body;
  assert.equal(restoredWorkspace.runtimeState.lifecycleState, "ready-to-open");
  assert.equal(restoredWorkspace.runtimeState.activeRun.requestId, run.requestId);
  assert.equal(restoredWorkspace.sourcePath, sourcePath);
  assert.equal(await readFile(sourcePath, "utf8"), originalHtml);

  const afterRestart = await requestJson(
    restarted.baseUrl,
    `/status?sourcePath=${encodeURIComponent(sourcePath)}&requestId=${run.requestId}&attemptId=${run.attemptId}`,
  );
  assert.equal(afterRestart.body.status, "ready-to-open");
  assert.equal(
    afterRestart.body.workingCopyPath,
    beforeRestart.body.workingCopyPath,
  );
  const activated = await activateReadyVersion(
    restarted.baseUrl,
    afterRestart.body,
  );
  assert.match(
    await readFile(activated.currentPath, "utf8"),
    /ready-after-restart/,
  );
  assert.equal(await readFile(sourcePath, "utf8"), originalHtml);
});

test("native text autosave intent and source-application crash boundaries recover exactly once", async (t) => {
  for (const failpoint of [
    "after-autosave-prepared",
    "after-autosave-source-applied",
    "after-autosave-project-applied",
    "after-autosave-audit-applied",
  ]) {
    const environment = await createEnvironment(t);
    const sourcePath = join(environment.sources, `${failpoint}.html`);
    const initial = htmlPage(`自动保存 ${failpoint}`);
    const target = htmlPage(
      `自动保存 ${failpoint}`,
      `<p id="durable">${failpoint}</p>`,
    );
    await writeFile(sourcePath, initial, "utf8");
    const firstBridge = await environment.start({
      HTML_AI_FAILPOINT: failpoint,
    });
    const opened = (await openWorkspace(firstBridge.baseUrl, sourcePath)).body;
    const interrupted = await postJson(firstBridge.baseUrl, "/autosave", {
      sourcePath,
      editRevision: 1,
      expectedSourceSha256: opened.currentHtmlSha256,
      html: target,
      changeEvents: [{
        eventId: `edit_${failpoint.replaceAll("-", "_")}`,
        kind: "text",
        property: "nativeText",
        before: "before",
        after: "after",
      }],
    });
    assert.equal(interrupted.response.status, 500);
    if (failpoint === "after-autosave-prepared") {
      assert.equal(await readFile(sourcePath, "utf8"), initial);
    } else {
      assert.equal(await readFile(sourcePath, "utf8"), target);
    }
    await stopChild(firstBridge.child);

    const restarted = await environment.start();
    const recoveredResponse = await openWorkspace(
      restarted.baseUrl,
      sourcePath,
    );
    assert.equal(
      recoveredResponse.response.status,
      200,
      JSON.stringify(recoveredResponse.body),
    );
    const recovered = recoveredResponse.body;
    assert.equal(await readFile(sourcePath, "utf8"), target);
    assert.equal(recovered.runtimeState.pendingWrite, null);
    assert.equal(recovered.runtimeState.lastPersistedRevision, 1);
    assert.equal(recovered.currentHtmlSha256, hash(target));
    assert.equal(recovered.projectId, opened.projectId);
    assert.equal(recovered.documentId, opened.documentId);
    assert.equal(recovered.versions.length, 1);
    const auditText = await readFile(
      join(
        opened.projectRoot,
        "edit-audit.jsonl",
      ),
      "utf8",
    );
    const auditEventId = `edit_${failpoint.replaceAll("-", "_")}`;
    const recoveredNativeEvents = auditText.trim().split("\n")
      .map((line) => JSON.parse(line))
      .filter((event) =>
        event.eventId === auditEventId
        && event.editRevision === 1
      );
    assert.equal(recoveredNativeEvents.length, 1);
    assert.equal(recoveredNativeEvents[0].property, "nativeText");
  }
});

test("draft writes use monotonic CAS and reject a stale client snapshot", async (t) => {
  const environment = await createEnvironment(t);
  const sourcePath = join(environment.sources, "draft-cas.html");
  await writeFile(sourcePath, htmlPage("Draft CAS"), "utf8");
  const bridge = await environment.start();
  const opened = (await openWorkspace(bridge.baseUrl, sourcePath)).body;

  const first = await postJson(bridge.baseUrl, "/draft", {
    sourcePath,
    projectId: opened.projectId,
    documentId: opened.documentId,
    expectedDraftRevision: 0,
    comments: [{ commentId: "comment_first", text: "first" }],
    changeEvents: [],
  });
  assert.equal(first.response.status, 200);
  assert.equal(first.body.activeDraft.draftRevision, 1);

  const stale = await postJson(bridge.baseUrl, "/draft", {
    sourcePath,
    projectId: opened.projectId,
    documentId: opened.documentId,
    expectedDraftRevision: 0,
    comments: [{ commentId: "comment_stale", text: "stale" }],
    changeEvents: [],
  });
  assert.equal(stale.response.status, 409);
  assert.equal(stale.body.error.code, "DRAFT_REVISION_CONFLICT");

  const reloaded = (await openWorkspace(bridge.baseUrl, sourcePath)).body;
  assert.equal(reloaded.runtimeState.draft.draftRevision, 1);
  assert.deepEqual(
    reloaded.runtimeState.draft.comments.map((comment) => comment.commentId),
    ["comment_first"],
  );
});

test("draft operations rebase stale revisions, persist deletes, and replay exactly once", async (t) => {
  const environment = await createEnvironment(t);
  const sourcePath = join(environment.sources, "draft-operation-rebase.html");
  await writeFile(sourcePath, htmlPage("Draft operation rebase"), "utf8");
  const bridge = await environment.start();
  const opened = (await openWorkspace(bridge.baseUrl, sourcePath)).body;

  const firstOperation = {
    operationId: "draftop_first_operation_0001",
    sourcePath,
    projectId: opened.projectId,
    documentId: opened.documentId,
    expectedDraftRevision: 0,
    comments: [{
      commentId: "comment_first",
      createdAt: "2026-07-26T00:00:00.000Z",
      updatedAt: "2026-07-26T00:00:00.000Z",
      text: "first",
    }],
    changeEvents: [],
    deletedCommentIds: [],
  };
  const first = await postJson(bridge.baseUrl, "/draft", firstOperation);
  assert.equal(first.response.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.activeDraft.draftRevision, 1);

  const replayed = await postJson(bridge.baseUrl, "/draft", {
    ...firstOperation,
    comments: [{ commentId: "comment_must_not_duplicate", text: "ignored" }],
  });
  assert.equal(replayed.response.status, 200, JSON.stringify(replayed.body));
  assert.equal(replayed.body.replayed, true);
  assert.equal(replayed.body.activeDraft.draftRevision, 1);
  assert.deepEqual(
    replayed.body.activeDraft.comments.map((comment) => comment.commentId),
    ["comment_first"],
  );

  const deleteOperation = await postJson(bridge.baseUrl, "/draft", {
    operationId: "draftop_delete_operation_0002",
    sourcePath,
    projectId: opened.projectId,
    documentId: opened.documentId,
    expectedDraftRevision: 1,
    comments: [{
      commentId: "comment_second",
      createdAt: "2026-07-26T00:01:00.000Z",
      updatedAt: "2026-07-26T00:01:00.000Z",
      text: "second",
    }],
    changeEvents: [],
    deletedCommentIds: ["comment_first"],
  });
  assert.equal(deleteOperation.response.status, 200, JSON.stringify(deleteOperation.body));
  assert.equal(deleteOperation.body.activeDraft.draftRevision, 2);
  assert.deepEqual(deleteOperation.body.activeDraft.deletedCommentIds, ["comment_first"]);
  assert.deepEqual(
    deleteOperation.body.activeDraft.comments.map((comment) => comment.commentId),
    ["comment_second"],
  );

  const staleMutation = {
    operationId: "draftop_stale_operation_0003",
    sourcePath,
    projectId: opened.projectId,
    documentId: opened.documentId,
    expectedDraftRevision: 1,
    comments: [{
      commentId: "comment_third",
      createdAt: "2026-07-26T00:02:00.000Z",
      updatedAt: "2026-07-26T00:02:00.000Z",
      text: "third",
    }],
    changeEvents: [],
    deletedCommentIds: [],
  };
  const conflict = await postJson(bridge.baseUrl, "/draft", staleMutation);
  assert.equal(conflict.response.status, 409, JSON.stringify(conflict.body));
  assert.equal(conflict.body.error.code, "DRAFT_REVISION_CONFLICT");
  assert.equal(conflict.body.error.details.currentDraftRevision, 2);
  assert.equal(conflict.body.error.details.activeDraft.draftRevision, 2);

  const rebasedMutation = rebaseDraftMutation(
    staleMutation,
    conflict.body.error.details.activeDraft,
  );
  const recovered = await postJson(bridge.baseUrl, "/draft", rebasedMutation);
  assert.equal(recovered.response.status, 200, JSON.stringify(recovered.body));
  assert.equal(recovered.body.activeDraft.draftRevision, 3);
  assert.deepEqual(
    recovered.body.activeDraft.comments
      .map((comment) => comment.commentId)
      .sort(),
    ["comment_second", "comment_third"],
  );
  assert.deepEqual(
    recovered.body.activeDraft.deletedCommentIds,
    ["comment_first"],
  );

  await stopChild(bridge.child);
  const restarted = await environment.start();
  const afterRestart = (await openWorkspace(
    restarted.baseUrl,
    sourcePath,
  )).body.runtimeState.draft;
  assert.equal(afterRestart.draftRevision, 3);
  assert.deepEqual(afterRestart.deletedCommentIds, ["comment_first"]);
  assert.equal(
    afterRestart.appliedOperationIds.includes(
      "draftop_stale_operation_0003",
    ),
    true,
  );
});

test("a draft artifact written before a Bridge crash restores revision and acknowledgement", async (t) => {
  const environment = await createEnvironment(t);
  const sourcePath = join(environment.sources, "draft-artifact-crash.html");
  await writeFile(sourcePath, htmlPage("Draft artifact crash"), "utf8");
  const interruptedBridge = await environment.start({
    HTML_AI_FAILPOINT: "after-draft-artifact-written",
  });
  const opened = (await openWorkspace(
    interruptedBridge.baseUrl,
    sourcePath,
  )).body;
  const operation = {
    operationId: "draftop_crash_recovery_0001",
    sourcePath,
    projectId: opened.projectId,
    documentId: opened.documentId,
    expectedDraftRevision: 0,
    comments: [{
      commentId: "comment_crash",
      text: "artifact is authoritative",
      createdAt: "2026-07-26T00:00:00.000Z",
      updatedAt: "2026-07-26T00:00:00.000Z",
    }],
    changeEvents: [],
    deletedCommentIds: [],
  };
  const interrupted = await postJson(
    interruptedBridge.baseUrl,
    "/draft",
    operation,
  );
  assert.equal(interrupted.response.status, 500);
  await stopChild(interruptedBridge.child);

  const restarted = await environment.start();
  const recovered = (await openWorkspace(restarted.baseUrl, sourcePath)).body;
  assert.equal(recovered.activeDraft.draftRevision, 1);
  assert.equal(recovered.runtimeState.draft.draftRevision, 1);
  assert.deepEqual(
    recovered.activeDraft.comments.map((comment) => comment.commentId),
    ["comment_crash"],
  );
  assert.equal(
    recovered.activeDraft.appliedOperationIds.includes(operation.operationId),
    true,
  );

  const replayed = await postJson(restarted.baseUrl, "/draft", operation);
  assert.equal(replayed.response.status, 200, JSON.stringify(replayed.body));
  assert.equal(replayed.body.replayed, true);
  assert.equal(replayed.body.activeDraft.draftRevision, 1);
});

test("a draft artifact cannot jump beyond the single-write crash window", async (t) => {
  const environment = await createEnvironment(t);
  const sourcePath = join(environment.sources, "draft-artifact-jump.html");
  await writeFile(sourcePath, htmlPage("Draft artifact jump"), "utf8");
  const bridge = await environment.start();
  const opened = (await openWorkspace(bridge.baseUrl, sourcePath)).body;
  const annotationsPath = join(
    opened.projectRoot,
    "draft",
    "annotations.json",
  );
  const annotations = JSON.parse(await readFile(annotationsPath, "utf8"));
  annotations.draftRevision = 99;
  annotations.comments = [{
    commentId: "comment_impossible_jump",
    text: "must never become authoritative",
  }];
  await writeFile(
    annotationsPath,
    `${JSON.stringify(annotations, null, 2)}\n`,
  );

  const rejected = await openWorkspace(bridge.baseUrl, sourcePath);
  assert.equal(rejected.response.status, 409, JSON.stringify(rejected.body));
  assert.equal(rejected.body.error.code, "DRAFT_ARTIFACT_REVISION_JUMP");
  assert.deepEqual(rejected.body.error.details, {
    runtimeDraftRevision: 0,
    artifactDraftRevision: 99,
  });
});

test("corrupt frozen annotations do not block status polling or cancellation", async (t) => {
  const environment = await createEnvironment(t);
  const sourcePath = join(environment.sources, "cancel-corrupt-annotations.html");
  await writeFile(sourcePath, htmlPage("Cancel degraded run"), "utf8");
  const bridge = await environment.start();
  const opened = (await openWorkspace(bridge.baseUrl, sourcePath)).body;
  const run = (
    await postJson(bridge.baseUrl, "/request", {
      sourcePath,
      projectId: opened.projectId,
      documentId: opened.documentId,
      expectedSourceSha256: opened.currentHtmlSha256,
      freezeCutoffRevision: 0,
      summary: "cancel despite corrupt display artifacts",
    })
  ).body;
  const annotationsPath = join(
    run.requestPath,
    "input",
    "annotations",
    "records.json",
  );
  const annotations = JSON.parse(await readFile(annotationsPath, "utf8"));
  annotations.schemaVersion = "2.0.0";
  await writeFile(annotationsPath, `${JSON.stringify(annotations, null, 2)}\n`);

  const status = await requestJson(
    bridge.baseUrl,
    `/status?sourcePath=${encodeURIComponent(sourcePath)}&requestId=${run.requestId}&attemptId=${run.attemptId}`,
  );
  assert.equal(status.response.status, 200);
  assert.equal(status.body.status, "waiting");

  const cancelled = await postJson(bridge.baseUrl, "/active-run/cancel", {
    sourcePath,
    projectId: opened.projectId,
    documentId: opened.documentId,
    requestId: run.requestId,
    attemptId: run.attemptId,
  });
  assert.equal(cancelled.response.status, 200);
  assert.equal(cancelled.body.status, "cancelled");
});

test("submitting Request crash boundaries roll back or publish deterministically", async (t) => {
  for (const failpoint of [
    "after-request-intent",
    "after-request-prepared",
    "after-request-published",
  ]) {
    const environment = await createEnvironment(t);
    const sourcePath = join(environment.sources, `${failpoint}.html`);
    await writeFile(sourcePath, htmlPage(`请求 ${failpoint}`), "utf8");
    const firstBridge = await environment.start({
      HTML_AI_FAILPOINT: failpoint,
    });
    const opened = (await openWorkspace(firstBridge.baseUrl, sourcePath)).body;
    const interrupted = await postJson(firstBridge.baseUrl, "/request", {
      sourcePath,
      expectedSourceSha256: opened.currentHtmlSha256,
      freezeCutoffRevision: 0,
      summary: failpoint,
    });
    assert.equal(interrupted.response.status, 500);
    await stopChild(firstBridge.child);

    const restarted = await environment.start();
    const recoveredResponse = await openWorkspace(
      restarted.baseUrl,
      sourcePath,
    );
    assert.equal(
      recoveredResponse.response.status,
      200,
      JSON.stringify(recoveredResponse.body),
    );
    const recovered = recoveredResponse.body;
    if (failpoint === "after-request-intent") {
      assert.equal(recovered.runtimeState.lifecycleState, "editing");
      assert.equal(recovered.runtimeState.activeRun, null);
      assert.equal(recovered.versions.length, 1);
    } else {
      assert.equal(recovered.runtimeState.lifecycleState, "processing");
      assert.equal(recovered.runtimeState.activeRun.requestId, "req_0001");
      assert.match(
        recovered.runtimeState.activeRun.inputManifestSha256,
        /^sha256:[a-f0-9]{64}$/,
      );
      await postJson(restarted.baseUrl, "/active-run/cancel", {
        sourcePath,
        requestId: recovered.runtimeState.activeRun.requestId,
        attemptId: recovered.runtimeState.activeRun.attemptId,
      });
    }
  }
});

test("transaction recovery rejects an unsupported schema before recovery mutation", async (t) => {
  const environment = await createEnvironment(t);
  const sourcePath = join(environment.sources, "transaction-schema.html");
  await writeFile(sourcePath, htmlPage("Transaction schema"), "utf8");
  const firstBridge = await environment.start({
    HTML_AI_FAILPOINT: "after-prepared",
  });
  const opened = (await openWorkspace(firstBridge.baseUrl, sourcePath)).body;
  const run = (
    await postJson(firstBridge.baseUrl, "/request", {
      sourcePath,
      expectedSourceSha256: opened.currentHtmlSha256,
      freezeCutoffRevision: 0,
      summary: "transaction schema fail closed",
    })
  ).body;
  await writeFile(
    run.outputPath,
    htmlPage("Transaction schema", "<p>candidate</p>"),
    "utf8",
  );
  await runFinalizer(environment.workspace, run);
  const interrupted = await requestJson(
    firstBridge.baseUrl,
    `/status?sourcePath=${encodeURIComponent(sourcePath)}&requestId=${run.requestId}&attemptId=${run.attemptId}`,
  );
  assert.equal(interrupted.response.status, 500);
  await stopChild(firstBridge.child);
  const projectRoot = projectRootFromRun(run);
  const transactionPath = join(
    projectRoot,
    "transactions",
    `txn_${run.requestId}_${run.attemptId}`,
    "transaction.json",
  );
  const transaction = JSON.parse(await readFile(transactionPath, "utf8"));
  transaction.schemaVersion = "2.0.0";
  await writeFile(
    transactionPath,
    `${JSON.stringify(transaction, null, 2)}\n`,
    "utf8",
  );
  const runtimePath = join(projectRoot, "runtime-state.json");
  const runtimeBefore = await readFile(runtimePath, "utf8");
  const sourceBefore = await readFile(sourcePath, "utf8");
  const restarted = await environment.start();
  assert.equal(await readFile(runtimePath, "utf8"), runtimeBefore);
  const rejected = await requestJson(
    restarted.baseUrl,
    `/status?sourcePath=${encodeURIComponent(sourcePath)}&requestId=${run.requestId}&attemptId=${run.attemptId}`,
  );
  assert.equal(rejected.response.status, 409);
  assert.equal(rejected.body.error.code, "UNSUPPORTED_SCHEMA_VERSION");
  assert.equal(await readFile(runtimePath, "utf8"), runtimeBefore);
  assert.equal(await readFile(sourcePath, "utf8"), sourceBefore);
  assert.deepEqual(
    (await readdir(join(projectRoot, "versions"))).sort(),
    ["ver_0001"],
  );
  await assert.rejects(access(join(run.attemptPath, "outcome.json")));
});

test("every Version transaction boundary recovers one committed candidate", async (t) => {
  for (const failpoint of [
    "after-prepared",
    "after-source-applied",
    "after-version-published",
    "after-commit-manifest-pending",
    "after-commit-manifest-written",
    "after-committed",
    "after-finalization",
  ]) {
    const environment = await createEnvironment(t);
    const sourcePath = join(environment.sources, `${failpoint}.html`);
    await writeFile(sourcePath, htmlPage(`事务 ${failpoint}`), "utf8");
    const firstBridge = await environment.start({
      HTML_AI_FAILPOINT: failpoint,
    });
    const opened = (await openWorkspace(firstBridge.baseUrl, sourcePath)).body;
    const originalSourceBeforeRun = await readFile(sourcePath, "utf8");
    const run = (
      await postJson(firstBridge.baseUrl, "/request", {
        sourcePath,
        expectedSourceSha256: opened.currentHtmlSha256,
        freezeCutoffRevision: 0,
        summary: `恢复 ${failpoint}`,
      })
    ).body;
    await writeFile(
      run.outputPath,
      htmlPage(
        `事务 ${failpoint}`,
        `<p id="transaction-boundary">${failpoint}</p>`,
      ),
      "utf8",
    );
    await runFinalizer(environment.workspace, run);
    const interrupted = await requestJson(
      firstBridge.baseUrl,
      `/status?sourcePath=${encodeURIComponent(sourcePath)}&requestId=${run.requestId}&attemptId=${run.attemptId}`,
    );
    assert.equal(interrupted.response.status, 500);
    await stopChild(firstBridge.child);

    const restarted = await environment.start();
    const recovered = await requestJson(
      restarted.baseUrl,
      `/status?sourcePath=${encodeURIComponent(sourcePath)}&requestId=${run.requestId}&attemptId=${run.attemptId}`,
    );
    assert.equal(recovered.response.status, 200);
    assert.equal(recovered.body.status, "ready-to-open");
    assert.equal(recovered.body.versionId, "ver_0002");
    assert.equal(await readFile(sourcePath, "utf8"), originalSourceBeforeRun);
    await activateReadyVersion(restarted.baseUrl, recovered.body);
    const workspace = (await openWorkspace(restarted.baseUrl, sourcePath)).body;
    assert.equal(workspace.versions.length, 2);
    assert.equal(workspace.latestVersionId, "ver_0002");
    assert.equal(await readFile(sourcePath, "utf8"), originalSourceBeforeRun);
    assert.match(
      await readFile(workspace.sourcePath, "utf8"),
      new RegExp(failpoint),
    );
    const projectRoot = projectRootFromRun(run);
    const [manifest, marker, transaction] = await Promise.all([
      readFile(
        join(projectRoot, "versions", "ver_0002", "version.json"),
        "utf8",
      ).then(JSON.parse),
      readFile(
        join(projectRoot, "versions", "ver_0002", "committed.json"),
        "utf8",
      ).then(JSON.parse),
      readFile(
        join(
          projectRoot,
          "transactions",
          `txn_${run.requestId}_${run.attemptId}`,
          "transaction.json",
        ),
        "utf8",
      ).then(JSON.parse),
    ]);
    assert.equal(manifest.generatedAt, marker.committedAt);
    assert.equal(transaction.versionGeneratedAt, marker.committedAt);
    assert.equal(
      transaction.candidateManifestSha256,
      marker.manifestSha256,
    );
    assert.equal("pendingCandidateManifestSha256" in transaction, false);
    assert.equal("pendingVersionGeneratedAt" in transaction, false);
  }
});

test("finalizer crash boundaries preserve frozen evidence and remain retry-safe", async (t) => {
  const environment = await createEnvironment(t);
  const sourcePath = join(environment.sources, "finalizer-boundaries.html");
  await writeFile(sourcePath, htmlPage("最终化边界"), "utf8");
  const bridge = await environment.start();
  const opened = (await openWorkspace(bridge.baseUrl, sourcePath)).body;
  const firstRun = (
    await postJson(bridge.baseUrl, "/request", {
      sourcePath,
      expectedSourceSha256: opened.currentHtmlSha256,
      freezeCutoffRevision: 0,
      summary: "输出已盖章但 completion 尚未发布",
    })
  ).body;
  await writeFile(
    firstRun.outputPath,
    htmlPage("最终化边界", "<p>first finalizer boundary</p>"),
    "utf8",
  );
  await assert.rejects(
    runFinalizer(environment.workspace, firstRun, {
      environment: {
        HTML_AI_FAILPOINT: "after-finalization-output",
      },
    }),
  );
  await assert.rejects(access(firstRun.completionPath));
  await runFinalizer(environment.workspace, firstRun);
  const firstCommitted = await requestJson(
    bridge.baseUrl,
    `/status?sourcePath=${encodeURIComponent(sourcePath)}&requestId=${firstRun.requestId}&attemptId=${firstRun.attemptId}`,
  );
  assert.equal(firstCommitted.body.status, "ready-to-open");
  await activateReadyVersion(bridge.baseUrl, firstCommitted.body);

  const afterFirst = (await openWorkspace(bridge.baseUrl, sourcePath)).body;
  const secondRun = (
    await postJson(bridge.baseUrl, "/request", {
      sourcePath,
      expectedSourceSha256: afterFirst.currentHtmlSha256,
      freezeCutoffRevision: afterFirst.runtimeState.editRevision,
      summary: "completion 已发布但 finalizer 退出",
    })
  ).body;
  await writeFile(
    secondRun.outputPath,
    htmlPage("最终化边界", "<p>second finalizer boundary</p>"),
    "utf8",
  );
  await assert.rejects(
    runFinalizer(environment.workspace, secondRun, {
      environment: {
        HTML_AI_FAILPOINT: "after-finalization",
      },
    }),
  );
  await access(secondRun.completionPath);
  const secondCommitted = await requestJson(
    bridge.baseUrl,
    `/status?sourcePath=${encodeURIComponent(sourcePath)}&requestId=${secondRun.requestId}&attemptId=${secondRun.attemptId}`,
  );
  assert.equal(secondCommitted.body.status, "ready-to-open");
  assert.equal(secondCommitted.body.versionId, "ver_0003");
});

test("version list returns hash-validated comments, local edits, and AI dialogue supplements", async (t) => {
  const environment = await createEnvironment(t);
  const sourcePath = join(environment.sources, "history-annotations.html");
  await writeFile(sourcePath, htmlPage("历史审计"), "utf8");
  const bridge = await environment.start();
  const opened = (await openWorkspace(bridge.baseUrl, sourcePath)).body;
  const editCreatedAt = "2026-07-18T06:01:02.000Z";
  const commentCreatedAt = "2026-07-18T06:02:03.000Z";
  const target = {
    targetId: "target_history_heading",
    label: "历史审计标题",
    level: "subregion",
    selector: "main > h1",
    resolution: "exact",
  };
  const directEdit = {
    eventId: "edit_history_heading",
    createdAt: editCreatedAt,
    kind: "text",
    target,
    before: "历史审计",
    after: "历史审计（已手动调整）",
    capturedRevision: 1,
  };
  const saved = await postJson(bridge.baseUrl, "/autosave", {
    sourcePath,
    projectId: opened.projectId,
    documentId: opened.documentId,
    editRevision: 1,
    expectedSourceSha256: opened.currentHtmlSha256,
    html: htmlPage("历史审计（已手动调整）"),
    changeEvents: [directEdit],
  });
  assert.equal(saved.response.status, 200);

  const run = (
    await postJson(bridge.baseUrl, "/request", {
      sourcePath,
      projectId: opened.projectId,
      documentId: opened.documentId,
      expectedSourceSha256: saved.body.currentHtmlSha256,
      freezeCutoffRevision: 1,
      lastPersistedRevision: 1,
      summary: "把评论与提交前的直接编辑一起归档到 V2。",
      comments: [
        {
          commentId: "comment_history_heading",
          createdAt: commentCreatedAt,
          updatedAt: commentCreatedAt,
          capturedRevision: 1,
          text: "请保留标题语义，并补充 AI 结论。",
          target,
        },
      ],
      changeEvents: [directEdit],
    })
  ).body;
  const frozenChangeRequest = JSON.parse(
    await readFile(join(run.requestPath, "change-request.json"), "utf8"),
  );
  const [frozenInstruction] = frozenChangeRequest.requirements.instructions;
  assert.match(frozenInstruction.instructionId, /^instruction_/u);
  await recordUserSupplement({
    workspaceRoot: environment.workspace,
    projectId: run.projectId,
    requestId: run.requestId,
    attemptId: run.attemptId,
    payload: {
      idempotencyKey: "history-chat-supplement-001",
      action: "add",
      refersTo: [frozenInstruction.instructionId],
      userText: "内部 AI 对话里又补充：结论区保持简洁，并参考刚发的图片留白。",
      targetDescription: "结论区",
      evidenceState: "description-only",
      evidenceDescription: "对话中可见一张参考图，但原始文件无法归档。",
      attachments: [],
    },
  });
  await writeFile(
    run.outputPath,
    htmlPage(
      "历史审计（已手动调整）",
      '<section id="ai-result">AI 已补充结论</section>',
    ),
    "utf8",
  );
  await runFinalizer(environment.workspace, run);
  const committed = await requestJson(
    bridge.baseUrl,
    `/status?sourcePath=${encodeURIComponent(sourcePath)}&requestId=${run.requestId}&attemptId=${run.attemptId}`,
  );
  assert.equal(committed.body.status, "ready-to-open");
  assert.equal(committed.body.supplement.status, "sealed");
  assert.equal(committed.body.supplement.recordCount, 1);

  const workspace = (await openWorkspace(bridge.baseUrl, sourcePath)).body;
  const version = workspace.versions.find(
    (item) => item.versionId === "ver_0002",
  );
  assert.ok(version);
  assert.equal(version.manifest.annotations, undefined);
  assert.equal(version.annotations.schemaVersion, "3.0.0");
  assert.equal(version.annotations.requestId, run.requestId);
  assert.equal(version.annotations.attemptId, run.attemptId);
  assert.equal(version.supplementArchive.status, "sealed");
  assert.equal(version.supplementArchive.recordCount, 1);
  assert.equal(version.supplements.length, 1);
  assert.equal(
    version.supplements[0].userText,
    "内部 AI 对话里又补充：结论区保持简洁，并参考刚发的图片留白。",
  );
  assert.equal(version.supplements[0].evidenceState, "description-only");
  assert.deepEqual(version.annotations.comments, [
    {
      commentId: "comment_history_heading",
      createdAt: commentCreatedAt,
      updatedAt: commentCreatedAt,
      capturedRevision: 1,
      text: "请保留标题语义，并补充 AI 结论。",
      target,
      persistence: "request-only",
    },
  ]);
  assert.deepEqual(version.annotations.editEvents, [
    {
      eventId: "edit_history_heading",
      createdAt: editCreatedAt,
      revision: 1,
      basedOnVersionId: "ver_0001",
      kind: "text",
      summary: "提交前已自动写回的本地编辑",
      target,
      before: "历史审计",
      after: "历史审计（已手动调整）",
    },
  ]);

  const versionAnnotationPath = join(
    projectRootFromRun(run),
    "versions",
    "ver_0002",
    "annotations",
    "records.json",
  );
  const originalAnnotations = await readFile(versionAnnotationPath);
  const tamperedAnnotations = JSON.parse(
    originalAnnotations.toString("utf8"),
  );
  tamperedAnnotations.comments[0].text = "被篡改的历史评论";
  await writeFile(
    versionAnnotationPath,
    `${JSON.stringify(tamperedAnnotations, null, 2)}\n`,
    "utf8",
  );
  const rejected = await openWorkspace(bridge.baseUrl, sourcePath);
  assert.equal(rejected.response.status, 409);
  assert.equal(
    rejected.body.error.code,
    "VERSION_INTEGRITY_VIOLATION",
  );
});

test("history endpoints reject marker, manifest, and entry tampering", async (t) => {
  const environment = await createEnvironment(t);
  const sourcePath = join(environment.sources, "integrity.html");
  await writeFile(sourcePath, htmlPage("完整性"), "utf8");
  const bridge = await environment.start();
  const opened = (await openWorkspace(bridge.baseUrl, sourcePath)).body;
  const run = (
    await postJson(bridge.baseUrl, "/request", {
      sourcePath,
      expectedSourceSha256: opened.currentHtmlSha256,
      freezeCutoffRevision: 0,
      summary: "建立完整性校验版本",
    })
  ).body;
  await writeFile(
    run.outputPath,
    htmlPage("完整性", "<p>immutable V2</p>"),
    "utf8",
  );
  await runFinalizer(environment.workspace, run);
  const ready = await requestJson(
    bridge.baseUrl,
    `/status?sourcePath=${encodeURIComponent(sourcePath)}&requestId=${run.requestId}&attemptId=${run.attemptId}`,
  );
  assert.equal(ready.body.status, "ready-to-open");
  await activateReadyVersion(bridge.baseUrl, ready.body);
  const versionRoot = join(
    projectRootFromRun(run),
    "versions",
    "ver_0002",
  );
  const entryPath = join(versionRoot, "files", "index.html");
  const manifestPath = join(versionRoot, "version.json");
  const markerPath = join(versionRoot, "committed.json");
  const originalEntry = await readFile(entryPath);
  const originalManifest = await readFile(manifestPath);
  const originalMarker = await readFile(markerPath);

  await writeFile(entryPath, htmlPage("tampered entry"), "utf8");
  const entryRejected = await requestJson(
    bridge.baseUrl,
    `/version-file?sourcePath=${encodeURIComponent(sourcePath)}&versionId=ver_0002`,
  );
  assert.equal(entryRejected.response.status, 409);
  assert.equal(
    entryRejected.body.error.code,
    "VERSION_INTEGRITY_VIOLATION",
  );
  await writeFile(entryPath, originalEntry);

  const manifest = JSON.parse(originalManifest.toString("utf8"));
  manifest.summary = "tampered manifest";
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const manifestRejected = await openWorkspace(bridge.baseUrl, sourcePath);
  assert.equal(manifestRejected.response.status, 409);
  assert.equal(
    manifestRejected.body.error.code,
    "VERSION_INTEGRITY_VIOLATION",
  );
  await writeFile(manifestPath, originalManifest);

  const marker = JSON.parse(originalMarker.toString("utf8"));
  marker.contentSha256 = hash("not the entry");
  await writeFile(markerPath, `${JSON.stringify(marker, null, 2)}\n`);
  const markerRejected = await requestJson(
    bridge.baseUrl,
    `/version-file?sourcePath=${encodeURIComponent(sourcePath)}&versionId=ver_0002`,
  );
  assert.equal(markerRejected.response.status, 409);
  assert.equal(
    markerRejected.body.error.code,
    "VERSION_INTEGRITY_VIOLATION",
  );
});

test("output PROJECT.md is rejected as a protocol violation", async (t) => {
  const environment = await createEnvironment(t);
  const sourcePath = join(environment.sources, "protocol-violation.html");
  await writeFile(sourcePath, htmlPage("协议错误"), "utf8");
  const bridge = await environment.start();
  const opened = (await openWorkspace(bridge.baseUrl, sourcePath)).body;
  const run = (
    await postJson(bridge.baseUrl, "/request", {
      sourcePath,
      expectedSourceSha256: opened.currentHtmlSha256,
      freezeCutoffRevision: 0,
      summary: "不得输出额外文件",
    })
  ).body;
  await writeFile(
    join(run.attemptPath, "output", "PROJECT.md"),
    "# unauthorized project-rule update",
  );
  const status = await requestJson(
    bridge.baseUrl,
    `/status?sourcePath=${encodeURIComponent(sourcePath)}&requestId=${run.requestId}&attemptId=${run.attemptId}`,
  );
  assert.equal(status.response.status, 200);
  assert.equal(status.body.status, "error");
  assert.equal(status.body.completionObserved, false);
  assert.equal(
    status.body.protocolViolation.code,
    "OUTPUT_PROTOCOL_VIOLATION",
  );
  const archived = JSON.parse(
    await readFile(join(run.attemptPath, "outcome.json"), "utf8"),
  );
  assert.equal(archived.status, "failed");
  assert.equal(archived.error.code, "OUTPUT_PROTOCOL_VIOLATION");
  const reconciledCancel = await postJson(
    bridge.baseUrl,
    "/active-run/cancel",
    {
      sourcePath,
      requestId: run.requestId,
      attemptId: run.attemptId,
    },
  );
  assert.equal(reconciledCancel.response.status, 200);
  assert.equal(reconciledCancel.body.status, "already-inactive");
  assert.equal(reconciledCancel.body.terminalStatus, "failed");
  const workspace = (await openWorkspace(bridge.baseUrl, sourcePath)).body;
  assert.equal(workspace.runtimeState.lifecycleState, "editing");
  assert.equal(workspace.runtimeState.activeRun, null);
});
