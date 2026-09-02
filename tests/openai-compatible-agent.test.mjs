import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { AgentRuntimeCoordinator } from "../bridge/agent/agent-runtime-coordinator.mjs";
import { loadExecutionPolicy } from "../bridge/agent/policies/execution-policy.mjs";
import {
  createOpenAiCompatibleProvider,
  namespacePagerootModels,
} from "../bridge/agent/providers/openai-compatible-provider.mjs";
import {
  createDefaultProviderRegistry,
  createProviderRegistry,
} from "../bridge/agent/providers/provider-registry.mjs";
import {
  classifyOpenAiCompatibleHttpStatus,
  completeOpenAiCompatibleChat,
  createHttpRuntime,
  extractHtmlDocument,
} from "../bridge/agent/runtimes/http-runtime.mjs";
import { createRuntimeRegistry } from "../bridge/agent/runtimes/runtime-registry.mjs";
import { sha256 } from "../bridge/lifecycle-core.mjs";
import { ProjectFileRepository } from "../bridge/project-file-repository.mjs";
import { inspectSourceElementIdentity } from "../bridge/project-file-repository/working-copy.mjs";
import { normalizeAgentDelivery } from "../shared/agent-delivery.mjs";
import {
  DEFAULT_OPENAI_COMPATIBLE_REASONING,
  OPENAI_COMPATIBLE_VENDORS,
  httpAgentLaunchBaseUrl,
  normalizeOpenAiCompatibleBaseUrl,
  openaiCompatibleChatThinkingFields,
  publicOpenAiCompatibleVendors,
  resolveOpenAiCompatibleVendor,
  testOpenAiCompatibleBaseUrl,
} from "../shared/openai-compatible-vendors.mjs";
import { startOpenAiCompatibleHttpAgent } from "./fixtures/openai-compatible-http-agent.mjs";

const HTML = "<!DOCTYPE html><html><head><title>ok</title></head><body><p>ok</p></body></html>";

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("shipped vendors include 智谱 DeepSeek and 阿里通义 and never Anthropic", () => {
  assert.deepEqual(
    publicOpenAiCompatibleVendors().map(({ id, label }) => [id, label]),
    [
      ["deepseek", "DeepSeek"],
      ["zhipu", "智谱"],
      ["dashscope", "阿里通义"],
      ["openai", "OpenAI"],
      ["custom", "其他兼容接口"],
    ],
  );
  assert.equal(OPENAI_COMPATIBLE_VENDORS.some((vendor) => /anthropic|claude/iu.test(vendor.id)), false);
  assert.equal(resolveOpenAiCompatibleVendor("anthropic"), null);
  assert.equal(resolveOpenAiCompatibleVendor("zhipu")?.baseUrl, "https://open.bigmodel.cn/api/paas/v4");
  assert.equal(resolveOpenAiCompatibleVendor("dashscope")?.baseUrl, "https://dashscope.aliyuncs.com/compatible-mode/v1");
  assert.equal(resolveOpenAiCompatibleVendor("custom", "https://api.example.com/v1")?.baseUrl, "https://api.example.com/v1");
  assert.equal(resolveOpenAiCompatibleVendor("custom", "http://api.example.com/v1"), null);
  assert.equal(resolveOpenAiCompatibleVendor("custom", "https://user:pass@api.example.com/v1"), null);
  assert.equal(normalizeOpenAiCompatibleBaseUrl("https://localhost/v1"), "");
});

