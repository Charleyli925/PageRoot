import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  createCodexAppServerRuntime,
  prepareVerifiedCodexExecutable,
  runCodexAppServerTask,
} from "../scripts/agent/runtimes/codex-app-server-runtime.mjs";
import { createDefaultProviderRegistry } from "../scripts/agent/providers/provider-registry.mjs";
import { resolveBundledCodexInstallation } from "../scripts/agent/providers/codex-provider.mjs";
import { terminateManagedProcess } from "../scripts/agent/hosts/execution-host.mjs";
import { promisify } from "node:util";

const fixture = fileURLToPath(new URL("./fixtures/codex-app-server-execution.mjs", import.meta.url));
const execFileAsync = promisify(execFile);

async function runtimeFixture(mode, operation) {
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-runtime-fixture-"));
  const outputRoot = path.join(root, "output");
  const outputPath = path.join(outputRoot, "candidate.html");
  const tracePath = path.join(root, "trace.jsonl");
  await mkdir(outputRoot, { recursive: true });
  await writeFile(tracePath, "", "utf8");
  const events = [];
  const hostCalls = [];
  const policy = {
    requestId: "request_synthetic",
    attemptId: "attempt_001",
    outputPath,
    finalizer: {
      command: "/synthetic/finalizer",
      args: ["--complete"],
      cwd: root,
      env: {},
    },
  };
  const hostFactory = () => ({
    bindSessionId(value) { hostCalls.push(["bind", value]); },
    async createTerminal(params) {
      assert.equal(
        await readFile(outputPath, "utf8"),
        "<!doctype html><html><head><title>Before</title></head><body>Candidate</body></html>\n",
      );
      hostCalls.push(["finalizer", params]);
      return { terminalId: "terminal_1" };
    },
    async waitForTerminalExit() { return { exitCode: 0, signal: null }; },
    async assertTurnCompleted() { return { status: "completed", outputSha256: "a".repeat(64) }; },
    async cancel() { hostCalls.push(["cancel"]); },
    async dispose() { hostCalls.push(["dispose"]); },
  });
  try {
    return await operation({
      root,
      outputRoot,
      outputPath,
      tracePath,
      events,
      hostCalls,
      launch: {
        command: process.execPath,
        argsPrefix: [fixture],
        cwd: outputRoot,
        environment: {
          PATH: process.env.PATH,
          FAKE_CODEX_EXECUTION_MODE: mode,
          FAKE_CODEX_OUTPUT_PATH: outputPath,
          FAKE_CODEX_TRACE_PATH: tracePath,
          APP_SERVER_LOGS: "must-be-removed",
        },
        policy,
        prompt: "Modify the frozen page and write the Candidate.",
        model: "gpt-synthetic",
        effort: "high",
        onEvent(event) { events.push(event); },
        requestTimeoutMs: 500,
        turnTimeoutMs: 500,
        hostFactory,
      },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("Codex App Server executes one ephemeral sandboxed turn before the fixed finalizer", async () => {
  await runtimeFixture("completed", async ({ launch, tracePath, outputRoot, events, hostCalls }) => {
    const result = await runCodexAppServerTask(launch);
    assert.equal(result.status, "completed");
    const messages = (await readFile(tracePath, "utf8"))
      .trim().split("\n").map((line) => JSON.parse(line));
    const thread = messages.find((message) => message.method === "thread/start");
    const turn = messages.find((message) => message.method === "turn/start");
    assert.equal(thread.params.ephemeral, true);
    assert.equal(thread.params.approvalPolicy, "never");
    assert.deepEqual(thread.params.config.mcp_servers, {});
    assert.deepEqual(thread.params.config.skills.config, [{
      path: "/synthetic/SKILL.md",
      enabled: false,
    }]);
    assert.equal(turn.params.approvalPolicy, "never");
    assert.deepEqual(turn.params.sandboxPolicy, {
      type: "workspaceWrite",
      writableRoots: [outputRoot],
      networkAccess: false,
      excludeTmpdirEnvVar: true,
      excludeSlashTmp: true,
    });
    assert.equal(turn.params.model, "gpt-synthetic");
    assert.equal(turn.params.effort, "high");
    assert.ok(events.some((event) => event.kind === "visible-text"));
    assert.ok(events.some((event) => event.kind === "file-written"));
    assert.deepEqual(hostCalls.map(([kind]) => kind), ["bind", "finalizer", "dispose"]);
  });
});

test("the verified native Codex snapshot executes independently of the package path", async () => {
  const installation = await resolveBundledCodexInstallation();
  const prepared = await prepareVerifiedCodexExecutable({
    command: installation.command,
    expectedCommandIdentity: installation.commandIdentity,
  });
  try {
    const result = await execFileAsync(prepared.command, ["--version"], {
      timeout: 10_000,
      maxBuffer: 64 * 1024,
    });
    assert.match(result.stdout, /codex-cli 0\.149\.1/u);
  } finally {
    await prepared.cleanup();
  }
});

test("Codex App Server denies permission requests and never reaches finalization", async () => {
  await runtimeFixture("permission", async ({ launch, hostCalls }) => {
    await assert.rejects(
      runCodexAppServerTask(launch),
      (error) => error?.code === "CODEX_PERMISSION_REQUESTED",
    );
    assert.deepEqual(hostCalls.map(([kind]) => kind), ["bind", "cancel", "dispose"]);
  });
});

test("Codex App Server rejects a permission request emitted after turn completion", async () => {
  await runtimeFixture("late-permission", async ({ launch, hostCalls }) => {
    await assert.rejects(
      runCodexAppServerTask(launch),
      (error) => error?.code === "CODEX_PERMISSION_REQUESTED",
    );
    assert.equal(hostCalls.some(([kind]) => kind === "finalizer"), false);
  });
});

test("Codex App Server rejects unconfirmed process-group cleanup", async () => {
  await runtimeFixture("completed", async ({ launch, hostCalls }) => {
    launch.terminateProcess = async (child, options) => {
      await terminateManagedProcess(child, options);
      return false;
    };
    await assert.rejects(
      runCodexAppServerTask(launch),
      (error) => error?.code === "CODEX_APP_SERVER_CLEANUP_UNCONFIRMED",
    );
    assert.equal(hostCalls.some(([kind]) => kind === "finalizer"), false);
  });
});

test("Codex App Server fails closed on a failed or timed-out turn", async () => {
  for (const [mode, code] of [["failed", "CODEX_TURN_FAILED"], ["hang", "CODEX_TURN_TIMEOUT"]]) {
    await runtimeFixture(mode, async ({ launch, hostCalls }) => {
      launch.turnTimeoutMs = 60;
      await assert.rejects(runCodexAppServerTask(launch), (error) => error?.code === code);
      assert.equal(hostCalls.some(([kind]) => kind === "finalizer"), false);
    });
  }
});

test("Codex App Server rejects any output beside the unique Candidate file", async () => {
  await runtimeFixture("extra-output", async ({ launch, hostCalls }) => {
    await assert.rejects(
      runCodexAppServerTask(launch),
      (error) => error?.code === "CODEX_OUTPUT_SURFACE_INVALID",
    );
    assert.equal(hostCalls.some(([kind]) => kind === "finalizer"), false);
  });
});

test("Codex App Server runtime requires the agent-native profile", async () => {
  const runtime = createCodexAppServerRuntime({ runTask: async () => ({ status: "completed" }) });
  assert.throws(
    () => runtime.run({ securityProfile: "client-mediated" }),
    { code: "AGENT_SECURITY_PROFILE_MISMATCH" },
  );
});

test("codexExecution registers Codex and its runtime only when the hard gate is enabled", () => {
  assert.deepEqual(
    createDefaultProviderRegistry().catalog().map((entry) => entry.providerId),
    ["qoder", "codex"],
  );
  const disabled = createDefaultProviderRegistry({ codexExecution: false });
  assert.deepEqual(disabled.catalog().map((entry) => entry.providerId), ["qoder"]);
  assert.equal(createDefaultProviderRegistry().catalog()[1].capabilities.execution, true);
});
