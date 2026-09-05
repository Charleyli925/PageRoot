import assert from "node:assert/strict";
import test from "node:test";

import {
  createAgentRecoveryIntent,
  recoveryIntentMatchesDocument,
  sidebarRecoveryBar,
} from "../app/application/agent-recovery-intent.js";

test("a recovery intent keeps destination facts and refuses secrets", () => {
  const intent = createAgentRecoveryIntent({
    originSurface: "sidebar",
    projectId: "project_abc",
    documentId: "document_xyz",
    requestId: "request_1",
    attemptId: "attempt_1",
    providerId: "pageroot",
    targetField: "apiKey",
    errorKind: "auth-required",
    draftIdentity: "draft_1",
    configurationGeneration: 4,
  });
  assert.equal(intent.providerId, "pageroot");
  assert.equal(intent.targetField, "apiKey");
  assert.equal(intent.configurationGeneration, 4);
  assert.ok(!("apiKey" in intent));
  assert.ok(!("token" in intent));
  assert.ok(!("loginUrl" in intent));
  assert.throws(
    () => createAgentRecoveryIntent({ providerId: "pageroot", apiKey: "sk-secret" }),
    /不能保存/u,
  );
});

test("restored connection does not auto-send on another document", () => {
  const intent = createAgentRecoveryIntent({
    originSurface: "send",
    projectId: "project_a",
    documentId: "document_a",
    providerId: "pageroot",
    targetField: "apiKey",
  });
  assert.equal(recoveryIntentMatchesDocument(intent, {
    projectId: "project_a",
    documentId: "document_a",
  }), true);
  assert.equal(recoveryIntentMatchesDocument(intent, {
    projectId: "project_a",
    documentId: "document_b",
  }), false);

  const restored = sidebarRecoveryBar({
    intent,
    catalogStatus: "ready",
    currentProjectId: "project_a",
    currentDocumentId: "document_a",
  });
  assert.equal(restored.kind, "restored");
  assert.equal(restored.primary.id, "resend-agent");

  const elsewhere = sidebarRecoveryBar({
    intent,
    catalogStatus: "ready",
    currentProjectId: "project_a",
    currentDocumentId: "document_b",
  });
  assert.equal(elsewhere.kind, "restored-elsewhere");
  assert.equal(elsewhere.primary.id, "return-original-task");
  assert.notEqual(elsewhere.primary.id, "resend-agent");
});

test("a broken Key opens the Key field, not a generic settings home", () => {
  const bar = sidebarRecoveryBar({
    intent: createAgentRecoveryIntent({
      originSurface: "sidebar",
      projectId: "project_a",
      documentId: "document_a",
      providerId: "pageroot",
      targetField: "apiKey",
    }),
    catalogStatus: "auth-required",
    credentialKind: "api-token",
    currentProjectId: "project_a",
    currentDocumentId: "document_a",
  });
  assert.equal(bar.primary.label, "更换 API Key");
  assert.equal(bar.primary.id, "repair-agent-connection");
});
