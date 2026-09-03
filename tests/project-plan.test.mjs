import assert from "node:assert/strict";
import test from "node:test";

import { planProjectCloseAbort, planProjectCloseHydration, planProjectCloseIdentity } from "../app/application/project/close-plan.js";
import { planProjectOpen } from "../app/application/project/open-intent.js";
import {
  planSourceLocatorRegister,
  planSourceLocatorTransition,
} from "../app/application/project/source-locator-plan.js";
import {
  planProjectSwitchAfterSourceProtection,
  planProjectSwitchAfterDrain,
  planProjectSwitchEntry,
  planProjectSwitchFence,
  planProjectSwitchValidationLease,
} from "../app/application/project/switch-plan.js";

test("project open plan rejects a closing window and classifies the remaining intents", () => {
  assert.equal(planProjectOpen({ closePhase: "ready" }).code, "PROJECT_OPEN_CLOSE_COMMITTED");
  assert.equal(planProjectOpen({ kind: "startup" }).action, "startup");
  assert.equal(planProjectOpen({ kind: "local" }).action, "open-file");
  assert.equal(planProjectOpen({ kind: "recent" }).action, "open-file");
  assert.equal(planProjectOpen({ kind: "registered" }).action, "open-registered");
});

test("project switch entry plan fail-closes disposed and drain blocks, and waits for history", () => {
  assert.equal(planProjectSwitchEntry({ disposed: true }).code, "PROJECT_WORKFLOW_DISPOSED");
  assert.equal(
    planProjectSwitchEntry({ drainBlockedReason: "AI 仍在写入。" }).code,
    "PROJECT_SWITCH_BLOCKED",
  );
  assert.equal(planProjectSwitchEntry({ projectLoadError: true }).action, "reset-failed");
  assert.equal(planProjectSwitchEntry({ runLocked: true }).action, "drain-run-lock");
  assert.equal(planProjectSwitchEntry({ hasHistoryAction: true }).kind, "wait");
  assert.equal(planProjectSwitchEntry().action, "continue");
});

test("project switch fence and after-drain plans reject unverified native edits", () => {
  assert.equal(planProjectSwitchFence({ needsCanvasCommit: false }).kind, "ready");
  assert.equal(
    planProjectSwitchFence({ needsCanvasCommit: true, fenceOk: false }).code,
    "PROJECT_SWITCH_NATIVE_EDIT",
  );
  assert.equal(
    planProjectSwitchAfterDrain({
      editRevision: 2,
      cutoffRevision: 1,
    }).code,
    "PROJECT_SWITCH_SOURCE_CHANGED",
  );
  assert.equal(planProjectSwitchAfterDrain({
    editRevision: 1,
    cutoffRevision: 1,
  }).kind, "ready");
});

test("project switch reuses only a clean exact Canvas validation lease", () => {
  const exact = {
    obligationsResolved: true,
    persistState: "idle",
    editRevision: 4,
    lastPersistedRevision: 4,
    sourcePath: "/tmp/a.html",
    sourceSha256: "sha256:aaa",
    canvasStatus: "verified",
    renderedSha256: "sha256:aaa",
  };
  assert.equal(planProjectSwitchValidationLease(exact).action, "reuse-verified");
  assert.equal(planProjectSwitchValidationLease({
    ...exact,
    obligationsResolved: false,
  }).action, "full-check");
  assert.equal(planProjectSwitchValidationLease({
    ...exact,
    hasPendingNativeEdit: true,
  }).action, "full-check");
  assert.equal(planProjectSwitchValidationLease({
    ...exact,
    renderedSha256: "sha256:bbb",
  }).action, "full-check");
});

test("project switch after-drain plan validates Working HTML instead of presentation freshness", () => {
  assert.equal(
    planProjectSwitchAfterSourceProtection({
      needsSourceProtection: true,
      sourcePath: "/tmp/a.html",
      lastPersistedRevision: 2,
      cutoffRevision: 1,
      committedSourceSha256: "sha256:aaa",
      persistedSourceSha256: "sha256:aaa",
      workingHtmlSha256: "sha256:aaa",
    }).code,
    "PROJECT_SWITCH_SOURCE_MISMATCH",
  );
  assert.equal(
    planProjectSwitchAfterSourceProtection({
      needsSourceProtection: true,
      sourcePath: "/tmp/a.html",
      lastPersistedRevision: 1,
      cutoffRevision: 1,
      committedSourceSha256: "sha256:aaa",
      persistedSourceSha256: "sha256:aaa",
      workingHtmlSha256: "sha256:aaa",
    }).kind,
    "ready",
  );
  assert.equal(
    planProjectSwitchAfterSourceProtection({ needsSourceProtection: false }).kind,
    "ready",
  );
});

test("project close plans classify identity, hydration and abort without executing side effects", () => {
  assert.equal(planProjectCloseIdentity({}).code, "PROJECT_CLOSE_IDENTITY_INVALID");
  assert.equal(planProjectCloseIdentity({ requestId: "close_1", deadlineAt: 1 }).kind, "ready");
  assert.equal(
    planProjectCloseHydration({
      projectHydrating: true,
      projectOpenInFlight: true,
    }).code,
    "PROJECT_CLOSE_OPEN_IN_FLIGHT",
  );
  assert.equal(
    planProjectCloseHydration({
      projectHydrating: true,
      canCloseDuringHydration: true,
    }).action,
    "allow-hydration",
  );
  assert.equal(
    planProjectCloseHydration({
      projectLoadError: true,
      pendingDirty: true,
    }).code,
    "PROJECT_CLOSE_LOAD_ERROR_DIRTY",
  );
  assert.equal(planProjectCloseHydration({ projectLoadError: true }).action, "allow-load-error");
  assert.equal(planProjectCloseAbort({ aborted: true }).code, "PROJECT_CLOSE_ABORTED");
  assert.equal(
    planProjectCloseAbort({ projectOpenInFlight: true }).code,
    "PROJECT_CLOSE_OPEN_IN_FLIGHT",
  );
});

test("source locator plans reject stale register and transition identities", () => {
  const samePath = (left, right) => left === right;
  assert.equal(planSourceLocatorRegister({
    epoch: 1,
    liveEpoch: 2,
    sourcePath: "/tmp/a.html",
    liveSourcePath: "/tmp/a.html",
    projectId: "p",
    documentId: "d",
    samePath,
  }).code, "SOURCE_LOCATOR_STALE");
  assert.equal(planSourceLocatorRegister({
    epoch: 1,
    liveEpoch: 1,
    sourcePath: "/tmp/a.html",
    liveSourcePath: "/tmp/a.html",
    projectId: "p",
    documentId: "d",
    samePath,
  }).kind, "ready");
  assert.equal(planSourceLocatorTransition({
    nextSourcePath: "",
    samePath,
  }).code, "SOURCE_LOCATOR_MISSING");
  assert.equal(planSourceLocatorTransition({
    nextSourcePath: "/tmp/b.html",
    previousSourcePath: "/tmp/a.html",
    liveSourcePath: "/tmp/other.html",
    samePath,
  }).code, "SOURCE_LOCATOR_STALE");
  assert.equal(planSourceLocatorTransition({
    nextSourcePath: "/tmp/b.html",
    previousSourcePath: "/tmp/a.html",
    liveSourcePath: "/tmp/a.html",
    samePath,
  }).kind, "ready");
});
