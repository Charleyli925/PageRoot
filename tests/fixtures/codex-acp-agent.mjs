#!/usr/bin/env node

import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { Readable, Writable } from "node:stream";

import * as acp from "@agentclientprotocol/sdk";

const behavior = process.argv.find((value) => value.startsWith("--fixture="))
  ?.slice("--fixture=".length) || "ready";
const pidFile = process.argv.find((value) => value.startsWith("--pid-file="))
  ?.slice("--pid-file=".length) || null;

if (behavior === "early-exit") process.exit(7);
if (behavior === "oversized-frame") {
  process.stdout.write(`${"x".repeat(4 * 1024 * 1024 + 1)}\n`);
  setInterval(() => {}, 1_000);
} else if (behavior === "invalid-utf8") {
  process.stdout.write(Buffer.from([0xff, 0x0a]));
  setInterval(() => {}, 1_000);
} else if (behavior === "hang-initialize") {
  process.stdin.resume();
} else {
  let authenticated = behavior !== "auth-flow" && behavior !== "auth-required";
  let descendantPid = null;
  const app = acp.agent({ name: "synthetic-codex-acp" })
    .onRequest(acp.methods.agent.initialize, () => ({
      protocolVersion: acp.PROTOCOL_VERSION,
      agentCapabilities: { loadSession: false },
      authMethods: behavior === "auth-flow"
        ? [{ id: "chat-gpt", name: "ChatGPT", description: "Synthetic login" }]
        : [],
      agentInfo: {
        name: behavior === "wrong-identity" ? "synthetic-other-agent" : "@agentclientprotocol/codex-acp",
        title: "Synthetic Codex",
        version: "1.6.2",
      },
    }))
    .onRequest(
      "authentication/status",
      (params) => params ?? {},
      () => ({
        type: authenticated ? "chat-gpt" : "unauthenticated",
      }),
    )
    .onRequest(acp.methods.agent.authenticate, ({ params }) => {
      const methodId = params?.methodId;
      if (behavior !== "auth-flow" || methodId !== "chat-gpt") {
        throw new Error("unsupported synthetic authentication");
      }
      authenticated = true;
      return {};
    })
    .onRequest(acp.methods.agent.session.new, () => {
      if (behavior === "descendant" || behavior === "cancel-stream") {
        const descendant = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
          stdio: "ignore",
        });
        descendantPid = descendant.pid;
        if (pidFile) writeFileSync(pidFile, `${descendant.pid}\n`, "utf8");
      }
      return {
        sessionId: "synthetic-codex-session",
        models: {
          currentModelId: "gpt-synthetic[high]",
          availableModels: [
            {
              modelId: "gpt-synthetic[high]",
              name: "GPT Synthetic (high)",
              description: "Synthetic model",
            },
          ],
        },
        modes: {
          currentModeId: "read-only",
          availableModes: [{ id: "read-only", name: "Read-only" }],
        },
        configOptions: [
          {
            id: "model",
            name: "Model",
            category: "model",
            type: "select",
            currentValue: "gpt-synthetic",
            options: [{ value: "gpt-synthetic", name: "GPT Synthetic" }],
          },
          {
            id: "reasoning_effort",
            name: "Reasoning",
            category: "reasoning_effort",
            type: "select",
            currentValue: "high",
            options: [{ value: "high", name: "High" }],
          },
        ],
      };
    })
    .onRequest(acp.methods.agent.session.close, () => {
      return {};
    })
    .onRequest(acp.methods.agent.session.setConfigOption, ({ params }) => {
      const { configId, value } = params;
      return {
        configOptions: [{ id: configId, type: "select", currentValue: value, options: [] }],
      };
    })
    .onRequest(acp.methods.agent.session.prompt, async ({ params, client }) => {
      if (behavior !== "discussion" && behavior !== "cancel-stream") {
        throw new Error("unsupported synthetic prompt");
      }
      await client.notify(acp.methods.client.session.update, {
        sessionId: params.sessionId,
        update: {
          sessionUpdate: "agent_thought_chunk",
          content: { type: "text", text: "synthetic hidden reasoning" },
        },
      });
      await client.notify(acp.methods.client.session.update, {
        sessionId: params.sessionId,
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "synthetic-read-attempt",
          title: "Read snapshot",
          kind: "read",
          status: "failed",
        },
      });
      await client.notify(acp.methods.client.session.update, {
        sessionId: params.sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: {
            type: "text",
            text: behavior === "cancel-stream"
              ? `Synthetic Codex reply pid=${descendantPid}`
              : "Synthetic Codex reply",
          },
        },
      });
      if (behavior === "cancel-stream") return new Promise(() => {});
      return { stopReason: "end_turn" };
    });

  app.connect(acp.ndJsonStream(
    Writable.toWeb(process.stdout),
    Readable.toWeb(process.stdin),
  ));
}
