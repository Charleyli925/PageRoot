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
  assert.equal(session.runForSource(current.sourcePath), null);
});

test("run session owns exact-once operation locks", () => {
  const session = new RunSession();
  assert.equal(session.beginOperation("cancel", "operation"), true);
  assert.equal(session.beginOperation("cancel", "operation"), false);
  assert.equal(session.isOperationBusy("cancel", "operation"), true);
  assert.equal(session.endOperation("cancel", "operation"), true);
  assert.equal(session.beginOperation("cancel", "operation"), true);
});
