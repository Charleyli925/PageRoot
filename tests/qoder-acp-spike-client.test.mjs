import assert from "node:assert/strict";
import {
  chmod,
  mkdir,
  mkdtemp,
  link,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import * as acp from "@agentclientprotocol/sdk";

import {
  captureQoderAcpReviewBoundary,
  createRestrictedQoderAcpHost,
  loadQoderAcpTaskPolicy,
  runAcpTask,
  runQoderAcpTask,
} from "../scripts/qoder-acp-spike-client.mjs";
import { sha256 } from "../scripts/lifecycle-core.mjs";
import { ProjectFileRepository } from "../scripts/project-file-repository.mjs";

const IDENTITIES = Object.freeze({
  requestId: "req_aaaaaaaaaaaaaaaa",
  attemptId: "attempt_001",
});
const READ_FILE_COUNT = 6;
const productRoot = fileURLToPath(new URL("../", import.meta.url));
const acpSdkModuleUrl = pathToFileURL(path.join(
  productRoot,
  "node_modules",
  "@agentclientprotocol",
  "sdk",
  "dist",
  "acp.js",
)).href;

async function createFixture(t) {
  const root = await realpath(
    await mkdtemp(path.join(tmpdir(), "pageroot-qoder-acp-test-")),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  const sources = path.join(root, "sources");
  const projects = path.join(root, "projects");
  await mkdir(sources, { recursive: true });
  const sourceHtml = "<!doctype html><html><head><title>Before</title></head><body><h1>Before</h1></body></html>\n";
  const sourcePath = path.join(sources, "synthetic.html");
  await writeFile(sourcePath, sourceHtml, "utf8");
  const repository = new ProjectFileRepository({ projectsRoot: projects });
  const imported = await repository.importExternal({
    sourcePath,
    expectedSourceSha256: sha256(Buffer.from(sourceHtml, "utf8")),
  });
  const { target } = imported;
  const promptText = "Follow the PageRoot task contract.\n";
  const request = await repository.prepareRequest({
    target,
    ...IDENTITIES,
    expectedSourceSha256: target.sourceSha256,
    request: {
      freezeCutoffRevision: 0,
      summary: "Synthetic ACP test",
      comments: [],
      changeEvents: [],
      instructions: [],
      targets: [],
    },
    prompt: promptText,
  });
  const requestPath = await realpath(path.join(
    target.projectRootPath,
    ".pageroot",
    "requests",
    IDENTITIES.requestId,
  ));
  const outputPath = path.join(
    requestPath,
    "attempts",
    IDENTITIES.attemptId,
    "output",
    "candidate.html",
  );
  const completionPath = path.join(
    requestPath,
    "attempts",
    IDENTITIES.attemptId,
    "completion.json",
  );
  const manifestPath = path.join(requestPath, "input-manifest.json");
  const options = {
    requestPath,
    promptPath: path.join(requestPath, "PROMPT.md"),
    outputPath,
    completionPath,
  };
  const policy = await loadQoderAcpTaskPolicy(options);
  return {
    root,
    repository,
    target,
    sourceHtml,
    requestPath,
    manifestPath,
    outputPath,
    completionPath,
    finalizer: policy.finalizer,
    promptText,
    request,
    options,
    policy,
  };
}

test("Qoder ACP policy freezes identities, hashes, and real files", async (t) => {
  const fixture = await createFixture(t);
  assert.equal(fixture.policy.requestRoot, fixture.requestPath);
  assert.equal(fixture.policy.readableFiles.length, READ_FILE_COUNT + 1);

  await writeFile(fixture.options.promptPath, "drifted\n", "utf8");
  await assert.rejects(
    loadQoderAcpTaskPolicy(fixture.options),
    (error) => error?.code === "ACP_FROZEN_INPUT_DRIFT",
  );
});

test("Qoder ACP policy rejects symlinked frozen input", async (t) => {
  const fixture = await createFixture(t);
  const rulesPath = path.join(fixture.requestPath, "input", "AI_RULES.md");
  const targetPath = path.join(fixture.requestPath, "input", "rules-target.md");
  await writeFile(targetPath, "Only modify the frozen Candidate.\n", "utf8");
  await rm(rulesPath);
  await symlink(targetPath, rulesPath);

  await assert.rejects(
    loadQoderAcpTaskPolicy(fixture.options),
    (error) => error?.code === "ACP_UNSAFE_FILE",
  );
});

test("Qoder ACP policy rejects a symlinked frozen-input ancestor", async (t) => {
  const fixture = await createFixture(t);
  const annotationsRoot = path.join(fixture.requestPath, "input", "annotations");
  const movedRoot = path.join(fixture.requestPath, "input", "annotations-real");
  await rename(annotationsRoot, movedRoot);
  await symlink(movedRoot, annotationsRoot, "dir");

  await assert.rejects(
    loadQoderAcpTaskPolicy(fixture.options),
    (error) => error?.code === "ACP_UNSAFE_ANCESTOR",
  );
});

test("Qoder ACP policy derives authority and rejects caller-injected policy fields", async (t) => {
  const fixture = await createFixture(t);
  await assert.rejects(
    loadQoderAcpTaskPolicy({
      ...fixture.options,
      inputManifestSha256: "sha256:" + "0".repeat(64),
    }),
    (error) => error?.code === "ACP_POLICY_OPTIONS_INVALID",
  );
  await assert.rejects(
    loadQoderAcpTaskPolicy({
      ...fixture.options,
      outputPath: path.join(
        fixture.requestPath,
        "attempts",
        IDENTITIES.attemptId,
        "output",
        "other.html",
      ),
    }),
    (error) => error?.code === "ACP_OUTPUT_ATTEMPT_MISMATCH",
  );
  await assert.rejects(
    loadQoderAcpTaskPolicy({
      ...fixture.options,
      finalizer: fixture.finalizer,
    }),
    (error) => error?.code === "ACP_POLICY_OPTIONS_INVALID",
  );

  const runtimePath = path.join(
    path.dirname(path.dirname(fixture.requestPath)),
    "runtime-state.json",
  );
  const runtime = JSON.parse(await readFile(runtimePath, "utf8"));
  runtime.activeRequest.inputManifestSha256 = "sha256:" + "0".repeat(64);
  await writeFile(runtimePath, `${JSON.stringify(runtime, null, 2)}\n`, "utf8");
  await assert.rejects(
    loadQoderAcpTaskPolicy(fixture.options),
    (error) => error?.code === "ACP_RUNTIME_AUTHORITY_MISMATCH",
  );

  const forgedRequestFixture = await createFixture(t);
  const requestRecordPath = path.join(forgedRequestFixture.requestPath, "request.json");
  const requestRecord = JSON.parse(await readFile(requestRecordPath, "utf8"));
  requestRecord.outputRelativePath = `requests/${IDENTITIES.requestId}/attempts/${IDENTITIES.attemptId}/output/other.html`;
  await writeFile(requestRecordPath, `${JSON.stringify(requestRecord, null, 2)}\n`, "utf8");
  await assert.rejects(
    loadQoderAcpTaskPolicy(forgedRequestFixture.options),
    (error) => error?.code === "ACP_REQUEST_AUTHORITY_MISMATCH",
  );

  const manifestDriftFixture = await createFixture(t);
  const manifestText = await readFile(manifestDriftFixture.manifestPath, "utf8");
  await writeFile(manifestDriftFixture.manifestPath, `${manifestText}\n`, "utf8");
  await assert.rejects(
    loadQoderAcpTaskPolicy(manifestDriftFixture.options),
    (error) => error?.code === "ACP_INPUT_MANIFEST_HASH_MISMATCH",
  );
});

test("restricted Qoder ACP host exposes only frozen reads, Candidate write, and finalizer", async (t) => {
  const fixture = await createFixture(t);
  const events = [];
  const host = createRestrictedQoderAcpHost(fixture.policy, {
    onEvent: (event) => events.push(event),
  });
  t.after(() => host.dispose());
  const sessionId = "session_synthetic";
  host.bindSessionId(sessionId);

  const prompt = await host.readTextFile({
    sessionId,
    path: fixture.options.promptPath,
    line: 1,
    limit: 1,
  });
  assert.equal(prompt.content, fixture.promptText);
  await assert.rejects(
    host.readTextFile({
      sessionId,
      path: fixture.options.promptPath,
      line: 0,
    }),
    (error) => error?.code === "ACP_READ_RANGE_INVALID",
  );
  await assert.rejects(
    host.readTextFile({ sessionId, path: path.join(fixture.requestPath, "secret.txt") }),
    (error) => error?.code === "ACP_READ_NOT_AUTHORIZED",
  );
  await assert.rejects(
    host.readTextFile({ sessionId: "wrong", path: fixture.options.promptPath }),
    (error) => error?.code === "ACP_SESSION_ID_MISMATCH",
  );

  const candidate = "<!doctype html><html><head><title>Candidate</title></head><body><h1>ACP Candidate</h1></body></html>\n";
  await link(fixture.options.promptPath, fixture.outputPath);
  await assert.rejects(
    host.writeTextFile({ sessionId, path: fixture.outputPath, content: candidate }),
    (error) => error?.code === "ACP_UNSAFE_OUTPUT_FILE",
  );
  assert.equal(await readFile(fixture.options.promptPath, "utf8"), fixture.promptText);
  await rm(fixture.outputPath);
  await host.writeTextFile({
    sessionId,
    path: fixture.outputPath,
    content: candidate,
  });
  assert.equal(await readFile(fixture.outputPath, "utf8"), candidate);
  await assert.rejects(
    host.writeTextFile({
      sessionId,
      path: path.join(fixture.requestPath, "current.html"),
      content: candidate,
    }),
    (error) => error?.code === "ACP_WRITE_NOT_AUTHORIZED",
  );
  await assert.rejects(
    host.createTerminal({ sessionId, command: process.execPath, args: ["--version"] }),
    (error) => error?.code === "ACP_TERMINAL_NOT_AUTHORIZED",
  );
  await assert.rejects(
    host.createTerminal({
      sessionId,
      command: fixture.finalizer.command,
      args: fixture.finalizer.args,
    }),
    (error) => error?.code === "ACP_TERMINAL_NOT_AUTHORIZED",
  );
  await assert.rejects(
    host.createTerminal({
      sessionId,
      command: fixture.finalizer.command,
      args: fixture.finalizer.args,
      cwd: fixture.finalizer.cwd,
    }),
    (error) => error?.code === "ACP_TERMINAL_NOT_AUTHORIZED",
  );

  const permission = await host.requestPermission({
    sessionId,
    toolCall: { kind: "execute" },
    options: [
      { optionId: "always", kind: "allow_always", name: "Always" },
      { optionId: "once", kind: "allow_once", name: "Once" },
    ],
  });
  assert.deepEqual(permission, {
    outcome: { outcome: "selected", optionId: "once" },
  });
  assert.deepEqual(await host.requestPermission({
    sessionId,
    toolCall: { kind: "execute" },
    options: [{ optionId: "always", kind: "allow_always", name: "Always" }],
  }), { outcome: { outcome: "cancelled" } });

  const created = await host.createTerminal({
    sessionId,
    command: fixture.finalizer.command,
    args: fixture.finalizer.args,
    cwd: fixture.finalizer.cwd,
    env: Object.entries(fixture.finalizer.env).map(([name, value]) => ({ name, value })),
    outputByteLimit: 1024,
  });
  const exitStatus = await host.waitForTerminalExit({ sessionId, terminalId: created.terminalId });
  const terminalOutput = await host.terminalOutput({
    sessionId,
    terminalId: created.terminalId,
  });
  assert.deepEqual(exitStatus, {
    exitCode: 0,
    signal: null,
  }, terminalOutput.output);
  const completion = JSON.parse(await readFile(fixture.completionPath, "utf8"));
  assert.equal(completion.requestId, IDENTITIES.requestId);
  assert.equal(completion.outputSha256, sha256(Buffer.from(candidate, "utf8")));
  assert.deepEqual(terminalOutput.exitStatus, { exitCode: 0, signal: null });
  await host.releaseTerminal({ sessionId, terminalId: created.terminalId });
  const verifiedCompletion = await host.assertTurnCompleted();
  assert.equal(verifiedCompletion.outputSha256, completion.outputSha256);
  await assert.rejects(
    host.writeTextFile({ sessionId, path: fixture.outputPath, content: candidate }),
    (error) => error?.code === "ACP_HOST_FINALIZED",
  );
  assert.ok(events.some((event) => event.kind === "file-read"));
  assert.ok(events.some((event) => event.kind === "file-written"));
  assert.ok(events.some((event) => event.kind === "terminal-exited"));
});

test("restricted Qoder ACP host rejects cancelled and late mutating requests", async (t) => {
  const fixture = await createFixture(t);
  const host = createRestrictedQoderAcpHost(fixture.policy);
  t.after(() => host.dispose());
  const sessionId = "session_cancel_boundary";
  host.bindSessionId(sessionId);
  const candidate = "<!doctype html><html><body><h1>Before cancel</h1></body></html>\n";
  await host.writeTextFile({
    sessionId,
    path: fixture.outputPath,
    content: candidate,
  });

  const requestCancellation = new AbortController();
  requestCancellation.abort();
  await assert.rejects(
    host.readTextFile({ sessionId, path: fixture.options.promptPath }, requestCancellation.signal),
    (error) => error?.code === "ACP_REQUEST_CANCELLED",
  );

  await host.cancel();
  assert.deepEqual(await host.requestPermission({
    sessionId,
    toolCall: { kind: "edit" },
    options: [{ optionId: "once", kind: "allow_once", name: "Once" }],
  }), { outcome: { outcome: "cancelled" } });
  await assert.rejects(
    host.writeTextFile({
      sessionId,
      path: fixture.outputPath,
      content: "<!doctype html><html><body><h1>Late write</h1></body></html>\n",
    }),
    (error) => error?.code === "ACP_HOST_CANCELLING",
  );
  await assert.rejects(
    host.createTerminal({
      sessionId,
      command: fixture.finalizer.command,
      args: fixture.finalizer.args,
      cwd: fixture.finalizer.cwd,
      env: [],
    }),
    (error) => error?.code === "ACP_HOST_CANCELLING",
  );
  assert.equal(await readFile(fixture.outputPath, "utf8"), candidate);
});

test("Qoder ACP mutation lock closes cancel and finalizer overlap races", async (t) => {
  const cancelledFixture = await createFixture(t);
  let announceCancelledRename;
  let releaseCancelledRename;
  const cancelledRenameStarted = new Promise((resolve) => {
    announceCancelledRename = resolve;
  });
  const cancelledRenameRelease = new Promise((resolve) => {
    releaseCancelledRename = resolve;
  });
  const cancelledHost = createRestrictedQoderAcpHost(cancelledFixture.policy, {
    renameOutput: async (...args) => {
      announceCancelledRename();
      await cancelledRenameRelease;
      return rename(...args);
    },
  });
  t.after(() => cancelledHost.dispose());
  const cancelledSessionId = "session_cancel_during_rename";
  cancelledHost.bindSessionId(cancelledSessionId);
  const candidate = "<!doctype html><html><head><title>Atomic Candidate</title></head><body><h1>Atomic Candidate</h1></body></html>\n";
  const cancelledWrite = cancelledHost.writeTextFile({
    sessionId: cancelledSessionId,
    path: cancelledFixture.outputPath,
    content: candidate,
  });
  void cancelledWrite.catch(() => {});
  await cancelledRenameStarted;
  const cancellation = cancelledHost.cancel();
  releaseCancelledRename();
  await assert.rejects(
    cancelledWrite,
    (error) => error?.code === "ACP_HOST_CANCELLING",
  );
  await cancellation;
  await assert.rejects(
    readFile(cancelledFixture.outputPath),
    (error) => error?.code === "ENOENT",
  );
  assert.deepEqual(await readdir(path.dirname(cancelledFixture.outputPath)), []);

  const serializedFixture = await createFixture(t);
  let announceSerializedRename;
  let releaseSerializedRename;
  const serializedRenameStarted = new Promise((resolve) => {
    announceSerializedRename = resolve;
  });
  const serializedRenameRelease = new Promise((resolve) => {
    releaseSerializedRename = resolve;
  });
  const events = [];
  const serializedHost = createRestrictedQoderAcpHost(serializedFixture.policy, {
    renameOutput: async (...args) => {
      announceSerializedRename();
      await serializedRenameRelease;
      return rename(...args);
    },
    onEvent: (event) => events.push(event.kind),
  });
  t.after(() => serializedHost.dispose());
  const serializedSessionId = "session_write_before_finalizer";
  serializedHost.bindSessionId(serializedSessionId);
  const serializedWrite = serializedHost.writeTextFile({
    sessionId: serializedSessionId,
    path: serializedFixture.outputPath,
    content: candidate,
  });
  await serializedRenameStarted;
  let terminalSettled = false;
  const terminalCreation = serializedHost.createTerminal({
    sessionId: serializedSessionId,
    command: serializedFixture.finalizer.command,
    args: serializedFixture.finalizer.args,
    cwd: serializedFixture.finalizer.cwd,
    env: [],
    outputByteLimit: 1024,
  }).finally(() => {
    terminalSettled = true;
  });
  void terminalCreation.catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(terminalSettled, false);
  releaseSerializedRename();
  await serializedWrite;
  const created = await terminalCreation;
  const exit = await serializedHost.waitForTerminalExit({
    sessionId: serializedSessionId,
    terminalId: created.terminalId,
  });
  assert.deepEqual(exit, { exitCode: 0, signal: null });
  await serializedHost.releaseTerminal({
    sessionId: serializedSessionId,
    terminalId: created.terminalId,
  });
  await serializedHost.assertTurnCompleted();
  assert.ok(events.indexOf("file-written") < events.indexOf("terminal-created"));
});

function createSyntheticAgent(fixture, observed) {
  const sessionId = "session_agent_bridge";
  return acp
    .agent({ name: "pageroot-synthetic-agent" })
    .onRequest(acp.methods.agent.initialize, ({ params }) => {
      observed.initialize = params;
      return {
        protocolVersion: acp.PROTOCOL_VERSION,
        agentCapabilities: { loadSession: false },
        authMethods: [],
        agentInfo: {
          name: "pageroot-synthetic-agent",
          title: "PageRoot Synthetic Agent",
          version: "1.0.0",
        },
      };
    })
    .onRequest(acp.methods.agent.session.new, ({ params }) => {
      observed.newSession = params;
      return { sessionId };
    })
    .onRequest(acp.methods.agent.session.prompt, async ({ params, client }) => {
      observed.prompt = params;
      await client.notify(acp.methods.client.session.update, {
        sessionId,
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "tool_synthetic",
          title: "Build Candidate",
          kind: "edit",
          status: "in_progress",
          locations: [{ path: fixture.outputPath }],
        },
      });
      const permission = await client.request(
        acp.methods.client.session.requestPermission,
        {
          sessionId,
          toolCall: {
            toolCallId: "tool_synthetic",
            title: "Build Candidate",
            kind: "edit",
            status: "pending",
          },
          options: [
            { optionId: "allow", kind: "allow_once", name: "Allow once" },
            { optionId: "reject", kind: "reject_once", name: "Reject" },
          ],
        },
      );
      observed.permission = permission;
      observed.manifest = await client.request(acp.methods.client.fs.readTextFile, {
        sessionId,
        path: fixture.manifestPath,
      });
      observed.promptFile = await client.request(acp.methods.client.fs.readTextFile, {
        sessionId,
        path: fixture.options.promptPath,
      });
      const candidate = "<!doctype html><html><head><title>Candidate</title></head><body><h1>ACP Candidate</h1></body></html>\n";
      await client.request(acp.methods.client.fs.writeTextFile, {
        sessionId,
        path: fixture.outputPath,
        content: candidate,
      });
      const created = await client.request(acp.methods.client.terminal.create, {
        sessionId,
        command: fixture.finalizer.command,
        args: fixture.finalizer.args,
        cwd: fixture.finalizer.cwd,
        env: Object.entries(fixture.finalizer.env).map(([name, value]) => ({ name, value })),
        outputByteLimit: 1024,
      });
      observed.exit = await client.request(acp.methods.client.terminal.waitForExit, {
        sessionId,
        terminalId: created.terminalId,
      });
      observed.output = await client.request(acp.methods.client.terminal.output, {
        sessionId,
        terminalId: created.terminalId,
      });
      await client.request(acp.methods.client.terminal.release, {
        sessionId,
        terminalId: created.terminalId,
      });
      return { stopReason: "end_turn" };
    });
}

async function createStdioAgentScript(fixture) {
  const scriptPath = path.join(fixture.root, "synthetic-stdio-agent.mjs");
  const source = `import { Readable, Writable } from "node:stream";
import * as acp from ${JSON.stringify(acpSdkModuleUrl)};

const config = JSON.parse(process.argv[2]);
const sessionId = "session_stdio_agent";
const app = acp.agent({ name: "pageroot-stdio-agent" })
  .onRequest(acp.methods.agent.initialize, () => ({
    protocolVersion: acp.PROTOCOL_VERSION,
    agentCapabilities: { loadSession: false },
    authMethods: [],
    agentInfo: { name: "pageroot-stdio-agent", version: "1.0.0" },
  }))
  .onRequest(acp.methods.agent.session.new, ({ params }) => {
    if (params.cwd !== config.requestPath || params.mcpServers.length !== 0) {
      throw new Error("unexpected session scope");
    }
    return { sessionId };
  })
  .onRequest(acp.methods.agent.session.prompt, async ({ client }) => {
    await client.request(acp.methods.client.fs.readTextFile, {
      sessionId,
      path: config.manifestPath,
    });
    await client.request(acp.methods.client.fs.writeTextFile, {
      sessionId,
      path: config.outputPath,
      content: config.candidate,
    });
    const terminal = await client.request(acp.methods.client.terminal.create, {
      sessionId,
      command: config.finalizer.command,
      args: config.finalizer.args,
      cwd: config.finalizer.cwd,
      env: [],
      outputByteLimit: 4096,
    });
    const status = await client.request(acp.methods.client.terminal.waitForExit, {
      sessionId,
      terminalId: terminal.terminalId,
    });
    if (status.exitCode !== 0 || status.signal) throw new Error("finalizer failed");
    await client.request(acp.methods.client.terminal.release, {
      sessionId,
      terminalId: terminal.terminalId,
    });
    if (config.exitAfterStop) setTimeout(() => process.exit(0), 0);
    return { stopReason: "end_turn" };
  });

app.connect(acp.ndJsonStream(
  Writable.toWeb(process.stdout),
  Readable.toWeb(process.stdin),
));
`;
  await writeFile(scriptPath, source, "utf8");
  return scriptPath;
}

async function createRawStdoutScript(fixture, name, body) {
  const scriptPath = path.join(fixture.root, `${name}.mjs`);
  await writeFile(scriptPath, `${body}\nsetInterval(() => {}, 1_000);\n`, "utf8");
  return scriptPath;
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    throw error;
  }
}

