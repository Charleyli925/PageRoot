import assert from "node:assert/strict";
import {
  chmod,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  AgentBridgeError,
  AgentBridgeService,
  resolveQoderAcpCommand,
  TRUSTED_LOCAL_AGENT_POLICY_VERSION,
} from "../scripts/agent-bridge-service.mjs";
import {
  cancelDurableRequestAfterAgentCleanup,
  closeWorkspaceBridgeAfterAgentCleanup,
} from "../scripts/workspace-bridge-shutdown.mjs";

const IDENTITY = Object.freeze({
  projectId: `project_${"a".repeat(16)}`,
  documentId: `doc_${"b".repeat(16)}`,
  requestId: "req_agent_bridge_001",
  attemptId: "attempt_001",
  sourcePath: "/tmp/pageroot-agent-bridge.html",
});

async function createFakeCommand(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "pageroot-agent-service-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const command = path.join(root, "fake-qoder.mjs");
  await writeFile(command, `#!/usr/bin/env node
if (process.argv.includes("--version")) {
  process.stdout.write("1.1.27\\n");
  process.exit(0);
}
if (process.argv.includes("--list-models")) {
  process.stdout.write("MODEL\\nSynthetic-Qoder\\n");
  process.exit(0);
}
process.stderr.write("unexpected command\\n");
process.exit(2);
`, { encoding: "utf8", mode: 0o755 });
  await chmod(command, 0o755);
  return command;
}

