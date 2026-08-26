import { appendFile, writeFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";

const mode = process.env.FAKE_CODEX_EXECUTION_MODE || "completed";
const outputPath = process.env.FAKE_CODEX_OUTPUT_PATH;
const tracePath = process.env.FAKE_CODEX_TRACE_PATH;
const input = readline.createInterface({ input: process.stdin });

async function trace(message) {
  if (tracePath) await appendFile(tracePath, `${JSON.stringify(message)}\n`, "utf8");
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

input.on("line", async (line) => {
  const message = JSON.parse(line);
  await trace(message);
  if (message.method === "initialize") {
    send({ id: message.id, result: { userAgent: "synthetic-codex/0.149.1" } });
    return;
  }
  if (message.method === "initialized") return;
  if (message.method === "skills/list") {
    send({
      id: message.id,
      result: {
        data: [{
          cwd: process.cwd(),
          errors: [],
          skills: [{
            name: "synthetic-skill",
            description: "must be disabled",
            enabled: true,
            path: "/synthetic/SKILL.md",
            scope: "user",
          }],
        }],
      },
    });
    return;
  }
  if (message.method === "thread/start") {
    send({ id: message.id, result: { thread: { id: "thread_synthetic" } } });
    return;
  }
  if (message.method !== "turn/start") return;
  send({ id: message.id, result: { turn: { id: "turn_synthetic", status: "inProgress", items: [] } } });
  if (mode === "permission") {
    send({
      id: "server_permission_1",
      method: "item/commandExecution/requestApproval",
      params: { threadId: "thread_synthetic", turnId: "turn_synthetic" },
    });
    return;
  }
  if (mode === "hang") return;
  send({
    method: "item/agentMessage/delta",
    params: {
      threadId: "thread_synthetic",
      turnId: "turn_synthetic",
      itemId: "message_1",
      delta: "正在修改页面。",
    },
  });
  if (outputPath) await writeFile(
    outputPath,
    "<!doctype html><html><head><title>Before</title></head><body>Candidate</body></html>\n",
    "utf8",
  );
  if (mode === "extra-output" && outputPath) {
    await writeFile(path.join(path.dirname(outputPath), "extra.txt"), "residue\n", "utf8");
  }
  send({
    method: "item/completed",
    params: {
      threadId: "thread_synthetic",
      turnId: "turn_synthetic",
      item: { id: "change_1", type: "fileChange", status: "completed", changes: [] },
    },
  });
  send({
    method: "turn/completed",
    params: {
      threadId: "thread_synthetic",
      turn: {
        id: "turn_synthetic",
        status: mode === "failed" ? "failed" : "completed",
        items: [],
      },
    },
  });
});
