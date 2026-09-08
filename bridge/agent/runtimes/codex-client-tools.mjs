import { createInterface } from "node:readline";
import * as acp from "@agentclientprotocol/sdk";

// Translate Codex's client tools into the existing ACP host contract. This
// adapter owns no file writes, shell execution, or Candidate completion authority.
export function createCodexClientToolsAgent({ readable, writable, policy }) {
  let sequence = 0;
  let sessionId = null;
  let activeTurn = null;
  let selectedModel = null;
  let client = null;
  let resolveTurn = null;
  let rejectTurn = null;
  let closed = false;
  const pending = new Map();
  const lines = createInterface({ input: readable });
  const fail = (message) => Object.assign(new Error(message), { code: "CODEX_PROTOCOL_FAILED" });
  const send = (message) => writable.write(`${JSON.stringify(message)}\n`);
  const request = (method, params) => new Promise((resolve, reject) => {
    if (closed) { reject(fail("Codex connection closed.")); return; }
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    send({ id, method, params });
  });
  const close = () => {
    closed = true;
    for (const { reject } of pending.values()) reject(fail("Codex connection closed."));
    pending.clear();
    rejectTurn?.(fail("Codex connection closed."));
    lines.close();
  };
  lines.on("close", () => { if (!closed) close(); });
  readable.on("error", close);
  const update = (value) => client.notify(acp.methods.client.session.update, { sessionId, update: value });
  const tools = [
    { name: "read_task_file", description: "Read an exact frozen task file. Only the task's allowlisted input paths are readable.",
      inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false } },
    { name: "write_candidate", description: "Submit the complete modified HTML once. Preserve every existing Stable ID. The host validates before writing the exact Candidate path.",
      inputSchema: { type: "object", properties: { content: { type: "string" } }, required: ["content"], additionalProperties: false } },
    { name: "finalize_candidate", description: "Run the frozen Stemmio finalizer after write_candidate succeeds. Required to complete the task. No shell or command arguments are accepted.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  ].map((tool) => ({ type: "function", ...tool }));
  async function callTool(params) {
    if (!client || !sessionId || params.threadId !== sessionId || (activeTurn && params.turnId !== activeTurn)) {
      throw fail("Tool request does not belong to the active task.");
    }
    const args = params.arguments;
    if (!args || typeof args !== "object" || Array.isArray(args)) throw fail("Invalid tool arguments.");
    if (params.tool === "read_task_file" && Object.keys(args).every((key) => key === "path")) {
      return client.request(acp.methods.client.fs.readTextFile, { sessionId, path: args.path });
    }
    if (params.tool === "write_candidate" && Object.keys(args).every((key) => key === "content")) {
      return client.request(acp.methods.client.fs.writeTextFile, { sessionId, path: policy.outputPath, content: args.content });
    }
    if (params.tool === "finalize_candidate" && Object.keys(args).length === 0) {
      const terminal = await client.request(acp.methods.client.terminal.create, {
        sessionId, command: policy.finalizer.command, args: [...policy.finalizer.args], cwd: policy.finalizer.cwd,
        env: Object.entries(policy.finalizer.env).map(([name, value]) => ({ name, value })),
      });
      return client.request(acp.methods.client.terminal.waitForExit, { sessionId, terminalId: terminal.terminalId });
    }
    throw fail("Tool is outside the frozen task contract.");
  }
  async function receive(message) {
    if (message.id != null && !message.method) {
      const reply = pending.get(message.id);
      if (!reply) return;
      pending.delete(message.id);
      if (message.error) reply.reject(fail(message.error.message || "Codex request failed."));
      else reply.resolve(message.result);
      return;
    }
    if (message.id != null) {
      if (message.method !== "item/tool/call") {
        send({ id: message.id, error: { code: -32601, message: "Native tool authority is disabled for this task." } });
        return;
      }
      try {
        const result = await callTool(message.params);
        send({ id: message.id, result: { success: true, contentItems: [{ type: "inputText", text: JSON.stringify(result) }] } });
      } catch (error) {
        send({ id: message.id, result: { success: false, contentItems: [{ type: "inputText", text: error.message }] } });
      }
      return;
    }
    const params = message.params || {};
    if (!client || params.threadId !== sessionId) return;
    if (activeTurn && params.turnId && params.turnId !== activeTurn) return;
    if (message.method === "item/agentMessage/delta" && typeof params.delta === "string") {
      await update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: params.delta } });
    } else if (message.method === "item/started" && params.item?.type === "dynamicToolCall") {
      await update({ sessionUpdate: "tool_call", toolCallId: params.item.id,
        title: "处理页面", kind: "other", status: "in_progress" });
    } else if (message.method === "turn/completed") {
      const turn = params.turn;
      if (activeTurn && turn?.id !== activeTurn) return;
      if (turn?.status === "completed") resolveTurn?.({ stopReason: "end_turn" });
      else rejectTurn?.(fail(turn?.error?.message || "Codex did not complete the turn."));
    }
  }
  lines.on("line", (line) => {
    try { void receive(JSON.parse(line)).catch((error) => rejectTurn?.(error)); }
    catch { close(); }
  });
  const agent = acp.agent({ name: "stemmio-codex-client-tools" })
    .onRequest(acp.methods.agent.initialize, async () => {
      await request("initialize", { clientInfo: { name: "stemmio", version: "1.0.0" }, capabilities: { experimentalApi: true } });
      send({ method: "initialized", params: {} });
      return { protocolVersion: acp.PROTOCOL_VERSION, agentCapabilities: {}, authMethods: [],
        agentInfo: { name: "stemmio-codex", version: "1.0.0" } };
    })
    .onRequest(acp.methods.agent.session.new, async ({ client: nextClient }) => {
      client = nextClient;
      const inherited = await request("config/read", { cwd: policy.requestRoot, includeLayers: false });
      const disabledServers = Object.fromEntries(Object.keys(inherited.config?.mcp_servers || {})
        .map((name) => [name, { enabled: false }]));
      // Native environments are absent. Only dynamic tool calls routed through
      // ACP may write the Candidate or invoke the frozen finalizer.
      const result = await request("thread/start", {
        cwd: policy.requestRoot, sandbox: "read-only", approvalPolicy: "never", ephemeral: true,
        dynamicTools: tools, environments: [],
        config: { features: { shell_tool: false, multi_agent: false, multi_agent_v2: false,
          apps: false, plugins: false, image_generation: false },
          mcp_servers: disabledServers, web_search: "disabled" },
        developerInstructions: "Use only read_task_file, write_candidate, and finalize_candidate for this frozen HTML task. The finalizer tool is the provided ACP terminal/create equivalent. Never use native filesystem or shell tools. Preserve Stable IDs. Do not announce completion before finalization succeeds.",
      });
      sessionId = result.thread?.id;
      if (!sessionId || result.sandbox?.type !== "readOnly") throw fail("Codex did not establish the restricted task session.");
      return { sessionId };
    })
    .onRequest("session/set_model", (value) => value, ({ params }) => { selectedModel = params.modelId; return {}; })
    .onRequest(acp.methods.agent.session.prompt, async ({ params }) => {
      if (params.sessionId !== sessionId) throw fail("Unexpected Codex session.");
      const model = /^(.*)\[([a-z]+)\]$/u.exec(selectedModel || "");
      const done = new Promise((resolve, reject) => { resolveTurn = resolve; rejectTurn = reject; });
      void done.catch(() => {});
      try {
        const result = await request("turn/start", {
          threadId: sessionId, input: params.prompt.filter((block) => block.type === "text").map((block) => ({ type: "text", text: block.text })),
          ...(selectedModel ? { model: model?.[1] || selectedModel } : {}), ...(model ? { effort: model[2] } : {}),
          environments: [], approvalPolicy: "never", sandboxPolicy: { type: "readOnly", networkAccess: false },
        });
        activeTurn = result.turn.id;
        return await done;
      } finally { activeTurn = null; resolveTurn = rejectTurn = null; }
    })
    .onNotification(acp.methods.agent.session.cancel, () => {
      if (sessionId && activeTurn) void request("turn/interrupt", { threadId: sessionId, turnId: activeTurn }).catch(() => {});
    });
  return { agent, close };
}
