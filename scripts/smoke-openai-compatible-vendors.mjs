import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { AgentRuntimeCoordinator } from "../bridge/agent/agent-runtime-coordinator.mjs";
import { createOpenAiCompatibleProvider } from "../bridge/agent/providers/openai-compatible-provider.mjs";
import { createProviderRegistry } from "../bridge/agent/providers/provider-registry.mjs";
import { createHttpRuntime } from "../bridge/agent/runtimes/http-runtime.mjs";
import { createRuntimeRegistry } from "../bridge/agent/runtimes/runtime-registry.mjs";
import { sha256 } from "../bridge/lifecycle-core.mjs";
import { ProjectFileRepository } from "../bridge/project-file-repository.mjs";
import { SUPPORTED_AGENT_MODELS } from "../shared/supported-agent-models.mjs";
import { openaiCompatibleVendor } from "../shared/openai-compatible-vendors.mjs";

const TRUST = "trusted-local-agent-v1";
const SECRET_BY_VENDOR = Object.freeze({
  deepseek: "PAGEROOT_SMOKE_DEEPSEEK_API_KEY",
  zhipu: "PAGEROOT_SMOKE_ZHIPU_API_KEY",
  dashscope: "PAGEROOT_SMOKE_DASHSCOPE_API_KEY",
  openai: "PAGEROOT_SMOKE_OPENAI_API_KEY",
});

function selection(model) {
  return Object.freeze({
    providerId: "pageroot",
    runtimeId: "http",
    requestedModelId: `pageroot:${model.modelId}`,
    resolvedModelId: `pageroot:${model.modelId}`,
    reasoning: Object.freeze({ requested: null, applied: null, resolution: "provider-default" }),
  });
}

