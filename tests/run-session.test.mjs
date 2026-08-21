import assert from "node:assert/strict";
import test from "node:test";

import { RunSession } from "../app/application/run-session.js";

function run(overrides = {}) {
  return {
    projectId: "project",
    documentId: "document",
    requestId: "request",
    attemptId: "attempt",
    requestPath: "/tmp/request",
    attemptPath: "/tmp/attempt",
    handoffMessage: "message",
    status: "processing",
    sourcePath: "/tmp/page.html",
    baseSnapshotSha256: "sha256:base",
    previousVersionId: null,
    basedOnVersionId: null,
    freezeCutoffRevision: 1,
    candidateVersionId: "version_002",
    candidateVersionLabel: "版本 2",
    submittedAt: "2026-07-31T00:00:00.000Z",
    ...overrides,
  };
}

test("run session activates one source without attaching another project result", () => {
  const session = new RunSession({ sourcePath: "/tmp/page.html" });
  const current = run();
  const background = run({
    projectId: "other",
    requestId: "other-request",
    sourcePath: "/tmp/other.html",
  });
  session.trackRun(current);
  session.trackRun(background);
  session.markResult(background.sourcePath, {
    state: "ready",
    label: "新版本可查看",
    updatedAt: 1,
  });

  assert.equal(session.activeRun, current);
  assert.equal(session.snapshot.backgroundResults.length, 1);
  session.activate(background.sourcePath);
  assert.equal(session.activeRun, background);
});

test("run session rejects a late handoff result from an older run", () => {
  const session = new RunSession({ sourcePath: "/tmp/page.html" });
  const current = run();
  session.setActiveRun(current);
  assert.equal(session.publishHandoff({
    sourcePath: current.sourcePath,
    requestId: current.requestId,
    attemptId: current.attemptId,
    status: "copying",
  }), true);
  assert.equal(session.publishHandoff({
    sourcePath: current.sourcePath,
    requestId: "older-request",
    attemptId: "older-attempt",
    status: "copied",
  }), false);
  assert.equal(session.activeHandoff.status, "copying");
});

test("run session preserves handoff risk after a retry fails", () => {
  const session = new RunSession({ sourcePath: "/tmp/page.html" });
  const current = run();
  session.trackRun(current);
  session.publishHandoff({
    sourcePath: current.sourcePath,
    requestId: current.requestId,
    attemptId: current.attemptId,
    status: "copied",
  });
  session.publishHandoff({
    sourcePath: current.sourcePath,
    requestId: current.requestId,
    attemptId: current.attemptId,
    status: "failed",
  });

  assert.equal(session.activeHandoff.status, "failed");
  assert.equal(session.activeHandoffMayBeRunning, true);
});

test("run session preserves copied handoff risk when refreshing the same run", () => {
  const session = new RunSession({ sourcePath: "/tmp/page.html" });
  const current = run();
  session.trackRun(current);
  session.publishHandoff({
    sourcePath: current.sourcePath,
    requestId: current.requestId,
    attemptId: current.attemptId,
    status: "copied",
  });

  session.setActiveRun({ ...current, status: "processing" });

  assert.equal(session.activeHandoffMayBeRunning, true);
});

test("run session distinguishes managed Qoder state from clipboard handoff risk", () => {
  const sourcePath = "/tmp/qoder.html";
  const session = new RunSession({ sourcePath });
  const activeRun = run({ sourcePath, requestId: "req_qoder" });
  session.trackRun(activeRun, { activate: "always" });
  session.publishHandoff({
    ...activeRun,
    mode: "qoder-acp",
    status: "running",
    phase: "reading-task",
  });
  assert.equal(session.activeHandoffManaged, true);
  assert.equal(session.activeHandoffMayBeRunning, true);

  session.publishHandoff({
    ...activeRun,
    mode: "qoder-acp",
    status: "interrupted",
    phase: "interrupted",
  });
  assert.equal(session.activeHandoffManaged, false);
  assert.equal(session.activeHandoffMayBeRunning, false);

  session.publishHandoff({
    ...activeRun,
    mode: "clipboard",
    status: "copying",
  });
  session.publishHandoff({
    ...activeRun,
    mode: "clipboard",
    status: "copied",
  });
  assert.equal(session.activeHandoffManaged, false);
  assert.equal(session.activeHandoffMayBeRunning, true);

});

