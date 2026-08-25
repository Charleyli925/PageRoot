import assert from "node:assert/strict";
import { chmod, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { TRUSTED_LOCAL_AGENT_POLICY_VERSION } from "../scripts/agent-bridge-service.mjs";
import { createBridgeTestEnvironment } from "./helpers/bridge-test-environment.mjs";

const fixtureAgent = fileURLToPath(new URL("./fixtures/qoder-acp-agent.mjs", import.meta.url));

// End-to-end discussion turn through the real Bridge process and a real ACP
// child: `POST /discussion/start` must run one read-only turn against a
// short-lived snapshot, publish only turn state, leave no snapshot behind, keep
// the Working Copy byte-identical and create no Request or Candidate.

function html(label) {
  return `<!doctype html><html><head><title>${label}</title></head><body><main><h1>${label}</h1></main></body></html>`;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

async function createDiscussionCommand(environment) {
  const command = path.join(environment.root, "qoder-discussion");
  await writeFile(
    command,
    `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(fixtureAgent)} --discussion "$@"\n`,
    { encoding: "utf8", mode: 0o755 },
  );
  await chmod(command, 0o755);
  return command;
}

async function createDiscussionEnvironment(t) {
  const environment = await createBridgeTestEnvironment(t, {
    prefix: "pageroot-discussion-bridge-",
  });
  const command = await createDiscussionCommand(environment);
  const sourceHtml = html("Discussion ACP");
  const externalSourcePath = await environment.createSource("discussion.html", sourceHtml);
  const bridge = await environment.start({
    HTML_AI_PROJECT_FILES_ROOT: path.join(environment.root, "project-files"),
    PAGEROOT_E2E: "1",
    PAGEROOT_QODER_ACP_ALLOW_TEST_COMMAND: "1",
    PAGEROOT_QODER_ACP_COMMAND: command,
  });
  const workspace = await bridge.requestJson(
    `/workspace?sourcePath=${encodeURIComponent(externalSourcePath)}`,
  );
  const ensured = await bridge.postJson("/project/ensure", {
    sourcePath: externalSourcePath,
    expectedSourceSha256: workspace.body.currentHtmlSha256,
    projectStorageVersion: "4.0.0",
  });
  assert.equal(ensured.response.status, 200, JSON.stringify(ensured.body));
  const preflight = await bridge.postJson("/agent/preflight", {
    driver: "qoder-acp",
    purpose: "discussion",
    trustPolicyAccepted: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
  });
  assert.equal(preflight.response.status, 200, JSON.stringify(preflight.body));
  return { environment, bridge, ensured: ensured.body, preflight: preflight.body, sourceHtml };
}

function startBody(ensured, preflight, overrides = {}) {
  return {
    driver: "qoder-acp",
    trustPolicyAccepted: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
    preflightId: preflight.preflightId,
    selection: preflight.selection,
    projectId: ensured.projectId,
    documentId: ensured.documentId,
    sourcePath: ensured.sourcePath,
    conversationId: "conversation_e2e",
    question: "这页的标题怎么改更有说服力？",
    expectedSourceSha256: ensured.sourceSha256,
    ...overrides,
  };
}

async function settledDiscussion(bridge, sourcePath) {
  const deadline = Date.now() + 30_000;
  let last = null;
  while (Date.now() < deadline) {
    const status = await bridge.requestJson(
      `/discussion/status?sourcePath=${encodeURIComponent(sourcePath)}`,
    );
    assert.equal(status.response.status, 200, JSON.stringify(status.body));
    last = status.body.discussion;
    if (last && !["starting", "running", "cancelling"].includes(last.state)) return last;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`discussion did not settle: ${JSON.stringify(last)}`);
}

test("POST /discussion/start runs one read-only turn and leaves no snapshot", async (t) => {
  const { bridge, ensured, preflight, sourceHtml } = await createDiscussionEnvironment(t);

  const started = await bridge.postJson("/discussion/start", startBody(ensured, preflight));
  assert.equal(started.response.status, 202, JSON.stringify(started.body));
  assert.equal(started.body.accepted, true);
  const session = started.body.session;
  assert.equal(session.driver, "qoder-acp");
  // The Bridge resolves the document's real conversation rather than trusting
  // the identity the caller sent.
  assert.match(session.conversationId, /^conversation_[a-f0-9]{32}$/u);
  assert.match(session.turnId, /^turn_[a-f0-9]{32}$/u);
  assert.equal(session.sourceSha256, ensured.sourceSha256);
  // The renderer never receives command, paths, prompt or page bytes.
  for (const leak of ["command", "cwd", "prompt", "question", "snapshotPath", "sourcePath"]) {
    assert.equal(leak in session, false, `${leak} must not be published`);
  }

  // The fixture Agent itself fails the turn if a write or terminal is allowed,
  // so a completed turn is proof the read-only boundary held over real ACP.
  const settled = await settledDiscussion(bridge, ensured.sourcePath);
  assert.equal(settled.state, "completed", JSON.stringify(settled));
  assert.equal(settled.interrupted, false);
  assert.ok(settled.eventCount > 0);
  assert.match(settled.agentName, /qoder/iu);
  // ADR 0036: the visible reply reaches the user, and hidden reasoning does not.
  assert.equal(settled.replyText, "这页的标题偏笼统，可以点明读者能得到什么。");
  assert.equal(settled.replyTruncated, false);
  assert.doesNotMatch(settled.replyText, /internal reasoning/iu);
  assert.equal(settled.recorded, true);

  // The round is durable: reading the conversation back shows the question and
  // the reply as stored messages, so the answer survives a reload.
  const conversation = await bridge.requestJson(
    `/conversation?sourcePath=${encodeURIComponent(ensured.sourcePath)}`,
  );
  assert.equal(conversation.response.status, 200, JSON.stringify(conversation.body));
  const messages = conversation.body.conversation.messages;
  const question = messages.find((message) => message.actor === "user");
  const reply = messages.find((message) => message.actor === "agent");
  assert.equal(reply.providerId, "qoder");
  assert.equal(question.text, "这页的标题怎么改更有说服力？");
  assert.equal(question.status, "completed");
  assert.equal(reply.text, "这页的标题偏笼统，可以点明读者能得到什么。");
  assert.equal(reply.status, "completed");
  assert.equal(reply.kind, "text");
  // Hidden reasoning never reaches the durable record either.
  for (const message of messages) {
    assert.doesNotMatch(message.text, /internal reasoning/iu);
  }
  // The round records which bytes were discussed (PRD §9.2).
  const context = conversation.body.conversation.contexts.find(
    (value) => value.contextId === reply.contextId,
  );
  assert.equal(context.sourceSha256, ensured.sourceSha256);
  assert.equal(context.side, "working-copy");

  // The snapshot is gone and durable project state is untouched.
  const snapshotParent = path.join(ensured.projectRoot, ".pageroot", "discussion-snapshots");
  assert.deepEqual(await readdir(snapshotParent).catch(() => []), []);
  assert.equal(await readFile(ensured.sourcePath, "utf8"), sourceHtml);

  // No Request, Attempt or Candidate came into existence: discussion never
  // touches `activeRequest` and writes nothing under `requests/`.
  const requestsRoot = path.join(ensured.projectRoot, ".pageroot", "requests");
  assert.deepEqual(await readdir(requestsRoot).catch(() => []), []);
  const runtimeText = await readFile(
    path.join(ensured.projectRoot, ".pageroot", "runtime-state.json"),
    "utf8",
  ).catch(() => "{}");
  assert.equal(Boolean(JSON.parse(runtimeText).activeRequest), false);
});

test("the discussion route refuses a mismatched target and a spent ticket", async (t) => {
  const { bridge, ensured, preflight } = await createDiscussionEnvironment(t);

  const mismatched = await bridge.postJson("/discussion/start", startBody(ensured, preflight, {
    documentId: "doc_cccccccccccccccc",
  }));
  assert.equal(mismatched.response.status, 409, JSON.stringify(mismatched.body));
  assert.equal(mismatched.body.error.code, "PROJECT_CONTEXT_IDENTITY_MISMATCH");

  const stale = await bridge.postJson("/discussion/start", startBody(ensured, preflight, {
    expectedSourceSha256: `sha256:${"b".repeat(64)}`,
  }));
  assert.equal(stale.response.status, 409, JSON.stringify(stale.body));
  assert.equal(stale.body.error.code, "DISCUSSION_SOURCE_STALE");

  // A refused start must not have consumed the one-use ticket.
  const accepted = await bridge.postJson("/discussion/start", startBody(ensured, preflight));
  assert.equal(accepted.response.status, 202, JSON.stringify(accepted.body));
  const settled = await settledDiscussion(bridge, ensured.sourcePath);
  assert.equal(settled.state, "completed", JSON.stringify(settled));

  // The ticket is single-use, so the next start needs a fresh preflight.
  const replayed = await bridge.postJson("/discussion/start", startBody(ensured, preflight));
  assert.equal(replayed.response.status, 409, JSON.stringify(replayed.body));
  assert.equal(replayed.body.error.code, "AGENT_PREFLIGHT_EXPIRED");
});

test("the discussion routes reject an unregistered source", async (t) => {
  const { bridge, environment, ensured, preflight } = await createDiscussionEnvironment(t);
  const stray = path.join(environment.root, "stray.html");
  await writeFile(stray, html("Stray"), "utf8");

  const started = await bridge.postJson("/discussion/start", startBody(ensured, preflight, {
    sourcePath: stray,
  }));
  assert.ok(started.response.status >= 400, JSON.stringify(started.body));

  const status = await bridge.requestJson(
    `/discussion/status?sourcePath=${encodeURIComponent(stray)}`,
  );
  assert.ok(status.response.status >= 400, JSON.stringify(status.body));
});
