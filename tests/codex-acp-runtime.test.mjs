import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { probeAgentNativeAcp } from "../scripts/agent/runtimes/acp-probe.mjs";
import { authenticateAgentNativeAcp } from "../scripts/agent/runtimes/acp-authentication.mjs";
import {
  prepareBoundAgentNativeExecutables,
  writeVerifiedDiscussionInput,
} from "../scripts/agent/runtimes/agent-native-acp-runner.mjs";

const adapterEntry = path.resolve("tests/fixtures/codex-acp-agent.mjs");

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

async function launch(behavior, extraArgs = [], executable = "/usr/bin/true") {
  const codexBinary = await realpath(executable);
  return {
    securityProfile: "agent-native",
    purpose: "discussion",
    adapterEntry,
    adapterEntryIdentity: await identity(adapterEntry),
    adapterVersion: "1.6.2",
    adapterArgs: [`--fixture=${behavior}`, ...extraArgs],
    codexBinary,
    codexBinaryIdentity: await identity(codexBinary),
    codexConfig: {},
    baseEnvironment: process.env,
    timeoutMs: 2_000,
  };
}

test("agent-native ACP probe returns live auth, model, reasoning, and mode evidence", {
  skip: process.platform !== "darwin",
}, async () => {
  const result = await probeAgentNativeAcp(await launch("ready"));
  assert.deepEqual(result.auth, { status: "ready", type: "chat-gpt" });
  assert.equal(result.adapterVersion, "1.6.2");
  assert.equal(result.currentModelId, "gpt-synthetic");
  assert.equal(result.currentReasoning, "high");
  assert.deepEqual(result.models.map((model) => model.id), ["gpt-synthetic"]);
  assert.deepEqual(result.reasoningEfforts.map((effort) => effort.id), ["high"]);
  assert.equal(result.currentMode, "read-only");
});

test("agent-native ACP probe reports auth-required without creating a session", {
  skip: process.platform !== "darwin",
}, async () => {
  const result = await probeAgentNativeAcp(await launch("auth-required"));
  assert.deepEqual(result.auth, { status: "required", type: "unauthenticated" });
  assert.deepEqual(result.models, []);
  assert.equal("sessionId" in result, false);
});

test("agent-native ACP authentication is explicit and creates no model session", {
  skip: process.platform !== "darwin",
}, async () => {
  const result = await authenticateAgentNativeAcp(await launch("auth-flow"));
  assert.deepEqual(result, { status: "ready" });
});

