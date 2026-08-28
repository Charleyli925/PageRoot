import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { createAgentCatalog } from "../bridge/agent/catalog/agent-catalog.mjs";
import { createAgentInstaller } from "../bridge/agent/catalog/agent-installer.mjs";
import { QODER_MANAGED_RELEASE } from "../bridge/agent/catalog/qoder-managed-release.mjs";

const execFileAsync = promisify(execFile);

async function isolatedRoot(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "pageroot-agent-installer-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function packQoderTarball(root, { version = "1.1.27", script = "ok" } = {}) {
  const packageRoot = path.join(root, "package");
  await mkdir(path.join(packageRoot, "bundle"), { recursive: true });
  await writeFile(path.join(packageRoot, "package.json"), `${JSON.stringify({
    name: "@qoder-ai/qodercli",
    version,
    bin: { qodercli: "bundle/qodercli.js" },
  }, null, 2)}\n`);
  await writeFile(
    path.join(packageRoot, "bundle", "qodercli.js"),
    `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(`${script}\n`)});\n`,
    { mode: 0o755 },
  );
  const tarball = path.join(root, "qodercli.tgz");
  await execFileAsync("/usr/bin/tar", ["-czf", tarball, "package"], { cwd: root });
  const bytes = await readFile(tarball);
  return {
    bytes,
    integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
  };
}

function releaseFor(tarball) {
  return Object.freeze({
    ...QODER_MANAGED_RELEASE,
    distribution: Object.freeze({
      ...QODER_MANAGED_RELEASE.distribution,
      managedRelease: Object.freeze({
        ...QODER_MANAGED_RELEASE.distribution.managedRelease,
        integrity: tarball.integrity,
        tarballUrl: "https://registry.example.test/qodercli.tgz",
      }),
    }),
  });
}

function fetchBytes(bytes) {
  return async () => ({
    ok: true,
    async arrayBuffer() {
      return bytes;
    },
  });
}

test("integrity mismatch leaves the agents root untouched", async (t) => {
  const root = await isolatedRoot(t);
  const packed = await packQoderTarball(root);
  const agentsRoot = path.join(root, "agents");
  const installer = createAgentInstaller({
    agentsRoot,
    fetchImpl: fetchBytes(Buffer.from("not-the-tarball")),
  });
  await assert.rejects(
    installer.install(releaseFor(packed)),
    (error) => error?.code === "AGENT_INSTALL_INTEGRITY_MISMATCH",
  );
  await assert.rejects(readFile(path.join(agentsRoot, "qoder", "1.1.27", "package", "bundle", "qodercli.js")));
});

test("atomic install writes a validated managed layout", async (t) => {
  const root = await isolatedRoot(t);
  const packed = await packQoderTarball(root);
  const agentsRoot = path.join(root, "agents");
  const installer = createAgentInstaller({
    agentsRoot,
    fetchImpl: fetchBytes(packed.bytes),
  });
  const installed = await installer.install(releaseFor(packed));
  assert.equal(installed.installSource, "managed");
  const command = path.join(agentsRoot, "qoder", "1.1.27", "package", "bundle", "qodercli.js");
  assert.match(await readFile(command, "utf8"), /ok/u);
  assert.equal(installer.snapshot("qoder").installState, "idle");
});

test("a failed later install keeps the previous managed version", async (t) => {
  const root = await isolatedRoot(t);
  const packed = await packQoderTarball(root, { script: "first" });
  const agentsRoot = path.join(root, "agents");
  const installer = createAgentInstaller({
    agentsRoot,
    fetchImpl: fetchBytes(packed.bytes),
  });
  await installer.install(releaseFor(packed));
  const command = path.join(agentsRoot, "qoder", "1.1.27", "package", "bundle", "qodercli.js");
  await assert.rejects(
    createAgentInstaller({
      agentsRoot,
      fetchImpl: fetchBytes(Buffer.from("corrupt")),
    }).install(releaseFor(packed)),
    (error) => error?.code === "AGENT_INSTALL_INTEGRITY_MISMATCH",
  );
  assert.match(await readFile(command, "utf8"), /first/u);
});

test("cancel aborts an in-flight install and confirms cleanup", async (t) => {
  const root = await isolatedRoot(t);
  const packed = await packQoderTarball(root);
  const agentsRoot = path.join(root, "agents");
  let releaseFetch;
  const blocked = new Promise((resolve) => {
    releaseFetch = resolve;
  });
  const installer = createAgentInstaller({
    agentsRoot,
    fetchImpl: async (_url, { signal } = {}) => {
      await new Promise((resolve, reject) => {
        const abort = () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        if (signal?.aborted) abort();
        else signal?.addEventListener("abort", abort, { once: true });
        blocked.then(resolve, reject);
      });
      return {
        ok: true,
        async arrayBuffer() {
          return packed.bytes;
        },
      };
    },
  });
  const installing = installer.install(releaseFor(packed));
  const cancelled = await installer.cancel("qoder");
  releaseFetch();
  await assert.rejects(installing, (error) => error?.code === "AGENT_INSTALL_CANCELLED");
  assert.equal(cancelled.installState, "idle");
  await assert.rejects(readFile(path.join(agentsRoot, "qoder", "1.1.27", "package", "bundle", "qodercli.js")));
});

test("drain stops in-flight installs before shutdown", async (t) => {
  const root = await isolatedRoot(t);
  const packed = await packQoderTarball(root);
  const installer = createAgentInstaller({
    agentsRoot: path.join(root, "agents"),
    fetchImpl: async (_url, { signal } = {}) => new Promise((_resolve, reject) => {
      const abort = () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      if (signal?.aborted) abort();
      else signal?.addEventListener("abort", abort, { once: true });
    }),
  });
  const installing = installer.install(releaseFor(packed));
  assert.equal(await installer.drain({ timeoutMs: 2_000 }), true);
  await assert.rejects(installing, (error) => error?.code === "AGENT_INSTALL_CANCELLED");
});

test("unknown providers and Codex fail closed without fetching", async (t) => {
  const root = await isolatedRoot(t);
  let fetched = 0;
  const catalog = createAgentCatalog({
    agentsRoot: path.join(root, "agents"),
    installerOptions: {
      fetchImpl: async () => {
        fetched += 1;
        throw new Error("must not fetch");
      },
    },
  });
  await assert.rejects(
    catalog.install("unknown-agent"),
    (error) => error?.code === "AGENT_PROVIDER_UNSUPPORTED",
  );
  await assert.rejects(
    catalog.install("codex"),
    (error) => error?.code === "AGENT_PROVIDER_UNSUPPORTED",
  );
  assert.equal(fetched, 0);
});
