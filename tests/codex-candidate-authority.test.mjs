import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { loadExecutionPolicy } from "../bridge/agent/policies/execution-policy.mjs";
import { runCodexAppServerTask } from "../bridge/agent/runtimes/codex-app-server-runtime.mjs";
import { sha256 } from "../bridge/lifecycle-core.mjs";
import { ProjectFileRepository } from "../bridge/project-file-repository.mjs";
import { normalizeAgentDelivery } from "../shared/agent-delivery.mjs";

const appServerFixture = fileURLToPath(new URL(
  "./fixtures/codex-app-server-execution.mjs",
  import.meta.url,
));

test("Codex completion reaches only a sealed Candidate and never adopts the Working Copy", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-candidate-authority-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourceRoot = path.join(root, "sources");
  const sourcePath = path.join(sourceRoot, "page.html");
  const source = "<!doctype html><html><head><title>Before</title></head><body>Before</body></html>\n";
  await mkdir(sourceRoot, { recursive: true });
  await writeFile(sourcePath, source, "utf8");
  const repository = new ProjectFileRepository({
    projectsRoot: path.join(root, "projects"),
    agentDeliveryNormalizer(value) {
      return normalizeAgentDelivery(value, { allowLegacy: false });
    },
  });
  const imported = await repository.importExternal({
    sourcePath,
    expectedSourceSha256: sha256(Buffer.from(source)),
  });
  const selection = {
    providerId: "codex",
    runtimeId: "app-server",
    requestedModelId: null,
    resolvedModelId: "codex:gpt-synthetic",
    reasoning: { requested: null, applied: null, resolution: "provider-default" },
  };
  const request = await repository.prepareRequest({
    target: imported.target,
    requestId: "req_codex_candidate_authority",
    attemptId: "attempt_001",
    expectedSourceSha256: imported.target.sourceSha256,
    request: {
      freezeCutoffRevision: 0,
      summary: "Modify the page through Codex",
      comments: [],
      changeEvents: [],
      targets: [],
      agentDelivery: {
        mode: "managed-agent",
        selection,
        trustPolicyVersion: "trusted-local-agent-v1",
      },
    },
    prompt: "Write one complete Candidate page.",
  });
  const requestRoot = path.join(
    imported.target.projectRootPath,
    ".pageroot",
    "requests",
    request.requestId,
  );
  const outputPath = path.join(
    imported.target.projectRootPath,
    ".pageroot",
    ...request.outputRelativePath.split("/"),
  );
  const policy = await loadExecutionPolicy({
    requestPath: requestRoot,
    promptPath: path.join(requestRoot, "PROMPT.md"),
    outputPath,
    completionPath: path.join(requestRoot, "attempts", request.attemptId, "completion.json"),
  });
  const tracePath = path.join(root, "app-server-trace.jsonl");
  await writeFile(tracePath, "", "utf8");
  const result = await runCodexAppServerTask({
    command: process.execPath,
    argsPrefix: [appServerFixture],
    cwd: path.dirname(outputPath),
    environment: {
      PATH: process.env.PATH,
      FAKE_CODEX_EXECUTION_MODE: "completed",
      FAKE_CODEX_OUTPUT_PATH: outputPath,
      FAKE_CODEX_TRACE_PATH: tracePath,
    },
    policy,
    prompt: "Write the exact Candidate output and stop.",
    model: "gpt-synthetic",
    onEvent() {},
    requestTimeoutMs: 1_000,
    turnTimeoutMs: 1_000,
  });
  assert.equal(result.status, "completed");
  const status = await repository.requestStatus({
    target: imported.target,
    requestId: request.requestId,
    attemptId: request.attemptId,
  });
  assert.equal(status.status, "candidate-ready");
  assert.equal(status.candidate.candidateId, request.candidateId);
  assert.equal(await readFile(sourcePath, "utf8"), source);
  assert.equal(await readFile(imported.target.exactSourcePath, "utf8"), source);
  const workspace = await repository.workspace({ sourcePath: imported.target.exactSourcePath });
  assert.equal(workspace.manifest.latestOfficialVersionId, "ver_0001");
  assert.equal(workspace.manifest.versions.length, 1);
  assert.equal(workspace.activeCandidate.candidateId, request.candidateId);
});