test("HTTP Agent loopback override requires both E2E fences and only 127.0.0.1", () => {
  const loopback = "http://127.0.0.1:9/v1";
  assert.equal(testOpenAiCompatibleBaseUrl({}), "");
  assert.equal(testOpenAiCompatibleBaseUrl({
    PAGEROOT_HTTP_AGENT_ALLOW_TEST_BASE_URL: "1",
    PAGEROOT_HTTP_AGENT_BASE_URL: loopback,
  }), "");
  assert.equal(testOpenAiCompatibleBaseUrl({
    PAGEROOT_E2E: "1",
    PAGEROOT_HTTP_AGENT_BASE_URL: loopback,
  }), "");
  assert.equal(testOpenAiCompatibleBaseUrl({
    PAGEROOT_E2E: "1",
    PAGEROOT_HTTP_AGENT_ALLOW_TEST_BASE_URL: "1",
    PAGEROOT_HTTP_AGENT_BASE_URL: loopback,
  }), loopback);
  assert.equal(testOpenAiCompatibleBaseUrl({
    PAGEROOT_E2E: "1",
    PAGEROOT_HTTP_AGENT_ALLOW_TEST_BASE_URL: "1",
    PAGEROOT_HTTP_AGENT_BASE_URL: "https://api.deepseek.com/v1",
  }), "");
  assert.equal(testOpenAiCompatibleBaseUrl({
    PAGEROOT_E2E: "1",
    PAGEROOT_HTTP_AGENT_ALLOW_TEST_BASE_URL: "1",
    PAGEROOT_HTTP_AGENT_BASE_URL: "http://localhost:9/v1",
  }), "");
  assert.equal(httpAgentLaunchBaseUrl({
    PAGEROOT_E2E: "1",
    PAGEROOT_HTTP_AGENT_ALLOW_TEST_BASE_URL: "1",
    PAGEROOT_HTTP_AGENT_BASE_URL: loopback,
  }, "https://api.deepseek.com/v1"), loopback);
  assert.equal(httpAgentLaunchBaseUrl({
    PAGEROOT_E2E: "1",
    PAGEROOT_HTTP_AGENT_ALLOW_TEST_BASE_URL: "1",
    PAGEROOT_HTTP_AGENT_BASE_URL: "https://api.deepseek.com/v1",
  }, "https://api.deepseek.com/v1"), "");
  assert.equal(
    httpAgentLaunchBaseUrl({}, "https://api.deepseek.com/v1"),
    "https://api.deepseek.com/v1",
  );
});

test("HTML extraction accepts a complete document and rejects commentary-only output", () => {
  assert.equal(extractHtmlDocument(`here\n\`\`\`html\n${HTML}\n\`\`\``), HTML);
  assert.equal(extractHtmlDocument(HTML), HTML);
  assert.throws(
    () => extractHtmlDocument("I updated the title."),
    (error) => error?.code === "AGENT_OUTPUT_INVALID",
  );
  assert.equal(classifyOpenAiCompatibleHttpStatus(401), "AGENT_AUTH_REQUIRED");
  assert.equal(classifyOpenAiCompatibleHttpStatus(429, "quota"), "AGENT_ACCOUNT_CAPACITY_UNAVAILABLE");
});

test("missing Token is auth-required and 401 does not fall back to default models", async () => {
  const provider = createOpenAiCompatibleProvider({
    fetchImpl: async () => jsonResponse(401, { error: { message: "invalid token" } }),
  });
  assert.throws(
    () => provider.resolveInstallation({ environment: {} }),
    (error) => error?.code === "AGENT_AUTH_REQUIRED",
  );
  const environment = {
    PAGEROOT_API_KEY: "sk-synthetic",
    PAGEROOT_API_VENDOR: "deepseek",
    PAGEROOT_API_BASE_URL: "https://api.deepseek.com/v1",
  };
  const installation = provider.resolveInstallation({ environment });
  await assert.rejects(
    () => provider.preflight(installation, { environment }),
    (error) => error?.code === "AGENT_AUTH_REQUIRED",
  );
});

test("智谱 404 model lists fall back to GLM defaults", async () => {
  const provider = createOpenAiCompatibleProvider({
    fetchImpl: async (url) => {
      assert.match(String(url), /open\.bigmodel\.cn/u);
      return jsonResponse(404, { error: "not found" });
    },
  });
  const environment = {
    PAGEROOT_API_KEY: "sk-zhipu-synthetic",
    PAGEROOT_API_VENDOR: "zhipu",
    PAGEROOT_API_BASE_URL: "https://open.bigmodel.cn/api/paas/v4",
  };
  const installation = provider.resolveInstallation({ environment });
  const evidence = await provider.preflight(installation, { environment });
  assert.equal(evidence.models[0].id, "pageroot:glm-4.5");
  assert.equal(evidence.vendorId, "zhipu");
});