async function waitForProcessExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (processExists(pid) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return !processExists(pid);
}

test("ACP ClientApp completes a synthetic PageRoot Candidate turn", async (t) => {
  const fixture = await createFixture(t);
  const reviewBoundaryBefore = await captureQoderAcpReviewBoundary({
    repository: fixture.repository,
    target: fixture.target,
    projectRoot: fixture.target.projectRootPath,
  });
  const observed = {};
  const events = [];
  const result = await runAcpTask({
    connection: createSyntheticAgent(fixture, observed),
    policy: fixture.policy,
    prompt: "Read PROMPT.md and complete the frozen task.",
    onEvent: (event) => events.push(event),
    startupTimeoutMs: 1_000,
    turnTimeoutMs: 2_000,
  });

  assert.equal(result.stopReason, "end_turn");
  assert.equal(result.initialized.agentInfo.name, "pageroot-synthetic-agent");
  assert.equal(observed.newSession.cwd, fixture.requestPath);
  assert.deepEqual(observed.newSession.mcpServers, []);
  assert.equal(observed.newSession.additionalDirectories, undefined);
  assert.deepEqual(observed.permission, {
    outcome: { outcome: "selected", optionId: "allow" },
  });
  assert.match(observed.manifest.content, /"frozen": true/u);
  assert.equal(observed.promptFile.content, fixture.promptText);
  assert.deepEqual(observed.exit, { exitCode: 0, signal: null });
  const status = await fixture.repository.requestStatus({
    target: fixture.target,
    ...IDENTITIES,
  });
  assert.equal(status.status, "candidate-ready");
  assert.equal(status.candidate.outputSha256, result.completion.outputSha256);
  assert.equal(await readFile(fixture.target.exactSourcePath, "utf8"), fixture.sourceHtml);
  const reviewBoundaryAfter = await captureQoderAcpReviewBoundary({
    repository: fixture.repository,
    target: fixture.target,
    projectRoot: fixture.target.projectRootPath,
  });
  assert.deepEqual(reviewBoundaryAfter, reviewBoundaryBefore);
  assert.equal(result.updates[0].type, "tool_call");
  assert.ok(events.some((event) => event.kind === "turn-stopped"));
});

