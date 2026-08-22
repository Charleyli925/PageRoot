import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import * as acp from "@agentclientprotocol/sdk";

import {
  acpDriverProfile,
  createRestrictedDiscussionHost,
  loadQoderAcpDiscussionPolicy,
  runAcpTask,
} from "../scripts/qoder-acp-client.mjs";

// The Discussion Host is the read-only Agent boundary for discussion turns.
// These pins hold its contract: it reads exactly one short-lived snapshot plus
// the prompt, never writes, never spawns a terminal, and fails closed on any
// unsafe path or post-start drift. It is independent of the Execution Host and
// carries no Request, output path or finalizer.

const SNAPSHOT_HTML = "<!doctype html><html><body><h1>标题</h1></body></html>";

async function discussionRoot(html = SNAPSHOT_HTML) {
  const root = await mkdtemp(path.join(tmpdir(), "pageroot-discussion-"));
  await writeFile(path.join(root, "snapshot.html"), html, "utf8");
  await writeFile(path.join(root, "PROMPT.md"), "讨论：这个标题怎么改更好？", "utf8");
  return root;
}

const SESSION = "discussion-session-1";

function boundHost(policy) {
  const events = [];
  const host = createRestrictedDiscussionHost(policy, {
    onEvent: (value) => events.push(value),
  });
  host.bindSessionId(SESSION);
  return { host, events };
}

