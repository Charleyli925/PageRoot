import assert from "node:assert/strict";
import {
  lstat,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { sha256 } from "../bridge/lifecycle-core.mjs";
import { normalizeAgentDelivery } from "../shared/agent-delivery.mjs";
import {
  ProjectFileRepository,
  ProjectFileRepositoryError,
} from "../bridge/project-file-repository.mjs";
import {
  fixture,
  html,
  importSource,
  json,
} from "./project-file-repository-harness.mjs";

test("Request publication rechecks source bytes after freezing its input bundle", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "request-boundary.html");
  const externalHtml = html("external edit during request freeze");
  const repository = new ProjectFileRepository({
    projectsRoot: value.projects,
    failpoint: async (name) => {
      if (name === "request-input-manifest-written") {
        await writeFile(imported.target.exactSourcePath, externalHtml, "utf8");
      }
      return false;
    },
  });

  await assert.rejects(
    repository.prepareRequest({
      target: imported.target,
      requestId: "req_source_boundary",
      expectedSourceSha256: imported.target.sourceSha256,
      prompt: "# Request\n",
    }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "SOURCE_HASH_CONFLICT",
  );

  assert.equal(await readFile(imported.target.exactSourcePath, "utf8"), externalHtml);
  const runtime = await json(path.join(
    imported.target.projectRootPath,
    ".pageroot",
    "runtime-state.json",
  ));
  assert.equal(runtime.activeRequest, null);
  await assert.rejects(
    readFile(path.join(
      imported.target.projectRootPath,
      ".pageroot",
      "requests",
      "req_source_boundary",
      "request.json",
    )),
    (error) => error?.code === "ENOENT",
  );
});

test("request preparation fault injection restores one immutable active Request", async (t) => {
  for (const failpoint of [
    "request-input-written",
    "request-project-rules-written",
    "request-annotations-written",
    "request-change-record-written",
    "request-prompt-written",
    "request-input-manifest-written",
    "request-record-written",
    "request-runtime-written",
    "request-prepared",
  ]) {
    const value = await fixture(t);
    const imported = await importSource(value, "request-fault.html");
    const request = { summary: `fault recovery ${failpoint}` };
    const prompt = `# ${failpoint}\n`;
    const failing = new ProjectFileRepository({
      projectsRoot: value.projects,
      failpoint: async (name) => name === failpoint,
    });
    await assert.rejects(
      failing.prepareRequest({
        target: imported.target,
        requestId: "req_fault_recovery",
        attemptId: "attempt_001",
        expectedSourceSha256: imported.target.sourceSha256,
        request,
        prompt,
      }),
      (error) => error instanceof ProjectFileRepositoryError
        && error.code === "INJECTED_FAILPOINT",
      failpoint,
    );

    const restarted = new ProjectFileRepository({ projectsRoot: value.projects });
    const prepared = await restarted.prepareRequest({
      target: imported.target,
      requestId: "req_fault_recovery",
      attemptId: "attempt_001",
      expectedSourceSha256: imported.target.sourceSha256,
      request,
      prompt,
    });
    assert.equal(prepared.status, "processing", failpoint);
    const workspace = await restarted.workspace({ sourcePath: imported.target.exactSourcePath });
    assert.equal(workspace.activeRequest.requestId, "req_fault_recovery", failpoint);
    assert.equal(workspace.activeRequest.status, "processing", failpoint);
    const requestRoots = (await readdir(path.join(
      imported.target.projectRootPath,
      ".pageroot",
      "requests",
    ), { withFileTypes: true })).filter((entry) => entry.isDirectory());
    assert.deepEqual(requestRoots.map((entry) => entry.name), ["req_fault_recovery"], failpoint);
  }
});