test("run session treats a recovered processing run as potentially handed off", () => {
  const original = new RunSession({ sourcePath: "/tmp/page.html" });
  const current = run();
  original.trackRun(current);
  original.publishHandoff({
    sourcePath: current.sourcePath,
    requestId: current.requestId,
    attemptId: current.attemptId,
    status: "copied",
  });
  assert.equal(original.activeHandoffMayBeRunning, true);

  const recovered = new RunSession({ sourcePath: "/tmp/page.html" });
  recovered.trackRun(current, { recovered: true });
  assert.equal(recovered.activeHandoff, null);
  assert.equal(recovered.activeHandoffMayBeRunning, true);

  const fresh = new RunSession({ sourcePath: "/tmp/page.html" });
  fresh.trackRun(current);
  assert.equal(fresh.activeHandoffMayBeRunning, false);
});

test("run session treats a recovered interrupted Qoder handoff as unmanaged risk", () => {
  const sourcePath = "/tmp/recovered-qoder.html";
  const current = run({
    sourcePath,
    requestId: "req_recovered_qoder",
    agentDelivery: {
      mode: "qoder-acp",
      trustPolicyVersion: "trusted-local-agent-v1",
    },
  });
  const session = new RunSession({ sourcePath });
  const snapshots = [];
  session.subscribe((snapshot) => snapshots.push(snapshot));
  session.trackRun(current, { recovered: true });

  assert.equal(session.activeHandoff.status, "interrupted");
  assert.equal(session.activeHandoff.errorCode, "AGENT_RESTART_RECOVERY_REQUIRED");
  assert.equal(session.activeHandoff.retryable, false);
  assert.equal(session.activeHandoffManaged, false);
  assert.equal(session.activeHandoffMayBeRunning, true);
  assert.equal(
    snapshots
      .filter((snapshot) => snapshot.activeRun?.requestId === current.requestId)
      .every((snapshot) => snapshot.activeHandoffMayBeRunning),
    true,
  );

  session.publishHandoff({
    ...current,
    mode: "qoder-acp",
    status: "failed",
    errorCode: "AGENT_RESTART_RECOVERY_REQUIRED",
    retryable: false,
  });
  assert.equal(session.activeHandoffManaged, false);
  assert.equal(session.activeHandoffMayBeRunning, true);
});

test("run session owns submission preparation, freeze and unknown-outcome locking", () => {
  const session = new RunSession({ sourcePath: "/tmp/page.html" });
  const submission = session.beginSubmission({
    sourcePath: "/tmp/page.html",
  });

  assert.ok(submission);
  assert.equal(session.snapshot.activeSubmission?.phase, "preparing");
  assert.equal(session.submissionPending, true);
  assert.equal(session.snapshot.activeSubmission?.phase === "preparing", true);
  assert.equal(session.activeLocked, false);
  assert.equal(session.beginSubmission({ sourcePath: "/tmp/other.html" }), null);

  assert.equal(session.freezeSubmission(submission), true);
  assert.equal(session.snapshot.activeSubmission?.phase, "frozen");
  assert.equal(session.submissionPending, true);
  assert.equal(session.snapshot.activeSubmission?.phase === "preparing", false);
  assert.equal(session.activeLocked, true);

  assert.equal(session.markSubmissionUncertain(submission), true);
  assert.equal(session.snapshot.activeSubmission?.phase, "uncertain");
  assert.equal(session.submissionPending, false);
  assert.equal(session.activeLocked, true);

  session.activate("/tmp/other.html");
  assert.equal(session.snapshot.activeSubmission, null);
  assert.equal(session.activeLocked, false);
  const nextSubmission = session.beginSubmission({
    sourcePath: "/tmp/other.html",
  });
  assert.ok(nextSubmission);
  assert.equal(session.snapshot.activeSubmission, nextSubmission);
  assert.equal(session.activeLocked, false);

  assert.equal(session.releaseSubmission(nextSubmission), true);
  assert.equal(session.snapshot.activeSubmission, null);
  assert.equal(session.activeLocked, false);
});