test("the discussion policy exposes only the snapshot and prompt, with no mutation surface", async () => {
  const root = await discussionRoot();
  const policy = await loadQoderAcpDiscussionPolicy({ snapshotRoot: root });

  assert.equal(policy.mode, "discussion");
  assert.equal(policy.readableFiles.length, 2);
  assert.deepEqual(
    policy.readableFiles.map((entry) => entry.role).sort(),
    ["discussion-snapshot", "prompt"],
  );
  assert.match(policy.sourceSha256, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(policy.outputPath, undefined);
  assert.equal(policy.finalizer, undefined);
  assert.equal(policy.runtimePath, undefined);
});

test("the host reads the snapshot and refuses any other path", async () => {
  const root = await discussionRoot();
  const policy = await loadQoderAcpDiscussionPolicy({ snapshotRoot: root });
  const { host, events } = boundHost(policy);

  const read = await host.readTextFile({ sessionId: SESSION, path: policy.snapshotPath });
  assert.match(read.content, /标题/u);
  assert.ok(events.some((value) => value.kind === "file-read" && value.role === "discussion-snapshot"));

  await assert.rejects(
    host.readTextFile({ sessionId: SESSION, path: path.join(root, "escape.txt") }),
    (error) => error.code === "ACP_READ_NOT_AUTHORIZED",
  );
  await assert.rejects(
    host.readTextFile({ sessionId: SESSION, path: "/etc/hosts" }),
    (error) => error.code === "ACP_READ_NOT_AUTHORIZED",
  );
});

test("the host hard-denies writes, terminals and tool permissions", async () => {
  const root = await discussionRoot();
  const policy = await loadQoderAcpDiscussionPolicy({ snapshotRoot: root });
  const { host } = boundHost(policy);

  await assert.rejects(
    host.writeTextFile({ sessionId: SESSION, path: policy.snapshotPath, content: "x" }),
    (error) => error.code === "ACP_DISCUSSION_READONLY",
  );
  // `buildClient` registers the whole terminal surface, so every terminal method
  // must answer with the policy error rather than an undefined-method TypeError.
  for (const method of [
    "createTerminal",
    "terminalOutput",
    "waitForTerminalExit",
    "killTerminal",
    "releaseTerminal",
  ]) {
    await assert.rejects(
      host[method]({ sessionId: SESSION, command: "ls", terminalId: "term_1" }),
      (error) => error.name === "QoderAcpPolicyError"
        && error.code === "ACP_DISCUSSION_NO_TERMINAL",
      `${method} must refuse with the discussion terminal policy error`,
    );
  }
  const permission = await host.requestPermission({
    sessionId: SESSION,
    toolCall: { kind: "execute" },
    options: [{ optionId: "allow", kind: "allow_once" }],
  });
  assert.equal(permission.outcome.outcome, "cancelled");
});

test("a read from an unbound or mismatched session is refused", async () => {
  const root = await discussionRoot();
  const policy = await loadQoderAcpDiscussionPolicy({ snapshotRoot: root });
  const host = createRestrictedDiscussionHost(policy);
  await assert.rejects(
    host.readTextFile({ sessionId: SESSION, path: policy.snapshotPath }),
    (error) => error.code === "ACP_SESSION_ID_MISMATCH",
  );
  host.bindSessionId(SESSION);
  await assert.rejects(
    host.readTextFile({ sessionId: "other", path: policy.snapshotPath }),
    (error) => error.code === "ACP_SESSION_ID_MISMATCH",
  );
});

test("snapshot drift after the session started fails closed", async () => {
  const root = await discussionRoot();
  const policy = await loadQoderAcpDiscussionPolicy({ snapshotRoot: root });
  const { host } = boundHost(policy);
  await writeFile(policy.snapshotPath, "<!doctype html><html><body><h1>改了</h1></body></html>", "utf8");
  await assert.rejects(
    host.readTextFile({ sessionId: SESSION, path: policy.snapshotPath }),
    (error) => error.code === "ACP_FROZEN_INPUT_DRIFT",
  );
});

test("a cancelled or disposed host refuses reads", async () => {
  const root = await discussionRoot();
  const policy = await loadQoderAcpDiscussionPolicy({ snapshotRoot: root });
  const { host } = boundHost(policy);
  await host.cancel();
  await assert.rejects(
    host.readTextFile({ sessionId: SESSION, path: policy.snapshotPath }),
    (error) => error.code === "ACP_HOST_CANCELLING",
  );

  const fresh = boundHost(policy);
  fresh.host.dispose();
  await assert.rejects(
    fresh.host.readTextFile({ sessionId: SESSION, path: policy.snapshotPath }),
    (error) => error.code === "ACP_HOST_DISPOSED",
  );
});

test("the policy loader fails closed on unsafe or malformed inputs", async () => {
  const root = await discussionRoot();

  // An execution-policy field must not be accepted here.
  await assert.rejects(
    loadQoderAcpDiscussionPolicy({ snapshotRoot: root, requestPath: root }),
    (error) => error.code === "ACP_DISCUSSION_OPTIONS_INVALID",
  );

  // A name that is not a single safe segment (path traversal / separators).
  for (const badName of ["../escape.html", "sub/dir.html", "..", ".hidden"]) {
    await assert.rejects(
      loadQoderAcpDiscussionPolicy({ snapshotRoot: root, snapshotName: badName }),
      (error) => error.code === "ACP_DISCUSSION_NAME_INVALID",
      `name ${JSON.stringify(badName)} must be refused`,
    );
  }

  // The snapshot and prompt must be distinct files.
  await assert.rejects(
    loadQoderAcpDiscussionPolicy({ snapshotRoot: root, snapshotName: "PROMPT.md" }),
    (error) => error.code === "ACP_DISCUSSION_READ_ORDER_DUPLICATE",
  );

  // A symlinked snapshot inside the root is rejected as a non-regular file.
  const outside = await mkdtemp(path.join(tmpdir(), "pageroot-outside-"));
  const strayPath = path.join(outside, "secret.html");
  await writeFile(strayPath, "<html></html>", "utf8");
  await symlink(strayPath, path.join(root, "linked.html"));
  await assert.rejects(
    loadQoderAcpDiscussionPolicy({ snapshotRoot: root, snapshotName: "linked.html" }),
    (error) => typeof error.code === "string" && error.code.startsWith("ACP_"),
  );

  // A snapshot root that is not a real directory.
  await assert.rejects(
    loadQoderAcpDiscussionPolicy({ snapshotRoot: path.join(root, "does-not-exist") }),
    (error) => typeof error.code === "string",
  );
});

test("a non-discussion policy cannot drive the discussion host", () => {
  assert.throws(
    () => createRestrictedDiscussionHost({ mode: "execution", readableFiles: [] }),
    /verified discussion policy/u,
  );
});

// The shared ACP driver is parameterized by the branded policy, not by an
// injected host. These pins hold that a discussion policy can only ever obtain
// discussion authority: read-only declared capabilities, the restricted host,
// and no completion evidence to fake.

function createDiscussionAgent(policy, observed) {
  const sessionId = "session_discussion_agent";
  return acp
    .agent({ name: "pageroot-synthetic-discussion" })
    .onRequest(acp.methods.agent.initialize, ({ params }) => {
      observed.initialize = params;
      return {
        protocolVersion: acp.PROTOCOL_VERSION,
        agentCapabilities: { loadSession: false },
        authMethods: [],
        agentInfo: { name: "pageroot-synthetic-discussion", version: "1.0.0" },
      };
    })
    .onRequest(acp.methods.agent.session.new, ({ params }) => {
      observed.newSession = params;
      return { sessionId };
    })
    .onRequest(acp.methods.agent.session.prompt, async ({ client }) => {
      observed.snapshot = await client.request(acp.methods.client.fs.readTextFile, {
        sessionId,
        path: policy.snapshotPath,
      });
      for (const update of observed.updates ?? []) {
        await client.notify(acp.methods.client.session.update, { sessionId, update });
      }
      const refused = async (method, params) => client
        .request(method, { sessionId, ...params })
        .then(() => "fulfilled", (error) => `refused: ${String(error?.message || error)}`);
      observed.writeRefusal = await refused(acp.methods.client.fs.writeTextFile, {
        path: policy.snapshotPath,
        content: "<html>injected</html>",
      });
      observed.terminalRefusal = await refused(acp.methods.client.terminal.create, {
        command: "/bin/sh",
        args: ["-c", "echo escalate"],
      });
      observed.terminalOutputRefusal = await refused(acp.methods.client.terminal.output, {
        terminalId: "term_forged",
      });
      return { stopReason: "end_turn" };
    });
}

test("a discussion policy drives the discussion host through the shared driver", async () => {
  const root = await discussionRoot();
  const policy = await loadQoderAcpDiscussionPolicy({ snapshotRoot: root });
  const observed = {};
  const events = [];

  const result = await runAcpTask({
    connection: createDiscussionAgent(policy, observed),
    policy,
    prompt: "讨论：这个标题怎么改更好？",
    onEvent: (value) => events.push(value),
    startupTimeoutMs: 1_000,
    turnTimeoutMs: 2_000,
  });

  // Read-only capabilities are declared to the Agent, not just enforced late.
  // The SDK adds its own defaults around them, so pin the declared fields.
  assert.equal(observed.initialize.clientCapabilities.fs.readTextFile, true);
  assert.equal(observed.initialize.clientCapabilities.fs.writeTextFile, false);
  assert.equal(observed.initialize.clientCapabilities.terminal, false);
  // The Agent's session is scoped to the short-lived snapshot directory only.
  assert.equal(observed.newSession.cwd, policy.requestRoot);
  assert.deepEqual(observed.newSession.mcpServers, []);
  assert.match(observed.snapshot.content, /标题/u);
  // Every mutation attempt is refused. The Agent learns only that its request
  // failed; the policy wording stays on PageRoot's side of the boundary.
  assert.match(observed.writeRefusal, /^refused: /u);
  assert.match(observed.terminalRefusal, /^refused: /u);
  assert.match(observed.terminalOutputRefusal, /^refused: /u);
  // Nothing was written behind the refusal: the snapshot bytes are untouched.
  assert.equal(await readFile(policy.snapshotPath, "utf8"), SNAPSHOT_HTML);
  assert.equal(result.stopReason, "end_turn");
  // No finalizer, no Candidate, so no completion evidence exists to be faked.
  assert.equal(result.completion, null);
  assert.ok(events.some((value) => value.kind === "turn-stopped"));
});

test("the discussion driver profile grants no execution authority", async () => {
  const root = await discussionRoot();
  const policy = await loadQoderAcpDiscussionPolicy({ snapshotRoot: root });
  const profile = acpDriverProfile(policy);

  assert.equal(profile.mode, "discussion");
  assert.equal(profile.requiresTurnCompletion, false);
  assert.equal(profile.clientCapabilities.fs.writeTextFile, false);
  assert.equal(profile.clientCapabilities.terminal, false);
  // The discussion host satisfies the full client surface the driver registers.
  const host = profile.assertHost(profile.createHost(policy, () => {}));
  assert.equal(typeof host.readTextFile, "function");
  assert.equal(host.assertTurnCompleted, undefined);

  // An unbranded or unknown-mode policy cannot select a profile at all.
  assert.throws(
    () => acpDriverProfile({ mode: "discussion" }),
    /verified PageRoot policy/u,
  );
});

// ADR 0036: a discussion turn may carry the Agent's visible words, bounded and
// sanitized. These pins hold what may cross and what must not.

test("a discussion turn returns the Agent's visible text and drops its reasoning", async () => {
  const root = await discussionRoot();
  const policy = await loadQoderAcpDiscussionPolicy({ snapshotRoot: root });
  const observed = {
    updates: [
      { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "标题可以更具体，" } },
      // Hidden reasoning must never reach the caller.
      { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "内部推理不得外泄" } },
      // A non-text content block carries no visible words.
      { sessionUpdate: "agent_message_chunk", content: { type: "image", data: "" } },
      // Control characters are stripped on capture.
      { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "比如\u0007加上季度。" } },
    ],
  };
  const events = [];

  const result = await runAcpTask({
    connection: createDiscussionAgent(policy, observed),
    policy,
    prompt: "这个标题怎么改？",
    onEvent: (value) => events.push(value),
    startupTimeoutMs: 1_000,
    turnTimeoutMs: 2_000,
  });

  assert.equal(result.visibleText, "标题可以更具体，比如加上季度。");
  assert.equal(result.visibleTextTruncated, false);
  assert.doesNotMatch(result.visibleText, /内部推理/u);
  assert.doesNotMatch(result.visibleText, /[\u0000-\u001f]/u);

  // The same text streams out as events so a caller can show it while it arrives.
  const streamed = events
    .filter((event) => event.kind === "visible-text")
    .map((event) => event.text)
    .join("");
  assert.equal(streamed, result.visibleText);
});

test("an over-budget reply is marked truncated rather than silently clipped", async () => {
  const root = await discussionRoot();
  const policy = await loadQoderAcpDiscussionPolicy({ snapshotRoot: root });
  const budget = acpDriverProfile(policy).visibleTextByteLimit;
  assert.equal(budget, 64 * 1024);
  const observed = {
    updates: [
      { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "x".repeat(budget) } },
      { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "超出预算的内容" } },
    ],
  };

  const result = await runAcpTask({
    connection: createDiscussionAgent(policy, observed),
    policy,
    prompt: "请详细说明。",
    startupTimeoutMs: 1_000,
    turnTimeoutMs: 4_000,
  });

  assert.equal(Buffer.byteLength(result.visibleText, "utf8"), budget);
  assert.equal(result.visibleTextTruncated, true);
  assert.doesNotMatch(result.visibleText, /超出预算/u);
});