test("ACP stdio transport completes the same synthetic Candidate contract", async (t) => {
  const fixture = await createFixture(t);
  const candidate = "<!doctype html><html><head><title>Stdio Candidate</title></head><body><h1>ACP stdio Candidate</h1></body></html>\n";
  const scriptPath = await createStdioAgentScript(fixture);
  const result = await runQoderAcpTask({
    command: process.execPath,
    args: [scriptPath, JSON.stringify({
      requestPath: fixture.requestPath,
      manifestPath: fixture.manifestPath,
      outputPath: fixture.outputPath,
      finalizer: fixture.finalizer,
      candidate,
    })],
    policy: fixture.policy,
    prompt: "complete stdio fixture",
    startupTimeoutMs: 2_000,
    turnTimeoutMs: 3_000,
  });

  assert.equal(result.stopReason, "end_turn");
  assert.equal(result.initialized.agentInfo.name, "pageroot-stdio-agent");
  assert.equal(result.stderr, "");
  const status = await fixture.repository.requestStatus({
    target: fixture.target,
    ...IDENTITIES,
  });
  assert.equal(status.status, "candidate-ready");
  assert.equal(await readFile(fixture.target.exactSourcePath, "utf8"), fixture.sourceHtml);
  await assert.rejects(
    runQoderAcpTask({
      command: process.execPath,
      args: [scriptPath, "{}"],
      policy: fixture.policy,
      prompt: "must not start",
      environment: { NODE_OPTIONS: "--require=untrusted" },
    }),
    /not allowed/u,
  );
});

