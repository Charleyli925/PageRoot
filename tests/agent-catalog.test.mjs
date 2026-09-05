import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createAgentCatalog } from "../bridge/agent/catalog/agent-catalog.mjs";
import { QODER_MANAGED_RELEASE } from "../bridge/agent/catalog/qoder-managed-release.mjs";
import { diagnoseQoder, resolveQoderAcpCommand } from "../bridge/agent/providers/qoder-provider.mjs";

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
  assert.equal(projected.connection, null);
  assert.equal(projected.loginUrlPresent, false);
  assert.equal(serialized.includes(root), false);
  assert.equal(Object.hasOwn(projected, "command"), false);
  assert.equal(serialized.includes("stderr"), false);
  assert.equal(serialized.includes("qodercli.js"), false);
});

test("user-installed Qoder wins over a managed copy", async (t) => {
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
  assert.equal(resolved.installSource, "user");
  assert.equal(resolved.command, userBundle);
  assert.notEqual(resolved.command, managed);
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

test("Qoder diagnosis uses only version and model-list commands", async (t) => {
  const root = await isolatedHome(t);
  const command = path.join(root, "qoder-diagnose");
  await writeFile(command, "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then echo 1.1.27; else echo MODEL; echo PageRoot-E2E; fi\n", { mode: 0o755 });
  await chmod(command, 0o755);
  const diagnostic = await diagnoseQoder({ command, version: "1.1.27", source: "e2e-override" }, {});
  assert.equal(diagnostic.readiness, "ready");
  assert.equal(diagnostic.activeInstallation, null);
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
