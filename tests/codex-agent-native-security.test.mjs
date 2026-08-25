import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { macosAgentSandboxProfile } from "../scripts/agent/sandbox/macos-agent-sandbox.mjs";
import { runAgentNativeAcp } from "../scripts/agent/runtimes/agent-native-acp-runner.mjs";
import { loadDiscussionPolicy } from "../scripts/agent/policies/discussion-policy.mjs";
import { createHash } from "node:crypto";

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

function runSandbox(profile, script, argumentsList = [], cwd = process.cwd()) {
  return new Promise((resolve, reject) => {
    const child = spawn("/usr/bin/sandbox-exec", [
      "-p",
      profile,
      process.execPath,
      "--input-type=module",
      "--eval",
      script,
      "--",
      ...argumentsList,
    ], { cwd, stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({
      code,
      signal,
      stdout: Buffer.concat(stdout).toString("utf8"),
      stderr: Buffer.concat(stderr).toString("utf8"),
    }));
  });
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause) {
    if (cause?.code === "ESRCH") return false;
    throw cause;
  }
}

test("macOS Codex Discussion sandbox denies external reads, all writes, and child commands", {
  skip: process.platform !== "darwin",
}, async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "stemmio-codex-sandbox-test-")));
  const contextRoot = path.join(root, "context");
  const stateRoot = path.join(root, "state");
  const outsideRoot = await realpath(await mkdtemp(path.join(os.tmpdir(), "stemmio-codex-outside-test-")));
  const contextFile = path.join(contextRoot, "snapshot.html");
  const outsideFile = path.join(outsideRoot, "secret.txt");
  try {
    await Promise.all([
      mkdir(contextRoot),
      mkdir(stateRoot),
      writeFile(outsideFile, "secret", "utf8"),
    ]);
    await writeFile(contextFile, "<main>safe</main>", "utf8");
    const profile = macosAgentSandboxProfile({
      runtime: process.execPath,
      codexBinary: "/usr/bin/true",
      packageRoot: path.resolve("node_modules"),
      contextRoot,
      stateRoot,
    });
    const script = `
      import { spawnSync } from "node:child_process";
      import { readFileSync, writeFileSync } from "node:fs";
      const [contextFile, stateFile, outsideFile] = process.argv.slice(1);
      const result = { contextRead: readFileSync(contextFile, "utf8") };
      try { writeFileSync(contextFile, "changed"); result.contextWrite = "allowed"; }
      catch (error) { result.contextWrite = error.code; }
      try { readFileSync(outsideFile, "utf8"); result.outsideRead = "allowed"; }
      catch (error) { result.outsideRead = error.code; }
      try { writeFileSync(stateFile, "runtime-state"); result.stateWrite = "allowed"; }
      catch (error) { result.stateWrite = error.code; }
      const command = spawnSync("/bin/sh", ["-c", "true"]);
      result.command = command.error?.code || command.status;
      const codex = spawnSync("/usr/bin/true", []);
      result.codex = codex.error?.code || codex.status;
      process.stdout.write(JSON.stringify(result));
    `;
    const result = await runSandbox(profile, script, [
      contextFile,
      path.join(stateRoot, "state.txt"),
      outsideFile,
    ], contextRoot);
    assert.equal(result.code, 0, result.stderr);
    const evidence = JSON.parse(result.stdout);
    assert.equal(evidence.contextRead, "<main>safe</main>");
    assert.match(evidence.contextWrite, /EPERM|EACCES/u);
    assert.match(evidence.outsideRead, /EPERM|EACCES/u);
    assert.match(evidence.stateWrite, /EPERM|EACCES/u);
    assert.match(String(evidence.command), /EPERM|EACCES/u);
    assert.equal(evidence.codex, 0);
    assert.equal(await readFile(contextFile, "utf8"), "<main>safe</main>");
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outsideRoot, { recursive: true, force: true });
  }
});