test("ACP stdio transport accepts a valid completed turn before immediate Agent exit", async (t) => {
  const fixture = await createFixture(t);
  const candidate = "<!doctype html><html><head><title>Immediate exit</title></head><body><h1>Immediate exit Candidate</h1></body></html>\n";
  const scriptPath = await createStdioAgentScript(fixture);
  const result = await runQoderAcpTask({
    command: process.execPath,
    args: [scriptPath, JSON.stringify({
      requestPath: fixture.requestPath,
      manifestPath: fixture.manifestPath,
      outputPath: fixture.outputPath,
      finalizer: fixture.finalizer,
      candidate,
      exitAfterStop: true,
    })],
    policy: fixture.policy,
    prompt: "complete and exit immediately",
    startupTimeoutMs: 2_000,
    turnTimeoutMs: 3_000,
  });

  assert.equal(result.stopReason, "end_turn");
  assert.equal(result.completion.outputSha256, sha256(Buffer.from(candidate, "utf8")));
  const status = await fixture.repository.requestStatus({
    target: fixture.target,
    ...IDENTITIES,
  });
  assert.equal(status.status, "candidate-ready");
});

test("ACP stdio transport fails immediately on process errors and cleans orphaned groups", async (t) => {
  const fixture = await createFixture(t);
  const invalidExecutable = path.join(fixture.root, "missing-interpreter-agent");
  await writeFile(invalidExecutable, "#!/pageroot/definitely-missing-interpreter\n", "utf8");
  await chmod(invalidExecutable, 0o700);
  await assert.rejects(
    runQoderAcpTask({
      command: invalidExecutable,
      args: [],
      policy: fixture.policy,
      prompt: "must fail at spawn",
      startupTimeoutMs: 5_000,
      turnTimeoutMs: 5_000,
    }),
    (error) => error?.code === "ACP_AGENT_PROCESS_ERROR",
  );

  if (process.platform === "win32") return;
  const pidPath = path.join(fixture.root, "grandchild.pid");
  const earlyExitScript = path.join(fixture.root, "early-exit-agent.mjs");
  await writeFile(earlyExitScript, `import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
const grandchild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
  stdio: "ignore",
});
writeFileSync(process.argv[2], String(grandchild.pid));
grandchild.unref();
process.exit(7);
`, "utf8");
  const startedAt = Date.now();
  await assert.rejects(
    runQoderAcpTask({
      command: process.execPath,
      args: [earlyExitScript, pidPath],
      policy: fixture.policy,
      prompt: "must fail on early exit",
      startupTimeoutMs: 10_000,
      turnTimeoutMs: 10_000,
    }),
    (error) => error?.code === "ACP_AGENT_EXITED_EARLY",
  );
  assert.ok(Date.now() - startedAt < 5_000, "early exit waited for the ACP startup timeout");
  const grandchildPid = Number(await readFile(pidPath, "utf8"));
  t.after(() => {
    if (processExists(grandchildPid)) process.kill(grandchildPid, "SIGKILL");
  });
  assert.equal(
    await waitForProcessExit(grandchildPid, 3_000),
    true,
    "the detached ACP process group retained a grandchild",
  );
});

