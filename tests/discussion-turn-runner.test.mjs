import assert from "node:assert/strict";
import { chmod, lstat, mkdir, mkdtemp, readdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import * as acp from "@agentclientprotocol/sdk";

import {
  DISCUSSION_TURN_TIMEOUT_MS,
  discussionPrompt,
  runDiscussionTurn,
} from "../scripts/discussion-turn-runner.mjs";
import { runAcpTask } from "../scripts/qoder-acp-client.mjs";
import { sha256 } from "../scripts/lifecycle-core.mjs";

// These pins hold the Discussion Snapshot contract: PageRoot copies the Working
// Copy's current bytes into one short-lived read-only file under the managed
// control directory, runs exactly one read-only turn against it, and deletes it
// when the turn ends — on success, failure, timeout and cancellation alike. The
// Agent never learns the Working Copy path, and no Request, Candidate, Version
// or finalizer is involved.

const WORKING_COPY_HTML = "<!doctype html><html><body><h1>季度报告</h1><p>正文</p></body></html>\n";
const SOURCE_SHA256 = sha256(Buffer.from(WORKING_COPY_HTML, "utf8"));
const SNAPSHOT_PARENT = path.join(".pageroot", "discussion-snapshots");

async function projectRoot(t) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "pageroot-discussion-turn-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, ".pageroot"), { recursive: true, mode: 0o700 });
  // A real project keeps durable state here. Nothing in a discussion turn may
  // touch it, so the tests compare the listing before and after.
  await writeFile(path.join(root, ".pageroot", "runtime-state.json"), "{}\n", "utf8");
  await mkdir(path.join(root, ".pageroot", "requests"), { recursive: true, mode: 0o700 });
  return root;
}

async function controlRootListing(root) {
  return (await readdir(path.join(root, ".pageroot"))).sort();
}

function baseTurn(root, overrides = {}) {
  return {
    projectRoot: root,
    turnId: "turn_0001",
    html: WORKING_COPY_HTML,
    expectedSourceSha256: SOURCE_SHA256,
    question: "这个标题怎么改更有说服力？",
    ...overrides,
  };
}

test("a completed discussion turn snapshots the current bytes and deletes them", async (t) => {
  const root = await projectRoot(t);
  const before = await controlRootListing(root);
  const seen = {};

  const outcome = await runDiscussionTurn(baseTurn(root, {
    runTurn: async ({ policy, prompt, turnTimeoutMs }) => {
      seen.mode = policy.mode;
      seen.snapshot = await readFile(policy.snapshotPath, "utf8");
      seen.promptFile = await readFile(policy.promptPath, "utf8");
      seen.prompt = prompt;
      seen.turnTimeoutMs = turnTimeoutMs;
      seen.snapshotRoot = policy.requestRoot;
      seen.directoryMode = (await lstat(policy.requestRoot)).mode & 0o777;
      seen.fileMode = (await lstat(policy.snapshotPath)).mode & 0o777;
      return { stopReason: "end_turn", updates: [{ type: "agent_message_chunk" }], droppedUpdateCount: 0 };
    },
  }));

  // The snapshot carries the Working Copy bytes and its Hash is the context Hash.
  assert.equal(seen.snapshot, WORKING_COPY_HTML);
  assert.equal(outcome.sourceSha256, SOURCE_SHA256);
  assert.equal(seen.mode, "discussion");
  // Discussion runs on the shorter default budget, not the execution budget.
  assert.equal(seen.turnTimeoutMs, DISCUSSION_TURN_TIMEOUT_MS);
  assert.equal(DISCUSSION_TURN_TIMEOUT_MS, 2 * 60_000);
  // The prompt the Agent reads is the prompt the runner composed.
  assert.equal(seen.promptFile, seen.prompt);
  assert.match(seen.promptFile, /这个标题怎么改更有说服力？/u);
  assert.match(seen.promptFile, /discussion only/u);
  // Owner-only permissions, like the Bridge's own lease directory.
  assert.equal(seen.directoryMode, 0o700);
  assert.equal(seen.fileMode, 0o600);
  // The snapshot lives under the managed control directory, never beside the
  // Working Copy.
  assert.ok(seen.snapshotRoot.startsWith(path.join(root, SNAPSHOT_PARENT) + path.sep));

  assert.equal(outcome.status, "completed");
  assert.equal(outcome.interrupted, false);
  assert.equal(outcome.stopReason, "end_turn");
  // ADR 0036: the driver-returned reply is what the outcome carries.
  assert.equal(outcome.replyText, "");
  assert.equal(outcome.replyTruncated, false);

  // Deleted on the way out, and durable state is untouched.
  await assert.rejects(lstat(seen.snapshotRoot), (error) => error.code === "ENOENT");
  assert.deepEqual(await readdir(path.join(root, SNAPSHOT_PARENT)), []);
  assert.deepEqual(
    (await controlRootListing(root)).filter((name) => name !== "discussion-snapshots"),
    before,
  );
  assert.equal(await readFile(path.join(root, ".pageroot", "runtime-state.json"), "utf8"), "{}\n");
});

