import assert from "node:assert/strict";
import test from "node:test";

import { createAgentAccessAuth } from "../bridge/agent/catalog/agent-access-auth.mjs";
import { extractAgentLoginUrl, publicAgentLoginUrl } from "../shared/agent-login-url.mjs";
import { describeQoderAuthSource, describeCodexAuthSource } from "../shared/agent-auth-source.mjs";

test("login URLs accept only https hosts for the selected provider", () => {
  assert.equal(
    publicAgentLoginUrl("https://auth.qoder.ai/device?code=1", { providerId: "qoder" }),
    "https://auth.qoder.ai/device?code=1",
  );
  assert.equal(
    publicAgentLoginUrl("https://chatgpt.com/auth/login", { providerId: "codex" }),
    "https://chatgpt.com/auth/login",
  );
  assert.equal(
    publicAgentLoginUrl("https://auth.openai.com/authorize", { providerId: "codex" }),
    "https://auth.openai.com/authorize",
  );
  assert.equal(publicAgentLoginUrl("http://qoder.ai/login", { providerId: "qoder" }), null);
  assert.equal(publicAgentLoginUrl("https://evil.example/qoder.ai", { providerId: "qoder" }), null);
  assert.equal(publicAgentLoginUrl("https://chatgpt.com/auth", { providerId: "qoder" }), null);
  assert.equal(
    extractAgentLoginUrl("Open https://auth.qoder.ai/start then continue.", { providerId: "qoder" }),
    "https://auth.qoder.ai/start",
  );
});

test("environment tokens are reported as shared-environment credentials", () => {
  assert.deepEqual(
    describeQoderAuthSource({ installSource: "managed" }, { QODER_API_KEY: "secret" }),
    { authSource: "environment-token", authScope: "environment" },
  );
  assert.deepEqual(
    describeCodexAuthSource({ installSource: "user" }, {}),
    { authSource: "chatgpt", authScope: "shared-machine" },
  );
});

test("login jobs cancel, expire, and reject stale generations", async () => {
  const auth = createAgentAccessAuth({ timeoutMs: 40 });
  let cancelled = false;
  auth.login("qoder", async ({ signal }) => {
    if (signal.aborted) {
      cancelled = true;
      throw Object.assign(new Error("canceled"), { code: "AGENT_LOGIN_CANCELLED" });
    }
    await new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => {
        cancelled = true;
        reject(Object.assign(new Error("canceled"), { code: "AGENT_LOGIN_CANCELLED" }));
      });
    });
  });
  assert.equal(auth.snapshot("qoder").loginState, "waiting");
  await auth.cancel("qoder");
  assert.equal(cancelled, true);
  assert.equal(auth.snapshot("qoder").loginState, "idle");

  auth.login("codex", async ({ onLoginUrl, signal }) => {
    onLoginUrl("https://chatgpt.com/auth/login");
    if (signal.aborted) {
      throw Object.assign(new Error("stale"), { code: "AGENT_LOGIN_STALE" });
    }
    await new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => {
        reject(Object.assign(new Error("stale"), { code: "AGENT_LOGIN_STALE" }));
      });
    });
  });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(auth.snapshot("codex").loginUrlPresent, true);
  assert.equal(auth.loginUrl("codex"), "https://chatgpt.com/auth/login");
  const replacement = await auth.login("codex", async () => ({
    authSource: "chatgpt",
    authScope: "app-managed",
  }));
  assert.equal(replacement.providerId, "codex");
  await auth.wait("codex");
  assert.equal(auth.snapshot("codex").loginState, "idle");
  assert.equal(auth.snapshot("codex").authSource, "chatgpt");
  assert.equal(auth.loginUrl("codex"), null);
});
