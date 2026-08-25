import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  macosAgentSandboxProfile,
  packagedRuntimeReadRoot,
} from "../scripts/agent/sandbox/macos-agent-sandbox.mjs";
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

test("packaged sandbox derives only the containing app bundle as runtime support", () => {
  assert.equal(
    packagedRuntimeReadRoot("/Applications/Stemmio.app/Contents/Frameworks/Stemmio Helper.app/Contents/MacOS/Stemmio Helper"),
    "/Applications/Stemmio.app",
  );
  assert.equal(packagedRuntimeReadRoot("/usr/local/bin/node"), null);
});

test("macOS Codex Discussion sandbox denies external reads, all writes, and child commands", {
  skip: process.platform !== "darwin",
}, async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "stemmio-codex-sandbox-test-")));
  const contextRoot = path.join(root, "context");
  const stateRoot = path.join(root, "state");
  const runtimeReadRoot = path.join(root, "runtime-read-root");
  const outsideRoot = await realpath(await mkdtemp(path.join(os.tmpdir(), "stemmio-codex-outside-test-")));
  const contextFile = path.join(contextRoot, "snapshot.html");
  const outsideFile = path.join(outsideRoot, "secret.txt");
  try {
    await Promise.all([
      mkdir(contextRoot),
      mkdir(stateRoot),
      mkdir(runtimeReadRoot),
      writeFile(outsideFile, "secret", "utf8"),
    ]);
    await writeFile(contextFile, "<main>safe</main>", "utf8");
    const runtimeSupportFile = path.join(runtimeReadRoot, "support.txt");
    await writeFile(runtimeSupportFile, "runtime-support", "utf8");
    const profile = macosAgentSandboxProfile({
      runtime: process.execPath,
      runtimeReadRoot,
      codexBinary: "/usr/bin/true",
      packageRoot: path.resolve("node_modules"),
      contextRoot,
      stateRoot,
    });
    const script = `
      import { spawnSync } from "node:child_process";
      import { readFileSync, writeFileSync } from "node:fs";
      const [contextFile, stateFile, outsideFile, runtimeSupportFile] = process.argv.slice(1);
      const result = {
        contextRead: readFileSync(contextFile, "utf8"),
        runtimeSupportRead: readFileSync(runtimeSupportFile, "utf8"),
      };
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
      runtimeSupportFile,
    ], contextRoot);
    assert.equal(result.code, 0, result.stderr);
    const evidence = JSON.parse(result.stdout);
    assert.equal(evidence.contextRead, "<main>safe</main>");
    assert.equal(evidence.runtimeSupportRead, "runtime-support");
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
    const codexBinary = path.join(root, "codex-node");
    const codeModeHost = path.join(root, "code-mode-node");
    await Promise.all([
      copyFile(process.execPath, codexBinary),
      copyFile(process.execPath, codeModeHost),
    ]);
    await Promise.all([chmod(codexBinary, 0o500), chmod(codeModeHost, 0o500)]);
    const hostScript = path.join(contextRoot, "host.mjs");
    const codexScript = path.join(contextRoot, "codex.mjs");
    await writeFile(hostScript, `
      import { spawnSync } from "node:child_process";
      const [context, output, state, outside] = process.argv.slice(2);
      const shell = (code, args = []) => {
        const value = spawnSync(
          "/bin/zsh",
          ["-f", "-c", code, "--", ...args],
          { encoding: "utf8" },
        );
        return {
          status: value.status,
          error: value.error?.code || null,
          stdout: value.stdout,
          stderr: value.stderr,
        };
      };
      process.stdout.write(JSON.stringify({
        context: shell('IFS= read -r value < "$1" || exit 91; print -r -- "$value"', [context]),
        output: shell('print -r -- "<html><body>tool</body></html>" > "$1"', [output]),
        state: shell('IFS= read -r value < "$1" || exit 91; print -r -- "$value"', [state]),
        outsideRead: shell('IFS= read -r value < "$1" || exit 91; print -r -- "$value"', [outside]),
        outsideWrite: shell('print -r -- changed > "$1"', [outside]),
        relaunchCodex: shell(${JSON.stringify(codexBinary)}),
        relaunchRuntime: shell(${JSON.stringify(process.execPath)} + ' --version'),
        relaunchSandbox: shell('/usr/bin/sandbox-exec -p "(version 1) (allow default)" /bin/true'),
        unlistedProgram: shell('/usr/bin/curl --version'),
      }));
    `, "utf8");
    await writeFile(codexScript, `
      import { spawnSync } from "node:child_process";
      const [host, hostScript, ...args] = process.argv.slice(2);
      const child = spawnSync(host, [hostScript, ...args], { encoding: "utf8" });
      if (child.status !== 0) {
        process.stderr.write(child.stderr || String(child.error || "code-mode host failed"));
        process.exit(child.status || 1);
      }
      process.stdout.write(child.stdout);
    `, "utf8");
    const profile = macosAgentSandboxProfile({
      runtime: process.execPath,
      codexBinary,
      codeModeHost,
      packageRoot: path.resolve("node_modules"),
      contextRoot,
      stateRoot,
      allowOutputRoot: outputRoot,
      allowToolProcesses: true,
    });
    const script = `
      import { spawnSync } from "node:child_process";
      import { writeFileSync } from "node:fs";
      const [codex, codexScript, host, hostScript, context, output, state, outside] = process.argv.slice(1);
      const adapterTool = spawnSync("/bin/zsh", ["-f", "-c", "true"], { encoding: "utf8" });
      let adapterWrite = "allowed";
      try { writeFileSync(output, "adapter bypass"); }
      catch (error) { adapterWrite = error.code; }
      const codexRun = spawnSync(codex, [
        codexScript, host, hostScript, context, output, state, outside,
      ], { encoding: "utf8" });
      const result = {
        adapterTool: adapterTool.error?.code || adapterTool.status,
        adapterToolStderr: adapterTool.stderr,
        adapterWrite,
        codexStatus: codexRun.status,
        codexError: codexRun.error?.code || null,
        codexStderr: codexRun.stderr,
        tools: codexRun.status === 0 ? JSON.parse(codexRun.stdout) : null,
      };
      process.stdout.write(JSON.stringify(result));
    `;
    const outputPath = path.join(outputRoot, "index.html");
    const outsidePath = path.join(outsideRoot, "secret.txt");
    const result = await runSandbox(profile, script, [
      codexBinary,
      codexScript,
      codeModeHost,
      hostScript,
      path.join(contextRoot, "input.html"),
      outputPath,
      path.join(stateRoot, "auth.json"),
      outsidePath,
    ], contextRoot);
    assert.equal(result.code, 0, result.stderr);
    const evidence = JSON.parse(result.stdout);
    assert.match(String(evidence.adapterTool), /EPERM|EACCES/u);
    assert.match(evidence.adapterWrite, /EPERM|EACCES/u);
    assert.equal(evidence.codexStatus, 0, evidence.codexStderr);
    assert.equal(evidence.tools.context.status, 0, JSON.stringify(evidence.tools.context));
    assert.match(evidence.tools.context.stdout, /<main>input<\/main>/u);
    assert.equal(evidence.tools.output.status, 0, evidence.tools.output.stderr);
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
      assert.notEqual(evidence.tools[key].status, 0, `${key} unexpectedly succeeded`);
      assert.match(evidence.tools[key].stderr, /not permitted|operation not permitted|denied/iu);
    }
    assert.equal(await readFile(outsidePath, "utf8"), "outside-secret\n");
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outsideRoot, { recursive: true, force: true });
  }
});

test("macOS Codex authentication grants auth writes only to the pinned Codex process", {
  skip: process.platform !== "darwin",
}, async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "stemmio-codex-auth-sandbox-")));
  const contextRoot = path.join(root, "context");
  const stateRoot = path.join(root, "state");
  const authRoot = path.join(root, "auth");
  const outsideRoot = await realpath(await mkdtemp(path.join(os.tmpdir(), "stemmio-auth-outside-")));
  const authFile = path.join(authRoot, "auth.json");
  const outsideFile = path.join(outsideRoot, "secret.txt");
  try {
    await Promise.all([
      mkdir(contextRoot),
      mkdir(stateRoot),
      mkdir(authRoot),
      writeFile(outsideFile, "outside-secret", "utf8"),
    ]);
    const profile = macosAgentSandboxProfile({
      runtime: process.execPath,
      codexBinary: "/bin/zsh",
      packageRoot: path.resolve("node_modules"),
      contextRoot,
      stateRoot,
      authRoot,
      allowAuthentication: true,
    });
    const script = `
      import { spawnSync } from "node:child_process";
      import { readFileSync, writeFileSync } from "node:fs";
      const [authFile, outsideFile] = process.argv.slice(1);
      const result = {};
      try { readFileSync(authFile, "utf8"); result.adapterRead = "allowed"; }
      catch (error) { result.adapterRead = error.code; }
      try { writeFileSync(authFile, "adapter"); result.adapterWrite = "allowed"; }
      catch (error) { result.adapterWrite = error.code; }
      const codexWrite = spawnSync("/bin/zsh", ["-f", "-c", 'print -n -- codex-token > "$1"', "--", authFile], { encoding: "utf8" });
      const codexOutside = spawnSync("/bin/zsh", ["-f", "-c", 'IFS= read -r value < "$1"', "--", outsideFile], { encoding: "utf8" });
      result.codexWriteStatus = codexWrite.status;
      result.codexWriteStderr = codexWrite.stderr;
      result.codexOutsideStatus = codexOutside.status;
      result.codexOutsideStderr = codexOutside.stderr;
      process.stdout.write(JSON.stringify(result));
    `;
    const result = await runSandbox(profile, script, [authFile, outsideFile], contextRoot);
    assert.equal(result.code, 0, result.stderr);
    const evidence = JSON.parse(result.stdout);
    assert.match(evidence.adapterRead, /ENOENT|EPERM|EACCES/u);
    assert.match(evidence.adapterWrite, /EPERM|EACCES/u);
    assert.equal(evidence.codexWriteStatus, 0, evidence.codexWriteStderr);
    assert.notEqual(evidence.codexOutsideStatus, 0, "Codex should fail on the outside read");
    assert.equal(await readFile(authFile, "utf8"), "codex-token");
    assert.equal(await readFile(outsideFile, "utf8"), "outside-secret");
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
