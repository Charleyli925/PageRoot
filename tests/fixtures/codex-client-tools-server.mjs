import assert from "node:assert/strict";
import { createInterface } from "node:readline";
const lines = createInterface({ input: process.stdin });
const send = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
let root;
let id = 100;
const waiting = new Map();
const mode = process.argv.find((arg) => arg.startsWith("--mode="))?.slice(7) || "complete";
const call = (tool, args, extras = {}) => new Promise((resolve) => {
  const next = ++id;
  waiting.set(next, resolve);
  send({ id: next, method: "item/tool/call", params: { threadId: "thread_synthetic", turnId: "turn_synthetic", callId: String(next), tool, arguments: args, ...extras } });
});
async function run() {
  assert.equal((await call("read_task_file", { path: "/etc/passwd" })).success, false);
  assert.equal((await call("read_task_file", { path: `${root}/input/base/index.html` }, { threadId: "other" })).success, false);
  assert.equal((await call("write_candidate", { content: "bad", path: "/tmp/other.html" })).success, false);
  assert.equal((await call("finalize_candidate", { command: "sh" })).success, false);
  assert.equal((await call("unknown", {})).success, false);
  const input = await call("read_task_file", { path: `${root}/input/base/index.html` });
  assert.equal(input.success, true);
  const html = JSON.parse(input.contentItems[0].text).content;
  const written = await call("write_candidate", { content: html.replace("Before", "After") });
  assert.equal(written.success, true);
  if (mode !== "missing-finalizer") {
    const finalized = await call("finalize_candidate", {});
    assert.equal(finalized.success, true);
    assert.equal(JSON.parse(finalized.contentItems[0].text).exitCode, 0);
  }
  send({ method: "turn/completed", params: { threadId: "thread_synthetic", turn: { id: "turn_synthetic", status: "completed" } } });
}
lines.on("line", async (line) => {
  const message = JSON.parse(line);
  if (!message.method) { waiting.get(message.id)?.(message.result); waiting.delete(message.id); return; }
  if (message.method === "initialize") { send({ id: message.id, result: {} }); return; }
  if (message.method === "config/read") {
    send({ id: message.id, result: { config: { mcp_servers: { unrelated: { command: "synthetic" } } } } }); return;
  }
  if (message.method === "thread/start") {
    assert.equal(message.params.sandbox, "read-only");
    assert.equal(message.params.approvalPolicy, "never");
    assert.deepEqual(message.params.environments, []);
    assert.deepEqual(message.params.config.mcp_servers, { unrelated: { enabled: false } });
    assert.equal(message.params.config.features.apps, false);
    assert.equal(message.params.config.features.plugins, false);
    assert.equal(message.params.config.features.shell_tool, false);
    assert.deepEqual(message.params.dynamicTools.map((tool) => tool.name), ["read_task_file", "write_candidate", "finalize_candidate"]);
    root = message.params.cwd;
    send({ id: message.id, result: { thread: { id: "thread_synthetic" }, sandbox: { type: "readOnly" } } });
  } else if (message.method === "turn/start") {
    assert.deepEqual(message.params.environments, []);
    assert.deepEqual(message.params.sandboxPolicy, { type: "readOnly", networkAccess: false });
    send({ id: message.id, result: { turn: { id: "turn_synthetic" } } });
    void run().catch((error) => { process.stderr.write(error.stack); process.exit(1); });
  }
});
