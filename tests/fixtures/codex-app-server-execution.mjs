import { appendFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";

const mode = process.env.FAKE_CODEX_EXECUTION_MODE || "completed";
const outputPath = process.env.FAKE_CODEX_OUTPUT_PATH;
const tracePath = process.env.FAKE_CODEX_TRACE_PATH;
const baseHtmlPath = process.env.FAKE_CODEX_BASE_HTML_PATH;
const streamGateMs = Math.max(
  0,
  Math.min(5_000, Number.parseInt(process.env.FAKE_CODEX_STREAM_GATE_MS || "0", 10) || 0),
);
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
  if (mode === "streaming") {
    send({
      method: "item/reasoning/delta",
      params: {
        threadId: "thread_synthetic",
        turnId: "turn_synthetic",
        delta: "这段推理不能进入 Stemmio 侧栏。",
      },
    });
    for (const delta of ["先读取冻结任务。", "再写入 Candidate。", "最后等待校验。"]) {
      send({
        method: "item/agentMessage/delta",
        params: {
          threadId: "thread_synthetic",
          turnId: "turn_synthetic",
          itemId: "message_streaming",
          delta,
        },
      });
      if (streamGateMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, streamGateMs));
      }
    }
  }
  send({
    method: "item/agentMessage/delta",
    params: {
      threadId: "thread_synthetic",
      turnId: "turn_synthetic",
      itemId: "message_1",
      delta: "正在修改页面。",
    },
  });
  if (outputPath) {
    const source = baseHtmlPath
      ? await readFile(baseHtmlPath, "utf8")
      : "<!doctype html><html><head><title>Before</title></head><body>Candidate</body></html>\n";
    const candidate = baseHtmlPath
      ? source.replace(
        /<body([^>]*)>/iu,
        '<body$1 data-pageroot-codex-app-server="e2e">',
      )
      : source;
    await writeFile(outputPath, candidate, "utf8");
  }
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
  const completedMessage = {
    method: "turn/completed",
    params: {
      threadId: "thread_synthetic",
      turn: {
        id: "turn_synthetic",
        status: mode === "failed" ? "failed" : "completed",
        items: [],
      },
    },
  };
  if (mode === "late-permission") {
    process.stdout.write([
      JSON.stringify(completedMessage),
      JSON.stringify({
        id: "server_permission_after_completion",
        method: "item/fileChange/requestApproval",
        params: { threadId: "thread_synthetic", turnId: "turn_synthetic" },
      }),
      "",
    ].join("\n"));
    return;
  }
  send(completedMessage);
});