async function createFailingCommand(t, stderr) {
  const root = await mkdtemp(path.join(os.tmpdir(), "pageroot-agent-preflight-failure-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const command = path.join(root, "fake-qoder.mjs");
  await writeFile(command, `#!/usr/bin/env node
process.stderr.write(${JSON.stringify(`${stderr}\n`)});
process.exit(1);
`, { encoding: "utf8", mode: 0o755 });
  await chmod(command, 0o755);
  return command;
}

async function createVerifiedNpmCommand(t, {
  manifestVersion = "1.1.27",
  reportedVersion = "1.1.27",
  models = ["Finder-Sparse-Path"],
} = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "pageroot-agent-npm-command-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = path.join(root, "home");
  const packageRoot = path.join(
    root,
    "lib",
    "node_modules",
    "@qoder-ai",
    "qodercli",
  );
  const bundleDirectory = path.join(packageRoot, "bundle");
  const bundle = path.join(bundleDirectory, "qodercli.js");
  const binDirectory = path.join(home, ".npm-global", "bin");
  await Promise.all([
    mkdir(bundleDirectory, { recursive: true }),
    mkdir(binDirectory, { recursive: true }),
  ]);
  await writeFile(path.join(packageRoot, "package.json"), `${JSON.stringify({
    name: "@qoder-ai/qodercli",
    version: manifestVersion,
    bin: { qodercli: "bundle/qodercli.js" },
  }, null, 2)}\n`);
  await writeFile(bundle, `#!/usr/bin/env node
if (process.argv.includes("--version")) {
  process.stdout.write(${JSON.stringify(`${reportedVersion}\n`)});
  process.exit(0);
}
if (process.argv.includes("--list-models")) {
  process.stdout.write(${JSON.stringify(`MODEL\n${models.join("\n")}${models.length ? "\n" : ""}`)});
  process.exit(0);
}
process.exit(2);
`, { encoding: "utf8", mode: 0o755 });
  await chmod(bundle, 0o755);
  await symlink(bundle, path.join(binDirectory, "qodercli"));
  return { root, home, bundle };
}

function taskAuthority(identity = IDENTITY) {
  return {
    run: {
      ...identity,
      status: "processing",
      requestPath: "/tmp/request",
      promptPath: "/tmp/request/PROMPT.md",
      outputPath: "/tmp/request/attempts/attempt_001/output/candidate.html",
      completionPath: "/tmp/request/attempts/attempt_001/completion.json",
    },
    request: {
      request: {
        agentDelivery: {
          mode: "qoder-acp",
          trustPolicyVersion: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
        },
      },
    },
  };
}

function fakePolicy() {
  return {
    manifestPath: "/tmp/request/input-manifest.json",
    promptPath: "/tmp/request/PROMPT.md",
    outputPath: "/tmp/request/attempts/attempt_001/output/candidate.html",
    finalizer: {
      command: process.execPath,
      args: ["/tmp/finalize-attempt.mjs"],
      cwd: "/tmp/request",
      env: {},
    },
  };
}

async function preflight(service) {
  return service.preflight({
    driver: "qoder-acp",
    trustPolicyAccepted: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
  });
}

function createService(command, overrides = {}) {
  return new AgentBridgeService({
    environment: {
      ...process.env,
      PAGEROOT_E2E: "1",
      PAGEROOT_QODER_ACP_ALLOW_TEST_COMMAND: "1",
      PAGEROOT_QODER_ACP_COMMAND: command,
    },
    resolveTask: async () => taskAuthority(),
    policyLoader: async () => fakePolicy(),
    leaseStore: {
      acquire: async ({ ownerToken }) => ({ path: "memory-agent-lease", ownerToken }),
      release: async () => true,
    },
    ...overrides,
  });
}

async function waitForState(service, state, identity = IDENTITY) {
  for (let index = 0; index < 50; index += 1) {
    const current = service.status(identity);
    if (current?.state === state) return current;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return service.status(identity);
}

test("Agent Bridge preflight is explicit, bounded, and consumed by one Qoder task", async (t) => {
  const command = await createFakeCommand(t);
  let resolveRun;
  const observed = { calls: 0, prompt: "", expectedExecutable: null };
  const service = createService(command, {
    runTask: ({ prompt, onEvent, expectedExecutable }) => {
      observed.calls += 1;
      observed.prompt = prompt;
      observed.expectedExecutable = expectedExecutable;
      onEvent({ kind: "initialized", agentName: "pageroot-e2e-qoder", agentVersion: "1.1.27" });
      onEvent({ kind: "file-read", role: "prompt" });
      return new Promise((resolve) => {
        resolveRun = resolve;
      });
    },
  });
  t.after(() => service.dispose());

  await assert.rejects(
    service.preflight({ driver: "qoder-acp" }),
    (error) => error?.code === "AGENT_TRUST_POLICY_REQUIRED",
  );
  const ticket = await preflight(service);
  assert.equal(ticket.status, "ready");
  assert.equal(ticket.agentVersion, "1.1.27");
  assert.equal(ticket.modelCount, 1);
  assert.equal("command" in ticket, false);

  const started = await service.submit({
    ...IDENTITY,
    driver: "qoder-acp",
    trustPolicyAccepted: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
    preflightId: ticket.preflightId,
  });
  assert.equal(started.accepted, true);
  assert.equal(started.session.state, "starting");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(service.status(IDENTITY).state, "running");
  assert.equal(service.status(IDENTITY).phase, "reading-task");
  assert.equal(observed.calls, 1);
  assert.match(observed.prompt, /Candidate pending PageRoot review/u);
  assert.equal(observed.prompt.includes("/tmp/request"), true);
  assert.equal(observed.expectedExecutable.path, await realpath(command));
  assert.match(observed.expectedExecutable.identity.sha256, /^sha256:[a-f0-9]{64}$/u);

  const duplicate = await service.submit({
    ...IDENTITY,
    driver: "qoder-acp",
    trustPolicyAccepted: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
    preflightId: "not-used-for-idempotent-session",
  });
  assert.equal(duplicate.idempotent, true);
  assert.equal(observed.calls, 1);

  resolveRun({ stopReason: "end_turn" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(service.status(IDENTITY).state, "completed");
  assert.equal(service.status(IDENTITY).phase, "awaiting-validation");
});

test("verified npm Qoder uses the trusted runtime under Finder's sparse PATH", async (t) => {
  const fixture = await createVerifiedNpmCommand(t);
  const environment = {
    HOME: fixture.home,
    PATH: "/usr/bin:/bin",
  };
  let observed = null;
  const service = new AgentBridgeService({
    environment,
    commandResolver: ({ environment: commandEnvironment }) => resolveQoderAcpCommand({
      environment: commandEnvironment,
      homeDirectory: fixture.home,
    }),
    resolveTask: async () => taskAuthority(),
    policyLoader: async () => fakePolicy(),
    leaseStore: {
      acquire: async ({ ownerToken }) => ({ path: "memory-agent-lease", ownerToken }),
      release: async () => true,
    },
    runTask: async (input) => {
      observed = input;
      return { stopReason: "end_turn" };
    },
  });
  t.after(() => service.dispose());

  const ticket = await preflight(service);
  assert.equal(ticket.agentVersion, "1.1.27");
  assert.equal(ticket.modelCount, 1);
  assert.equal("command" in ticket, false);
  await service.submit({
    ...IDENTITY,
    driver: "qoder-acp",
    trustPolicyAccepted: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
    preflightId: ticket.preflightId,
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(observed.useVerifiedJavaScriptRuntime, true);
  assert.equal(observed.expectedExecutable.path, await realpath(fixture.bundle));
  assert.equal(observed.baseEnvironment.PATH, "/usr/bin:/bin");
});

test("preflight failures state that no Request exists yet", async (t) => {
  for (const [stderr, code, expectedCopy] of [
    [
      "not logged in",
      "QODER_AUTH_REQUIRED",
      "Qoder CLI 尚未登录。",
    ],
    [
      "no available model capacity",
      "QODER_CAPACITY_UNAVAILABLE",
      "Qoder 账号当前没有可用模型容量。",
    ],
    [
      "You've reached your credit usage limit. Please upgrade your subscription plan.",
      "QODER_CAPACITY_UNAVAILABLE",
      "Qoder 账号当前没有可用模型容量。",
    ],
    [
      "unexpected preflight failure",
      "QODER_PREFLIGHT_FAILED",
      "Qoder CLI 预检没有完成。",
    ],
  ]) {
    await t.test(code, async (caseTest) => {
      const command = await createFailingCommand(caseTest, stderr);
      const service = createService(command);
      caseTest.after(() => service.dispose());
      await assert.rejects(
        preflight(service),
        (error) => (
          error?.code === code
          && error.message.startsWith(expectedCopy)
          && error.message.includes("尚未创建本轮 Request")
          && !error.message.includes("Request 已保留")
          && !error.message.includes("Request 与当前 HTML 均已保留")
        ),
      );
    });
  }
});

test("verified npm preflight normalizes version and empty-model failures before Request creation", async (t) => {
  for (const [name, fixtureOptions, expectedCode] of [
    ["invalid-version", { reportedVersion: "not-a-version" }, "QODER_VERSION_INVALID"],
    [
      "manifest-version-mismatch",
      { manifestVersion: "1.1.28", reportedVersion: "1.1.27" },
      "QODER_VERSION_MISMATCH",
    ],
    ["empty-model-list", { models: [] }, "QODER_CAPACITY_UNAVAILABLE"],
  ]) {
    await t.test(name, async (caseTest) => {
      const fixture = await createVerifiedNpmCommand(caseTest, fixtureOptions);
      const service = new AgentBridgeService({
        environment: { HOME: fixture.home, PATH: "/usr/bin:/bin" },
        commandResolver: ({ environment }) => resolveQoderAcpCommand({
          environment,
          homeDirectory: fixture.home,
        }),
        resolveTask: async () => taskAuthority(),
      });
      caseTest.after(() => service.dispose());
      await assert.rejects(
        preflight(service),
        (error) => (
          error?.code === expectedCode
          && error.message.includes("尚未创建本轮 Request")
          && !error.message.includes("Request 已保留")
        ),
      );
    });
  }
});

test("every locally generated preflight error uses the pre-Request copy contract", async (t) => {
  for (const code of [
    "QODER_AUTH_REQUIRED",
    "QODER_PREFLIGHT_TIMEOUT",
    "QODER_VERSION_INVALID",
    "QODER_VERSION_MISMATCH",
    "QODER_CAPACITY_UNAVAILABLE",
    "QODER_COMMAND_NOT_FOUND",
    "QODER_COMMAND_UNTRUSTED",
    "QODER_COMMAND_CHANGED",
  ]) {
    await t.test(code, async () => {
      const service = new AgentBridgeService({
        resolveTask: async () => taskAuthority(),
        commandResolver: async () => {
          throw new AgentBridgeError(code, "private preflight detail", { status: 503 });
        },
      });
      await assert.rejects(
        preflight(service),
        (error) => (
          error?.code === code
          && error.message.includes("尚未创建本轮 Request")
          && !error.message.includes("private preflight detail")
          && !error.message.includes("Request 已保留")
        ),
      );
      await service.dispose();
    });
  }
});

test("unconfirmed preflight cleanup fences later starts and Bridge shutdown", async (t) => {
  const command = await createFakeCommand(t);
  let preflightCalls = 0;
  const service = createService(command, {
    preflightRunner: async () => {
      preflightCalls += 1;
      throw new AgentBridgeError(
        "AGENT_PREFLIGHT_CLEANUP_UNCONFIRMED",
        "private process-group detail",
        { status: 503 },
      );
    },
  });

  await assert.rejects(
    preflight(service),
    (error) => (
      error?.code === "AGENT_PREFLIGHT_CLEANUP_UNCONFIRMED"
      && error.message.includes("尚未创建本轮 Request")
      && !error.message.includes("private process-group")
    ),
  );
  await assert.rejects(
    preflight(service),
    (error) => error?.code === "AGENT_PREFLIGHT_CLEANUP_UNCONFIRMED",
  );
  assert.equal(preflightCalls, 1);
  await assert.rejects(
    service.dispose(),
    (error) => error?.code === "AGENT_SHUTDOWN_UNCONFIRMED",
  );
});

test("Agent Bridge cancellation aborts the managed task before reporting stopped", async (t) => {
  const command = await createFakeCommand(t);
  const events = [];
  const service = createService(command, {
    runTask: ({ cancellationSignal, onEvent }) => new Promise((_resolve, reject) => {
      onEvent({ kind: "initialized", agentName: "pageroot-e2e-qoder", agentVersion: "1.1.27" });
      cancellationSignal.addEventListener("abort", () => {
        events.push("driver-aborted");
        const error = new Error("raw private driver detail");
        error.code = "ACP_CANCELLED";
        reject(error);
      }, { once: true });
    }),
  });
  t.after(() => service.dispose());
  const ticket = await preflight(service);
  await service.submit({
    ...IDENTITY,
    driver: "qoder-acp",
    trustPolicyAccepted: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
    preflightId: ticket.preflightId,
  });

  const cancelled = await service.cancel(IDENTITY);
  events.push("cancel-returned");
  assert.equal(cancelled.stopped, true);
  assert.deepEqual(events, ["driver-aborted", "cancel-returned"]);
  assert.equal(cancelled.session.state, "cancelled");
  assert.equal(JSON.stringify(cancelled).includes("raw private"), false);
});

test("Agent Bridge cancellation never reports stopped after cleanup is unconfirmed", async (t) => {
  const command = await createFakeCommand(t);
  const root = await mkdtemp(path.join(os.tmpdir(), "pageroot-agent-cancel-unconfirmed-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const policy = {
    ...fakePolicy(),
    outputPath: path.join(root, "output", "candidate.html"),
    completionPath: path.join(root, "completion.json"),
  };
  let releaseCalls = 0;
  const service = createService(command, {
    policyLoader: async () => policy,
    leaseStore: {
      acquire: async ({ ownerToken }) => ({ path: "memory-agent-lease", ownerToken }),
      release: async () => {
        releaseCalls += 1;
        return true;
      },
    },
    runTask: ({ cancellationSignal, onEvent }) => new Promise((_resolve, reject) => {
      onEvent({ kind: "initialized", agentName: "pageroot-e2e-qoder" });
      cancellationSignal.addEventListener("abort", () => {
        const error = new Error("private process-group cleanup detail");
        error.code = "ACP_PROCESS_CLEANUP_UNCONFIRMED";
        reject(error);
      }, { once: true });
    }),
  });
  const ticket = await preflight(service);
  await service.submit({
    ...IDENTITY,
    driver: "qoder-acp",
    trustPolicyAccepted: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
    preflightId: ticket.preflightId,
  });
  await new Promise((resolve) => setImmediate(resolve));

  await assert.rejects(
    service.cancel(IDENTITY),
    (error) => (
      error?.code === "AGENT_CANCEL_UNCONFIRMED"
      && !error.message.includes("private process-group")
    ),
  );
  const failed = service.status(IDENTITY);
  assert.equal(failed.state, "cancelled");
  assert.equal(failed.errorCode, "AGENT_RESTART_RECOVERY_REQUIRED");
  assert.equal(releaseCalls, 0);
  await assert.rejects(
    service.dispose(),
    (error) => error?.code === "AGENT_SHUTDOWN_UNCONFIRMED",
  );
});

test("Agent Bridge cancellation timeout stays live and fails closed", async (t) => {
  const command = await createFakeCommand(t);
  let releaseCalls = 0;
  const service = createService(command, {
    cancelTimeoutMs: 25,
    leaseStore: {
      acquire: async ({ ownerToken }) => ({ path: "memory-agent-lease", ownerToken }),
      release: async () => {
        releaseCalls += 1;
        return true;
      },
    },
    runTask: ({ onEvent }) => new Promise(() => {
      onEvent({ kind: "initialized", agentName: "pageroot-e2e-qoder" });
    }),
  });
  const ticket = await preflight(service);
  await service.submit({
    ...IDENTITY,
    driver: "qoder-acp",
    trustPolicyAccepted: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
    preflightId: ticket.preflightId,
  });
  await new Promise((resolve) => setImmediate(resolve));

  await assert.rejects(
    service.cancel(IDENTITY),
    (error) => error?.code === "AGENT_CANCEL_UNCONFIRMED",
  );
  assert.equal(service.status(IDENTITY).state, "cancelling");
  assert.equal(releaseCalls, 0);
  await assert.rejects(
    service.dispose(),
    (error) => error?.code === "AGENT_SHUTDOWN_UNCONFIRMED",
  );
});

test("Workspace Bridge never durably cancels after Agent cancellation rejects", async () => {
  const events = [];
  const cleanupError = Object.assign(new Error("cleanup unconfirmed"), {
    code: "AGENT_CANCEL_UNCONFIRMED",
  });
  await assert.rejects(
    cancelDurableRequestAfterAgentCleanup({
      cancelAgent: async () => {
        events.push("agent-cancel");
        throw cleanupError;
      },
      cancelRequest: async () => {
        events.push("durable-cancel");
        return { status: "cancelled" };
      },
    }),
    cleanupError,
  );
  assert.deepEqual(events, ["agent-cancel"]);
});

test("Agent Bridge never invents a resumed Qoder session after restart", async (t) => {
  const command = await createFakeCommand(t);
  const service = createService(command, { runTask: async () => ({}) });
  t.after(() => service.dispose());
  assert.equal(service.status(IDENTITY), null);
  const interrupted = service.interrupted(IDENTITY);
  assert.equal(interrupted.state, "interrupted");
  assert.equal(interrupted.retryable, false);
  assert.equal(interrupted.errorCode, "AGENT_RESTART_RECOVERY_REQUIRED");
  assert.equal("sourcePath" in interrupted, false);
});

test("Agent Bridge persistent lease blocks a second service from racing the same Request", async (t) => {
  const command = await createFakeCommand(t);
  const root = await mkdtemp(path.join(os.tmpdir(), "pageroot-agent-lease-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const requestPath = path.join(
    root,
    "project",
    ".pageroot",
    "requests",
    IDENTITY.requestId,
  );
  await mkdir(requestPath, { recursive: true });
  const authority = taskAuthority();
  authority.run.requestPath = requestPath;
  const environment = {
    ...process.env,
    PAGEROOT_E2E: "1",
    PAGEROOT_QODER_ACP_ALLOW_TEST_COMMAND: "1",
    PAGEROOT_QODER_ACP_COMMAND: command,
  };
  const createLeasedService = (runTask) => new AgentBridgeService({
    environment,
    resolveTask: async () => authority,
    policyLoader: async () => fakePolicy(),
    runTask,
  });
  const first = createLeasedService(({ cancellationSignal, onEvent }) => new Promise(
    (_resolve, reject) => {
      onEvent({ kind: "initialized", agentName: "pageroot-e2e-qoder" });
      cancellationSignal.addEventListener("abort", () => {
        const error = new Error("cancelled");
        error.code = "ACP_CANCELLED";
        reject(error);
      }, { once: true });
    },
  ));
  t.after(() => first.dispose());
  const firstTicket = await preflight(first);
  await first.submit({
    ...IDENTITY,
    driver: "qoder-acp",
    trustPolicyAccepted: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
    preflightId: firstTicket.preflightId,
  });

  let secondRunCalls = 0;
  const second = createLeasedService(async () => {
    secondRunCalls += 1;
  });
  t.after(() => second.dispose());
  const secondTicket = await preflight(second);
  await assert.rejects(
    second.submit({
      ...IDENTITY,
      driver: "qoder-acp",
      trustPolicyAccepted: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
      preflightId: secondTicket.preflightId,
    }),
    (error) => error?.code === "AGENT_RESTART_RECOVERY_REQUIRED",
  );
  assert.equal(secondRunCalls, 0);
});

test("Agent Bridge rejects a policy retry that would overwrite an unfinalized output", async (t) => {
  const command = await createFakeCommand(t);
  const service = createService(command, {
    policyLoader: async () => {
      const error = new Error("private output path");
      error.code = "ACP_OUTPUT_PREEXISTS";
      throw error;
    },
  });
  t.after(() => service.dispose());
  const ticket = await preflight(service);
  await assert.rejects(
    service.submit({
      ...IDENTITY,
      driver: "qoder-acp",
      trustPolicyAccepted: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
      preflightId: ticket.preflightId,
    }),
    (error) => (
      error instanceof AgentBridgeError
      && error.code === "AGENT_RETRY_OUTPUT_PRESENT"
      && !error.message.includes("private output path")
    ),
  );
});

test("Agent Bridge identifies a real Qoder credit limit after Request creation", async (t) => {
  const command = await createFakeCommand(t);
  const root = await mkdtemp(path.join(os.tmpdir(), "pageroot-agent-capacity-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const service = createService(command, {
    policyLoader: async () => ({
      ...fakePolicy(),
      outputPath: path.join(root, "output", "candidate.html"),
      completionPath: path.join(root, "completion.json"),
    }),
    runTask: async () => {
      const error = new Error(
        "You've reached your credit usage limit. Please upgrade your subscription plan.",
      );
      error.code = 500;
      throw error;
    },
  });
  t.after(() => service.dispose());
  const ticket = await preflight(service);
  await service.submit({
    ...IDENTITY,
    driver: "qoder-acp",
    trustPolicyAccepted: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
    preflightId: ticket.preflightId,
  });

  const failed = await waitForState(service, "failed");
  assert.equal(failed.errorCode, "QODER_ACCOUNT_CAPACITY_UNAVAILABLE");
  assert.equal(failed.retryable, true);
  assert.equal(
    failed.errorMessage,
    "Qoder 账号当前没有可用模型容量。本轮 Request 已保留，可稍后重试或复制给其他 Agent。",
  );
  assert.equal(JSON.stringify(failed).includes("upgrade your subscription"), false);
});

test("Agent Bridge marks output written before failure as cancel-and-new only", async (t) => {
  const command = await createFakeCommand(t);
  const root = await mkdtemp(path.join(os.tmpdir(), "pageroot-agent-residue-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const outputPath = path.join(root, "attempt", "output", "candidate.html");
  await mkdir(path.dirname(outputPath), { recursive: true });
  const policy = {
    ...fakePolicy(),
    outputPath,
    completionPath: path.join(root, "attempt", "completion.json"),
  };
  const service = createService(command, {
    policyLoader: async () => policy,
    runTask: async () => {
      await writeFile(outputPath, "<!doctype html><html><body>partial</body></html>\n");
      const error = new Error("finalizer failed after output publication");
      error.code = "ACP_FINALIZER_EXIT_NONZERO";
      throw error;
    },
  });
  t.after(() => service.dispose());
  const ticket = await preflight(service);
  await service.submit({
    ...IDENTITY,
    driver: "qoder-acp",
    trustPolicyAccepted: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
    preflightId: ticket.preflightId,
  });
  const failed = await waitForState(service, "failed");
  assert.equal(failed.state, "failed");
  assert.equal(failed.retryable, false);
  assert.equal(failed.errorCode, "AGENT_RETRY_OUTPUT_PRESENT");
  assert.equal(JSON.stringify(failed).includes(outputPath), false);
});

test("Agent Bridge keeps an uncertain cleanup fenced and blocks same-Request retry", async (t) => {
  const command = await createFakeCommand(t);
  const root = await mkdtemp(path.join(os.tmpdir(), "pageroot-agent-cleanup-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const policy = {
    ...fakePolicy(),
    outputPath: path.join(root, "attempt", "output", "candidate.html"),
    completionPath: path.join(root, "attempt", "completion.json"),
  };
  let runCalls = 0;
  let releaseCalls = 0;
  const service = createService(command, {
    policyLoader: async () => policy,
    leaseStore: {
      acquire: async ({ ownerToken }) => ({ path: "memory-agent-lease", ownerToken }),
      release: async () => {
        releaseCalls += 1;
        return true;
      },
    },
    runTask: async () => {
      runCalls += 1;
      const error = new Error("private process-group detail");
      error.code = "ACP_PROCESS_CLEANUP_UNCONFIRMED";
      throw error;
    },
  });
  t.after(() => service.dispose().catch(() => {}));
  const firstTicket = await preflight(service);
  await service.submit({
    ...IDENTITY,
    driver: "qoder-acp",
    trustPolicyAccepted: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
    preflightId: firstTicket.preflightId,
  });
  const failed = await waitForState(service, "failed");
  assert.equal(failed.errorCode, "AGENT_RESTART_RECOVERY_REQUIRED");
  assert.equal(failed.retryable, false);
  assert.equal(JSON.stringify(failed).includes("private process-group"), false);
  assert.equal(releaseCalls, 0);

  const retryTicket = await preflight(service);
  await assert.rejects(
    service.submit({
      ...IDENTITY,
      driver: "qoder-acp",
      trustPolicyAccepted: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
      preflightId: retryTicket.preflightId,
    }),
    (error) => error?.code === "AGENT_RESTART_RECOVERY_REQUIRED",
  );
  assert.equal(runCalls, 1);
  assert.equal(releaseCalls, 0);
  await assert.rejects(
    service.dispose(),
    (error) => error?.code === "AGENT_SHUTDOWN_UNCONFIRMED",
  );
});

test("cleanup-unconfirmed fences survive terminal TTL and capacity pruning", async (t) => {
  const command = await createFakeCommand(t);
  const root = await mkdtemp(path.join(os.tmpdir(), "pageroot-agent-prune-fence-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  let now = Date.parse("2026-08-11T00:00:00.000Z");
  const identities = [1, 2, 3].map((index) => ({
    ...IDENTITY,
    requestId: `req_cleanup_fence_${index}`,
  }));
  const service = createService(command, {
    clock: { now: () => now },
    terminalSessionTtlMs: 1,
    maxRetainedSessions: 1,
    resolveTask: async (identity) => taskAuthority(identity),
    policyLoader: async () => ({
      ...fakePolicy(),
      outputPath: path.join(root, "output", "candidate.html"),
      completionPath: path.join(root, "completion.json"),
    }),
    runTask: async () => {
      const error = new Error("private process-group cleanup detail");
      error.code = "ACP_PROCESS_CLEANUP_UNCONFIRMED";
      throw error;
    },
  });

  for (const identity of identities) {
    const ticket = await preflight(service);
    await service.submit({
      ...identity,
      driver: "qoder-acp",
      trustPolicyAccepted: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
      preflightId: ticket.preflightId,
    });
    const failed = await waitForState(service, "failed", identity);
    assert.equal(failed.errorCode, "AGENT_RESTART_RECOVERY_REQUIRED");
  }

  now += 60_000;
  await preflight(service);
  for (const identity of identities) {
    assert.equal(
      service.status(identity)?.errorCode,
      "AGENT_RESTART_RECOVERY_REQUIRED",
    );
  }
  await assert.rejects(
    service.dispose(),
    (error) => error?.code === "AGENT_SHUTDOWN_UNCONFIRMED",
  );
});

test("Agent Bridge shutdown rejects when an owned Agent never confirms cleanup", async (t) => {
  const command = await createFakeCommand(t);
  let releaseCalls = 0;
  const service = createService(command, {
    cancelTimeoutMs: 25,
    leaseStore: {
      acquire: async ({ ownerToken }) => ({ path: "memory-agent-lease", ownerToken }),
      release: async () => {
        releaseCalls += 1;
        return true;
      },
    },
    runTask: ({ onEvent }) => new Promise(() => {
      onEvent({ kind: "initialized", agentName: "pageroot-e2e-qoder" });
    }),
  });
  const ticket = await preflight(service);
  await service.submit({
    ...IDENTITY,
    driver: "qoder-acp",
    trustPolicyAccepted: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
    preflightId: ticket.preflightId,
  });
  await new Promise((resolve) => setImmediate(resolve));

  await assert.rejects(
    service.dispose(),
    (error) => error?.code === "AGENT_SHUTDOWN_UNCONFIRMED",
  );
  assert.equal(releaseCalls, 0);
  assert.equal(service.status(IDENTITY).state, "running");
  await assert.rejects(
    service.dispose(),
    (error) => error?.code === "AGENT_SHUTDOWN_UNCONFIRMED",
  );
});

test("Workspace Bridge stays alive when Agent cleanup is not confirmed", async () => {
  const diagnostics = [];
  let closeCalls = 0;
  let exitCalls = 0;
  const accepted = await closeWorkspaceBridgeAfterAgentCleanup({
    agentBridgeService: {
      async dispose() {
        throw new Error("private process-group cleanup detail");
      },
    },
    closeServer() {
      closeCalls += 1;
    },
    exitProcess() {
      exitCalls += 1;
    },
    writeDiagnostic(line) {
      diagnostics.push(line);
    },
  });

  assert.equal(accepted, false);
  assert.equal(closeCalls, 0);
  assert.equal(exitCalls, 0);
  assert.equal(diagnostics.length, 1);
  assert.match(diagnostics[0], /AGENT_SHUTDOWN_UNCONFIRMED/u);
  assert.doesNotMatch(diagnostics[0], /private process-group/u);
});

test("Agent Bridge treats directories and special files at result paths as residue", async (t) => {
  const command = await createFakeCommand(t);
  for (const kind of ["directory", "socket"]) {
    await t.test(kind, async (caseTest) => {
      const root = await mkdtemp(path.join(
        kind === "socket" ? "/tmp" : os.tmpdir(),
        `pageroot-agent-${kind}-residue-`,
      ));
      caseTest.after(() => rm(root, { recursive: true, force: true }));
      const outputPath = path.join(root, "output");
      const completionPath = path.join(root, "completion");
      const policy = { ...fakePolicy(), outputPath, completionPath };
      let socket = null;
      const service = createService(command, {
        policyLoader: async () => policy,
        runTask: async () => {
          if (kind === "directory") {
            await mkdir(outputPath, { recursive: true });
          } else {
            await mkdir(path.dirname(completionPath), { recursive: true });
            socket = createServer();
            await new Promise((resolve, reject) => {
              socket.once("error", reject);
              socket.listen(completionPath, resolve);
            });
          }
          const error = new Error("result path is not a regular file");
          error.code = "ACP_RESULT_PATH_INVALID";
          throw error;
        },
      });
      caseTest.after(async () => {
        await service.dispose();
        if (socket?.listening) {
          await new Promise((resolve, reject) => socket.close((error) => (
            error ? reject(error) : resolve()
          )));
        }
      });
      const ticket = await preflight(service);
      await service.submit({
        ...IDENTITY,
        driver: "qoder-acp",
        trustPolicyAccepted: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
        preflightId: ticket.preflightId,
      });
      const failed = await waitForState(service, "failed");
      assert.equal(failed.errorCode, "AGENT_RETRY_OUTPUT_PRESENT");
      assert.equal(failed.retryable, false);
    });
  }
});

test("Agent Bridge never exposes command-discovery paths through preflight errors", async () => {
  const service = new AgentBridgeService({
    resolveTask: async () => taskAuthority(),
    commandResolver: async () => {
      throw new Error("ENOENT: /private/account/bin/qodercli");
    },
  });
  await assert.rejects(
    preflight(service),
    (error) => (
      error instanceof AgentBridgeError
      && error.code === "QODER_COMMAND_UNTRUSTED"
      && !error.message.includes("/private/account")
    ),
  );
  await service.dispose();
});