test("listed models stay in the pageroot namespace and custom vendors require HTTPS", async () => {
  const provider = createOpenAiCompatibleProvider({
    fetchImpl: async () => jsonResponse(200, {
      data: [{ id: "qwen-plus" }, { id: "qwen-max" }],
    }),
  });
  const environment = {
    PAGEROOT_API_KEY: "sk-dashscope-synthetic",
    PAGEROOT_API_VENDOR: "dashscope",
    PAGEROOT_API_BASE_URL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  };
  const installation = provider.resolveInstallation({ environment });
  const evidence = await provider.preflight(installation, { environment });
  assert.deepEqual(evidence.models.map((model) => model.id), [
    "pageroot:qwen-plus",
    "pageroot:qwen-max",
    "pageroot:qwen-turbo",
  ]);
  assert.equal(
    provider.resolveInstallation({
      environment: {
        PAGEROOT_API_KEY: "sk-custom",
        PAGEROOT_API_VENDOR: "custom",
        PAGEROOT_API_BASE_URL: "https://api.safe-example.com/v1",
      },
    }).vendorId,
    "custom",
  );
  assert.throws(
    () => provider.resolveInstallation({
      environment: {
        PAGEROOT_API_KEY: "sk-custom",
        PAGEROOT_API_VENDOR: "custom",
        PAGEROOT_API_BASE_URL: "http://api.example.com/v1",
      },
    }),
    (error) => error?.code === "AGENT_AUTH_REQUIRED",
  );
});

test("OpenAI-compatible chat extracts a complete HTML document", async () => {
  const html = await completeOpenAiCompatibleChat({
    fetchImpl: async (url, init) => {
      assert.match(String(url), /\/chat\/completions$/u);
      const body = JSON.parse(String(init.body));
      assert.equal(body.model, "deepseek-chat");
      return jsonResponse(200, {
        choices: [{ message: { content: `commentary\n\`\`\`html\n${HTML}\n\`\`\`` } }],
      });
    },
    baseUrl: "https://api.deepseek.com/v1",
    apiKey: "sk-synthetic",
    modelId: "deepseek-chat",
    messages: [{ role: "user", content: "task" }],
  });
  assert.equal(html, HTML);
});

