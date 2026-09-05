import assert from "node:assert/strict";
import test from "node:test";

import {
  accessOperationFromInstallSnapshot,
  accessOperationFromLoginSnapshot,
  createAccessOperation,
  finishAccessOperation,
  isStaleAccessOperation,
  publicAccessOperation,
  requestCancelAccessOperation,
  credentialErrorField,
} from "../shared/agent-access-operation.mjs";

test("access operations require a known kind and finish only in a terminal state", () => {
  const running = createAccessOperation({
    providerId: "qoder",
    kind: "install",
    generation: 2,
    startedAt: "2026-09-06T00:00:00.000Z",
  });
  assert.equal(running.operationId, "access_qoder_install_2");
  assert.equal(running.state, "running");
  assert.equal(running.cancellable, true);
  assert.throws(() => createAccessOperation({
    providerId: "qoder",
    kind: "spawn-shell",
    generation: 1,
  }), /kind/u);
  const cancelled = finishAccessOperation(running, { state: "cancelled" });
  assert.equal(cancelled.state, "cancelled");
  assert.equal(cancelled.cancellable, false);
  assert.throws(() => finishAccessOperation(running, { state: "cancelling" }), /terminal/u);
});

test("cancel converges to a terminal state and does not rewrite an already finished operation", () => {
  const waiting = createAccessOperation({
    providerId: "codex",
    kind: "login",
    generation: 1,
  });
  assert.equal(waiting.state, "waiting");
  const cancelling = requestCancelAccessOperation(waiting);
  assert.equal(cancelling.state, "cancelling");
  const succeeded = finishAccessOperation(waiting, { state: "succeeded" });
  assert.equal(requestCancelAccessOperation(succeeded).state, "succeeded");
  assert.equal(publicAccessOperation({ kind: "install" }), null);
});

test("install snapshots project in-flight access operations and ignore stale generations", () => {
  const installing = accessOperationFromInstallSnapshot({
    providerId: "qoder",
    installState: "installing",
    generation: 4,
    startedAt: "2026-09-06T00:00:00.000Z",
  });
  assert.equal(installing.kind, "install");
  assert.equal(installing.state, "running");
  assert.equal(accessOperationFromInstallSnapshot({
    providerId: "qoder",
    installState: "idle",
    generation: 4,
  }), null);
  assert.equal(isStaleAccessOperation(installing, 5), true);
  assert.equal(isStaleAccessOperation(installing, 4), false);
});

test("login snapshots project waiting access operations", () => {
  const waiting = accessOperationFromLoginSnapshot({
    providerId: "codex",
    loginState: "waiting",
    generation: 2,
    startedAt: "2026-09-06T00:00:00.000Z",
  });
  assert.equal(waiting.kind, "login");
  assert.equal(waiting.state, "waiting");
  assert.equal(accessOperationFromLoginSnapshot({
    providerId: "codex",
    loginState: "idle",
    generation: 2,
  }), null);
});

test("credential errors map to the field that the user can correct", () => {
  assert.equal(credentialErrorField("AGENT_AUTH_REQUIRED"), "apiKey");
  assert.equal(credentialErrorField("AGENT_SELECTION_UNSUPPORTED"), "modelId");
  assert.equal(credentialErrorField("AGENT_ENDPOINT_REGION_MISMATCH"), "baseUrl");
  assert.equal(credentialErrorField("AGENT_PROVIDER_UNAVAILABLE"), null);
});

test("credential field mapping stays on structured error codes", async () => {
  const { credentialErrorField } = await import("../shared/agent-access-operation.mjs");
  assert.equal(credentialErrorField("AGENT_AUTH_REQUIRED"), "apiKey");
  assert.equal(credentialErrorField("AGENT_SELECTION_UNSUPPORTED"), "modelId");
  assert.equal(credentialErrorField("AGENT_ENDPOINT_REGION_MISMATCH"), "baseUrl");
  assert.equal(credentialErrorField("AGENT_PROVIDER_UNAVAILABLE"), null);
});