test("request recovery keeps the original runtime input-manifest anchor", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "runtime-anchor.html");
  const prepared = await value.repository.prepareRequest({
    target: imported.target,
    requestId: "req_runtime_anchor",
    attemptId: "attempt_001",
    expectedSourceSha256: imported.target.sourceSha256,
    request: { summary: "runtime anchor" },
    prompt: "# Runtime anchor\n",
  });
  const controlRoot = path.join(imported.target.projectRootPath, ".pageroot");
  const runtimePath = path.join(controlRoot, "runtime-state.json");
  const requestPath = path.join(controlRoot, "requests", prepared.requestId, "request.json");
  const runtimeBefore = await json(runtimePath);
  const requestRecord = await json(requestPath);
  requestRecord.inputManifestSha256 = sha256(Buffer.from("untrusted manifest", "utf8"));
  await writeFile(requestPath, JSON.stringify(requestRecord), "utf8");

  await assert.rejects(
    value.repository.prepareRequest({
      target: imported.target,
      requestId: prepared.requestId,
      attemptId: prepared.attemptId,
      expectedSourceSha256: imported.target.sourceSha256,
    }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "FROZEN_REQUEST_BUNDLE_MISMATCH",
  );
  const runtimeAfter = await json(runtimePath);
  assert.equal(
    runtimeAfter.activeRequest?.inputManifestSha256,
    runtimeBefore.activeRequest?.inputManifestSha256,
  );
});

test("request recovery binds Request identity to its sealed runtime anchor", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "runtime-identity-anchor.html");
  const prepared = await value.repository.prepareRequest({
    target: imported.target,
    requestId: "req_runtime_identity_anchor",
    attemptId: "attempt_001",
    expectedSourceSha256: imported.target.sourceSha256,
    request: { summary: "runtime identity anchor" },
    prompt: "# Runtime identity anchor\n",
  });
  const controlRoot = path.join(imported.target.projectRootPath, ".pageroot");
  const runtimePath = path.join(controlRoot, "runtime-state.json");
  const requestPath = path.join(controlRoot, "requests", prepared.requestId, "request.json");
  const runtimeBefore = await json(runtimePath);
  const record = await json(requestPath);
  record.attemptId = "attempt_002";
  await writeFile(requestPath, JSON.stringify(record), "utf8");

  await assert.rejects(
    new ProjectFileRepository({ projectsRoot: value.projects }).workspace({
      sourcePath: imported.target.exactSourcePath,
    }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "REQUEST_IDENTITY_MISMATCH",
  );
  const runtimeAfter = await json(runtimePath);
  assert.equal(runtimeAfter.activeRequest?.requestId, runtimeBefore.activeRequest?.requestId);
  assert.equal(runtimeAfter.activeRequest?.attemptId, runtimeBefore.activeRequest?.attemptId);
});

test("request recovery never recreates runtime authority from Agent-owned Request files", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "agent-owned-request.html");
  const prepared = await value.repository.prepareRequest({
    target: imported.target,
    requestId: "req_agent_owned_recovery",
    attemptId: "attempt_001",
    expectedSourceSha256: imported.target.sourceSha256,
    request: { summary: "must retain the runtime seal" },
    prompt: "# Runtime seal\n",
  });
  const controlRoot = path.join(imported.target.projectRootPath, ".pageroot");
  const runtimePath = path.join(controlRoot, "runtime-state.json");
  const requestPath = path.join(controlRoot, "requests", prepared.requestId, "request.json");
  const inputManifestPath = path.join(controlRoot, "requests", prepared.requestId, "input-manifest.json");
  const runtime = await json(runtimePath);
  runtime.activeRequest = null;
  runtime.activeCandidateId = null;
  await writeFile(runtimePath, JSON.stringify(runtime), "utf8");

  // An external Agent may alter every file it can see in its Request tree.
  // Its new digest must not become runtime authority when PageRoot reopens.
  const launderedManifest = Buffer.from('{"agent":"replacement bundle"}\n', "utf8");
  await writeFile(inputManifestPath, launderedManifest);
  const record = await json(requestPath);
  record.status = "processing";
  record.inputManifestSha256 = sha256(launderedManifest);
  await writeFile(requestPath, JSON.stringify(record), "utf8");

  const reopened = await new ProjectFileRepository({ projectsRoot: value.projects }).workspace({
    sourcePath: imported.target.exactSourcePath,
  });
  assert.equal(reopened.activeRequest, null);
  assert.equal(reopened.activeCandidate, null);
  const runtimeAfter = await json(runtimePath);
  assert.equal(runtimeAfter.activeRequest, null);
  assert.equal(runtimeAfter.activeCandidateId, null);
});

