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
  const app = acp.agent({ name: "synthetic-codex-acp" })
    .onRequest(acp.methods.agent.initialize, () => ({
      protocolVersion: acp.PROTOCOL_VERSION,
      agentCapabilities: { loadSession: false },
      authMethods: [],
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
        type: behavior === "auth-required" ? "unauthenticated" : "chat-gpt",
      }),
    )
    .onRequest(acp.methods.agent.session.new, () => {
      if (behavior === "descendant") {
        const descendant = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
          stdio: "ignore",
        });
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
    });

  app.connect(acp.ndJsonStream(
    Writable.toWeb(process.stdout),
    Readable.toWeb(process.stdin),
  ));
}
