import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createCodexProvider } from "./agent/providers/codex-provider.mjs";
import { runCodexAppServerTask } from "./agent/runtimes/codex-app-server-runtime.mjs";
import { sha256 } from "./lifecycle-core.mjs";
import { ProjectFileRepository } from "./project-file-repository.mjs";
import { normalizeAgentDelivery } from "../shared/agent-delivery.mjs";

const sourceHtml = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Before Codex</title></head>
<body><main><h1>Before Codex</h1><p>Keep this paragraph unchanged.</p></main></body>
</html>
`;
const expectedHeading = "Codex Candidate Verified";

function assert(condition, code, message) {
  if (condition) return;
  const error = new Error(message);
  error.code = code;
  throw error;
}

function countEvents(events) {
  const counts = {};
  for (const event of events) counts[event.kind] = (counts[event.kind] || 0) + 1;
  return counts;
}

async function run() {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "stemmio-codex-live-"));
  const retain = process.env.STEMMIO_KEEP_CODEX_SPIKE === "1";
  const events = [];
  try {
    const sourceRoot = path.join(temporaryRoot, "sources");
    const sourcePath = path.join(sourceRoot, "codex-live.html");
    await mkdir(sourceRoot, { recursive: true });
    await writeFile(sourcePath, sourceHtml, "utf8");

    const repository = new ProjectFileRepository({
      projectsRoot: path.join(temporaryRoot, "projects"),
      agentDeliveryNormalizer(value) {
        return normalizeAgentDelivery(value, { allowLegacy: false });
      },
    });
    const imported = await repository.importExternal({
      sourcePath,
      expectedSourceSha256: sha256(Buffer.from(sourceHtml)),
    });

    const provider = createCodexProvider({ executionEnabled: true });
    const installation = await provider.resolveInstallation({ environment: process.env });
    const evidence = await provider.preflight(installation, { environment: process.env });
    await provider.assertInstallationUnchanged(installation);
    const selection = provider.resolveSelection(provider.defaultSelection, { evidence });

    const requestId = `req_codex_live_${randomUUID().replaceAll("-", "")}`;
    const attemptId = "attempt_001";
    const prepared = await repository.prepareRequest({
      target: imported.target,
      requestId,
      attemptId,
      expectedSourceSha256: imported.target.sourceSha256,
      request: {
        freezeCutoffRevision: 0,
        summary: "Change only the page heading through Codex",
        comments: [{
          commentId: "comment_codex_live",
          text: `Replace the h1 text with exactly: ${expectedHeading}`,
          target: { id: "heading", selector: "h1" },
          attachments: [],
        }],
        changeEvents: [],
        targets: [{ id: "heading", selector: "h1" }],
        agentDelivery: {
          mode: "managed-agent",
          selection,
          trustPolicyVersion: "trusted-local-agent-v1",
        },
      },
      prompt: [
        "Modify the frozen HTML page for this Request.",
        `Replace only the h1 text with exactly: ${expectedHeading}`,
        "Keep the paragraph and all other page content unchanged.",
        "Produce one complete HTML Candidate.",
      ].join("\n"),
    });
    const requestRoot = path.join(
      imported.target.projectRootPath,
      ".pageroot",
      "requests",
      requestId,
    );
    const outputPath = path.join(
      imported.target.projectRootPath,
      ".pageroot",
      ...prepared.outputRelativePath.split("/"),
    );
    const policy = await provider.loadExecutionPolicy({
      requestPath: requestRoot,
      promptPath: path.join(requestRoot, "PROMPT.md"),
      outputPath,
      completionPath: path.join(requestRoot, "attempts", attemptId, "completion.json"),
    });
    const launch = provider.createRuntimeLaunch({
      ticket: { installation, selection },
      policy,
      baseEnvironment: process.env,
      onEvent(event) {
        if (events.length < 2_048) events.push(event);
      },
    });
    const result = await runCodexAppServerTask(launch);
    const candidate = await readFile(outputPath, "utf8");
    const status = await repository.requestStatus({
      target: imported.target,
      requestId,
      attemptId,
    });
    const workspace = await repository.workspace({ sourcePath: imported.target.exactSourcePath });

    assert(result.status === "completed", "CODEX_LIVE_NOT_COMPLETED", "Codex did not complete.");
    assert(status.status === "candidate-ready", "CODEX_LIVE_CANDIDATE_MISSING", "Candidate is not ready.");
    assert(candidate.includes(`<h1>${expectedHeading}</h1>`), "CODEX_LIVE_EDIT_MISSING", "The requested heading edit is missing.");
    assert(candidate.includes("Keep this paragraph unchanged."), "CODEX_LIVE_SCOPE_DRIFT", "Unchanged content was lost.");
    assert(await readFile(sourcePath, "utf8") === sourceHtml, "CODEX_LIVE_SOURCE_CHANGED", "Original source changed.");
    assert(await readFile(imported.target.exactSourcePath, "utf8") === sourceHtml, "CODEX_LIVE_WORKING_COPY_CHANGED", "Working Copy changed.");
    assert(workspace.manifest.versions.length === 1, "CODEX_LIVE_VERSION_CREATED", "Execution created an official Version.");
    assert(workspace.activeCandidate?.candidateId === prepared.candidateId, "CODEX_LIVE_CANDIDATE_AUTHORITY", "Candidate identity drifted.");

    process.stdout.write(`${JSON.stringify({
      ok: true,
      providerId: provider.providerId,
      runtimeId: provider.runtimeId,
      model: selection.resolvedModelId,
      status: status.status,
      candidateId: prepared.candidateId,
      officialVersionCount: workspace.manifest.versions.length,
      originalUnchanged: true,
      workingCopyUnchanged: true,
      eventCounts: countEvents(events),
      ...(retain ? { evidenceRoot: temporaryRoot } : {}),
    }, null, 2)}\n`);
  } finally {
    if (!retain) await rm(temporaryRoot, { recursive: true, force: true });
  }
}

try {
  await run();
} catch (cause) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    code: String(cause?.code || "CODEX_LIVE_EXECUTION_FAILED"),
    message: String(cause?.message || "Codex live execution failed."),
  })}\n`);
  process.exitCode = 1;
}
