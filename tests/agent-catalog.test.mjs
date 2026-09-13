import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createAgentCatalog } from "../bridge/agent/catalog/agent-catalog.mjs";
import { QODER_MANAGED_RELEASE } from "../bridge/agent/catalog/qoder-managed-release.mjs";
import {
  diagnoseQoder,
  resolveQoderAcpCommand,
  startQoderLogin,
} from "../bridge/agent/providers/qoder-provider.mjs";

async function isolatedHome(t) {
  const root = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "pageroot-agent-catalog-")),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function writeManagedQoder(agentsRoot, version = "1.1.27") {
  const packageRoot = path.join(agentsRoot, "qoder", version, "package");
  const bundle = path.join(packageRoot, "bundle", "qodercli.js");
  await mkdir(path.dirname(bundle), { recursive: true, mode: 0o755 });
  await writeFile(path.join(packageRoot, "package.json"), `${JSON.stringify({
    name: "@qoder-ai/qodercli",
    version,
    bin: { qodercli: "bundle/qodercli.js" },
  }, null, 2)}\n`, { mode: 0o644 });
  await writeFile(bundle, "#!/usr/bin/env node\nprocess.exit(0);\n", { mode: 0o755 });
  await chmod(bundle, 0o755);
  await chmod(packageRoot, 0o755);
  return bundle;
}

function isolatedEnvironment(home) {
  return {
    PATH: path.join(home, "bin"),
    HOME: home,
    NPM_CONFIG_PREFIX: path.join(home, "missing-prefix"),
  };
}

test("public catalog projection never includes command, path or stderr", async (t) => {
  const root = await isolatedHome(t);
  const catalog = createAgentCatalog({ agentsRoot: path.join(root, "agents") });
  const projected = catalog.publicProvider({
    providerId: "qoder",
    displayName: "Qoder",
    runtimeId: "acp",
    capabilities: { availability: true, preflight: true, execution: true },
  }, { installSource: "managed" });
  const serialized = JSON.stringify(projected);
  assert.equal(projected.installable, true);
  assert.equal(projected.installSource, "managed");
  assert.equal(projected.installState, "idle");
  assert.equal(projected.activeOperation, null);
  assert.equal(projected.lastOperation, null);
  assert.equal(projected.connection, null);
  assert.equal(projected.loginUrlPresent, false);
  assert.equal(serialized.includes(root), false);
  assert.equal(Object.hasOwn(projected, "command"), false);
  assert.equal(serialized.includes("stderr"), false);
  assert.equal(serialized.includes("qodercli.js"), false);
});

test("PageRoot-managed Qoder wins over a valid user copy", async (t) => {
  const root = await isolatedHome(t);
  const agentsRoot = path.join(root, "agents");
  const managed = await writeManagedQoder(agentsRoot);
  const userPackage = path.join(root, "lib", "node_modules", "@qoder-ai", "qodercli");
  const userBundle = path.join(userPackage, "bundle", "qodercli.js");
  await mkdir(path.dirname(userBundle), { recursive: true, mode: 0o755 });
  await writeFile(path.join(userPackage, "package.json"), `${JSON.stringify({
    name: "@qoder-ai/qodercli",
    version: "1.1.27",
    bin: { qodercli: "bundle/qodercli.js" },
  }, null, 2)}\n`);
  await writeFile(userBundle, "#!/usr/bin/env node\nprocess.exit(0);\n", { mode: 0o755 });
  await chmod(userBundle, 0o755);
  await chmod(userPackage, 0o755);
  const bin = path.join(root, "bin");
  await mkdir(bin, { recursive: true });
  await symlink(userBundle, path.join(bin, "qodercli"));
  const catalog = createAgentCatalog({ agentsRoot });
  const resolved = await resolveQoderAcpCommand({
    environment: isolatedEnvironment(root),
    homeDirectory: root,
    managedCandidates: () => catalog.managedCommandCandidates("qoder"),
  });
  assert.equal(resolved.installSource, "managed");
  assert.equal(resolved.command, managed);
  assert.notEqual(resolved.command, userBundle);
});

test("managed Qoder is used only when no user CLI exists", async (t) => {
  const root = await isolatedHome(t);
  const agentsRoot = path.join(root, "agents");
  const managed = await writeManagedQoder(agentsRoot);
  await mkdir(path.join(root, "bin"), { recursive: true });
  const catalog = createAgentCatalog({ agentsRoot });
  const resolved = await resolveQoderAcpCommand({
    environment: isolatedEnvironment(root),
    homeDirectory: root,
    managedCandidates: () => catalog.managedCommandCandidates("qoder"),
  });
  assert.equal(resolved.installSource, "managed");
  assert.equal(resolved.command, managed);
});

test("Qoder diagnosis requires an ACP identity and session smoke check", async (t) => {
  const root = await isolatedHome(t);
  const command = path.join(root, "qoder-diagnose");
  await writeFile(command, "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then echo 1.1.27; else echo MODEL; echo PageRoot-E2E; fi\n", { mode: 0o755 });
  await chmod(command, 0o755);
  let probe = null;
  const diagnostic = await diagnoseQoder(
    { command, version: "1.1.27", source: "e2e-override" },
    {},
    { probeRunner: async (input) => { probe = input; } },
  );
  assert.equal(diagnostic.readiness, "ready");
  assert.equal(diagnostic.activeInstallation, null);
  assert.equal(diagnostic.facts.protocol, "ready");
  assert.equal(diagnostic.facts.service, "ready");
  assert.deepEqual(probe.args, ["--acp"]);
  assert.match("pageroot-e2e-qoder", probe.expectedAgentName);
});