test("a Request freezes comments, targets and project rules alongside its exact HTML", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "frozen-request.html");
  const saved = await value.repository.saveWorkingCopy({
    target: imported.target,
    html: html("persisted before request"),
    expectedSourceSha256: imported.target.sourceSha256,
    editRevision: 1,
  });
  await value.repository.updateProjectNotes({
    target: saved.target,
    content: "# 项目规则\n\n只修改首页标题。\n",
  });
  const comments = [{
    commentId: "comment_001",
    text: "把标题改成欢迎页",
    target: { targetId: "target_title" },
    attachments: [{
      attachmentId: "attachment_001",
      fileName: "参考.png",
      relativePath: "draft/attachments/comment_001/attachment_001-参考.png",
    }],
  }];
  const request = {
    freezeCutoffRevision: 1,
    summary: "按评论更新标题",
    comments,
    changeEvents: [{ eventId: "edit_001", kind: "text", target: { targetId: "target_title" } }],
    instructions: [{ instructionId: "instruction_001", text: "保留其他内容" }],
    targets: [{ targetId: "target_title", selector: "h1" }],
    preserveOutsideTargets: false,
  };
  await assert.rejects(
    value.repository.prepareRequest({
      target: saved.target,
      requestId: "req_unknown_provider",
      attemptId: "attempt_001",
      expectedSourceSha256: saved.target.sourceSha256,
      request: {
        ...request,
        agentDelivery: {
          mode: "managed-agent",
          selection: {
            providerId: "future-agent",
            runtimeId: "future-runtime",
            requestedModelId: null,
            resolvedModelId: null,
            reasoning: { requested: null, applied: null, resolution: "provider-default" },
          },
          trustPolicyVersion: "trusted-local-agent-v1",
        },
      },
      prompt: "# must not publish\n",
    }),
    (error) => error?.code === "AGENT_DELIVERY_INVALID"
      && error?.details?.reasonCode === "AGENT_PROVIDER_UNSUPPORTED",
  );
  assert.equal(
    await lstat(path.join(
      saved.target.projectRootPath,
      ".pageroot",
      "requests",
      "req_unknown_provider",
    )).then(() => true, () => false),
    false,
  );
  const prepared = await value.repository.prepareRequest({
    target: saved.target,
    requestId: "req_frozen_inputs",
    attemptId: "attempt_001",
    expectedSourceSha256: saved.target.sourceSha256,
    request,
    prompt: "# 本轮任务\n",
  });
  const requestRoot = path.join(
    saved.target.projectRootPath,
    ".pageroot",
    "requests",
    prepared.requestId,
  );
  const annotationsPath = path.join(requestRoot, "input", "annotations", "records.json");
  const projectRulesPath = path.join(requestRoot, "input", "PROJECT.md");
  const changeRequestPath = path.join(requestRoot, "change-request.json");
  const inputManifestPath = path.join(requestRoot, "input-manifest.json");
  const frozenAnnotations = await readFile(annotationsPath);
  const frozenProjectRules = await readFile(projectRulesPath);
  const frozenChangeRequest = await readFile(changeRequestPath);
  const annotations = JSON.parse(frozenAnnotations.toString("utf8"));
  const changeRequest = JSON.parse(frozenChangeRequest.toString("utf8"));
  const inputManifest = await json(inputManifestPath);
  assert.deepEqual(annotations.comments, comments);
  assert.deepEqual(changeRequest.requirements, {
    ...request,
    preserveOutsideTargets: true,
    agentDelivery: { mode: "clipboard" },
  });
  assert.deepEqual(inputManifest.readOrder, [
    "PROMPT.md",
    "input/AI_RULES.md",
    "change-request.json",
    "input/PROJECT.md",
    "input/base/index.html",
    "input/annotations/records.json",
  ]);
  assert.equal(
    inputManifest.files.find((entry) => entry.path === "input/base/index.html").sha256,
    saved.target.sourceSha256,
  );
  assert.equal(prepared.inputManifestSha256, sha256(await readFile(inputManifestPath)));

  await value.repository.updateProjectNotes({
    target: saved.target,
    content: "# 已修改的项目规则\n",
  });
  assert.deepEqual(await readFile(annotationsPath), frozenAnnotations);
  assert.deepEqual(await readFile(projectRulesPath), frozenProjectRules);
  assert.deepEqual(await readFile(changeRequestPath), frozenChangeRequest);
});