test("a timed-out discussion turn is interrupted, keeps what arrived and still deletes the snapshot", async (t) => {
  const root = await projectRoot(t);
  let snapshotRoot;

  const outcome = await runDiscussionTurn(baseTurn(root, {
    turnTimeoutMs: 50,
    runTurn: async ({ policy, onEvent }) => {
      snapshotRoot = policy.requestRoot;
      onEvent(Object.freeze({ kind: "session-update", type: "agent_message_chunk" }));
      onEvent(Object.freeze({ kind: "session-update", type: "agent_message_chunk" }));
      // Words that arrived before the timeout must survive the interruption.
      onEvent(Object.freeze({ kind: "visible-text", text: "说到" }));
      onEvent(Object.freeze({ kind: "visible-text", text: "一半" }));
      const timeout = new Error("The ACP operation timed out.");
      timeout.code = "ACP_TIMEOUT";
      throw timeout;
    },
  }));

  assert.equal(outcome.status, "interrupted");
  assert.equal(outcome.interrupted, true);
  assert.equal(outcome.interruptedReason, "timeout");
  // Received evidence is preserved, and the turn is not dressed up as complete.
  assert.equal(outcome.updates.length, 2);
  assert.equal(outcome.stopReason, null);
  assert.equal(outcome.replyText, "说到一半");
  await assert.rejects(lstat(snapshotRoot), (error) => error.code === "ENOENT");
});

test("a cancelled discussion turn is interrupted rather than failed", async (t) => {
  const root = await projectRoot(t);
  let snapshotRoot;

  const outcome = await runDiscussionTurn(baseTurn(root, {
    runTurn: async ({ policy }) => {
      snapshotRoot = policy.requestRoot;
      const cancelled = new Error("The PageRoot ACP task was cancelled.");
      cancelled.code = "ACP_CANCELLED";
      throw cancelled;
    },
  }));

  assert.equal(outcome.status, "interrupted");
  assert.equal(outcome.interruptedReason, "cancelled");
  await assert.rejects(lstat(snapshotRoot), (error) => error.code === "ENOENT");
});

test("any other turn failure propagates and still deletes the snapshot", async (t) => {
  const root = await projectRoot(t);
  let snapshotRoot;

  await assert.rejects(
    runDiscussionTurn(baseTurn(root, {
      runTurn: async ({ policy }) => {
        snapshotRoot = policy.requestRoot;
        const failure = new Error("Qoder refused the protocol.");
        failure.code = "ACP_PROTOCOL_UNSUPPORTED";
        throw failure;
      },
    })),
    (error) => error.code === "ACP_PROTOCOL_UNSUPPORTED",
  );

  await assert.rejects(lstat(snapshotRoot), (error) => error.code === "ENOENT");
  assert.deepEqual(await readdir(path.join(root, SNAPSHOT_PARENT)), []);
});

