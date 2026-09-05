import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile, chmod } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { createAgentCatalog } from "../bridge/agent/catalog/agent-catalog.mjs";
import { createAgentInstaller } from "../bridge/agent/catalog/agent-installer.mjs";
import {
  CODEX_ACP_MANAGED_RELEASE,
  QODER_MANAGED_RELEASE,
} from "../bridge/agent/catalog/qoder-managed-release.mjs";

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
  assert.equal(installer.snapshot("qoder").generation, 1);
  assert.equal(installer.snapshot("qoder").startedAt, null);
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

test("unknown providers fail closed without fetching", async (t) => {
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
  assert.equal(fetched, 0);
});

async function packNpmTarball(root, name, files) {
  const packageRoot = path.join(root, "package");
  await mkdir(packageRoot, { recursive: true });
  for (const [relativePath, contents] of Object.entries(files)) {
    const filePath = path.join(packageRoot, relativePath);
    await mkdir(path.dirname(filePath), { recursive: true });
    const body = typeof contents === "string" || Buffer.isBuffer(contents)
      ? contents
      : contents.body;
    const mode = typeof contents === "object" && contents && !Buffer.isBuffer(contents)
      ? contents.mode
      : 0o644;
    await writeFile(filePath, body, { mode });
    if (mode === 0o755) await chmod(filePath, 0o755);
  }
  const tarball = path.join(root, `${name}.tgz`);
  await execFileAsync("/usr/bin/tar", ["-czf", tarball, "package"], { cwd: root });
  const bytes = await readFile(tarball);
  await rm(packageRoot, { recursive: true, force: true });
  return {
    bytes,
    integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
  };
}

function fetchMap(entries) {
  const table = new Map(Object.entries(entries));
  return async (url) => {
    const bytes = table.get(url);
    if (!bytes) throw new Error(`unexpected tarball ${url}`);
    return {
      ok: true,
      async arrayBuffer() {
        return bytes;
      },
    };
  };
}

test("Codex closure integrity failure leaves the agents root untouched", async (t) => {
  const root = await isolatedRoot(t);
  const adapter = await packNpmTarball(root, "adapter", {
    "package.json": `${JSON.stringify({
      name: "@agentclientprotocol/codex-acp",
      version: "1.7.0",
      bin: { "codex-acp": "dist/index.js" },
    })}\n`,
    "dist/index.js": { body: "#!/usr/bin/env node\n", mode: 0o755 },
  });
  const entry = Object.freeze({
    ...CODEX_ACP_MANAGED_RELEASE,
    distribution: Object.freeze({
      ...CODEX_ACP_MANAGED_RELEASE.distribution,
      managedRelease: Object.freeze({
        version: "1.7.0",
        integrity: adapter.integrity,
        tarballUrl: "https://registry.example.test/codex-acp.tgz",
      }),
      closure: Object.freeze([]),
    }),
  });
  const installer = createAgentInstaller({
    agentsRoot: path.join(root, "agents"),
    fetchImpl: fetchBytes(Buffer.from("not-the-tarball")),
  });
  await assert.rejects(
    installer.install(entry),
    (error) => error?.code === "AGENT_INSTALL_INTEGRITY_MISMATCH",
  );
  await assert.rejects(readFile(path.join(root, "agents", "codex", "1.7.0", "package", "dist", "index.js")));
});

test("atomic Codex closure install writes adapter plus native layout", async (t) => {
  const root = await isolatedRoot(t);
  const adapter = await packNpmTarball(path.join(root, "adapter-src"), "adapter", {
    "package.json": `${JSON.stringify({
      name: "@agentclientprotocol/codex-acp",
      version: "1.7.0",
      bin: { "codex-acp": "dist/index.js" },
    })}\n`,
    "dist/index.js": { body: "#!/usr/bin/env node\nprocess.stdout.write('ok\\n');\n", mode: 0o755 },
  });
  const wrapper = await packNpmTarball(path.join(root, "wrapper-src"), "wrapper", {
    "package.json": `${JSON.stringify({ name: "@openai/codex", version: "0.148.0" })}\n`,
    "bin/codex.js": "export {}\n",
  });
  const nativeName = `codex-${process.platform}-${process.arch}`;
  const native = await packNpmTarball(path.join(root, "native-src"), "native", {
    "package.json": `${JSON.stringify({
      name: "@openai/codex",
      version: `0.148.0-${process.platform}-${process.arch}`,
    })}\n`,
    [`vendor/test/bin/${process.platform === "win32" ? "codex.exe" : "codex"}`]: {
      body: "#!/bin/sh\n",
      mode: 0o755,
    },
  });
  const urls = Object.freeze({
    adapter: "https://registry.example.test/codex-acp.tgz",
    wrapper: "https://registry.example.test/codex.tgz",
    native: "https://registry.example.test/codex-native.tgz",
  });
  const entry = Object.freeze({
    ...CODEX_ACP_MANAGED_RELEASE,
    distribution: Object.freeze({
      ...CODEX_ACP_MANAGED_RELEASE.distribution,
      managedRelease: Object.freeze({
        version: "1.7.0",
        integrity: adapter.integrity,
        tarballUrl: urls.adapter,
      }),
      closure: Object.freeze([
        Object.freeze({
          packageName: "@openai/codex",
          version: "0.148.0",
          integrity: wrapper.integrity,
          tarballUrl: urls.wrapper,
          nodeModulesPath: "@openai/codex",
        }),
        Object.freeze({
          packageName: "@openai/codex",
          version: `0.148.0-${process.platform}-${process.arch}`,
          integrity: native.integrity,
          tarballUrl: urls.native,
          nodeModulesPath: `@openai/${nativeName}`,
          platform: process.platform,
          arch: process.arch,
        }),
      ]),
    }),
  });
  const agentsRoot = path.join(root, "agents");
  const installer = createAgentInstaller({
    agentsRoot,
    fetchImpl: fetchMap({
      [urls.adapter]: adapter.bytes,
      [urls.wrapper]: wrapper.bytes,
      [urls.native]: native.bytes,
    }),
  });
  const installed = await installer.install(entry);
  assert.equal(installed.installSource, "managed");
  const command = path.join(agentsRoot, "codex", "1.7.0", "package", "dist", "index.js");
  assert.match(await readFile(command, "utf8"), /ok/u);
  assert.equal(installer.snapshot("codex").installState, "idle");
});

test("the shipped Codex catalog entry is installable", async () => {
  assert.equal(CODEX_ACP_MANAGED_RELEASE.installable, true);
  assert.equal(CODEX_ACP_MANAGED_RELEASE.runtimeId, "acp");
  assert.equal(CODEX_ACP_MANAGED_RELEASE.distribution.packageName, "@agentclientprotocol/codex-acp");
  assert.equal(
    CODEX_ACP_MANAGED_RELEASE.distribution.managedRelease.integrity,
    "sha512-+nUhAJyunx8Zc7r3jjLPoMPPUkkk02TmBIosln4l+ugRNUOdNQAMm6toZo7xb+mF1yM5zxJB83qvy/bPmOTaaw==",
  );
  const closure = CODEX_ACP_MANAGED_RELEASE.distribution.closure;
  assert.ok(closure.some((item) => item.packageName === "@openai/codex" && item.version === "0.148.0"));
  assert.ok(closure.some((item) => item.nodeModulesPath === "@openai/codex-darwin-arm64"));
  assert.equal(closure.find((item) => item.packageName === "is-wsl")?.version, "3.1.1");
  assert.equal(closure.find((item) => item.packageName === "default-browser-id")?.version, "5.0.1");
});