test("DeepSeek defaults to V4, skips vision ids, and sends thinking depth", async () => {
  const namespaced = namespacePagerootModels(
    [
      { id: "deepseek-v4-flash" },
      { id: "deepseek-v4-flash-vision-exp" },
      { id: "deepseek-v4-pro" },
    ],
    {
      fallback: resolveOpenAiCompatibleVendor("deepseek").defaultModels,
      names: new Map([
        ["deepseek-v4-flash", "V4 Flash"],
        ["deepseek-v4-pro", "V4 Pro"],
      ]),
    },
  );
  assert.deepEqual(namespaced.map((model) => [model.id, model.displayName]), [
    ["pageroot:deepseek-v4-flash", "V4 Flash"],
    ["pageroot:deepseek-v4-pro", "V4 Pro"],
  ]);
  assert.deepEqual(
    openaiCompatibleChatThinkingFields("deepseek", "none"),
    { thinking: { type: "disabled" } },
  );
  assert.deepEqual(
    openaiCompatibleChatThinkingFields("deepseek", "low"),
    { thinking: { type: "enabled" }, reasoning_effort: "low" },
  );
  assert.deepEqual(
    openaiCompatibleChatThinkingFields("openai", "max"),
    { reasoning_effort: "high" },
  );
  assert.equal(DEFAULT_OPENAI_COMPATIBLE_REASONING, "high");

  const provider = createOpenAiCompatibleProvider({
    fetchImpl: async (url) => {
      assert.match(String(url), /api\.deepseek\.com\/v1\/models$/u);
      return jsonResponse(200, {
        data: [
          { id: "deepseek-v4-flash" },
          { id: "deepseek-v4-flash-vision-exp" },
          { id: "deepseek-v4-pro" },
        ],
      });
    },
  });
  const environment = {
    PAGEROOT_API_KEY: "sk-synthetic",
    PAGEROOT_API_VENDOR: "deepseek",
    PAGEROOT_API_BASE_URL: "https://api.deepseek.com/v1",
  };
  const installation = provider.resolveInstallation({ environment });
  const evidence = await provider.preflight(installation, { environment });
  assert.deepEqual(evidence.models.map((model) => model.id), [
    "pageroot:deepseek-v4-flash",
    "pageroot:deepseek-v4-pro",
  ]);
  const selection = provider.resolveSelection({
    requestedModelId: "pageroot:deepseek-v4-pro",
    reasoning: { requested: "max" },
  }, { evidence });
  assert.equal(selection.resolvedModelId, "pageroot:deepseek-v4-pro");
  assert.deepEqual(selection.reasoning, {
    requested: "max",
    applied: "max",
    resolution: "exact",
  });
  const unset = provider.resolveSelection({
    requestedModelId: null,
    reasoning: { requested: null, applied: null, resolution: "provider-default" },
  }, { evidence });
  assert.deepEqual(unset.reasoning, {
    requested: null,
    applied: null,
    resolution: "provider-default",
  });
  const launch = provider.createRuntimeLaunch({
    ticket: {
      selection: {
        resolvedModelId: "pageroot:deepseek-v4-flash",
        reasoning: unset.reasoning,
      },
    },
    baseEnvironment: environment,
  });
  assert.equal(launch.modelId, "deepseek-v4-flash");
  assert.equal(launch.reasoning, "high");

  const html = await completeOpenAiCompatibleChat({
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(String(init.body));
      assert.deepEqual(body.thinking, { type: "enabled" });
      assert.equal(body.reasoning_effort, "low");
      return jsonResponse(200, {
        choices: [{ message: { content: HTML } }],
      });
    },
    baseUrl: "https://api.deepseek.com/v1",
    apiKey: "sk-synthetic",
    modelId: "deepseek-v4-flash",
    vendorId: "deepseek",
    reasoning: "low",
    messages: [{ role: "user", content: "task" }],
  });
  assert.equal(html, HTML);
});

test("the default registry registers pageroot/http ahead of Qoder and Codex ACP", () => {
  const registry = createDefaultProviderRegistry();
  const catalog = registry.catalog();
  assert.deepEqual(catalog.map((entry) => [entry.providerId, entry.runtimeId]), [
    ["pageroot", "http"],
    ["qoder", "acp"],
    ["codex", "acp"],
  ]);
  const { provider } = registry.resolveSelection({
    providerId: "pageroot",
    runtimeId: "http",
    requestedModelId: null,
    resolvedModelId: null,
    reasoning: { requested: null, applied: null, resolution: "provider-default" },
  });
  assert.equal(provider.securityProfile, "client-mediated");
  assert.deepEqual(provider.legacyDrivers, []);
});

test("Coordinator accepts only pageroot session Tokens and never Codex keys", () => {
  const coordinator = new AgentRuntimeCoordinator({
    clock: { now: () => 1 },
    leaseStore: {
      acquire: async () => ({ ok: true }),
      release: async () => true,
    },
    providerRegistry: {
      resolveSelection() { return {}; },
      catalog() { return []; },
    },
  });
  assert.deepEqual(
    coordinator.setSessionCredential("pageroot", "sk-zhipu-synthetic", { vendorId: "zhipu" }),
    { ok: true, providerId: "pageroot", vendorId: "zhipu", configured: true },
  );
  assert.throws(
    () => coordinator.setSessionCredential("codex", "sk-codex"),
    (error) => error?.code === "AGENT_SESSION_CREDENTIAL_UNSUPPORTED",
  );
  assert.throws(
    () => coordinator.setSessionCredential("pageroot", "sk-anthropic", { vendorId: "anthropic" }),
    (error) => error?.code === "AGENT_SESSION_CREDENTIAL_INVALID",
  );
  assert.equal(coordinator.sessionCredentialConfigured("pageroot"), true);
  coordinator.clearSessionCredential("pageroot");
  assert.equal(coordinator.sessionCredentialConfigured("pageroot"), false);
});