test("the runner fails closed before writing anything unsafe", async (t) => {
  const root = await projectRoot(t);
  const runTurn = async () => {
    throw new Error("the turn must never start");
  };

  // Stale source: the bytes and the vouched Hash disagree.
  await assert.rejects(
    runDiscussionTurn(baseTurn(root, { expectedSourceSha256: `sha256:${"0".repeat(64)}`, runTurn })),
    (error) => error.code === "DISCUSSION_SOURCE_HASH_MISMATCH",
  );
  // No snapshot directory is created by a rejected turn.
  await assert.rejects(lstat(path.join(root, SNAPSHOT_PARENT)), (error) => error.code === "ENOENT");

  await assert.rejects(
    runDiscussionTurn(baseTurn(root, { question: "   ", runTurn })),
    (error) => error.code === "DISCUSSION_QUESTION_EMPTY",
  );
  await assert.rejects(
    runDiscussionTurn(baseTurn(root, { question: "x".repeat(9 * 1024), runTurn })),
    (error) => error.code === "DISCUSSION_QUESTION_TOO_LARGE",
  );
  for (const turnId of ["../escape", "sub/dir", "..", ".hidden"]) {
    await assert.rejects(
      runDiscussionTurn(baseTurn(root, { turnId, runTurn })),
      (error) => error.code === "DISCUSSION_TURN_ID_INVALID",
      `turnId ${JSON.stringify(turnId)} must be refused`,
    );
  }
  await assert.rejects(
    runDiscussionTurn(baseTurn(root, { runTurn: null })),
    (error) => error.code === "DISCUSSION_RUNNER_MISSING",
  );

  // A missing managed control directory is not created here; that authority
  // belongs to the repository.
  const bare = await realpath(await mkdtemp(path.join(tmpdir(), "pageroot-bare-")));
  t.after(() => rm(bare, { recursive: true, force: true }));
  await assert.rejects(
    runDiscussionTurn(baseTurn(bare, { runTurn })),
    (error) => error.code === "DISCUSSION_CONTROL_ROOT_INVALID",
  );
});

test("a colliding turn directory fails closed and is left untouched", async (t) => {
  const root = await projectRoot(t);
  const existing = path.join(root, SNAPSHOT_PARENT, "turn_0001");
  await mkdir(existing, { recursive: true, mode: 0o700 });
  await writeFile(path.join(existing, "snapshot.html"), "<html>其他人的</html>", "utf8");

  await assert.rejects(
    runDiscussionTurn(baseTurn(root, {
      runTurn: async () => {
        throw new Error("the turn must never start");
      },
    })),
    (error) => error.code === "DISCUSSION_SNAPSHOT_EXISTS",
  );

  // The pre-existing directory belongs to someone else; the refused turn must
  // not delete it.
  assert.equal(
    await readFile(path.join(existing, "snapshot.html"), "utf8"),
    "<html>其他人的</html>",
  );
});

test("an unsafe snapshot directory is refused", async (t) => {
  const root = await projectRoot(t);
  const outside = await realpath(await mkdtemp(path.join(tmpdir(), "pageroot-outside-")));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await symlink(outside, path.join(root, SNAPSHOT_PARENT));

  await assert.rejects(
    runDiscussionTurn(baseTurn(root, {
      runTurn: async () => {
        throw new Error("the turn must never start");
      },
    })),
    (error) => error.code === "DISCUSSION_SNAPSHOT_ROOT_UNSAFE",
  );
  // Nothing was written through the symlink.
  assert.deepEqual(await readdir(outside), []);
});

function syntheticDiscussionAgent(observed) {
  const sessionId = "session_discussion_runner";
  return acp
    .agent({ name: "pageroot-synthetic-discussion" })
    .onRequest(acp.methods.agent.initialize, ({ params }) => {
      observed.clientCapabilities = params.clientCapabilities;
      return {
        protocolVersion: acp.PROTOCOL_VERSION,
        agentCapabilities: { loadSession: false },
        authMethods: [],
        agentInfo: { name: "pageroot-synthetic-discussion", version: "1.0.0" },
      };
    })
    .onRequest(acp.methods.agent.session.new, ({ params }) => {
      observed.cwd = params.cwd;
      return { sessionId };
    })
    .onRequest(acp.methods.agent.session.prompt, async ({ params, client }) => {
      observed.promptText = params.prompt?.[0]?.text ?? "";
      const snapshotPath = path.join(observed.cwd, "snapshot.html");
      observed.read = await client.request(acp.methods.client.fs.readTextFile, {
        sessionId,
        path: snapshotPath,
      });
      observed.writeRefused = await client
        .request(acp.methods.client.fs.writeTextFile, {
          sessionId,
          path: snapshotPath,
          content: "<html>改写</html>",
        })
        .then(() => false, () => true);
      observed.workingCopyRefused = await client
        .request(acp.methods.client.fs.readTextFile, {
          sessionId,
          path: observed.workingCopyPath,
        })
        .then(() => false, () => true);
      return { stopReason: "end_turn" };
    });
}

