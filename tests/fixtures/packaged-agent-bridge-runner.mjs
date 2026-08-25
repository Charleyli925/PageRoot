#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [resourcesArgument, productRootArgument, helperArgument] = process.argv.slice(2);
for (const [label, value] of [
  ["Resources", resourcesArgument],
  ["product root", productRootArgument],
  ["Electron Helper", helperArgument],
]) {
  assert.equal(path.isAbsolute(String(value || "")), true, `${label} must be absolute`);
}

const resourcesPath = await realpath(resourcesArgument);
const productRoot = await realpath(productRootArgument);
const helperExecutable = await realpath(helperArgument);
const bridgeScript = path.join(resourcesPath, "bridge", "workspace-bridge.mjs");
const sdkUrl = pathToFileURL(path.join(
  resourcesPath,
  "node_modules",
  "@agentclientprotocol",
  "sdk",
  "dist",
  "acp.js",
)).href;
const sourceHtml = "<!doctype html><html><head><title>Packaged ACP</title></head><body><main><h1>Before</h1></main></body></html>\n";
const trustPolicyVersion = "trusted-local-agent-v1";

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

async function reservePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.equal(typeof address, "object");
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return address.port;
}

async function waitForExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve) => child.once("exit", resolve));
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  const exited = await Promise.race([
    waitForExit(child).then(() => true),
    new Promise((resolve) => setTimeout(resolve, 12_000, false)),
  ]);
  if (!exited && child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await waitForExit(child);
  }
}

