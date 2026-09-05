import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, realpath, rm, symlink, writeFile, lstat, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { sha256 } from "../bridge/lifecycle-core.mjs";
import { createAgentCatalog } from "../bridge/agent/catalog/agent-catalog.mjs";
import { createDefaultProviderRegistry } from "../bridge/agent/providers/provider-registry.mjs";
import {
  assertCodexAcpInstallationUnchanged,
  diagnoseCodexAcp,
  probeCodexAcp,
  resolveCodexAcpCommand,
} from "../bridge/agent/providers/codex-acp-provider.mjs";

const fixtureAgent = fileURLToPath(new URL("./fixtures/codex-acp-agent.mjs", import.meta.url));

async function isolatedHome(t) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "pageroot-codex-acp-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

function isolatedEnvironment(home) {
  return {
    PATH: path.join(home, "bin"),
    HOME: home,
    NPM_CONFIG_PREFIX: path.join(home, "missing-prefix"),
  };
}

async function probeCommand(root, extraArgs = "") {
  const command = path.join(root, extraArgs ? "codex-acp-probe-auth" : "codex-acp-probe");
  await writeFile(
    command,
    `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(fixtureAgent)}${
      extraArgs ? ` ${extraArgs}` : ""
    } "$@"\n`,
    { mode: 0o755 },
  );
  await chmod(command, 0o755);
  const resolved = await realpath(command);
  const information = await lstat(resolved);
  return Object.freeze({
    command: resolved,
    version: null,
    identity: Object.freeze({
      dev: information.dev,
      ino: information.ino,
      nlink: information.nlink,
      size: information.size,
      mtimeMs: information.mtimeMs,
      sha256: sha256(await readFile(resolved)),
    }),
    source: "e2e-override",
    nodeModulesRoot: null,
    nativeIdentity: null,
  });
}

async function writeManagedCodex(agentsRoot, version = "1.7.0") {
  const packageRoot = path.join(agentsRoot, "codex", version, "package");
  const command = path.join(packageRoot, "dist", "index.js");
  const nativeRoot = path.join(agentsRoot, "codex", version, "node_modules", "@openai", `codex-${process.platform}-${process.arch}`);
  await mkdir(path.dirname(command), { recursive: true, mode: 0o755 });
  await mkdir(path.join(nativeRoot, "vendor", "test", "bin"), { recursive: true, mode: 0o755 });
  await writeFile(path.join(packageRoot, "package.json"), `${JSON.stringify({
    name: "@agentclientprotocol/codex-acp",
    version,
    bin: { "codex-acp": "dist/index.js" },
  }, null, 2)}\n`, { mode: 0o644 });
  await writeFile(command, "#!/usr/bin/env node\nprocess.exit(0);\n", { mode: 0o755 });
  await chmod(command, 0o755);
  await chmod(packageRoot, 0o755);
  const native = path.join(nativeRoot, "vendor", "test", "bin", process.platform === "win32" ? "codex.exe" : "codex");
  await writeFile(native, "#!/bin/sh\n", { mode: 0o755 });
  await chmod(native, 0o755);
  await chmod(nativeRoot, 0o755);
  return command;
}

test("the default registry registers Codex through the shared ACP runtime", () => {
  const registry = createDefaultProviderRegistry();
  const catalog = registry.catalog();
  const codex = catalog.find((entry) => entry.providerId === "codex");
  assert.equal(codex.runtimeId, "acp");
  assert.equal(codex.capabilities.execution, true);
  const { provider } = registry.resolveSelection({
    providerId: "codex",
    runtimeId: "acp",
    requestedModelId: null,
    resolvedModelId: null,
    reasoning: {
      requested: null,
      applied: null,
      resolution: "provider-default",
    },
  });
  assert.equal(provider.securityProfile, "client-mediated");
  assert.equal("legacyDrivers" in provider, false);
  assert.equal(catalog.filter((entry) => entry.runtimeId === "acp").length, 2);
  assert.equal(catalog.find((entry) => entry.providerId === "pageroot")?.runtimeId, "http");
});

