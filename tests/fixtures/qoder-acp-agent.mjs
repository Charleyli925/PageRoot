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
