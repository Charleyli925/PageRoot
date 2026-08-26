import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  PINNED_CODEX_VERSION,
  assertCodexInstallationUnchanged,
  codexInstallationDigest,
  createCodexProvider,
  resolveBundledCodexInstallation,
} from "../scripts/agent/providers/codex-provider.mjs";
import { probeCodexAppServer } from "../scripts/agent/runtimes/codex-app-server-client.mjs";
import { verifyCodexRuntimeLock } from "../scripts/verify-codex-runtime-lock.mjs";
import { createDefaultProviderRegistry } from "../scripts/agent/providers/provider-registry.mjs";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const fakeServer = fileURLToPath(new URL("./fixtures/codex-app-server.mjs", import.meta.url));

function probe(mode, options = {}) {
  return probeCodexAppServer({
    command: process.execPath,
    argsPrefix: [fakeServer],
    cwd: repositoryRoot,
    environment: {
      PATH: process.env.PATH,
      FAKE_CODEX_APP_SERVER_MODE: mode,
      APP_SERVER_LOGS: "must-be-removed",
    },
    requestTimeoutMs: options.requestTimeoutMs || 500,
    shutdownTimeoutMs: options.shutdownTimeoutMs || 200,
  });
}

test("Codex App Server preflight returns only bounded public models", async () => {
  const result = await probe("ready");
  assert.equal(result.protocol, "codex-app-server-v2");
  assert.equal(result.authMode, "chatgpt");
  assert.deepEqual(result.models, [{
    id: "codex:gpt-synthetic",
    providerModelId: "gpt-synthetic",
    displayName: "GPT Synthetic",
    reasoningEfforts: ["medium", "high"],
    defaultReasoningEffort: "medium",
    isDefault: true,
  }]);
});

test("Codex App Server preflight classifies auth and empty catalog without leaking stderr", async () => {
  for (const [mode, code] of [
    ["auth-required", "CODEX_AUTH_REQUIRED"],
    ["empty-catalog", "CODEX_MODEL_CATALOG_EMPTY"],
  ]) {
    await assert.rejects(
      probe(mode),
      (error) => error?.code === code
        && !String(error.message).includes("SYNTHETIC_CODEX_SECRET_CANARY"),
    );
  }
});

test("Codex App Server preflight fails closed on framing, exit, and timeout faults", async () => {
  for (const [mode, code] of [
    ["invalid-utf8", "CODEX_APP_SERVER_INVALID_UTF8"],
    ["oversized", "CODEX_APP_SERVER_FRAME_TOO_LARGE"],
    ["malformed", "CODEX_APP_SERVER_PROTOCOL_INVALID"],
    ["early-exit", "CODEX_APP_SERVER_EXITED"],
    ["hang", "CODEX_APP_SERVER_TIMEOUT"],
  ]) {
    await assert.rejects(
      probe(mode, { requestTimeoutMs: 80, shutdownTimeoutMs: 100 }),
      (error) => error?.code === code,
      mode,
    );
  }
});

test("the bundled Codex package is exact-pinned and installation-bound", async () => {
  const installation = await resolveBundledCodexInstallation({ resourcesRoot: repositoryRoot });
  assert.equal(installation.version, PINNED_CODEX_VERSION);
  assert.match(codexInstallationDigest(installation), /^sha256:[a-f0-9]{64}$/u);
  await assertCodexInstallationUnchanged(installation);
});

test("the pinned Codex binary regenerates the reviewed App Server schema", async () => {
  const result = await verifyCodexRuntimeLock({ root: repositoryRoot });
  assert.equal(result.version, PINNED_CODEX_VERSION);
  assert.match(result.schemaSha256, /^[a-f0-9]{64}$/u);
});

