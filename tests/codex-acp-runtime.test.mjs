import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { probeAgentNativeAcp } from "../scripts/agent/runtimes/acp-probe.mjs";
import { authenticateAgentNativeAcp } from "../scripts/agent/runtimes/acp-authentication.mjs";

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

async function launch(behavior, extraArgs = []) {
  const codexBinary = await realpath("/usr/bin/true");
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

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause) {
    if (cause?.code === "ESRCH") return false;
    throw cause;
  }
}

test("agent-native ACP probe returns live auth, model, reasoning, and mode evidence", async () => {
  const result = await probeAgentNativeAcp(await launch("ready"));
  assert.deepEqual(result.auth, { status: "ready", type: "chat-gpt" });
  assert.equal(result.adapterVersion, "1.6.2");
  assert.equal(result.currentModelId, "gpt-synthetic");
  assert.equal(result.currentReasoning, "high");
  assert.deepEqual(result.models.map((model) => model.id), ["gpt-synthetic"]);
  assert.deepEqual(result.reasoningEfforts.map((effort) => effort.id), ["high"]);
  assert.equal(result.currentMode, "read-only");
});

test("agent-native ACP probe reports auth-required without creating a session", async () => {
  const result = await probeAgentNativeAcp(await launch("auth-required"));
  assert.deepEqual(result.auth, { status: "required", type: "unauthenticated" });
  assert.deepEqual(result.models, []);
  assert.equal("sessionId" in result, false);
});

test("agent-native ACP authentication is explicit and creates no model session", async () => {
  const result = await authenticateAgentNativeAcp(await launch("auth-flow"));
  assert.deepEqual(result, { status: "ready" });
});

test("agent-native ACP probe fails closed on identity, timeout, frame, UTF-8, and exit faults", async () => {
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

test("probe cleanup terminates the adapter and its descendant process group", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "stemmio-codex-pid-"));
  const pidFile = path.join(root, "descendant.pid");
  try {
    await probeAgentNativeAcp(await launch("descendant", [`--pid-file=${pidFile}`]));
    const pid = Number.parseInt(await readFile(pidFile, "utf8"), 10);
    assert.equal(Number.isSafeInteger(pid), true);
    assert.equal(processExists(pid), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