test("first-time Codex authentication creates a private auth-state root", {
  skip: process.platform !== "darwin",
}, async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "stemmio-codex-first-auth-")));
  const home = path.join(root, "home");
  try {
    await mkdir(home, { mode: 0o700 });
    const authLaunch = await launch("auth-flow");
    authLaunch.baseEnvironment = { ...process.env, HOME: home, CODEX_HOME: "" };
    const result = await authenticateAgentNativeAcp(authLaunch);
    assert.deepEqual(result, { status: "ready" });
    const information = await lstat(path.join(home, ".codex"));
    assert.equal(information.isDirectory(), true);
    assert.equal(information.isSymbolicLink(), false);
    assert.equal(information.mode & 0o077, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Codex authentication rejects an existing auth-state root with shared permissions", {
  skip: process.platform !== "darwin",
}, async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "stemmio-codex-shared-auth-")));
  const home = path.join(root, "home");
  const authRoot = path.join(home, ".codex");
  try {
    await mkdir(home, { mode: 0o700 });
    await mkdir(authRoot, { mode: 0o770 });
    await chmod(authRoot, 0o770);
    const authLaunch = await launch("auth-flow");
    authLaunch.baseEnvironment = { ...process.env, HOME: home, CODEX_HOME: authRoot };
    await assert.rejects(authenticateAgentNativeAcp(authLaunch), {
      code: "CODEX_AUTH_STATE_UNAVAILABLE",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Codex authentication rejects a writable auth-state parent before creating the root", {
  skip: process.platform !== "darwin",
}, async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "stemmio-codex-shared-parent-")));
  const home = path.join(root, "home");
  const authRoot = path.join(home, ".codex");
  try {
    await mkdir(home, { mode: 0o770 });
    await chmod(home, 0o770);
    const authLaunch = await launch("auth-flow");
    authLaunch.baseEnvironment = { ...process.env, HOME: home, CODEX_HOME: authRoot };
    await assert.rejects(authenticateAgentNativeAcp(authLaunch), {
      code: "CODEX_AUTH_STATE_UNAVAILABLE",
    });
    await assert.rejects(lstat(authRoot), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("agent-native ACP probe fails closed on identity, timeout, frame, UTF-8, and exit faults", {
  skip: process.platform !== "darwin",
}, async () => {
  await assert.rejects(probeAgentNativeAcp(await launch("wrong-identity")), {
    code: "CODEX_ACP_IDENTITY_MISMATCH",
  });
  const hanging = await launch("hang-initialize");
  hanging.timeoutMs = 100;
  await assert.rejects(probeAgentNativeAcp(hanging), {
    code: "CODEX_PREFLIGHT_TIMEOUT",
  });
  await assert.rejects(
    probeAgentNativeAcp(await launch("oversized-frame")),
    (error) => ["CODEX_ACP_FRAME_TOO_LARGE", "CODEX_ACP_CONNECTION_CLOSED"].includes(error?.code),
  );
  await assert.rejects(
    probeAgentNativeAcp(await launch("invalid-utf8")),
    (error) => ["CODEX_ACP_UTF8_INVALID", "CODEX_ACP_CONNECTION_CLOSED"].includes(error?.code),
  );
  await assert.rejects(probeAgentNativeAcp(await launch("early-exit")), {
    code: "CODEX_ACP_CONNECTION_CLOSED",
  });

  const changed = await launch("ready");
  changed.adapterEntryIdentity = Object.freeze({
    ...changed.adapterEntryIdentity,
    sha256: "0".repeat(64),
  });
  await assert.rejects(probeAgentNativeAcp(changed), {
    code: "CODEX_ADAPTER_UNTRUSTED",
  });
});

test("probe sandbox denies external file access and unapproved process creation", {
  skip: process.platform !== "darwin",
}, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "stemmio-codex-denial-"));
  const outsideRead = path.join(root, "outside-read.txt");
  const outsideWrite = path.join(root, "outside-write.txt");
  try {
    await writeFile(outsideRead, "sandbox-secret", "utf8");
    const sandboxLaunch = await launch("sandbox-denials", [
      `--outside-read=${outsideRead}`,
      `--outside-write=${outsideWrite}`,
    ], "/bin/cat");
    sandboxLaunch.timeoutMs = 10_000;
    await probeAgentNativeAcp(sandboxLaunch);
    await assert.rejects(readFile(outsideWrite, "utf8"), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("verified native executables are retained as private bound copies", async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "stemmio-codex-binding-")));
  const codexBinary = path.join(root, "codex");
  const codeModeHost = path.join(root, "codex-code-mode-host");
  await Promise.all([
    copyFile(process.execPath, codexBinary),
    copyFile(process.execPath, codeModeHost),
  ]);
  await Promise.all([chmod(codexBinary, 0o500), chmod(codeModeHost, 0o500)]);
  const binding = await prepareBoundAgentNativeExecutables({
    purpose: "execution",
    codexBinary,
    codexBinaryIdentity: await identity(codexBinary),
    codeModeHost,
    codeModeHostIdentity: await identity(codeModeHost),
  });
  try {
    await Promise.all([unlink(codexBinary), unlink(codeModeHost)]);
    await Promise.all([
      writeFile(codexBinary, "#!/bin/sh\necho replaced\n", { mode: 0o500 }),
      writeFile(codeModeHost, "#!/bin/sh\necho replaced\n", { mode: 0o500 }),
    ]);
    assert.equal((await identity(binding.codexBinary)).sha256, (await identity(process.execPath)).sha256);
    assert.equal((await identity(binding.codeModeHost)).sha256, (await identity(process.execPath)).sha256);
    await chmod(binding.root, 0o700);
    await unlink(binding.codexBinary);
    await writeFile(binding.codexBinary, "#!/bin/sh\necho staged-replacement\n", { mode: 0o500 });
    assert.throws(
      () => binding.assertUnchanged(),
      (error) => error?.code === "CODEX_INNER_INCOMPATIBLE",
    );
  } finally {
    await binding.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("discussion isolation writes the bytes already verified before a source-path swap", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "stemmio-discussion-copy-"));
  const source = path.join(root, "source.html");
  const target = path.join(root, "snapshot.html");
  try {
    await writeFile(source, "verified snapshot", "utf8");
    const verified = await readFile(source);
    await writeVerifiedDiscussionInput(target, verified, {
      beforeWrite: async () => writeFile(source, "replacement bytes", "utf8"),
    });
    assert.equal(await readFile(target, "utf8"), "verified snapshot");
    assert.equal(await readFile(source, "utf8"), "replacement bytes");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
