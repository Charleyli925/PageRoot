import assert from "node:assert/strict";
import { mkdtemp, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createRestrictedDiscussionHost,
  loadQoderAcpDiscussionPolicy,
} from "../scripts/qoder-acp-client.mjs";

// The Discussion Host is the read-only Agent boundary for discussion turns.
// These pins hold its contract: it reads exactly one short-lived snapshot plus
// the prompt, never writes, never spawns a terminal, and fails closed on any
// unsafe path or post-start drift. It is independent of the Execution Host and
// carries no Request, output path or finalizer.

async function discussionRoot(html = "<!doctype html><html><body><h1>标题</h1></body></html>") {
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
  await assert.rejects(
    host.createTerminal({ sessionId: SESSION, command: "ls" }),
    (error) => error.code === "ACP_DISCUSSION_NO_TERMINAL",
  );
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