test("the runner drives one real read-only turn through the shared ACP driver", async (t) => {
  const root = await projectRoot(t);
  const workingCopyPath = path.join(root, "page.html");
  await writeFile(workingCopyPath, WORKING_COPY_HTML, "utf8");
  const observed = { workingCopyPath };
  let snapshotRoot;

  const outcome = await runDiscussionTurn(baseTurn(root, {
    turnId: "turn_real_0001",
    runTurn: async ({ policy, prompt, turnTimeoutMs, onEvent }) => {
      snapshotRoot = policy.requestRoot;
      return runAcpTask({
        connection: syntheticDiscussionAgent(observed),
        policy,
        prompt,
        onEvent,
        startupTimeoutMs: 1_000,
        turnTimeoutMs,
      });
    },
  }));

  // The real driver picked the discussion profile: read-only capabilities.
  assert.equal(observed.clientCapabilities.fs.writeTextFile, false);
  assert.equal(observed.clientCapabilities.terminal, false);
  // The Agent's working directory is the snapshot directory, so it cannot
  // derive the Working Copy path.
  assert.equal(observed.cwd, snapshotRoot);
  assert.match(observed.read.content, /季度报告/u);
  assert.equal(observed.writeRefused, true);
  assert.equal(observed.workingCopyRefused, true);
  assert.match(observed.promptText, /这个标题怎么改更有说服力？/u);

  assert.equal(outcome.status, "completed");
  assert.equal(outcome.interrupted, false);
  assert.equal(outcome.sourceSha256, SOURCE_SHA256);
  // The Working Copy itself is untouched and the snapshot is gone.
  assert.equal(await readFile(workingCopyPath, "utf8"), WORKING_COPY_HTML);
  await assert.rejects(lstat(snapshotRoot), (error) => error.code === "ENOENT");
});

test("a snapshot that cannot be confirmed deleted fails the turn", async (t) => {
  // PRD §21.1 makes deletion a product invariant, so a leftover snapshot beats a
  // successful turn. Root ignores the permission fence used to simulate it.
  if (typeof process.getuid === "function" && process.getuid() === 0) {
    t.skip("root bypasses the directory permission fence");
    return;
  }
  const root = await projectRoot(t);
  const parent = path.join(root, SNAPSHOT_PARENT);

  await assert.rejects(
    runDiscussionTurn(baseTurn(root, {
      turnId: "turn_locked",
      runTurn: async () => {
        // Freeze the parent so the snapshot directory cannot be unlinked.
        await chmod(parent, 0o500);
        return { stopReason: "end_turn", updates: [], droppedUpdateCount: 0 };
      },
    })),
    (error) => error.code === "DISCUSSION_SNAPSHOT_CLEANUP_UNCONFIRMED"
      // The turn's own result rides along so the caller can still show it.
      && error.discussionOutcome?.status === "completed",
  );

  // Restore here rather than in a hook: the temp-root cleanup hook registered
  // earlier would otherwise run first and fail on the frozen directory.
  await chmod(parent, 0o700);
});

test("the composed prompt states the read-only boundary and drops control characters", () => {
  const prompt = discussionPrompt({ question: "改\u0000标题\u0007吗？" });
  assert.match(prompt, /改标题吗？/u);
  assert.doesNotMatch(prompt, /[\u0000\u0007]/u);
  assert.match(prompt, /Do not write any file/u);
  assert.match(prompt, /snapshot\.html/u);
});