async function waitForCompletion(coordinator, identity) {
  for (let index = 0; index < 360; index += 1) {
    const session = coordinator.executionStatus(identity);
    if (["completed", "failed", "cancelled"].includes(session?.state)) return session;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  return Object.freeze({ state: "failed", errorCode: "SMOKE_TIMEOUT" });
}

async function runFormalChainSmoke(model, apiKey) {
  const root = await mkdtemp(path.join(os.tmpdir(), `pageroot-vendor-smoke-${model.vendorId}-`));
  try {
    const sourceRoot = path.join(root, "sources");
    const sourcePath = path.join(sourceRoot, "page.html");
    const source = "<!doctype html><html><head><title>Before smoke</title></head><body><main><p>Keep this content.</p></main></body></html>\n";
    await mkdir(sourceRoot, { recursive: true });
    await writeFile(sourcePath, source, "utf8");
    const repository = new ProjectFileRepository({ projectsRoot: path.join(root, "projects") });
    const imported = await repository.importExternal({
      sourcePath,
      expectedSourceSha256: sha256(Buffer.from(source)),
    });
    const workingBefore = await readFile(imported.target.exactSourcePath, "utf8");
    const provider = createOpenAiCompatibleProvider();
    const registry = createProviderRegistry({
      providers: [provider],
      runtimeRegistry: createRuntimeRegistry([createHttpRuntime()]),
    });
    let authority = null;
    const coordinator = new AgentRuntimeCoordinator({
      environment: { PAGEROOT_ENABLE_BETA_AGENT_MODELS: "1" },
      providerRegistry: registry,
      resolveTask: async () => authority,
      leaseStore: {
        acquire: async ({ ownerToken }) => ({ path: "vendor-smoke", ownerToken }),
        release: async () => true,
      },
    });
    try {
      const connected = await coordinator.updateAgentConfiguration("pageroot", {
        apiKey,
        vendorId: model.vendorId,
        selection: selection(model),
      });
      const preflight = await coordinator.preflight({
        selection: connected.selection,
        trustPolicyAccepted: TRUST,
      });
      const requestId = `req_${Date.now()}${Math.floor(Math.random() * 1000)}`;
      const request = await repository.prepareRequest({
        target: imported.target,
        requestId,
        attemptId: "attempt_001",
        expectedSourceSha256: imported.target.sourceSha256,
        request: {
          freezeCutoffRevision: 0,
          summary: "Run the real provider release smoke",
          comments: [{
            commentId: "comment_vendor_smoke",
            text: "Change only the document title from Before smoke to PageRoot smoke. Return the complete HTML and preserve every PageRoot Stable ID.",
            target: { targetId: "target_vendor_smoke" },
            attachments: [],
          }],
          changeEvents: [],
          targets: [{ targetId: "target_vendor_smoke" }],
          agentDelivery: {
            mode: "managed-agent",
            selection: preflight.selection,
            configuration: preflight.configuration,
            trustPolicyVersion: TRUST,
          },
        },
        prompt: "Apply the frozen task and produce one complete HTML Candidate.",
      });
      const requestRoot = path.join(imported.target.projectRootPath, ".pageroot", "requests", request.requestId);
      authority = {
        run: {
          projectId: imported.target.projectId,
          documentId: imported.target.documentId,
          sourcePath: imported.target.exactSourcePath,
          requestId: request.requestId,
          attemptId: request.attemptId,
          status: "processing",
          requestPath: requestRoot,
          promptPath: path.join(requestRoot, "PROMPT.md"),
          outputPath: path.join(imported.target.projectRootPath, ".pageroot", ...request.outputRelativePath.split("/")),
          completionPath: path.join(requestRoot, "attempts", request.attemptId, "completion.json"),
        },
        request: { request: { agentDelivery: request.request.agentDelivery } },
      };
      await coordinator.submit({
        ...authority.run,
        selection: preflight.selection,
        trustPolicyAccepted: TRUST,
        preflightId: preflight.preflightId,
        configurationDigest: preflight.configuration.configurationDigest,
      });
      const session = await waitForCompletion(coordinator, authority.run);
      if (session.state !== "completed") throw Object.assign(new Error("formal chain failed"), { code: session.errorCode });
      const status = await repository.requestStatus({
        target: imported.target,
        requestId: request.requestId,
        attemptId: request.attemptId,
      });
      if (status.status !== "candidate-ready") throw Object.assign(new Error("candidate not review-ready"), { code: "SMOKE_NOT_REVIEW_READY" });
      const candidate = await readFile(authority.run.outputPath, "utf8");
      if (!/<title>PageRoot smoke<\/title>/iu.test(candidate)) throw Object.assign(new Error("expected edit missing"), { code: "SMOKE_EDIT_MISSING" });
      if (await readFile(imported.target.exactSourcePath, "utf8") !== workingBefore) {
        throw Object.assign(new Error("Working Copy changed"), { code: "SMOKE_WORKING_COPY_CHANGED" });
      }
    } finally {
      await coordinator.shutdown();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const requireAll = process.argv.includes("--require-all");
const vendors = [...new Set(SUPPORTED_AGENT_MODELS.map((model) => model.vendorId))];
const missing = vendors.filter((vendorId) => !String(process.env[SECRET_BY_VENDOR[vendorId]] || "").trim());
if (requireAll && missing.length) {
  throw new Error(`Real Agent vendor smoke is missing secrets for: ${missing.join(", ")}.`);
}
const configuredModels = SUPPORTED_AGENT_MODELS.filter((model) => (
  String(process.env[SECRET_BY_VENDOR[model.vendorId]] || "").trim()
));
if (!configuredModels.length) throw new Error("Real Agent vendor smoke requires at least one configured vendor secret.");

for (const model of configuredModels) {
  const apiKey = String(process.env[SECRET_BY_VENDOR[model.vendorId]]).trim();
  try {
    await runFormalChainSmoke(model, apiKey);
    const vendor = openaiCompatibleVendor(model.vendorId);
    process.stdout.write(`${vendor?.displayName || model.vendorId}: ${model.modelId} formal-chain smoke passed.\n`);
  } catch (cause) {
    const code = String(cause?.code || "SMOKE_FAILED").replace(/[^A-Z0-9_-]/gu, "").slice(0, 80);
    throw new Error(`${model.vendorId}:${model.modelId} smoke failed (${code || "SMOKE_FAILED"}).`);
  }
}