test("macOS Codex Execution tools can write only output and cannot read state or relaunch programs", {
  skip: process.platform !== "darwin",
}, async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "stemmio-codex-tool-test-")));
  const contextRoot = path.join(root, "context");
  const outputRoot = path.join(contextRoot, "output");
  const stateRoot = path.join(root, "state");
  const outsideRoot = await realpath(await mkdtemp(path.join(os.tmpdir(), "stemmio-tool-outside-")));
  try {
    await Promise.all([
      mkdir(outputRoot, { recursive: true }),
      mkdir(path.join(stateRoot, "codex-home", "shell_snapshots"), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(path.join(contextRoot, "input.html"), "<main>input</main>\n"),
      writeFile(path.join(stateRoot, "auth.json"), "secret-auth\n"),
      writeFile(path.join(outsideRoot, "secret.txt"), "outside-secret\n"),
    ]);
    const profile = macosAgentSandboxProfile({
      runtime: process.execPath,
      codexBinary: "/usr/bin/true",
      codeModeHost: "/usr/bin/false",
      packageRoot: path.resolve("node_modules"),
      contextRoot,
      stateRoot,
      allowOutputRoot: outputRoot,
      allowToolProcesses: true,
    });
    const script = `
      import { spawnSync } from "node:child_process";
      const [context, output, state, outside] = process.argv.slice(1);
      const shell = (code, args = []) => {
        const value = spawnSync("/bin/zsh", ["-f", "-c", code, "--", ...args], { encoding: "utf8" });
        return { status: value.status, error: value.error?.code || null, stdout: value.stdout, stderr: value.stderr };
      };
      const result = {
        context: shell('IFS= read -r value < "$1" || exit 91; print -r -- "$value"', [context]),
        output: shell('print -r -- "<html><body>tool</body></html>" > "$1"', [output]),
        state: shell('IFS= read -r value < "$1" || exit 91; print -r -- "$value"', [state]),
        outsideRead: shell('IFS= read -r value < "$1" || exit 91; print -r -- "$value"', [outside]),
        outsideWrite: shell('print -r -- changed > "$1"', [outside]),
        relaunchCodex: shell('/usr/bin/true'),
        relaunchRuntime: shell(JSON.stringify(process.execPath) + ' --version'),
        relaunchSandbox: shell('/usr/bin/sandbox-exec -p "(version 1) (allow default)" /bin/true'),
        unlistedProgram: shell('/usr/bin/curl --version'),
      };
      process.stdout.write(JSON.stringify(result));
    `;
    const outputPath = path.join(outputRoot, "index.html");
    const outsidePath = path.join(outsideRoot, "secret.txt");
    const result = await runSandbox(profile, script, [
      path.join(contextRoot, "input.html"),
      outputPath,
      path.join(stateRoot, "auth.json"),
      outsidePath,
    ], contextRoot);
    assert.equal(result.code, 0, result.stderr);
    const evidence = JSON.parse(result.stdout);
    assert.equal(evidence.context.status, 0, JSON.stringify(evidence.context));
    assert.match(evidence.context.stdout, /<main>input<\/main>/u);
    assert.equal(evidence.output.status, 0, evidence.output.stderr);
    assert.equal(await readFile(outputPath, "utf8"), "<html><body>tool</body></html>\n");
    for (const key of [
      "state",
      "outsideRead",
      "outsideWrite",
      "relaunchCodex",
      "relaunchRuntime",
      "relaunchSandbox",
      "unlistedProgram",
    ]) {
      assert.notEqual(evidence[key].status, 0, `${key} unexpectedly succeeded`);
      assert.match(evidence[key].stderr, /not permitted|operation not permitted|denied/iu);
    }
    assert.equal(await readFile(outsidePath, "utf8"), "outside-secret\n");
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outsideRoot, { recursive: true, force: true });
  }
});

test("agent-native Discussion applies the selected model and emits only canonical visible text", {
  skip: process.platform !== "darwin",
}, async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "stemmio-codex-turn-test-")));
  const adapterEntry = path.resolve("tests/fixtures/codex-acp-agent.mjs");
  const codexBinary = await realpath("/usr/bin/true");
  try {
    await writeFile(path.join(root, "snapshot.html"), "<main>synthetic snapshot</main>");
    await writeFile(path.join(root, "PROMPT.md"), "synthetic prompt");
    const policy = await loadDiscussionPolicy({ snapshotRoot: root });
    const events = [];
    const result = await runAgentNativeAcp({
      securityProfile: "agent-native",
      purpose: "discussion",
      adapterEntry,
      adapterEntryIdentity: await identity(adapterEntry),
      adapterVersion: "1.6.2",
      adapterArgs: ["--fixture=discussion"],
      codexBinary,
      codexBinaryIdentity: await identity(codexBinary),
      codexConfig: {},
      sessionConfigOptions: [
        { id: "model", value: "gpt-synthetic" },
        { id: "reasoning_effort", value: "high" },
      ],
      cwd: policy.requestRoot,
      mode: "read-only",
      policy,
      prompt: "What is in the snapshot?",
      baseEnvironment: process.env,
      onEvent: (event) => events.push(event),
      turnTimeoutMs: 5_000,
    });
    assert.equal(result.visibleText, "Synthetic Codex reply");
    assert.doesNotMatch(result.visibleText, /hidden reasoning/u);
    assert.deepEqual(
      events.filter((event) => event.kind === "session-config-applied")
        .map((event) => event.configId),
      ["model", "reasoning_effort"],
    );
    assert.equal(events.some((event) => event.kind === "visible-text"), true);
    assert.equal(events.some((event) => JSON.stringify(event).includes("hidden reasoning")), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cancelling a streaming agent-native turn confirms the whole process group is gone", {
  skip: process.platform !== "darwin",
}, async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "stemmio-codex-cancel-test-")));
  const adapterEntry = path.resolve("tests/fixtures/codex-acp-agent.mjs");
  const codexBinary = await realpath("/bin/sleep");
  const controller = new AbortController();
  let descendantPid = null;
  try {
    await writeFile(path.join(root, "snapshot.html"), "<main>cancel snapshot</main>");
    await writeFile(path.join(root, "PROMPT.md"), "cancel prompt");
    const policy = await loadDiscussionPolicy({ snapshotRoot: root });
    await assert.rejects(runAgentNativeAcp({
      securityProfile: "agent-native",
      purpose: "discussion",
      adapterEntry,
      adapterEntryIdentity: await identity(adapterEntry),
      adapterVersion: "1.6.2",
      adapterArgs: ["--fixture=cancel-stream"],
      codexBinary,
      codexBinaryIdentity: await identity(codexBinary),
      codexConfig: {},
      sessionConfigOptions: [{ id: "model", value: "gpt-synthetic" }],
      cwd: policy.requestRoot,
      mode: "read-only",
      policy,
      prompt: "Start a streaming reply.",
      baseEnvironment: process.env,
      cancellationSignal: controller.signal,
      onEvent(event) {
        if (event.kind === "visible-text") {
          descendantPid = Number.parseInt(String(event.text).split("pid=")[1], 10);
          controller.abort();
        }
      },
      turnTimeoutMs: 5_000,
    }), { code: "ACP_CANCELLED" });
    assert.equal(Number.isSafeInteger(descendantPid), true);
    assert.equal(processExists(descendantPid), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