test("run session rebases run, handoff and result through a source rename", () => {
  const session = new RunSession({ sourcePath: "/tmp/page.html" });
  const current = run();
  session.trackRun(current);
  session.publishHandoff({
    sourcePath: current.sourcePath,
    requestId: current.requestId,
    attemptId: current.attemptId,
    status: "copied",
  });
  session.markResult(current.sourcePath, {
    state: "processing",
    label: "正在处理",
    updatedAt: 1,
  });
  session.rememberOutcome({ ...current, status: "error" });
  assert.equal(session.rebaseSource({
    previousSourcePath: current.sourcePath,
    sourcePath: "/tmp/renamed.html",
    projectId: current.projectId,
  }), true);
  assert.equal(session.activeRun.sourcePath, "/tmp/renamed.html");
  assert.equal(session.activeHandoff.sourcePath, "/tmp/renamed.html");
  assert.equal(
    session.resultForSource("/tmp/renamed.html").state,
    "processing",
  );
  assert.equal(
    session.outcomeForSource("/tmp/renamed.html").sourcePath,
    "/tmp/renamed.html",
  );
  assert.equal(session.runForSource(current.sourcePath), null);
});

test("terminal outcomes remain reopenable after the active panel is dismissed", () => {
  const session = new RunSession({ sourcePath: "/tmp/page.html" });
  const terminal = run({ status: "error", error: "返回结果无法使用。" });
  session.setActiveRun(terminal);
  session.rememberOutcome(terminal);
  session.clearActiveRun();

  assert.equal(session.snapshot.activeRun, null);
  assert.equal(session.snapshot.recentOutcome, terminal);
  session.setActiveRun(session.outcomeForSource(terminal.sourcePath));
  assert.equal(session.snapshot.activeRun, terminal);

  assert.equal(session.forgetOutcome(terminal.sourcePath), true);
  assert.equal(session.snapshot.recentOutcome, null);
});

test("run session owns exact-once operation locks", () => {
  const session = new RunSession();
  const snapshots = [];
  session.setObserver((snapshot) => snapshots.push(snapshot));
  assert.equal(session.beginOperation("cancel", "operation"), true);
  assert.equal(session.beginOperation("cancel", "operation"), false);
  assert.equal(session.isOperationBusy("cancel", "operation"), true);
  assert.deepEqual(session.snapshot.operationKeys, [["cancel", "operation"]]);
  assert.equal(session.endOperation("cancel", "operation"), true);
  assert.deepEqual(session.snapshot.operationKeys, []);
  assert.equal(session.beginOperation("cancel", "operation"), true);
  assert.equal(snapshots.length, 3);
});

test("run session allows the controller to observe alongside the existing view observer", () => {
  const session = new RunSession({ sourcePath: "/tmp/page.html" });
  const viewSnapshots = [];
  const controllerSnapshots = [];
  session.setObserver((snapshot) => viewSnapshots.push(snapshot));
  const unsubscribe = session.subscribe((snapshot) => controllerSnapshots.push(snapshot));

  session.trackRun(run());
  unsubscribe();
  session.clearActiveRun();

  assert.equal(viewSnapshots.length, 2);
  assert.equal(controllerSnapshots.length, 2);
  assert.equal(controllerSnapshots[1].activeRun?.requestId, "request");
});