test("Coordinator preflight uses the fenced loopback instead of the vendor origin", async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(String(url));
    return jsonResponse(200, { data: [{ id: "deepseek-v4-flash" }] });
  };
  const coordinator = new AgentRuntimeCoordinator({
    clock: { now: () => 1 },
    leaseStore: {
      acquire: async () => ({ ok: true }),
      release: async () => true,
    },
    environment: {
      PAGEROOT_E2E: "1",
      PAGEROOT_HTTP_AGENT_ALLOW_TEST_BASE_URL: "1",
      PAGEROOT_HTTP_AGENT_BASE_URL: "http://127.0.0.1:9/v1",
    },
    providerRegistry: createProviderRegistry({
      providers: [createOpenAiCompatibleProvider({ fetchImpl })],
      runtimeRegistry: createRuntimeRegistry([createHttpRuntime({ fetchImpl })]),
    }),
  });
  coordinator.setSessionCredential("pageroot", "sk-synthetic", { vendorId: "deepseek" });
  await coordinator.preflight({
    selection: {
      providerId: "pageroot",
      runtimeId: "http",
      requestedModelId: null,
      resolvedModelId: null,
      reasoning: { requested: null, applied: null, resolution: "provider-default" },
    },
    trustPolicyAccepted: "trusted-local-agent-v1",
    purpose: "execution",
  });
  assert.deepEqual(urls, ["http://127.0.0.1:9/v1/models"]);
});

test("live loopback HTTP Agent serves models, chat HTML, 401 and incomplete output", async () => {
  const ready = await startOpenAiCompatibleHttpAgent();
  const denied = await startOpenAiCompatibleHttpAgent({ mode: "auth-required" });
  const invalid = await startOpenAiCompatibleHttpAgent({ mode: "invalid-html" });
  try {
    const models = await fetch(`${ready.baseUrl}/models`);
    assert.equal(models.status, 200);
    const listed = await models.json();
    assert.equal(listed.data[0].id, "deepseek-v4-flash");
    const html = await completeOpenAiCompatibleChat({
      baseUrl: ready.baseUrl,
      apiKey: "sk-synthetic",
      modelId: "deepseek-v4-flash",
      vendorId: "deepseek",
      reasoning: "low",
      messages: [{
        role: "user",
        content: "<!DOCTYPE html><html><head><title>ok</title></head><body><h1>真实 DOM</h1></body></html>",
      }],
    });
    assert.match(html, /data-pageroot-http-agent="e2e"/u);
    assert.match(html, /data-pageroot-http-reasoning="low"/u);
    assert.match(html, /源页已更新：真实/u);
    await assert.rejects(
      () => completeOpenAiCompatibleChat({
        baseUrl: denied.baseUrl,
        apiKey: "sk-bad",
        modelId: "deepseek-v4-flash",
        vendorId: "deepseek",
        reasoning: "high",
        messages: [{ role: "user", content: HTML }],
      }),
      (error) => error?.code === "AGENT_AUTH_REQUIRED",
    );
    await assert.rejects(
      () => completeOpenAiCompatibleChat({
        baseUrl: invalid.baseUrl,
        apiKey: "sk-synthetic",
        modelId: "deepseek-v4-flash",
        vendorId: "deepseek",
        reasoning: "high",
        messages: [{ role: "user", content: HTML }],
      }),
      (error) => error?.code === "AGENT_OUTPUT_INVALID",
    );
  } finally {
    await Promise.all([ready.close(), denied.close(), invalid.close()]);
  }
});