test("an existing unknown-provider Request remains readable and durably cancellable without read-time rewrite", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "unknown-provider-history.html");
  const prepared = await value.repository.prepareRequest({
    target: imported.target,
    requestId: "req_unknown_history",
    attemptId: "attempt_001",
    expectedSourceSha256: imported.target.sourceSha256,
    request: {
      freezeCutoffRevision: 0,
      summary: "historical request",
      comments: [],
      changeEvents: [],
      instructions: [],
      targets: [],
      preserveOutsideTargets: true,
      agentDelivery: { mode: "clipboard" },
    },
    prompt: "# historical request\n",
  });
  const requestPath = path.join(
    imported.target.projectRootPath,
    ".pageroot",
    "requests",
    prepared.requestId,
    "request.json",
  );
  const record = JSON.parse(await readFile(requestPath, "utf8"));
  record.request.agentDelivery = {
    mode: "managed-agent",
    selection: {
      providerId: "future-agent",
      runtimeId: "future-runtime",
      requestedModelId: "future-agent:model-a",
      resolvedModelId: "future-agent:model-a",
      reasoning: { requested: "high", applied: "high", resolution: "exact" },
    },
    trustPolicyVersion: "trusted-local-agent-v1",
  };
  await writeFile(requestPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  const historicalBytes = await readFile(requestPath, "utf8");

  const status = await value.repository.requestStatus({
    target: imported.target,
    requestId: prepared.requestId,
    attemptId: prepared.attemptId,
  });
  assert.equal(status.request.request.agentDelivery.selection.providerId, "future-agent");
  assert.equal(await readFile(requestPath, "utf8"), historicalBytes);

  const cancelled = await value.repository.cancelRequest({
    target: imported.target,
    requestId: prepared.requestId,
    attemptId: prepared.attemptId,
  });
  assert.equal(cancelled.status, "cancelled");
  assert.equal(JSON.parse(await readFile(requestPath, "utf8")).status, "cancelled");
});

test("injected provider authority can normalize a new selection without a legacy driver", async (t) => {
  const value = await fixture(t);
  const repository = new ProjectFileRepository({
    projectsRoot: value.projects,
    agentDeliveryNormalizer: (input) => {
      const delivery = normalizeAgentDelivery(input, { allowLegacy: false });
      if (delivery.mode === "managed-agent"
        && (delivery.selection.providerId !== "synthetic-provider"
          || delivery.selection.runtimeId !== "synthetic-runtime")) {
        throw Object.assign(new Error("unsupported provider"), {
          code: "AGENT_PROVIDER_UNSUPPORTED",
        });
      }
      return delivery;
    },
  });
  const imported = await importSource({ ...value, repository }, "selection-first-request.html");
  const agentDelivery = {
    mode: "managed-agent",
    selection: {
      providerId: "synthetic-provider",
      runtimeId: "synthetic-runtime",
      requestedModelId: null,
      resolvedModelId: null,
      reasoning: { requested: null, applied: null, resolution: "provider-default" },
    },
    trustPolicyVersion: "trusted-local-agent-v1",
  };
  const prepared = await repository.prepareRequest({
    target: imported.target,
    requestId: "req_selection_first_provider",
    attemptId: "attempt_001",
    expectedSourceSha256: imported.target.sourceSha256,
    request: {
      freezeCutoffRevision: 0,
      summary: "selection-first request",
      comments: [],
      changeEvents: [],
      instructions: [],
      targets: [],
      agentDelivery,
    },
    prompt: "# selection-first request\n",
  });
  assert.deepEqual(prepared.request.agentDelivery, normalizeAgentDelivery(agentDelivery));
});
