import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { promisify } from "node:util";

import {
  AGENT_POLICY_BRAND,
  MAX_HTML_BYTES,
  assertRuntimeProcessingAuthority,
  policyError,
  readVerifiedRegularFile,
  verifiedOutputParent,
} from "../policies/execution-policy.mjs";
import { isAgentCapacityFailureText } from "../agent-errors.mjs";
import { agentProviderError } from "../providers/agent-provider-contract.mjs";
import { defineAgentRuntime } from "./agent-runtime-contract.mjs";
import { openaiCompatibleChatThinkingFields } from "../../../shared/openai-compatible-vendors.mjs";

const execFileAsync = promisify(execFile);
const DEFAULT_TURN_TIMEOUT_MS = 180_000;
const MAX_CONTEXT_CHARS = 750_000;

function fail(code, message, options) {
  throw agentProviderError(code, message, options);
}

export function extractHtmlDocument(text) {
  const raw = String(text || "");
  const fenced = raw.match(/```(?:html)?\s*([\s\S]*?)```/iu);
  const candidate = (fenced ? fenced[1] : raw).trim();
  if (
    !candidate
    || Buffer.byteLength(candidate, "utf8") > MAX_HTML_BYTES
    || (!/^<!DOCTYPE html/iu.test(candidate) && !/<html[\s>]/iu.test(candidate))
  ) {
    fail("AGENT_OUTPUT_INVALID", "模型没有返回完整 HTML。", { status: 422 });
  }
  return candidate;
}

function jsonErrorText(payload, fallback) {
  if (!payload || typeof payload !== "object") return fallback;
  const error = payload.error;
  if (typeof error === "string" && error.trim()) return error;
  if (typeof error?.message === "string" && error.message.trim()) return error.message;
  if (typeof payload.message === "string" && payload.message.trim()) return payload.message;
  return fallback;
}

export function classifyOpenAiCompatibleHttpStatus(status, bodyText) {
  const text = String(bodyText || "");
  if (status === 401 || status === 403) return "AGENT_AUTH_REQUIRED";
  if (status === 429 || isAgentCapacityFailureText(text)) {
    return "AGENT_ACCOUNT_CAPACITY_UNAVAILABLE";
  }
  if (status === 408 || status >= 500) return "AGENT_TURN_TIMEOUT";
  return "AGENT_PROVIDER_UNAVAILABLE";
}

async function readContextFiles(policy) {
  const parts = [];
  let used = 0;
  for (const file of policy.readableFiles || []) {
    const read = await readVerifiedRegularFile(
      file.path,
      policy.requestRoot,
      file.relativePath || "frozen input",
    );
    if (read.bytes.includes(0)) continue;
    const text = read.bytes.toString("utf8");
    const chunk = `\n\n## ${file.relativePath}\n\n${text}`;
    if (used + chunk.length > MAX_CONTEXT_CHARS) {
      fail("AGENT_PROMPT_TOO_LARGE", "冻结页面超出当前模型可发送的长度。", { status: 413 });
    }
    parts.push(chunk);
    used += chunk.length;
  }
  return parts.join("").trim();
}

async function parseJsonResponse(response) {
  const text = await response.text();
  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const code = classifyOpenAiCompatibleHttpStatus(response.status, text);
    fail(code, jsonErrorText(payload, "模型接口没有接通。"), {
      status: response.status === 401 || response.status === 403 ? 401 : 502,
    });
  }
  return payload;
}

export async function completeOpenAiCompatibleChat({
  fetchImpl = fetch,
  baseUrl,
  apiKey,
  modelId,
  vendorId,
  reasoning,
  messages,
  signal,
} = {}) {
  const response = await fetchImpl(`${String(baseUrl).replace(/\/+$/u, "")}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      model: modelId,
      messages,
      temperature: 0.2,
      ...openaiCompatibleChatThinkingFields(vendorId, reasoning),
    }),
    signal,
  });
  const payload = await parseJsonResponse(response);
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    fail("AGENT_OUTPUT_INVALID", "模型没有返回完整 HTML。", { status: 422 });
  }
  return extractHtmlDocument(content);
}

async function runOfficialFinalizer(policy, signal) {
  const finalizer = policy.finalizer;
  await execFileAsync(finalizer.command, [...finalizer.args], {
    cwd: finalizer.cwd,
    env: { ...process.env, ...finalizer.env },
    timeout: 60_000,
    killSignal: "SIGTERM",
    signal,
  });
}

export function createHttpRuntime({
  fetchImpl = fetch,
  completeChat = completeOpenAiCompatibleChat,
  runFinalizer = runOfficialFinalizer,
} = {}) {
  return defineAgentRuntime({
    runtimeId: "http",
    async run(launch) {
      if (!launch || typeof launch !== "object" || Array.isArray(launch)) {
        throw new TypeError("HTTP runtime requires a launch descriptor.");
      }
      const policy = launch.policy;
      if (!policy || policy[AGENT_POLICY_BRAND] !== true) {
        throw policyError("POLICY_INVALID", "The HTTP runtime requires a verified PageRoot policy.");
      }
      const onEvent = typeof launch.onEvent === "function" ? launch.onEvent : () => {};
      const signal = launch.cancellationSignal;
      const apiKey = String(launch.environment?.PAGEROOT_API_KEY || "");
      const baseUrl = String(launch.environment?.PAGEROOT_API_BASE_URL || "");
      const modelId = String(launch.modelId || "").trim();
      if (!apiKey || !baseUrl || !modelId) {
        fail("AGENT_AUTH_REQUIRED", "还没有接通 API Token。", { status: 401 });
      }
      onEvent({ kind: "initialized", agentName: "源页 Agent", agentVersion: "1.0.0" });
      await assertRuntimeProcessingAuthority(policy);
      const context = await readContextFiles(policy);
      const timeout = AbortSignal.timeout(Number(launch.turnTimeoutMs) || DEFAULT_TURN_TIMEOUT_MS);
      const combined = signal
        ? AbortSignal.any([signal, timeout])
        : timeout;
      const html = await completeChat({
        fetchImpl,
        baseUrl,
        apiKey,
        modelId,
        vendorId: String(launch.environment?.PAGEROOT_API_VENDOR || ""),
        reasoning: String(launch.reasoning || ""),
        signal: combined,
        messages: Object.freeze([
          Object.freeze({
            role: "system",
            content: "You are PageRoot's native HTML agent. Follow the frozen task. Reply with one complete HTML document only. Do not wrap it in commentary.",
          }),
          Object.freeze({
            role: "user",
            content: context,
          }),
        ]),
      });
      await verifiedOutputParent(policy.outputPath, policy.requestRoot);
      await writeFile(policy.outputPath, html, { encoding: "utf8", flag: "wx" });
      await runFinalizer(policy, combined);
      onEvent({ kind: "completion-verified", status: "completed" });
      return Object.freeze({ stopReason: "end_turn" });
    },
  });
}

export const httpRuntime = createHttpRuntime();
