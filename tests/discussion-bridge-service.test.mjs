import assert from "node:assert/strict";
import test from "node:test";

import { TRUSTED_LOCAL_AGENT_POLICY_VERSION } from "../scripts/agent-bridge-service.mjs";
import { DiscussionBridgeService } from "../scripts/discussion-bridge-service.mjs";

// These pins hold the Bridge side of a discussion turn: it redeems the same
// one-use command ticket as execution, refuses a stale or mismatched target,
// keeps at most one in-flight turn per Document, and publishes turn state only —
// never a path, prompt or page byte. It creates no Request and no Candidate.

const PROJECT_ID = "project_aaaaaaaaaaaaaaaa";
const DOCUMENT_ID = "doc_bbbbbbbbbbbbbbbb";
const SOURCE_PATH = "/tmp/pageroot-discussion/page.html";
const SOURCE_SHA256 = `sha256:${"a".repeat(64)}`;
const HTML = "<!doctype html><html><body><h1>标题</h1></body></html>\n";

function ticket() {
  return {
    preflightId: "preflight_1",
    command: {
      command: "/opt/qoder/bin/qoder",
      identity: { device: 1, inode: 2 },
      source: "verified-npm-package",
    },
    evidence: { version: "1.1.27" },
  };
}

function workingCopy(overrides = {}) {
  return {
    target: {
      projectId: PROJECT_ID,
      documentId: DOCUMENT_ID,
      projectRootPath: "/tmp/pageroot-discussion/project",
      exactSourcePath: SOURCE_PATH,
      ...overrides.target,
    },
    content: HTML,
    sourceSha256: SOURCE_SHA256,
    ...overrides,
  };
}

function createService(overrides = {}) {
  const calls = { redeemed: [], discussions: [], runners: [] };
  const service = new DiscussionBridgeService({
    redeemCommandTicket: async (preflightId) => {
      calls.redeemed.push(preflightId);
      return ticket();
    },
    readWorkingCopy: async () => workingCopy(),
    runDiscussion: async (input) => {
      calls.discussions.push(input);
      return {
        status: "completed",
        interrupted: false,
        interruptedReason: null,
        turnId: input.turnId,
        sourceSha256: input.expectedSourceSha256,
        stopReason: "end_turn",
        updates: [],
        droppedUpdateCount: 0,
      };
    },
    createTurnRunner: (input) => {
      calls.runners.push(input);
      return async () => ({ stopReason: "end_turn" });
    },
    ...overrides,
  });
  return { service, calls };
}

function startBody(overrides = {}) {
  return {
    driver: "qoder-acp",
    trustPolicyAccepted: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
    preflightId: "preflight_1",
    projectId: PROJECT_ID,
    documentId: DOCUMENT_ID,
    sourcePath: SOURCE_PATH,
    conversationId: "conversation_1",
    question: "这个标题怎么改更有说服力？",
    ...overrides,
  };
}

test("a started discussion turn is accepted and publishes turn state only", async () => {
  const { service, calls } = createService();

  const accepted = await service.start(startBody());
  assert.equal(accepted.ok, true);
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.idempotent, false);

  const session = accepted.session;
  assert.equal(session.driver, "qoder-acp");
  assert.equal(session.state, "starting");
  assert.equal(session.conversationId, "conversation_1");
  assert.match(session.turnId, /^turn_[a-f0-9]{32}$/u);
  assert.equal(session.sourceSha256, SOURCE_SHA256);
  // Nothing about the machine, the page or the prompt crosses the boundary.
  for (const leak of ["command", "cwd", "prompt", "question", "html", "content", "snapshotPath", "projectRootPath", "sourcePath"]) {
    assert.equal(leak in session, false, `${leak} must not be published`);
  }

  // The one-use ticket comes from the Agent service, and the spawn contract is
  // built from that ticket rather than from caller input.
  assert.deepEqual(calls.redeemed, ["preflight_1"]);
  assert.equal(calls.runners[0].ticket.command.command, "/opt/qoder/bin/qoder");

  // The runner receives the Working Copy bytes with their vouched Hash, and the
  // turn id it must use for the snapshot directory.
  const turn = calls.discussions[0];
  assert.equal(turn.html, HTML);
  assert.equal(turn.expectedSourceSha256, SOURCE_SHA256);
  assert.equal(turn.projectRoot, "/tmp/pageroot-discussion/project");
  assert.equal(turn.turnId, session.turnId);
  assert.equal(turn.question, "这个标题怎么改更有说服力？");

  await service.dispose();
  const settled = service.status({ documentId: DOCUMENT_ID });
  assert.equal(settled.state, "completed");
  assert.equal(settled.interrupted, false);
});

test("an interrupted or cancelled outcome is reported as such, not as success", async () => {
  for (const [reason, expectedState] of [["timeout", "interrupted"], ["cancelled", "cancelled"]]) {
    const { service } = createService({
      runDiscussion: async (input) => ({
        status: "interrupted",
        interrupted: true,
        interruptedReason: reason,
        turnId: input.turnId,
        sourceSha256: input.expectedSourceSha256,
        stopReason: null,
        updates: [],
        droppedUpdateCount: 0,
      }),
    });
    const accepted = await service.start(startBody());
    assert.equal(accepted.accepted, true);
    await service.dispose();
    const session = service.status({ documentId: DOCUMENT_ID });
    assert.equal(session.state, expectedState, `${reason} must map to ${expectedState}`);
    assert.equal(session.interrupted, true);
    assert.equal(session.interruptedReason, reason);
  }
});

