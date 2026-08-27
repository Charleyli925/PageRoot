import assert from "node:assert/strict";
import test from "node:test";

import {
  planDocumentEnqueue,
  planDocumentSave,
} from "../app/application/document/save-plan.js";
import {
  copyProjectContext,
  verifyProjectContext,
} from "../app/application/verified-project-context.js";

test("document enqueue plan rejects disposed and conflict, and is ready otherwise", () => {
  assert.equal(planDocumentEnqueue({ disposed: true }).kind, "reject");
  assert.equal(planDocumentEnqueue({ persistState: "conflict" }).code, "DOCUMENT_PERSISTENCE_CONFLICT");
  assert.equal(planDocumentEnqueue({ persistState: "idle" }).kind, "ready");
});

test("document save plan waits for an in-flight flush and idles when caught up", () => {
  assert.equal(planDocumentSave({ flushInFlight: true }).kind, "wait");
  assert.deepEqual(planDocumentSave({
    pendingWrite: null,
    editRevision: 3,
    lastPersistedRevision: 3,
  }), { kind: "ready", action: "idle", revision: 3 });
  assert.equal(planDocumentSave({
    pendingWrite: null,
    editRevision: 4,
    lastPersistedRevision: 3,
  }).code, "DOCUMENT_SOURCE_UNBOUND");
  assert.equal(planDocumentSave({
    pendingWrite: { sourcePath: "/tmp/page.html" },
    editRevision: 4,
    lastPersistedRevision: 3,
  }).action, "write");
});

test("VerifiedProjectContext is a frozen snapshot and never matches a different live session", () => {
  const context = copyProjectContext({
    epoch: 2,
    projectId: "project_a",
    documentId: "document_a",
    sourcePath: "/tmp/a.html",
  });
  assert.ok(Object.isFrozen(context));
  const live = {
    epoch: 2,
    sourcePath: "/tmp/a.html",
    matches(candidate) {
      return candidate.projectId === "project_a" && candidate.documentId === "document_a";
    },
  };
  const verified = verifyProjectContext(context, live);
  assert.equal(verified.sourcePath, "/tmp/a.html");
  assert.equal(verifyProjectContext(context, {
    ...live,
    matches: () => false,
  }), null);
  assert.equal(verifyProjectContext(context, live, { disposed: true }), null);
});
