import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  access,
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runBridgeFinalizer } from "../scripts/agent/native/bridge-finalizer.mjs";
import { publishCodexExecutionOutput } from "../scripts/agent/native/codex-workspace.mjs";
import { runAgentNativeAcp } from "../scripts/agent/runtimes/agent-native-acp-runner.mjs";
import { loadExecutionPolicy } from "../scripts/agent/policies/execution-policy.mjs";
import { sha256 } from "../scripts/lifecycle-core.mjs";
import { ProjectFileRepository } from "../scripts/project-file-repository.mjs";

const adapterEntry = path.resolve("tests/fixtures/codex-acp-agent.mjs");

async function identity(filePath) {
  const resolved = await realpath(filePath);
  const [information, bytes] = await Promise.all([lstat(resolved), readFile(resolved)]);
  return Object.freeze({
    path: resolved,
    dev: information.dev,
    ino: information.ino,
    nlink: information.nlink,
    size: information.size,
    mtimeMs: information.mtimeMs,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}

async function fixture(t, suffix = "complete") {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), `stemmio-codex-${suffix}-`)));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourceHtml = "<!doctype html><html><head><title>Before</title></head><body><main><h1>Before</h1></main></body></html>";
  const sourcePath = path.join(root, "external.html");
  await writeFile(sourcePath, sourceHtml);
  const projectsRoot = path.join(root, "projects");
  const repository = new ProjectFileRepository({ projectsRoot });
  const imported = await repository.importExternal({
    sourcePath,
    expectedSourceSha256: sha256(Buffer.from(sourceHtml)),
  });
  const requestId = `req_${"a".repeat(15)}${suffix.charCodeAt(0).toString(16).slice(-1)}`;
  const attemptId = "attempt_001";
  await repository.prepareRequest({
    target: imported.target,
    requestId,
    attemptId,
    expectedSourceSha256: imported.target.sourceSha256,
    request: {
      freezeCutoffRevision: 0,
      summary: "Create a Codex Candidate",
      comments: [],
      changeEvents: [],
      instructions: [],
      targets: [],
    },
    prompt: "Create one complete updated HTML document.",
  });
  const requestPath = await realpath(path.join(
    imported.target.projectRootPath,
    ".pageroot",
    "requests",
    requestId,
  ));
  const outputPath = path.join(requestPath, "attempts", attemptId, "output", "candidate.html");
  const completionPath = path.join(requestPath, "attempts", attemptId, "completion.json");
  const policy = await loadExecutionPolicy({
    requestPath,
    promptPath: path.join(requestPath, "PROMPT.md"),
    outputPath,
    completionPath,
  });
  return {
    root,
    repository,
    projectsRoot,
    sourcePath,
    sourceHtml,
    target: imported.target,
    policy,
    outputPath,
    completionPath,
  };
}