test("a changed bundled Codex binary cannot redeem preflight identity", async () => {
  const sourceInstallation = await resolveBundledCodexInstallation({
    resourcesRoot: repositoryRoot,
  });
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "codex-installation-fixture-"));
  const destinationRoot = path.join(fixtureRoot, "node_modules", "@openai");
  const wrapperRoot = path.join(destinationRoot, "codex");
  const platformRoot = path.join(destinationRoot, path.basename(sourceInstallation.platformRoot));
  const vendorRoot = path.join(platformRoot, "vendor", sourceInstallation.target);
  try {
    await Promise.all([
      mkdir(path.join(wrapperRoot, "bin"), { recursive: true }),
      mkdir(path.join(vendorRoot, "bin"), { recursive: true }),
    ]);
    for (const [source, destination] of [
      [path.join(sourceInstallation.packageRoot, "package.json"), path.join(wrapperRoot, "package.json")],
      [path.join(sourceInstallation.packageRoot, "bin", "codex.js"), path.join(wrapperRoot, "bin", "codex.js")],
      [path.join(sourceInstallation.platformRoot, "package.json"), path.join(platformRoot, "package.json")],
      [path.join(sourceInstallation.platformRoot, "vendor", sourceInstallation.target, "codex-package.json"), path.join(vendorRoot, "codex-package.json")],
      [sourceInstallation.command, path.join(vendorRoot, "bin", path.basename(sourceInstallation.command))],
    ]) await copyFile(source, destination);

    const installation = await resolveBundledCodexInstallation({ resourcesRoot: fixtureRoot });
    await writeFile(installation.command, Buffer.concat([
      await readFile(installation.command),
      Buffer.from("tampered"),
    ]));
    await assert.rejects(
      assertCodexInstallationUnchanged(installation),
      (error) => error?.code === "CODEX_INSTALLATION_CHANGED",
    );
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("Codex Provider resolves model and reasoning but cannot execute in PR3", async () => {
  const installation = Object.freeze({
    command: "/synthetic/codex",
    packageRoot: "/synthetic/package",
    version: PINNED_CODEX_VERSION,
    resourcesRoot: "/synthetic",
    platform: "darwin",
    arch: "arm64",
    target: "aarch64-apple-darwin",
    launcherIdentity: Object.freeze({ sha256: "a".repeat(64) }),
    commandIdentity: Object.freeze({ sha256: "b".repeat(64) }),
  });
  const provider = createCodexProvider({
    installationResolver: async () => installation,
    probeRunner: async () => ({
      protocol: "codex-app-server-v2",
      authMode: "chatgpt",
      models: [{
        id: "codex:gpt-synthetic",
        providerModelId: "gpt-synthetic",
        displayName: "GPT Synthetic",
        reasoningEfforts: ["medium", "high"],
        defaultReasoningEffort: "medium",
        isDefault: true,
      }],
    }),
  });
  assert.equal(provider.securityProfile, "agent-native");
  assert.equal(provider.capabilities.execution, false);
  const evidence = await provider.preflight(installation, { environment: {} });
  assert.equal(evidence.modelCount, 1);
  assert.deepEqual(provider.resolveSelection({
    providerId: "codex",
    runtimeId: "app-server",
    requestedModelId: "codex:gpt-synthetic",
    resolvedModelId: null,
    reasoning: { requested: "high", applied: null, resolution: "unsupported" },
  }, { evidence }), {
    providerId: "codex",
    runtimeId: "app-server",
    requestedModelId: "codex:gpt-synthetic",
    resolvedModelId: "codex:gpt-synthetic",
    reasoning: { requested: "high", applied: "high", resolution: "exact" },
  });
  assert.throws(() => provider.createRuntimeLaunch(), { code: "CODEX_EXECUTION_DISABLED" });
});

test("the packaged execution gate exposes Codex through the default product catalog", () => {
  const catalog = createDefaultProviderRegistry().catalog();
  assert.deepEqual(catalog.map((entry) => entry.providerId), ["qoder", "codex"]);
  assert.equal(catalog.find((entry) => entry.providerId === "codex")?.capabilities.execution, true);
});

test("enabled Codex execution writes only the Candidate and leaves finalization to Stemmio", async () => {
  const policy = {
    manifestPath: "/request/input-manifest.json",
    promptPath: "/request/PROMPT.md",
    outputPath: "/request/attempts/attempt_001/output/candidate.html",
    finalizer: { command: "/stemmio/finalizer", args: [], cwd: "/request", env: {} },
  };
  const provider = createCodexProvider({
    executionEnabled: true,
    policyLoader: async () => policy,
  });
  assert.equal(provider.capabilities.execution, true);
  assert.equal(await provider.loadExecutionPolicy({}), policy);
  const launch = provider.createRuntimeLaunch({
    ticket: {
      installation: {
        command: "/runtime/codex",
        commandIdentity: { sha256: "a".repeat(64) },
      },
      selection: {
        resolvedModelId: "codex:gpt-synthetic",
        reasoning: { applied: "high" },
      },
    },
    policy,
    baseEnvironment: {},
    cancellationSignal: new AbortController().signal,
    onEvent() {},
  });
  assert.equal(launch.securityProfile, "agent-native");
  assert.equal(launch.model, "gpt-synthetic");
  assert.equal(launch.effort, "high");
  assert.match(launch.prompt, /Stemmio alone runs and verifies the fixed finalizer/u);
  assert.doesNotMatch(launch.prompt, /terminal\/create/u);
});
