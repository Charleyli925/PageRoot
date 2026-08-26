import assert from "node:assert/strict";
import { chmod, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { sha256 } from "../scripts/lifecycle-core.mjs";
import { TRUSTED_LOCAL_AGENT_POLICY_VERSION } from "../scripts/agent-bridge-service.mjs";
import { loadQoderAcpTaskPolicy } from "../scripts/qoder-acp-client.mjs";
import { createBridgeTestEnvironment } from "./helpers/bridge-test-environment.mjs";

const fixtureAgent = fileURLToPath(new URL("./fixtures/qoder-acp-agent.mjs", import.meta.url));

function html(label) {
  return `<!doctype html><html><head><title>${label}</title></head><body><main><h1>${label}</h1></main></body></html>`;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

async function createCommand(environment, { hang = false, pidFile = null } = {}) {
  const command = path.join(environment.root, hang ? "qoder-hang" : "qoder-complete");
  const argumentsText = [
    hang ? "--hang" : null,
    pidFile ? `--pid-file=${pidFile}` : null,
  ].filter(Boolean).map(shellQuote).join(" ");
  await writeFile(
    command,
    `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(fixtureAgent)} ${argumentsText} "$@"\n`,
    { encoding: "utf8", mode: 0o755 },
  );
  await chmod(command, 0o755);
  return command;
}

async function createManagedRequest(t, { hang = false } = {}) {
  const environment = await createBridgeTestEnvironment(t, {
    prefix: hang ? "pageroot-agent-cancel-" : "pageroot-agent-complete-",
  });
  const pidFile = path.join(environment.root, "agent.pid");
  const command = await createCommand(environment, { hang, pidFile });
  const sourceHtml = html(hang ? "Cancel ACP" : "Complete ACP");
  const externalSourcePath = await environment.createSource("agent.html", sourceHtml);
  const bridge = await environment.start({
    HTML_AI_PROJECT_FILES_ROOT: path.join(environment.root, "project-files"),
    PAGEROOT_E2E: "1",
    PAGEROOT_QODER_ACP_ALLOW_TEST_COMMAND: "1",
    PAGEROOT_QODER_ACP_COMMAND: command,
  });
  const workspace = await bridge.requestJson(
    `/workspace?sourcePath=${encodeURIComponent(externalSourcePath)}`,
  );
  const ensured = await bridge.postJson("/project/ensure", {
    sourcePath: externalSourcePath,
    expectedSourceSha256: workspace.body.currentHtmlSha256,
    projectStorageVersion: "4.0.0",
  });
  assert.equal(ensured.response.status, 200, JSON.stringify(ensured.body));
  const unknownRequest = await bridge.postJson("/request", {
    projectId: ensured.body.projectId,
    documentId: ensured.body.documentId,
    sourcePath: ensured.body.sourcePath,
    expectedSourceSha256: ensured.body.sourceSha256,
    freezeCutoffRevision: 0,
    summary: "must not publish",
    comments: [],
    changeEvents: [],
    agentDelivery: {
      mode: "managed-agent",
      selection: {
        providerId: "future-agent",
        runtimeId: "future-runtime",
        requestedModelId: null,
        resolvedModelId: null,
        reasoning: { requested: null, applied: null, resolution: "provider-default" },
      },
      trustPolicyVersion: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
    },
  });
  assert.equal(unknownRequest.response.status, 422, JSON.stringify(unknownRequest.body));
  assert.equal(unknownRequest.body.error.code, "AGENT_PROVIDER_UNSUPPORTED");
  const afterUnknown = await bridge.requestJson(
    `/workspace?sourcePath=${encodeURIComponent(ensured.body.sourcePath)}`,
  );
  assert.equal(afterUnknown.body.activeRun, null);
  const availability = await bridge.requestJson("/agent/availability");
  assert.equal(availability.response.status, 200, JSON.stringify(availability.body));
  assert.equal(availability.body.status, "ready");
  assert.equal("command" in availability.body, false);
  assert.equal("version" in availability.body, false);
  const selectedAvailability = await bridge.requestJson(
    `/agent/availability?selection=${encodeURIComponent(JSON.stringify({
      providerId: "qoder",
      runtimeId: "acp",
      requestedModelId: null,
      resolvedModelId: null,
      reasoning: { requested: null, applied: null, resolution: "provider-default" },
    }))}`,
  );
  assert.equal(selectedAvailability.response.status, 200, JSON.stringify(selectedAvailability.body));
  assert.equal(selectedAvailability.body.status, "ready");
  const unknownAvailability = await bridge.requestJson(
    `/agent/availability?selection=${encodeURIComponent(JSON.stringify({
      providerId: "future-agent",
      runtimeId: "future-runtime",
      requestedModelId: null,
      resolvedModelId: null,
      reasoning: { requested: null, applied: null, resolution: "provider-default" },
    }))}`,
  );
  assert.equal(unknownAvailability.response.status, 400, JSON.stringify(unknownAvailability.body));
  assert.equal(unknownAvailability.body.error.code, "AGENT_PROVIDER_UNSUPPORTED");
  const preflight = await bridge.postJson("/agent/preflight", {
    driver: "qoder-acp",
    trustPolicyAccepted: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
  });
  assert.equal(preflight.response.status, 200, JSON.stringify(preflight.body));
  assert.equal(preflight.body.status, "ready");
  assert.equal("command" in preflight.body, false);
  const request = await bridge.postJson("/request", {
    projectId: ensured.body.projectId,
    documentId: ensured.body.documentId,
    sourcePath: ensured.body.sourcePath,
    expectedSourceSha256: ensured.body.sourceSha256,
    freezeCutoffRevision: 0,
    summary: "完成受管 Qoder ACP 测试任务",
    comments: [],
    changeEvents: [],
    agentDelivery: {
      mode: "managed-agent",
      selection: {
        providerId: "qoder",
        runtimeId: "acp",
        requestedModelId: null,
        resolvedModelId: null,
        reasoning: { requested: null, applied: null, resolution: "provider-default" },
      },
      trustPolicyVersion: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
    },
  });
  assert.equal(request.response.status, 201, JSON.stringify(request.body));
  await loadQoderAcpTaskPolicy({
    requestPath: request.body.activeRun.requestPath,
    promptPath: request.body.activeRun.promptPath,
    outputPath: request.body.activeRun.outputPath,
    completionPath: request.body.activeRun.completionPath,
  });
  const started = await bridge.postJson("/agent/start", {
    projectId: ensured.body.projectId,
    documentId: ensured.body.documentId,
    sourcePath: ensured.body.sourcePath,
    requestId: request.body.requestId,
    attemptId: request.body.attemptId,
    driver: "qoder-acp",
    trustPolicyAccepted: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
    preflightId: preflight.body.preflightId,
  });
  assert.equal(started.response.status, 202, JSON.stringify(started.body));
  return {
    bridge,
    environment,
    ensured: ensured.body,
    request: request.body,
    sourceHtml,
    externalSourcePath,
    pidFile,
    qoderCommand: command,
  };
}

async function waitForStatus(value, predicate, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let latest;
  while (Date.now() < deadline) {
    latest = await value();
    if (predicate(latest)) return latest;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for status: ${JSON.stringify(latest?.body)}`);
}

test("workspace Agent Bridge completes Qoder ACP into pending review without adopting HTML", async (t) => {
  const value = await createManagedRequest(t);
  const statusPath = `/status?sourcePath=${encodeURIComponent(value.ensured.sourcePath)}`
    + `&requestId=${encodeURIComponent(value.request.requestId)}`
    + `&attemptId=${encodeURIComponent(value.request.attemptId)}`;
  const ready = await waitForStatus(
    () => value.bridge.requestJson(statusPath),
    (result) => result.response.status === 200 && result.body.status === "ready-to-open",
  );
  assert.equal(ready.body.agentSession.driver, "qoder-acp");
  assert.equal(ready.body.agentSession.state, "completed");
  assert.equal(ready.body.activeRun.agentDelivery.mode, "managed-agent");
  assert.equal(ready.body.activeRun.agentDelivery.selection.providerId, "qoder");
  assert.equal(ready.body.activeRun.agentDelivery.selection.runtimeId, "acp");
  assert.equal(await readFile(value.externalSourcePath, "utf8"), value.sourceHtml);
  assert.equal(await readFile(value.ensured.sourcePath, "utf8"), value.sourceHtml);

  const candidate = await value.bridge.requestJson(
    `/version-file?sourcePath=${encodeURIComponent(value.ensured.sourcePath)}`
    + `&versionId=${encodeURIComponent(ready.body.versionId)}`,
  );
  assert.equal(candidate.response.status, 200, JSON.stringify(candidate.body));
  assert.match(candidate.body.content, /data-pageroot-qoder-acp="e2e"/u);
  assert.equal(candidate.body.sha256, sha256(Buffer.from(candidate.body.content)));

  const workspace = await value.bridge.requestJson(
    `/workspace?sourcePath=${encodeURIComponent(value.ensured.sourcePath)}`,
  );
  assert.equal(workspace.body.currentExactVersionId, value.ensured.currentExactVersionId);
  assert.equal(workspace.body.runtimeState.activeRun.status, "ready-to-open");
});

test("workspace cancellation stops Qoder before cancelling the durable Request", async (t) => {
  const value = await createManagedRequest(t, { hang: true });
  const pid = Number(await waitForStatus(
    async () => {
      try {
        return { body: { pid: await readFile(value.pidFile, "utf8") } };
      } catch {
        return { body: null };
      }
    },
    (result) => Boolean(result.body?.pid),
  ).then((result) => result.body.pid));
  assert.equal(Number.isSafeInteger(pid), true);

  const cancelled = await value.bridge.postJson("/active-run/cancel", {
    projectId: value.ensured.projectId,
    documentId: value.ensured.documentId,
    sourcePath: value.ensured.sourcePath,
    requestId: value.request.requestId,
    attemptId: value.request.attemptId,
    reason: "agent-bridge-test",
  });
  assert.equal(cancelled.response.status, 200, JSON.stringify(cancelled.body));
  assert.equal(cancelled.body.status, "cancelled");
  await waitForStatus(
    async () => {
      try {
        process.kill(pid, 0);
        return { body: { running: true } };
      } catch (error) {
        if (error?.code === "ESRCH") return { body: { running: false } };
        throw error;
      }
    },
    (result) => result.body.running === false,
  );
  assert.equal(await readFile(value.externalSourcePath, "utf8"), value.sourceHtml);
  assert.equal(await readFile(value.ensured.sourcePath, "utf8"), value.sourceHtml);
  const workspace = await value.bridge.requestJson(
    `/workspace?sourcePath=${encodeURIComponent(value.ensured.sourcePath)}`,
  );
  assert.equal(workspace.body.runtimeState.activeRun, null);
});

test("Bridge crash fences an interrupted Qoder Request from restart and clipboard fallback", async (t) => {
  if (process.platform === "win32") {
    t.skip("detached process-group crash fencing is a POSIX product boundary");
    return;
  }
  const value = await createManagedRequest(t, { hang: true });
  const orphanPid = Number(await waitForStatus(
    async () => {
      try {
        return { body: { pid: await readFile(value.pidFile, "utf8") } };
      } catch {
        return { body: null };
      }
    },
    (result) => Boolean(result.body?.pid),
  ).then((result) => result.body.pid));
  t.after(() => {
    try {
      process.kill(-orphanPid, "SIGKILL");
    } catch (error) {
      if (error?.code !== "ESRCH") throw error;
    }
  });
  const crashed = new Promise((resolve) => value.bridge.child.once("exit", resolve));
  value.bridge.child.kill("SIGKILL");
  await crashed;

  const retryCommand = await createCommand(value.environment);
  const restarted = await value.environment.start({
    HTML_AI_PROJECT_FILES_ROOT: path.join(value.environment.root, "project-files"),
    PAGEROOT_E2E: "1",
    PAGEROOT_QODER_ACP_ALLOW_TEST_COMMAND: "1",
    PAGEROOT_QODER_ACP_COMMAND: retryCommand,
  });
  const statusPath = `/status?sourcePath=${encodeURIComponent(value.ensured.sourcePath)}`
    + `&requestId=${encodeURIComponent(value.request.requestId)}`
    + `&attemptId=${encodeURIComponent(value.request.attemptId)}`;
  const interrupted = await restarted.requestJson(statusPath);
  assert.equal(interrupted.response.status, 200, JSON.stringify(interrupted.body));
  assert.equal(interrupted.body.status, "processing");
  assert.equal(interrupted.body.agentSession.state, "interrupted");
  assert.equal(interrupted.body.agentSession.retryable, false);
  assert.equal(
    interrupted.body.agentSession.errorCode,
    "AGENT_RESTART_RECOVERY_REQUIRED",
  );

  const preflight = await restarted.postJson("/agent/preflight", {
    driver: "qoder-acp",
    trustPolicyAccepted: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
  });
  const retried = await restarted.postJson("/agent/start", {
    projectId: value.ensured.projectId,
    documentId: value.ensured.documentId,
    sourcePath: value.ensured.sourcePath,
    requestId: value.request.requestId,
    attemptId: value.request.attemptId,
    driver: "qoder-acp",
    trustPolicyAccepted: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
    preflightId: preflight.body.preflightId,
  });
  assert.equal(retried.response.status, 409, JSON.stringify(retried.body));
  assert.equal(retried.body.error.code, "AGENT_RESTART_RECOVERY_REQUIRED");

  const cancelled = await restarted.postJson("/active-run/cancel", {
    projectId: value.ensured.projectId,
    documentId: value.ensured.documentId,
    sourcePath: value.ensured.sourcePath,
    requestId: value.request.requestId,
    attemptId: value.request.attemptId,
    reason: "bridge-crash-fence-test",
  });
  assert.equal(cancelled.response.status, 200, JSON.stringify(cancelled.body));
  assert.equal(cancelled.body.status, "cancelled");
  const requestsRoot = path.join(
    value.ensured.projectRoot,
    ".pageroot",
    "requests",
  );
  const requestDirectories = await readdir(requestsRoot);
  assert.equal(requestDirectories.filter((name) => name.startsWith("req_")).length, 1);
  assert.equal(await readFile(value.externalSourcePath, "utf8"), value.sourceHtml);
  assert.equal(await readFile(value.ensured.sourcePath, "utf8"), value.sourceHtml);
});
