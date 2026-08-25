import assert from "node:assert/strict";
import test from "node:test";

import {
  createBridgeClient,
  isBridgeRequestError,
} from "../app/application/bridge-client.js";

test("Bridge client preserves structured conflict details", async () => {
  const client = createBridgeClient({
    baseUrl: "http://127.0.0.1:4317",
    fetchImpl: async () => new Response(JSON.stringify({
      error: {
        code: "DRAFT_REVISION_CONFLICT",
        message: "stale draft",
        details: {
          expectedDraftRevision: 104,
          currentDraftRevision: 106,
        },
      },
    }), {
      status: 409,
      headers: { "content-type": "application/json" },
    }),
  });

  await assert.rejects(
    () => client.saveDraft({
      sourcePath: "/tmp/page.html",
      expectedDraftRevision: 104,
    }),
    (error) => {
      assert.equal(isBridgeRequestError(error), true);
      assert.equal(error.code, "DRAFT_REVISION_CONFLICT");
      assert.equal(error.status, 409);
      assert.equal(error.outcome, "rejected");
      assert.deepEqual(error.details, {
        expectedDraftRevision: 104,
        currentDraftRevision: 106,
      });
      return true;
    },
  );
});

test("Bridge client classifies an unacknowledged mutation as unknown", async () => {
  let attempts = 0;
  const client = createBridgeClient({
    baseUrl: "http://127.0.0.1:4317",
    fetchImpl: async () => {
      attempts += 1;
      throw new Error("connection reset after write");
    },
  });

  await assert.rejects(
    () => client.saveDraft({
      sourcePath: "/tmp/page.html",
      expectedDraftRevision: 1,
    }),
    (error) => {
      assert.equal(isBridgeRequestError(error), true);
      assert.equal(error.outcome, "unknown");
      return true;
    },
  );
  assert.equal(attempts, 1, "mutations must not be retried blindly");
});

test("Bridge client treats a server-side mutation failure as an unknown outcome", async () => {
  const client = createBridgeClient({
    baseUrl: "http://127.0.0.1:4317",
    fetchImpl: async () => new Response(JSON.stringify({
      error: {
        code: "INJECTED_FAILPOINT",
        message: "write interrupted after durable state changed",
      },
    }), {
      status: 500,
      headers: { "content-type": "application/json" },
    }),
  });

  await assert.rejects(
    () => client.saveDraft({
      operationId: "draftop_server_failure_0001",
    }),
    (error) => {
      assert.equal(error.outcome, "unknown");
      assert.equal(error.code, "INJECTED_FAILPOINT");
      return true;
    },
  );
});

test("opening project records is a one-shot command, not a read retry", async () => {
  let requests = 0;
  const client = createBridgeClient({
    baseUrl: "http://127.0.0.1:4317",
    retryDelayMs: 0,
    fetchImpl: async () => {
      requests += 1;
      throw new Error("connection reset while opening folder");
    },
  });
  const payload = { sourcePath: "/tmp/page.html" };

  await assert.rejects(
    () => client.openFolder(payload),
    (error) => {
      assert.equal(isBridgeRequestError(error), true);
      assert.equal(error.outcome, "unknown");
      return true;
    },
  );
  assert.equal(requests, 1, "a command must not be retried blindly");

  await assert.rejects(() => client.openFolder(payload));
  assert.equal(requests, 2, "a later user action may issue a new command");
});

test("managed Working Copy reconcile is a one-shot command", async () => {
  let requests = 0;
  const client = createBridgeClient({
    baseUrl: "http://127.0.0.1:4317",
    retryDelayMs: 0,
    fetchImpl: async (input, init) => {
      requests += 1;
      assert.equal(String(init?.method || "GET").toUpperCase(), "POST");
      assert.match(String(input), /\/managed-working-copy\/reconcile$/u);
      throw new Error("connection reset after reconcile");
    },
  });

  await assert.rejects(
    () => client.reconcileManagedWorkingCopy({
      operationId: "reconcile_client_operation_01",
      previousSourcePath: "/tmp/page.html",
      projectId: "project_aaaaaaaaaaaaaaaa",
      documentId: "doc_aaaaaaaaaaaaaaaa",
      workingCopyId: "work_ver_0001",
      versionId: "ver_0001",
      expectedSourceSha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      reason: "watch",
    }),
    (error) => {
      assert.equal(isBridgeRequestError(error), true);
      assert.equal(error.outcome, "unknown");
      return true;
    },
  );
  assert.equal(requests, 1);
});


test("Bridge client retries a transient read and attaches authorization", async () => {
  const requests = [];
  const client = createBridgeClient({
    baseUrl: "http://127.0.0.1:4317",
    authToken: "test-token",
    retryDelayMs: 0,
    fetchImpl: async (input, init) => {
      requests.push({ input: String(input), init });
      if (requests.length === 1) {
        return new Response(JSON.stringify({ error: { code: "BUSY" } }), {
          status: 503,
        });
      }
      return new Response(JSON.stringify({
        projectId: "proj_1",
        documentId: "doc_1",
      }), { status: 200 });
    },
  });

  const payload = await client.workspace("/tmp/page.html");
  assert.equal(payload.projectId, "proj_1");
  assert.equal(requests.length, 2);
  assert.match(
    requests[0].input,
    /workspace\?sourcePath=%2Ftmp%2Fpage\.html&projectStorageVersion=4\.0\.0$/,
  );
  assert.equal(
    new Headers(requests[0].init.headers).get("x-html-ai-bridge-token"),
    "test-token",
  );
});

test("Bridge client exposes the five neutral Agent routes and keeps availability alias", async () => {
  const requests = [];
  const client = createBridgeClient({
    baseUrl: "http://127.0.0.1:4317",
    fetchImpl: async (input, init) => {
      requests.push({ url: new URL(String(input)), method: String(init?.method || "GET") });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  });
  await client.agentProviders();
  await client.preflightAgent({ selection: {} });
  await client.startAgent({ selection: {} });
  await client.agentStatus("/tmp/page.html", "req_1", "attempt_001");
  await client.cancelAgent({ requestId: "req_1" });
  await client.qoderAvailability();
  assert.deepEqual(requests.map(({ url, method }) => [method, url.pathname]), [
    ["GET", "/agent/providers"],
    ["POST", "/agent/preflight"],
    ["POST", "/agent/start"],
    ["GET", "/agent/status"],
    ["POST", "/agent/cancel"],
    ["GET", "/agent/availability"],
  ]);
});