test("public catalog projection never includes command, path or stderr", async (t) => {
  const root = await isolatedHome(t);
  const registry = createDefaultProviderRegistry({
    agentsRoot: path.join(root, "agents"),
  });
  const projected = await registry.publicCatalog({
    environment: isolatedEnvironment(root),
  });
  const serialized = JSON.stringify(projected);
  const codex = projected.find((item) => item.providerId === "codex");
  assert.equal(codex.installable, true);
  assert.equal(codex.runtimeId, "acp");
  assert.equal(serialized.includes(root), false);
  assert.equal(Object.hasOwn(codex, "command"), false);
  assert.equal(serialized.includes("stderr"), false);
  assert.equal(serialized.includes("index.js"), false);
});

test("PageRoot-managed Codex ACP wins over a valid user copy", async (t) => {
  const root = await isolatedHome(t);
  const agentsRoot = path.join(root, "agents");
  const managed = await writeManagedCodex(agentsRoot);
  const userPackage = path.join(root, "lib", "node_modules", "@agentclientprotocol", "codex-acp");
  const userCommand = path.join(userPackage, "dist", "index.js");
  const nativeRoot = path.join(root, "lib", "node_modules", "@openai", `codex-${process.platform}-${process.arch}`);
  await mkdir(path.dirname(userCommand), { recursive: true, mode: 0o755 });
  await mkdir(path.join(nativeRoot, "vendor", "test", "bin"), { recursive: true, mode: 0o755 });
  await writeFile(path.join(userPackage, "package.json"), `${JSON.stringify({
    name: "@agentclientprotocol/codex-acp",
    version: "1.7.0",
    bin: { "codex-acp": "dist/index.js" },
  }, null, 2)}\n`);
  await writeFile(userCommand, "#!/usr/bin/env node\nprocess.exit(0);\n", { mode: 0o755 });
  await chmod(userCommand, 0o755);
  await chmod(userPackage, 0o755);
  await writeFile(path.join(nativeRoot, "vendor", "test", "bin", "codex"), "#!/bin/sh\n", { mode: 0o755 });
  const bin = path.join(root, "bin");
  await mkdir(bin, { recursive: true });
  await symlink(userCommand, path.join(bin, "codex-acp"));
  const catalog = createAgentCatalog({ agentsRoot });
  const resolved = await resolveCodexAcpCommand({
    environment: isolatedEnvironment(root),
    homeDirectory: root,
    managedCandidates: () => catalog.managedCommandCandidates("codex"),
  });
  assert.equal(resolved.installSource, "managed");
  assert.equal(resolved.command, managed);
  assert.notEqual(resolved.command, userCommand);
});

test("managed Codex ACP is used only when no user CLI exists", async (t) => {
  const root = await isolatedHome(t);
  const agentsRoot = path.join(root, "agents");
  const managed = await writeManagedCodex(agentsRoot);
  await mkdir(path.join(root, "bin"), { recursive: true });
  const catalog = createAgentCatalog({ agentsRoot });
  const resolved = await resolveCodexAcpCommand({
    environment: isolatedEnvironment(root),
    homeDirectory: root,
    managedCandidates: () => catalog.managedCommandCandidates("codex"),
  });
  assert.equal(resolved.installSource, "managed");
  assert.equal(resolved.command, managed);
});

test("an invalid user installation is diagnostic-only when managed Codex is valid", async (t) => {
  const root = await isolatedHome(t);
  const agentsRoot = path.join(root, "agents");
  await writeManagedCodex(agentsRoot);
  const bin = path.join(root, "bin");
  await mkdir(bin, { recursive: true });
  await writeFile(path.join(bin, "codex-acp"), "#!/bin/sh\necho untrusted\n", { mode: 0o755 });
  const catalog = createAgentCatalog({ agentsRoot });
  const resolved = await resolveCodexAcpCommand({
    environment: isolatedEnvironment(root),
    homeDirectory: root,
    managedCandidates: () => catalog.managedCommandCandidates("codex"),
  });
  assert.equal(resolved.installSource, "managed");
});

test("explicit E2E Codex path wins after all candidate sources are collected", async (t) => {
  const root = await isolatedHome(t);
  const agentsRoot = path.join(root, "agents");
  const managed = await writeManagedCodex(agentsRoot);
  const explicit = await probeCommand(root);
  const environment = {
    ...isolatedEnvironment(root),
    PAGEROOT_E2E: "1",
    PAGEROOT_CODEX_ACP_ALLOW_TEST_COMMAND: "1",
    PAGEROOT_CODEX_ACP_COMMAND: explicit.command,
  };
  const catalog = createAgentCatalog({ agentsRoot });
  const resolved = await resolveCodexAcpCommand({
    environment,
    homeDirectory: root,
    managedCandidates: () => catalog.managedCommandCandidates("codex"),
  });
  assert.equal(resolved.installSource, "explicit");
  assert.equal(resolved.command, explicit.command);
  assert.notEqual(resolved.command, managed);
});