test("源页 HTTP Agent writes a sealed Candidate and never adopts the Working Copy", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pageroot-http-candidate-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourceRoot = path.join(root, "sources");
  const sourcePath = path.join(sourceRoot, "page.html");
  const source = "<!doctype html><html><head><title>Before</title></head><body>Before</body></html>\n";
  await mkdir(sourceRoot, { recursive: true });
  await writeFile(sourcePath, source, "utf8");
  const repository = new ProjectFileRepository({
    projectsRoot: path.join(root, "projects"),
    agentDeliveryNormalizer(value) {
      return normalizeAgentDelivery(value, { allowLegacy: false });
    },
  });
  const imported = await repository.importExternal({
    sourcePath,
    expectedSourceSha256: sha256(Buffer.from(source)),
  });
  const managedSourceBefore = await readFile(imported.target.exactSourcePath, "utf8");
  assert.equal(inspectSourceElementIdentity(managedSourceBefore).complete, true);
  const candidateHtml = managedSourceBefore.replaceAll("Before", "After");
  const chatBodies = [];
  const fetchImpl = async (url, init) => {
    if (String(url).endsWith("/models")) {
      return jsonResponse(200, {
        data: [{ id: "deepseek-v4-flash" }, { id: "deepseek-v4-pro" }],
      });
    }
    chatBodies.push(JSON.parse(String(init.body)));
    return jsonResponse(200, {
      choices: [{ message: { content: candidateHtml } }],
    });
  };
  const registry = createProviderRegistry({
    providers: [createOpenAiCompatibleProvider({ fetchImpl })],
    runtimeRegistry: createRuntimeRegistry([createHttpRuntime({ fetchImpl })]),
  });
  const selection = {
    providerId: "pageroot",
    runtimeId: "http",
    requestedModelId: "pageroot:deepseek-v4-flash",
    resolvedModelId: "pageroot:deepseek-v4-flash",
    reasoning: { requested: "low", applied: "low", resolution: "exact" },
  };
  const request = await repository.prepareRequest({
    target: imported.target,
    requestId: "req_pageroot_http_candidate",
    attemptId: "attempt_001",
    expectedSourceSha256: imported.target.sourceSha256,
    request: {
      freezeCutoffRevision: 0,
      summary: "Modify the page through 源页 Agent",
      comments: [{
        commentId: "comment_pageroot_http",
        text: "Modify the page through 源页 Agent",
        target: { targetId: "target_pageroot_http" },
        attachments: [],
      }],
      changeEvents: [],
      targets: [{ targetId: "target_pageroot_http" }],
      agentDelivery: {
        mode: "managed-agent",
        selection,
        trustPolicyVersion: "trusted-local-agent-v1",
      },
    },
    prompt: "Write one complete Candidate page.",
  });
  const requestRoot = path.join(
    imported.target.projectRootPath,
    ".pageroot",
    "requests",
    request.requestId,
  );
  const outputPath = path.join(
    imported.target.projectRootPath,
    ".pageroot",
    ...request.outputRelativePath.split("/"),
  );
  const policy = await loadExecutionPolicy({
    requestPath: requestRoot,
    promptPath: path.join(requestRoot, "PROMPT.md"),
    outputPath,
    completionPath: path.join(requestRoot, "attempts", request.attemptId, "completion.json"),
  });
  const environment = {
    PAGEROOT_API_KEY: "sk-synthetic",
    PAGEROOT_API_VENDOR: "deepseek",
    PAGEROOT_API_BASE_URL: "https://api.deepseek.com/v1",
  };
  const ticket = await registry.preflightForSelection(selection, "execution", { environment });
  const result = await registry.run(ticket, {
    policy,
    baseEnvironment: environment,
    onEvent() {},
  });
  assert.equal(result.stopReason, "end_turn");
  assert.equal(chatBodies.length, 1);
  assert.equal(chatBodies[0].model, "deepseek-v4-flash");
  assert.deepEqual(chatBodies[0].thinking, { type: "enabled" });
  assert.equal(chatBodies[0].reasoning_effort, "low");
  assert.equal(await readFile(outputPath, "utf8"), candidateHtml.trim());
  const status = await repository.requestStatus({
    target: imported.target,
    requestId: request.requestId,
    attemptId: request.attemptId,
  });
  assert.equal(status.status, "candidate-ready");
  assert.equal(status.candidate.candidateId, request.candidateId);
  assert.equal(await readFile(sourcePath, "utf8"), source);
  assert.equal(await readFile(imported.target.exactSourcePath, "utf8"), managedSourceBefore);
});