async function runCommand(executable, args, { env = process.env, cwd = resourcesPath } = {}) {
  const child = spawn(executable, args, {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout = [];
  const stderr = [];
  child.stdout.on("data", (chunk) => stdout.push(chunk));
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  const exit = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  const output = Buffer.concat([...stdout, ...stderr]).toString("utf8");
  assert.deepEqual(exit, { code: 0, signal: null }, output);
  return output;
}

async function verifyPackagedCodexRuntime() {
  const providerUrl = pathToFileURL(path.join(
    resourcesPath,
    "bridge",
    "agent",
    "providers",
    "codex-provider.mjs",
  )).href;
  const flagsUrl = pathToFileURL(path.join(
    resourcesPath,
    "bridge",
    "agent",
    "codex-feature-flags.mjs",
  )).href;
  const [{ resolvePinnedCodexInstallation }, { CODEX_BUILD_GATES }] = await Promise.all([
    import(providerUrl),
    import(flagsUrl),
  ]);
  assert.deepEqual(CODEX_BUILD_GATES, { codexDiscussion: true, codexExecution: true });
  const installation = await resolvePinnedCodexInstallation();
  assert.equal(installation.platform, "darwin-arm64");
  for (const executable of [
    installation.adapterEntry,
    installation.codexWrapper,
    installation.codexBinary,
    installation.codeModeHost,
  ]) {
    assert.equal(executable.startsWith(`${resourcesPath}${path.sep}`), true);
  }
  const adapterVersion = await runCommand(helperExecutable, [
    installation.adapterEntry,
    "--version",
  ], {
    env: {
      PATH: "/usr/bin:/bin",
      ELECTRON_RUN_AS_NODE: "1",
      CODEX_PATH: installation.codexBinary,
    },
  });
  assert.match(adapterVersion, /@agentclientprotocol\/codex-acp 1\.6\.2/u);
  const codexVersion = await runCommand(installation.codexBinary, ["--version"], {
    env: {
      HOME: os.tmpdir(),
      PATH: "/usr/bin:/bin",
      TMPDIR: os.tmpdir(),
    },
  });
  assert.match(codexVersion, /codex-cli 0\.148\.0/u);
  return Object.freeze({ adapterVersion: "1.6.2", codexVersion: "0.148.0" });
}

async function run() {
  const temporaryRoot = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "pageroot-packaged-agent-")),
  );
  let bridge = null;
  const logs = { stdout: "", stderr: "" };
  try {
    const packagedCodex = await verifyPackagedCodexRuntime();
    const fakeAgentSource = await readFile(
      path.join(productRoot, "tests", "fixtures", "qoder-acp-agent.mjs"),
      "utf8",
    );
    const packagedFakeAgentSource = fakeAgentSource.replace(
      'from "@agentclientprotocol/sdk";',
      `from ${JSON.stringify(sdkUrl)};`,
    );
    assert.notEqual(packagedFakeAgentSource, fakeAgentSource, "fake ACP SDK import was not rebound");
    const fakeAgentPath = path.join(temporaryRoot, "packaged-qoder-agent.mjs");
    await writeFile(fakeAgentPath, packagedFakeAgentSource, { encoding: "utf8", mode: 0o700 });
    const commandPath = path.join(temporaryRoot, "qodercli");
    await writeFile(
      commandPath,
      [
        "#!/bin/sh",
        `exec env ELECTRON_RUN_AS_NODE=1 ${shellQuote(helperExecutable)} ${shellQuote(fakeAgentPath)} "$@"`,
        "",
      ].join("\n"),
      { encoding: "utf8", mode: 0o700 },
    );
    await chmod(commandPath, 0o700);

    const sourcesRoot = path.join(temporaryRoot, "sources");
    const projectsRoot = path.join(temporaryRoot, "project-files");
    const workspaceRoot = path.join(temporaryRoot, "workspace");
    await Promise.all([
      mkdir(sourcesRoot, { recursive: true }),
      mkdir(projectsRoot, { recursive: true }),
      mkdir(workspaceRoot, { recursive: true }),
    ]);
    const externalSourcePath = path.join(sourcesRoot, "packaged-agent.html");
    await writeFile(externalSourcePath, sourceHtml, "utf8");
    const port = await reservePort();
    const token = `packaged_agent_${randomUUID().replaceAll("-", "")}`;
    bridge = spawn(helperExecutable, [bridgeScript], {
      cwd: resourcesPath,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        HTML_AI_WORKSPACE: workspaceRoot,
        HTML_AI_PROJECT_FILES_ROOT: projectsRoot,
        HTML_AI_BRIDGE_PORT: String(port),
        HTML_AI_BRIDGE_AUTH_TOKEN: token,
        PAGEROOT_E2E: "1",
        PAGEROOT_QODER_ACP_ALLOW_TEST_COMMAND: "1",
        PAGEROOT_QODER_ACP_COMMAND: commandPath,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    bridge.stdout.setEncoding("utf8");
    bridge.stderr.setEncoding("utf8");
    bridge.stdout.on("data", (chunk) => {
      logs.stdout = (logs.stdout + chunk).slice(-64 * 1024);
    });
    bridge.stderr.on("data", (chunk) => {
      logs.stderr = (logs.stderr + chunk).slice(-64 * 1024);
    });

    const baseUrl = `http://127.0.0.1:${port}`;
    const requestJson = async (pathname, init = {}) => {
      const headers = new Headers(init.headers);
      headers.set("x-html-ai-bridge-token", token);
      if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
      const response = await fetch(`${baseUrl}${pathname}`, { ...init, headers });
      const text = await response.text();
      const body = text ? JSON.parse(text) : null;
      return { response, body };
    };
    const postJson = (pathname, body) => requestJson(pathname, {
      method: "POST",
      body: JSON.stringify(body),
    });
    const deadline = Date.now() + 15_000;
    let healthy = false;
    while (Date.now() < deadline) {
      if (bridge.exitCode !== null) break;
      try {
        const health = await requestJson("/health");
        if (health.response.status === 200 && health.body?.ok) {
          healthy = true;
          break;
        }
      } catch {
        // The packaged Bridge is still starting.
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(healthy, true, `packaged Bridge did not become healthy\n${logs.stderr}`);

    const workspace = await requestJson(
      `/workspace?sourcePath=${encodeURIComponent(externalSourcePath)}`,
    );
    assert.equal(workspace.response.status, 200, JSON.stringify(workspace.body));
    const ensured = await postJson("/project/ensure", {
      sourcePath: externalSourcePath,
      expectedSourceSha256: workspace.body.currentHtmlSha256,
      projectStorageVersion: "4.0.0",
    });
    assert.equal(ensured.response.status, 200, JSON.stringify(ensured.body));
    const preflight = await postJson("/agent/preflight", {
      driver: "qoder-acp",
      trustPolicyAccepted: trustPolicyVersion,
    });
    assert.equal(preflight.response.status, 200, JSON.stringify(preflight.body));
    assert.equal(preflight.body.selection?.providerId, "qoder");
    assert.equal(preflight.body.selection?.runtimeId, "acp");
    assert.ok(preflight.body.selection?.resolvedModelId);
    const selection = preflight.body.selection;
    const request = await postJson("/request", {
      projectId: ensured.body.projectId,
      documentId: ensured.body.documentId,
      sourcePath: ensured.body.sourcePath,
      expectedSourceSha256: ensured.body.sourceSha256,
      freezeCutoffRevision: 0,
      summary: "Packaged Agent Bridge closed loop",
      comments: [],
      changeEvents: [],
      agentDelivery: {
        mode: "managed-agent",
        selection,
        trustPolicyVersion,
      },
    });
    assert.equal(request.response.status, 201, JSON.stringify(request.body));
    const started = await postJson("/agent/start", {
      projectId: ensured.body.projectId,
      documentId: ensured.body.documentId,
      sourcePath: ensured.body.sourcePath,
      requestId: request.body.requestId,
      attemptId: request.body.attemptId,
      driver: "qoder-acp",
      selection,
      trustPolicyAccepted: trustPolicyVersion,
      preflightId: preflight.body.preflightId,
    });
    assert.equal(started.response.status, 202, JSON.stringify(started.body));

    const statusPath = `/status?sourcePath=${encodeURIComponent(ensured.body.sourcePath)}`
      + `&requestId=${encodeURIComponent(request.body.requestId)}`
      + `&attemptId=${encodeURIComponent(request.body.attemptId)}`;
    const completionDeadline = Date.now() + 30_000;
    let ready = null;
    while (Date.now() < completionDeadline) {
      const status = await requestJson(statusPath);
      assert.equal(status.response.status, 200, JSON.stringify(status.body));
      if (status.body.status === "ready-to-open") {
        ready = status.body;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(ready, `packaged ACP task did not reach pending review\n${logs.stderr}`);
    assert.equal(ready.agentSession.state, "completed");
    assert.equal(ready.activeRun.agentDelivery.mode, "managed-agent");
    assert.equal(ready.activeRun.agentDelivery.selection.providerId, "qoder");
    assert.equal(ready.activeRun.agentDelivery.selection.runtimeId, "acp");

    const candidate = await requestJson(
      `/version-file?sourcePath=${encodeURIComponent(ensured.body.sourcePath)}`
        + `&versionId=${encodeURIComponent(ready.versionId)}`,
    );
    assert.equal(candidate.response.status, 200, JSON.stringify(candidate.body));
    assert.match(candidate.body.content, /data-pageroot-qoder-acp="e2e"/u);
    const requestRoot = request.body.activeRun.requestPath;
    const [candidateRecord, completionRecord] = await Promise.all([
      readFile(path.join(requestRoot, "candidate.json"), "utf8").then(JSON.parse),
      readFile(request.body.activeRun.completionPath, "utf8").then(JSON.parse),
    ]);
    assert.equal(candidateRecord.status, "pending-review");
    assert.equal(completionRecord.kind, "candidate-finalization");
    assert.equal(completionRecord.status, "completed");
    assert.equal(await readFile(externalSourcePath, "utf8"), sourceHtml);
    assert.equal(await readFile(ensured.body.sourcePath, "utf8"), sourceHtml);
    assert.equal(candidate.body.sha256, sha256(Buffer.from(candidate.body.content, "utf8")));
    process.stdout.write(`${JSON.stringify({
      ok: true,
      status: ready.status,
      agentState: ready.agentSession.state,
      candidateStatus: candidateRecord.status,
      packagedCodex,
    })}\n`);
  } finally {
    await stopChild(bridge);
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

await run();
