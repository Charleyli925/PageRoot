import assert from "node:assert/strict";
import test from "node:test";

import { runOfficialAgentLogin } from "../bridge/agent/catalog/agent-login-command.mjs";

test("official login isolates the process group and confirms cancel cleanup", async () => {
  const controller = new AbortController();
  const pending = runOfficialAgentLogin({
    executable: process.execPath,
    args: ["-e", "setInterval(() => {}, 1000)"],
    env: process.env,
    providerId: "qoder",
    signal: controller.signal,
    timeoutMs: 5_000,
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  controller.abort();
  await assert.rejects(pending, (error) => (
    error?.code === "AGENT_LOGIN_CANCELLED"
    || error?.code === "AGENT_LOGIN_CANCEL_FAILED"
  ));
});