test("Codex start revalidates the adapter and native executable closure", async (t) => {
  const root = await isolatedHome(t);
  const adapter = await probeCommand(root);
  const nativeCommand = path.join(root, "codex-native");
  await writeFile(nativeCommand, "#!/bin/sh\necho native-v1\n", { mode: 0o755 });
  await chmod(nativeCommand, 0o755);
  const nativeInformation = await lstat(nativeCommand);
  const nativeIdentity = Object.freeze({
    dev: nativeInformation.dev,
    ino: nativeInformation.ino,
    nlink: nativeInformation.nlink,
    size: nativeInformation.size,
    mtimeMs: nativeInformation.mtimeMs,
    sha256: sha256(await readFile(nativeCommand)),
  });
  const installation = { ...adapter, nativeCommand, nativeIdentity };
  await assertCodexAcpInstallationUnchanged(installation);

  await writeFile(nativeCommand, "#!/bin/sh\necho native-v2-changed\n", { mode: 0o755 });
  await assert.rejects(
    assertCodexAcpInstallationUnchanged(installation),
    (error) => error?.code === "CODEX_COMMAND_CHANGED",
  );
});

test("ACP probe completes initialize, model catalog and cleanup", async (t) => {
  const evidence = await probeCodexAcp(await probeCommand(await isolatedHome(t)), process.env);
  assert.equal(evidence.protocol, "acp");
  assert.equal(evidence.authMode, "ready");
  assert.ok(evidence.modelCount >= 1);
  assert.equal(evidence.models[0].id.startsWith("codex:"), true);
});

test("ACP probe classifies missing ChatGPT login as auth-required", async (t) => {
  await assert.rejects(
    probeCodexAcp(await probeCommand(await isolatedHome(t), "--auth-required"), process.env),
    (error) => error?.code === "CODEX_AUTH_REQUIRED",
  );
});

test("Codex diagnosis uses initialize-only fallback without opening an ACP session", async (t) => {
  const root = await isolatedHome(t);
  const marker = path.join(root, "session-new.marker");
  const command = await probeCommand(root, `--session-marker=${marker}`);
  const diagnostic = await diagnoseCodexAcp(command, {});
  assert.equal(diagnostic.readiness, "connection-failed");
  assert.equal(diagnostic.cause, "CODEX_AUTH_UNVERIFIED");
  await assert.rejects(() => readFile(marker, "utf8"), { code: "ENOENT" });
});

test("Codex diagnosis uses protected native login status when available", async (t) => {
  const root = await isolatedHome(t);
  const native = path.join(root, "codex-native");
  await writeFile(native, "#!/bin/sh\necho Logged in\n", { mode: 0o755 });
  await chmod(native, 0o755);
  const ready = await diagnoseCodexAcp({ nativeCommand: native }, {});
  assert.equal(ready.readiness, "ready");

  await writeFile(native, "#!/bin/sh\necho Not logged in\n", { mode: 0o755 });
  await assert.rejects(
    diagnoseCodexAcp({ nativeCommand: native }, {}),
    (error) => error?.code === "CODEX_AUTH_REQUIRED",
  );

  await writeFile(native, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  await assert.rejects(
    diagnoseCodexAcp({ nativeCommand: native }, {}),
    (error) => error?.code === "CODEX_AUTH_UNVERIFIED",
  );
});

test("Codex diagnosis verifies native login and ACP initialize without session/new", async (t) => {
  const root = await isolatedHome(t);
  const marker = path.join(root, "session-new.marker");
  const adapter = await probeCommand(root, `--session-marker=${marker}`);
  const native = path.join(root, "codex-native");
  await writeFile(native, "#!/bin/sh\necho Logged in\n", { mode: 0o755 });
  await chmod(native, 0o755);

  const diagnostic = await diagnoseCodexAcp({ ...adapter, nativeCommand: native }, {});
  assert.equal(diagnostic.readiness, "ready");
  assert.equal(diagnostic.facts.authentication, "ready");
  assert.equal(diagnostic.facts.protocol, "ready");
  assert.equal(diagnostic.facts.service, "unknown");
  await assert.rejects(() => readFile(marker, "utf8"), { code: "ENOENT" });
});
