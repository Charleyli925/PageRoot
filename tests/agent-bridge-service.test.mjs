import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  AgentBridgeError,
  AgentBridgeService,
  TRUSTED_LOCAL_AGENT_POLICY_VERSION,
} from "../scripts/agent-bridge-service.mjs";

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

function taskAuthority() {
  return {
    run: {
      ...IDENTITY,
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

async function waitForState(service, state) {
  for (let index = 0; index < 50; index += 1) {
    const current = service.status(IDENTITY);
    if (current?.state === state) return current;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return service.status(IDENTITY);
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
  t.after(() => service.dispose());
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