test("agent-native output has no Candidate authority until the Bridge finalizer succeeds", {
  skip: process.platform !== "darwin",
}, async (t) => {
  const value = await fixture(t);
  const codexBinary = await realpath("/usr/bin/true");
  const codexBinaryIdentity = await identity(codexBinary);
  const result = await runAgentNativeAcp({
    securityProfile: "agent-native",
    purpose: "execution",
    adapterEntry,
    adapterEntryIdentity: await identity(adapterEntry),
    adapterVersion: "1.6.2",
    adapterArgs: ["--fixture=execution"],
    codexBinary,
    codexBinaryIdentity,
    codeModeHost: codexBinary,
    codeModeHostIdentity: codexBinaryIdentity,
    codexConfig: {},
    sessionConfigOptions: [{ id: "model", value: "gpt-synthetic" }],
    cwd: value.policy.requestRoot,
    mode: "agent",
    policy: value.policy,
    prompt: "This prompt must be replaced by the native workspace prompt.",
    baseEnvironment: process.env,
    onEvent() {},
    turnTimeoutMs: 5_000,
  });
  assert.match(result.completion.outputSha256, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(await access(value.outputPath).then(() => true, () => false), true);
  assert.equal(await access(value.completionPath).then(() => true, () => false), false);
  const beforeFinalizer = await value.repository.workspace({ sourcePath: value.target.exactSourcePath });
  assert.equal(beforeFinalizer.activeCandidate, null);
  assert.equal(beforeFinalizer.activeRequest.status, "processing");
  assert.equal(await readFile(value.sourcePath, "utf8"), value.sourceHtml);
  assert.equal(await readFile(value.target.exactSourcePath, "utf8"), value.sourceHtml);

  const completion = await runBridgeFinalizer({ policy: value.policy });
  assert.equal(completion.status, "completed");
  const reopened = new ProjectFileRepository({ projectsRoot: value.projectsRoot });
  const status = await reopened.requestStatus({
    target: value.target,
    requestId: value.policy.requestId,
    attemptId: value.policy.attemptId,
  });
  assert.equal(status.status, "candidate-ready");
  const afterFinalizer = await reopened.workspace({ sourcePath: value.target.exactSourcePath });
  assert.equal(afterFinalizer.activeRequest.status, "candidate-ready");
  assert.equal(afterFinalizer.activeCandidate.outputSha256, completion.outputSha256);
  assert.equal(await readFile(value.sourcePath, "utf8"), value.sourceHtml);
  assert.equal(await readFile(value.target.exactSourcePath, "utf8"), value.sourceHtml);
});

test("an output file without completion evidence never publishes a Candidate", async (t) => {
  const value = await fixture(t, "invalid");
  await mkdir(path.dirname(value.outputPath), { recursive: true });
  await writeFile(
    value.outputPath,
    "<!doctype html><html><head><title>Unfinalized</title></head><body><main>Unfinalized</main></body></html>",
  );
  const workspace = await value.repository.workspace({ sourcePath: value.target.exactSourcePath });
  assert.equal(workspace.activeCandidate, null);
  assert.equal(workspace.activeRequest.status, "processing");
  assert.equal(await access(value.completionPath).then(() => true, () => false), false);
});

async function nativeOutputRoot(t, value) {
  const workspaceRoot = await realpath(await mkdtemp(path.join(value.root, "native-output-")));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  const outputRoot = path.join(workspaceRoot, "output");
  await mkdir(outputRoot);
  return { outputRoot };
}

const validHtml = "<!doctype html><html><head><title>Candidate</title></head><body><main>Candidate</main></body></html>";

test("Bridge rejects extra, symlinked, hard-linked, incomplete, and oversized native outputs", async (t) => {
  const cases = [
    {
      name: "extra output",
      code: "CODEX_NATIVE_OUTPUT_INVALID",
      prepare: async ({ outputRoot }) => {
        await writeFile(path.join(outputRoot, "index.html"), validHtml);
        await writeFile(path.join(outputRoot, "extra.txt"), "extra");
      },
    },
    {
      name: "symlink output",
      code: "CODEX_NATIVE_OUTPUT_INVALID",
      prepare: async ({ outputRoot }, value) => {
        const target = path.join(value.root, "symlink-target.html");
        await writeFile(target, validHtml);
        await symlink(target, path.join(outputRoot, "index.html"));
      },
    },
    {
      name: "hard-linked output",
      code: "CODEX_NATIVE_OUTPUT_UNSAFE",
      prepare: async ({ outputRoot }, value) => {
        const target = path.join(value.root, "hardlink-target.html");
        await writeFile(target, validHtml);
        await link(target, path.join(outputRoot, "index.html"));
      },
    },
    {
      name: "incomplete output",
      code: "INCOMPLETE_HTML",
      prepare: ({ outputRoot }) => writeFile(path.join(outputRoot, "index.html"), "<html><body>open"),
    },
    {
      name: "oversized output",
      code: "CODEX_NATIVE_OUTPUT_UNSAFE",
      prepare: ({ outputRoot }) => writeFile(
        path.join(outputRoot, "index.html"),
        Buffer.alloc(20 * 1024 * 1024 + 1, 0x61),
      ),
    },
  ];
  for (const attack of cases) {
    await t.test(attack.name, async (subtest) => {
      const value = await fixture(subtest, attack.name.replaceAll(" ", "_"));
      const workspace = await nativeOutputRoot(subtest, value);
      await attack.prepare(workspace, value);
      await assert.rejects(
        publishCodexExecutionOutput({ workspace, policy: value.policy }),
        { code: attack.code },
      );
      assert.equal(await access(value.outputPath).then(() => true, () => false), false);
      assert.equal(await access(value.completionPath).then(() => true, () => false), false);
    });
  }
});

test("Bridge refuses publication after cancellation or frozen-input drift", async (t) => {
  await t.test("cancelled publication", async (subtest) => {
    const value = await fixture(subtest, "cancelled");
    const workspace = await nativeOutputRoot(subtest, value);
    await writeFile(path.join(workspace.outputRoot, "index.html"), validHtml);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      publishCodexExecutionOutput({
        workspace,
        policy: value.policy,
        cancellationSignal: controller.signal,
      }),
      { code: "AGENT_CANCELLED" },
    );
    assert.equal(await access(value.outputPath).then(() => true, () => false), false);
  });
  await t.test("frozen input drift", async (subtest) => {
    const value = await fixture(subtest, "drifted");
    const workspace = await nativeOutputRoot(subtest, value);
    await writeFile(path.join(workspace.outputRoot, "index.html"), validHtml);
    const frozen = value.policy.readableFiles[0];
    await chmod(frozen.path, 0o600);
    await writeFile(frozen.path, "drifted input");
    await assert.rejects(
      publishCodexExecutionOutput({ workspace, policy: value.policy }),
      { code: "CODEX_FROZEN_INPUT_DRIFT" },
    );
    assert.equal(await access(value.outputPath).then(() => true, () => false), false);
    assert.equal(await access(value.completionPath).then(() => true, () => false), false);
  });
});