test("Qoder diagnosis keeps authentication ready when ACP identity fails", async (t) => {
  const root = await isolatedHome(t);
  const command = path.join(root, "qoder-diagnose-identity");
  await writeFile(command, "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then echo 1.1.27; else echo MODEL; echo PageRoot-E2E; fi\n", { mode: 0o755 });
  await chmod(command, 0o755);
  const diagnostic = await diagnoseQoder(
    { command, version: "1.1.27", source: "e2e-override" },
    {},
    { probeRunner: async () => {
      throw Object.assign(new Error("wrong agent"), { code: "ACP_AGENT_IDENTITY_MISMATCH" });
    } },
  );
  assert.deepEqual(diagnostic.facts, {
    installation: "ready",
    authentication: "ready",
    protocol: "failed",
    service: "unknown",
  });
  assert.equal(diagnostic.readiness, "connection-failed");
  assert.equal(diagnostic.cause, "ACP_AGENT_IDENTITY_MISMATCH");
});

test("Qoder diagnosis fails closed when ACP process cleanup is unconfirmed", async (t) => {
  const root = await isolatedHome(t);
  const command = path.join(root, "qoder-diagnose-cleanup");
  await writeFile(command, "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then echo 1.1.27; else echo MODEL; echo PageRoot-E2E; fi\n", { mode: 0o755 });
  await chmod(command, 0o755);
  await assert.rejects(
    diagnoseQoder(
      { command, version: "1.1.27", source: "e2e-override" },
      {},
      { probeRunner: async () => {
        throw Object.assign(new Error("cleanup unconfirmed"), {
          code: "ACP_PROCESS_CLEANUP_UNCONFIRMED",
        });
      } },
    ),
    (error) => error?.code === "ACP_PROCESS_CLEANUP_UNCONFIRMED"
      && /未确认停止/u.test(error.message),
  );
});

test("Qoder login prints one validated URL for Stemmio to open", async () => {
  let loginInput = null;
  let capturedUrl = null;
  await startQoderLogin(
    { command: "/tmp/qodercli", installSource: "managed" },
    {
      environment: { HOME: "/tmp/qoder-home", PATH: "/usr/bin:/bin" },
      loginRunner: async (input) => {
        loginInput = input;
        input.onOutput({ loginUrl: "https://qoder.com/account/integrations" });
      },
      onLoginUrl: (url) => { capturedUrl = url; },
      inspectRunner: async () => ({ readiness: "ready" }),
    },
  );
  assert.equal(loginInput.env.NO_BROWSER, "1");
  assert.equal(capturedUrl, "https://qoder.com/account/integrations");
});

test("an invalid user installation is diagnostic-only when managed Qoder is valid", async (t) => {
  const root = await isolatedHome(t);
  const agentsRoot = path.join(root, "agents");
  const managed = await writeManagedQoder(agentsRoot);
  const bin = path.join(root, "bin");
  await mkdir(bin, { recursive: true });
  await writeFile(path.join(bin, "qodercli"), "#!/bin/sh\necho untrusted\n", { mode: 0o755 });
  const catalog = createAgentCatalog({ agentsRoot });
  const resolved = await resolveQoderAcpCommand({
    environment: isolatedEnvironment(root),
    homeDirectory: root,
    managedCandidates: () => catalog.managedCommandCandidates("qoder"),
  });
  assert.equal(resolved.installSource, "managed");
  assert.equal(resolved.command, managed);
});

test("an invalid user installation stays fail-closed when no managed Qoder exists", async (t) => {
  const root = await isolatedHome(t);
  const bin = path.join(root, "bin");
  await mkdir(bin, { recursive: true });
  await writeFile(path.join(bin, "qodercli"), "#!/bin/sh\necho untrusted\n", { mode: 0o755 });
  const catalog = createAgentCatalog({ agentsRoot: path.join(root, "agents") });
  await assert.rejects(
    resolveQoderAcpCommand({
      environment: isolatedEnvironment(root),
      homeDirectory: root,
      managedCandidates: () => catalog.managedCommandCandidates("qoder"),
    }),
    (error) => error?.code === "QODER_COMMAND_UNTRUSTED",
  );
});

test("absent Qoder stays not-installed", async (t) => {
  const root = await isolatedHome(t);
  await mkdir(path.join(root, "bin"), { recursive: true });
  const catalog = createAgentCatalog({ agentsRoot: path.join(root, "agents") });
  await assert.rejects(
    resolveQoderAcpCommand({
      environment: isolatedEnvironment(root),
      homeDirectory: root,
      managedCandidates: () => catalog.managedCommandCandidates("qoder"),
    }),
    (error) => error?.code === "QODER_COMMAND_NOT_FOUND",
  );
  assert.equal(QODER_MANAGED_RELEASE.installable, true);
});
