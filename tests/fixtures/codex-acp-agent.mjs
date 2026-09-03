#!/usr/bin/env node

import { Readable, Writable } from "node:stream";
import { writeFileSync } from "node:fs";

import * as acp from "@agentclientprotocol/sdk";

const pidFileArgument = process.argv.find((argument) => argument.startsWith("--pid-file="));
if (pidFileArgument) {
  writeFileSync(pidFileArgument.slice("--pid-file=".length), `${process.pid}\n`, "utf8");
}
const hang = process.argv.includes("--hang");
const authRequired = process.argv.includes("--auth-required");
if (process.argv.includes("login") && process.argv.includes("status")) {
  if (authRequired) {
    process.stderr.write("Not logged in. Login required.\n");
    process.exit(1);
  }
  process.stdout.write("Logged in\n");
  process.exit(0);
}
const visibleText = process.argv.includes("--visible-text");
const visibleTextGateArgument = process.argv.find((argument) => argument.startsWith("--visible-text-gate-ms="));
const visibleTextGateMs = Math.max(
  0,
  Math.min(5_000, Number.parseInt(visibleTextGateArgument?.slice("--visible-text-gate-ms=".length) || "0", 10) || 0),
);
const sessionMarkerArgument = process.argv.find((argument) => argument.startsWith("--session-marker="));

const sessionId = "session_pageroot_e2e_codex";
let requestRoot = "";

function promptText(params) {
  return (params.prompt || [])
    .filter((block) => block?.type === "text")
    .map((block) => String(block.text || ""))
    .join("\n");
}

function finalizerRequest(params) {
  const line = promptText(params)
    .split(/\r?\n/u)
    .find((value) => value.trim().startsWith("{\"command\""));
  if (!line) throw new Error("PageRoot finalizer request is missing");
  return JSON.parse(line);
}

const app = acp.agent({ name: "pageroot-e2e-codex" })
  .onRequest(acp.methods.agent.initialize, () => ({
    protocolVersion: acp.PROTOCOL_VERSION,
    agentCapabilities: { loadSession: false },
    authMethods: [
      { id: "chatgpt", name: "ChatGPT" },
      { id: "codex-api-key", name: "Codex API key" },
    ],
    agentInfo: {
      name: "pageroot-e2e-codex",
      title: "PageRoot E2E Codex",
      version: "1.7.0",
    },
  }))
  .onRequest(acp.methods.agent.session.new, ({ params }) => {
    if (sessionMarkerArgument) {
      writeFileSync(sessionMarkerArgument.slice("--session-marker=".length), "session.new\n", "utf8");
    }
    if (authRequired) {
      throw acp.RequestError.authRequired(undefined, "Not logged in. Login required.");
    }
    requestRoot = params.cwd;
    return { sessionId, models: [{ id: "gpt-synthetic", displayName: "GPT Synthetic", isDefault: true }] };
  })
  .onRequest(acp.methods.agent.session.prompt, async ({ params, client }) => {
    if (hang) return new Promise(() => {});
    if (visibleText) {
      for (const text of ["先读取冻结任务。", "再写入 Candidate。", "最后等待校验。"]) {
        await client.notify(acp.methods.client.session.update, {
          sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text },
          },
        });
        if (visibleTextGateMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, visibleTextGateMs));
        }
      }
    }
    const changeRequest = await client.request(acp.methods.client.fs.readTextFile, {
      sessionId,
      path: `${requestRoot}/change-request.json`,
    });
    const authority = JSON.parse(changeRequest.content);
    const input = await client.request(acp.methods.client.fs.readTextFile, {
      sessionId,
      path: `${requestRoot}/input/base/index.html`,
    });
    const outputPath = `${requestRoot}/attempts/${authority.attemptId}/output/candidate.html`;
    const candidate = input.content
      .replace(
        /<body([^>]*)>/iu,
        '<body$1 data-pageroot-codex-acp="e2e">',
      )
      .replace(
        /(<h1\b[^>]*>)\u771f\u5b9e /iu,
        "$1Codex \u5df2\u66f4\u65b0\uff1a\u771f\u5b9e ",
      );
    await client.notify(acp.methods.client.session.update, {
      sessionId,
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "tool_pageroot_e2e_codex",
        title: "Build PageRoot Candidate",
        kind: "edit",
        status: "in_progress",
        locations: [{ path: outputPath }],
      },
    });
    await client.request(acp.methods.client.fs.writeTextFile, {
      sessionId,
      path: outputPath,
      content: candidate,
    });
    const finalizer = finalizerRequest(params);
    const terminal = await client.request(acp.methods.client.terminal.create, {
      sessionId,
      ...finalizer,
      outputByteLimit: 8 * 1024,
    });
    const status = await client.request(acp.methods.client.terminal.waitForExit, {
      sessionId,
      terminalId: terminal.terminalId,
    });
    if (status.exitCode !== 0 || status.signal) {
      throw new Error("PageRoot finalizer failed");
    }
    await client.request(acp.methods.client.terminal.release, {
      sessionId,
      terminalId: terminal.terminalId,
    });
    return { stopReason: "end_turn" };
  });

app.connect(acp.ndJsonStream(
  Writable.toWeb(process.stdout),
  Readable.toWeb(process.stdin),
));