test("ACP stdio transport rejects invalid UTF-8 and oversized unterminated frames", async (t) => {
  const fixture = await createFixture(t);
  const invalidUtf8 = await createRawStdoutScript(
    fixture,
    "invalid-utf8-agent",
    "process.stdout.write(Buffer.from([0xff, 0x0a]));",
  );
  await assert.rejects(
    runQoderAcpTask({
      command: process.execPath,
      args: [invalidUtf8],
      policy: fixture.policy,
      prompt: "invalid utf8",
      startupTimeoutMs: 2_000,
      turnTimeoutMs: 2_000,
    }),
    (error) => error?.code === "ACP_UTF8_INVALID",
  );

  const oversizedFrame = await createRawStdoutScript(
    fixture,
    "oversized-frame-agent",
    "process.stdout.write(Buffer.alloc(23 * 1024 * 1024, 0x61));",
  );
  await assert.rejects(
    runQoderAcpTask({
      command: process.execPath,
      args: [oversizedFrame],
      policy: fixture.policy,
      prompt: "oversized frame",
      startupTimeoutMs: 5_000,
      turnTimeoutMs: 2_000,
    }),
    (error) => error?.code === "ACP_FRAME_TOO_LARGE",
  );
});

test("ACP stop reason cannot replace Candidate finalization evidence", async (t) => {
  const fixture = await createFixture(t);
  const agent = acp
    .agent({ name: "pageroot-early-stop-agent" })
    .onRequest(acp.methods.agent.initialize, () => ({
      protocolVersion: acp.PROTOCOL_VERSION,
      agentCapabilities: { loadSession: false },
      authMethods: [],
    }))
    .onRequest(acp.methods.agent.session.new, () => ({ sessionId: "session_early_stop" }))
    .onRequest(acp.methods.agent.session.prompt, () => ({ stopReason: "end_turn" }));

  await assert.rejects(
    runAcpTask({
      connection: agent,
      policy: fixture.policy,
      prompt: "stop too early",
      startupTimeoutMs: 1_000,
      turnTimeoutMs: 1_000,
    }),
    (error) => error?.code === "ACP_FINALIZER_NOT_COMPLETED",
  );
});

test("ACP turn timeout fails closed and requests session cancellation", async (t) => {
  const fixture = await createFixture(t);
  let releasePrompt;
  let cancelled = false;
  const agent = acp
    .agent({ name: "pageroot-timeout-agent" })
    .onRequest(acp.methods.agent.initialize, () => ({
      protocolVersion: acp.PROTOCOL_VERSION,
      agentCapabilities: { loadSession: false },
      authMethods: [],
    }))
    .onRequest(acp.methods.agent.session.new, () => ({ sessionId: "session_timeout" }))
    .onRequest(acp.methods.agent.session.prompt, () => new Promise((resolve) => {
      releasePrompt = resolve;
    }))
    .onNotification(acp.methods.agent.session.cancel, () => {
      cancelled = true;
      releasePrompt?.({ stopReason: "cancelled" });
    });

  await assert.rejects(
    runAcpTask({
      connection: agent,
      policy: fixture.policy,
      prompt: "wait",
      startupTimeoutMs: 1_000,
      turnTimeoutMs: 30,
    }),
    (error) => error?.code === "ACP_TIMEOUT",
  );
  assert.equal(cancelled, true);
});