test("a failed turn reports a safe error and keeps any partial outcome", async () => {
  const failure = new Error("snapshot could not be confirmed deleted");
  failure.code = "DISCUSSION_SNAPSHOT_CLEANUP_UNCONFIRMED";
  failure.discussionOutcome = { interrupted: true, interruptedReason: "timeout" };
  const { service } = createService({
    runDiscussion: async () => {
      throw failure;
    },
  });

  await service.start(startBody());
  await service.dispose();
  const session = service.status({ documentId: DOCUMENT_ID });
  assert.equal(session.state, "failed");
  assert.equal(session.errorCode, "DISCUSSION_SNAPSHOT_CLEANUP_UNCONFIRMED");
  // The message is safe product copy, not the raw internal failure text.
  assert.doesNotMatch(session.errorMessage, /snapshot/iu);
  assert.equal(session.interrupted, true);
  assert.equal(session.interruptedReason, "timeout");
});

test("a second turn for the same Document does not launch a second Qoder", async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const started = [];
  const { service, calls } = createService({
    runDiscussion: async (input) => {
      started.push(input);
      await gate;
      return {
        status: "completed",
        interrupted: false,
        interruptedReason: null,
        turnId: input.turnId,
        sourceSha256: input.expectedSourceSha256,
        stopReason: "end_turn",
        updates: [],
        droppedUpdateCount: 0,
      };
    },
  });

  const first = await service.start(startBody());
  const second = await service.start(startBody({ conversationId: "conversation_2" }));

  assert.equal(first.accepted, true);
  // PRD §17.5: one in-flight turn per Document.
  assert.equal(second.accepted, false);
  assert.equal(second.idempotent, true);
  assert.equal(second.session.turnId, first.session.turnId);
  assert.equal(started.length, 1);
  // The refused start must not burn a second preflight ticket either.
  assert.deepEqual(calls.redeemed, ["preflight_1"]);

  release();
  await service.dispose();
  assert.equal(service.status({ documentId: DOCUMENT_ID }).state, "completed");
});

test("the Bridge refuses an unusable discussion before spawning anything", async () => {
  const rejects = async (body, code, status) => {
    const { service, calls } = createService();
    await assert.rejects(
      service.start(startBody(body)),
      (error) => error.code === code && error.status === status,
      `${code} expected for ${JSON.stringify(body)}`,
    );
    assert.equal(calls.discussions.length, 0);
    assert.deepEqual(calls.redeemed, [], "no ticket may be redeemed by a refused start");
  };

  await rejects({ driver: "clipboard" }, "AGENT_DRIVER_UNSUPPORTED", 422);
  await rejects({ trustPolicyAccepted: "nope" }, "AGENT_TRUST_POLICY_REQUIRED", 422);
  await rejects({ projectId: "project_zz" }, "DISCUSSION_IDENTITY_INVALID", 422);
  await rejects({ conversationId: "../escape" }, "DISCUSSION_IDENTITY_INVALID", 422);
  await rejects({ question: "   " }, "DISCUSSION_QUESTION_EMPTY", 422);
  await rejects({ question: "x".repeat(9 * 1024) }, "DISCUSSION_QUESTION_TOO_LARGE", 422);
});

test("a stale page or mismatched target is refused without redeeming the ticket", async () => {
  const stale = createService();
  await assert.rejects(
    stale.service.start(startBody({ expectedSourceSha256: `sha256:${"b".repeat(64)}` })),
    (error) => error.code === "DISCUSSION_SOURCE_STALE" && error.status === 409,
  );
  assert.deepEqual(stale.calls.redeemed, []);
  assert.equal(stale.calls.discussions.length, 0);

  const mismatched = createService({
    readWorkingCopy: async () => workingCopy({ target: { documentId: "doc_cccccccccccccccc" } }),
  });
  await assert.rejects(
    mismatched.service.start(startBody()),
    (error) => error.code === "DISCUSSION_IDENTITY_MISMATCH" && error.status === 409,
  );
  assert.deepEqual(mismatched.calls.redeemed, []);
  assert.equal(mismatched.calls.discussions.length, 0);
});

test("cancel aborts the in-flight turn and dispose drains every owned turn", async () => {
  const observed = { aborted: false };
  const { service } = createService({
    runDiscussion: async ({ cancellationSignal }) => {
      await new Promise((resolve) => {
        if (cancellationSignal.aborted) resolve();
        else cancellationSignal.addEventListener("abort", resolve, { once: true });
      });
      observed.aborted = true;
      return {
        status: "interrupted",
        interrupted: true,
        interruptedReason: "cancelled",
        turnId: "turn_x",
        sourceSha256: SOURCE_SHA256,
        stopReason: null,
        updates: [],
        droppedUpdateCount: 0,
      };
    },
  });

  await service.start(startBody());
  const cancelled = await service.cancel({ documentId: DOCUMENT_ID });
  assert.equal(cancelled.cancelled, true);
  assert.equal(observed.aborted, true);
  assert.equal(service.status({ documentId: DOCUMENT_ID }).state, "cancelled");

  // Cancelling a settled turn is a no-op rather than an error.
  const again = await service.cancel({ documentId: DOCUMENT_ID });
  assert.equal(again.cancelled, false);

  await service.dispose();
  await assert.rejects(
    service.start(startBody()),
    (error) => error.code === "AGENT_BRIDGE_DISPOSED" && error.status === 503,
  );
});

test("an unknown Document has no discussion session", () => {
  const { service } = createService();
  assert.equal(service.status({ documentId: "doc_dddddddddddddddd" }), null);
  assert.equal(service.status({}), null);
});
