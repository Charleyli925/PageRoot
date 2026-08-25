#!/usr/bin/env node

import { Readable, Writable } from "node:stream";
import { writeFileSync } from "node:fs";

import * as acp from "@agentclientprotocol/sdk";

if (process.argv.includes("--version")) {
  process.stdout.write("1.1.27\n");
  process.exit(0);
}

if (process.argv.includes("--list-models")) {
  if (process.argv.includes("--auth-required")) {
    process.stderr.write("Not logged in. Login required.\n");
    process.exit(1);
  }
  if (process.argv.includes("--capacity-unavailable")) {
    process.stderr.write("No available model capacity.\n");
    process.exit(1);
  }
  process.stdout.write("MODEL\nPageRoot-E2E\n");
  process.exit(0);
}

if (!process.argv.includes("--acp")) {
  process.stderr.write("Unsupported synthetic Qoder command.\n");
  process.exit(2);
}

const pidFileArgument = process.argv.find((argument) => argument.startsWith("--pid-file="));
if (pidFileArgument) {
  writeFileSync(pidFileArgument.slice("--pid-file=".length), `${process.pid}\n`, "utf8");
}
const hang = process.argv.includes("--hang");
// A discussion turn is read-only: the snapshot is the only readable file and the
// snapshot directory is the whole working scope. This branch also asserts the
// boundary from the Agent side, so the turn fails loudly if writes ever open up.
const discussion = process.argv.includes("--discussion");

const sessionId = "session_pageroot_e2e_qoder";
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

const app = acp.agent({ name: "pageroot-e2e-qoder" })
  .onRequest(acp.methods.agent.initialize, () => ({
    protocolVersion: acp.PROTOCOL_VERSION,
    agentCapabilities: { loadSession: false },
    authMethods: [],
    agentInfo: {
      name: "pageroot-e2e-qoder",
      title: "PageRoot E2E Qoder",
      version: "1.1.27",
    },
  }))
  .onRequest(acp.methods.agent.session.new, ({ params }) => {
    requestRoot = params.cwd;
    return { sessionId };
  })
  .onRequest(acp.methods.agent.session.prompt, async ({ params, client }) => {
    if (hang) return new Promise(() => {});
    if (discussion) {
      const snapshot = await client.request(acp.methods.client.fs.readTextFile, {
        sessionId,
        path: `${requestRoot}/snapshot.html`,
      });
      if (!snapshot.content.includes("<html")) {
        throw new Error("PageRoot discussion snapshot is missing");
      }
      let writeRefused = false;
      try {
        await client.request(acp.methods.client.fs.writeTextFile, {
          sessionId,
          path: `${requestRoot}/snapshot.html`,
          content: "<html>rewritten</html>",
        });
      } catch {
        writeRefused = true;
      }
      if (!writeRefused) throw new Error("PageRoot discussion write must be refused");
      let terminalRefused = false;
      try {
        await client.request(acp.methods.client.terminal.create, {
          sessionId,
          command: "/bin/sh",
          args: ["-c", "echo escalate"],
          cwd: requestRoot,
          env: [],
          outputByteLimit: 1024,
        });
      } catch {
        terminalRefused = true;
      }
      if (!terminalRefused) throw new Error("PageRoot discussion terminal must be refused");
      // Visible prose is the payload of a discussion turn (ADR 0036). The thought
      // chunk must be dropped by the driver rather than reaching the user.
      await client.notify(acp.methods.client.session.update, {
        sessionId,
        update: {
          sessionUpdate: "agent_thought_chunk",
          content: { type: "text", text: "internal reasoning must not surface" },
        },
      });
      await client.notify(acp.methods.client.session.update, {
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "这页的标题偏笼统，" },
        },
      });
      await client.notify(acp.methods.client.session.update, {
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "可以点明读者能得到什么。" },
        },
      });
      return { stopReason: "end_turn" };
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
    const candidate = input.content.replace(
      /<body([^>]*)>/iu,
      '<body$1 data-pageroot-qoder-acp="e2e">',
    );
    await client.notify(acp.methods.client.session.update, {
      sessionId,
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "tool_pageroot_e2e",
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
