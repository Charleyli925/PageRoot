import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { agentProviderError } from "../providers/agent-provider-contract.mjs";
import { validateNpmCodexAcpCommand } from "../providers/codex-acp-provider.mjs";
import { validateNpmQoderCommand } from "../providers/qoder-provider.mjs";
import {
  assertInstallableCatalogEntry,
  closurePackagesForInstall,
} from "./qoder-managed-release.mjs";

const execFileAsync = promisify(execFile);
const INSTALL_STATES = Object.freeze(["idle", "installing", "failed", "cancelling"]);
const TAR_BIN = "/usr/bin/tar";

function fail(code, message, options) {
  throw agentProviderError(code, message, options);
}

function decodeNpmIntegrity(integrity) {
  const match = String(integrity || "").match(/^sha512-([A-Za-z0-9+/=]+)$/u);
  if (!match) fail("AGENT_INSTALL_INTEGRITY_INVALID", "Managed Agent release integrity is invalid.");
  return Buffer.from(match[1], "base64");
}

function assertSafeTarEntry(name) {
  const normalized = String(name || "").replace(/\\/gu, "/");
  if (!normalized || normalized.startsWith("/") || normalized.includes("..")) {
    fail("AGENT_INSTALL_ARCHIVE_UNTRUSTED", "Managed Agent archive contained an unsafe path.");
  }
  return normalized;
}

export function createAgentInstaller({
  agentsRoot,
  fetchImpl = globalThis.fetch.bind(globalThis),
  extractArchive = extractNpmTarball,
  validateInstallation = defaultValidateInstallation,
  now = () => Date.now(),
} = {}) {
  if (typeof agentsRoot !== "string" || !path.isAbsolute(agentsRoot)) {
    throw new TypeError("Agent installer requires an absolute agentsRoot.");
  }
  if (typeof fetchImpl !== "function") {
    throw new TypeError("Agent installer requires fetch().");
  }
  const jobs = new Map();

  function jobSnapshot(providerId) {
    const job = jobs.get(providerId);
    if (!job) {
      return Object.freeze({
        providerId,
        installState: "idle",
        errorCode: null,
      });
    }
    return Object.freeze({
      providerId,
      installState: INSTALL_STATES.includes(job.state) ? job.state : "failed",
      errorCode: job.errorCode || null,
    });
  }

  async function downloadTarball(release, signal) {
    const expected = decodeNpmIntegrity(release.integrity);
    const response = await fetchImpl(release.tarballUrl, { signal }).catch((cause) => {
      if (signal?.aborted) {
        fail("AGENT_INSTALL_CANCELLED", "Agent 安装已取消。", { status: 409 });
      }
      fail("AGENT_INSTALL_DOWNLOAD_FAILED", "无法下载 Agent 安装包。", { cause, status: 503 });
    });
    if (!response?.ok) {
      fail("AGENT_INSTALL_DOWNLOAD_FAILED", "无法下载 Agent 安装包。", { status: 503 });
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    const actual = createHash("sha512").update(bytes).digest();
    if (actual.length !== expected.length || !actual.equals(expected)) {
      fail("AGENT_INSTALL_INTEGRITY_MISMATCH", "下载的 Agent 安装包与钉死完整性不一致。");
    }
    return bytes;
  }

  async function unpackRelease(release, destination, signal, label) {
    const tarball = await downloadTarball(release, signal);
    const archivePath = path.join(path.dirname(destination), `${label}.tgz`);
    await writeFile(archivePath, tarball, { mode: 0o600 });
    await mkdir(destination, { recursive: true, mode: 0o755 });
    await extractArchive({
      archivePath,
      destination,
      signal,
    });
  }

  return {
    agentsRoot,
    snapshot(providerId) {
      return jobSnapshot(providerId);
    },
    snapshots() {
      return Object.freeze([...jobs.keys()].map((providerId) => jobSnapshot(providerId)));
    },
    async install(entry, { signal } = {}) {
      assertInstallableCatalogEntry(entry, entry.providerId);
      const existing = jobs.get(entry.providerId);
      if (existing?.state === "installing") {
        return existing.promise;
      }
      const controller = new AbortController();
      if (signal) {
        if (signal.aborted) controller.abort(signal.reason);
        else signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
      }
      const job = {
        state: "installing",
        errorCode: null,
        controller,
        startedAt: now(),
      };
      job.promise = (async () => {
        const staging = await mkdtemp(path.join(os.tmpdir(), `pageroot-agent-install-${entry.providerId}-`));
        try {
          const unpacked = path.join(staging, "unpacked");
          await mkdir(unpacked, { recursive: true, mode: 0o755 });
          await unpackRelease(
            entry.distribution.managedRelease,
            unpacked,
            controller.signal,
            "package",
          );
          let depIndex = 0;
          for (const dependency of closurePackagesForInstall(entry)) {
            depIndex += 1;
            const depUnpacked = path.join(staging, `dep-${depIndex}`);
            await unpackRelease(dependency, depUnpacked, controller.signal, `dep-${depIndex}`);
            const destination = path.join(unpacked, "node_modules", ...String(dependency.nodeModulesPath).split("/"));
            await mkdir(path.dirname(destination), { recursive: true, mode: 0o755 });
            await rename(path.join(depUnpacked, "package"), destination);
          }
          await protectTree(unpacked);
          const command = path.join(unpacked, entry.distribution.executableRelativePath);
          await validateInstallation(command, entry);
          const version = entry.distribution.managedRelease.version;
          const destination = path.join(agentsRoot, entry.providerId, version);
          await mkdir(path.dirname(destination), { recursive: true, mode: 0o755 });
          await promoteInstallation(unpacked, destination);
          jobs.set(entry.providerId, {
            state: "idle",
            errorCode: null,
            controller: null,
            promise: null,
            startedAt: job.startedAt,
          });
          return Object.freeze({
            providerId: entry.providerId,
            version,
            installSource: "managed",
          });
        } catch (cause) {
          if (controller.signal.aborted || cause?.code === "AGENT_INSTALL_CANCELLED") {
            jobs.set(entry.providerId, {
              state: "idle",
              errorCode: null,
              controller: null,
              promise: null,
              startedAt: job.startedAt,
            });
            fail("AGENT_INSTALL_CANCELLED", "Agent 安装已取消。", { status: 409 });
          }
          const code = cause?.code && String(cause.code).startsWith("AGENT_")
            ? cause.code
            : "AGENT_INSTALL_FAILED";
          jobs.set(entry.providerId, {
            state: "failed",
            errorCode: code,
            controller: null,
            promise: null,
            startedAt: job.startedAt,
          });
          if (cause?.code && String(cause.code).startsWith("AGENT_")) throw cause;
          fail(code, "Agent 安装没有完成。", { status: 503, cause });
        } finally {
          await rm(staging, { recursive: true, force: true }).catch(() => {});
        }
      })();
      jobs.set(entry.providerId, job);
      return job.promise;
    },
    async cancel(providerId) {
      const job = jobs.get(providerId);
      if (!job || job.state !== "installing") {
        return jobSnapshot(providerId);
      }
      job.state = "cancelling";
      job.controller?.abort(agentProviderError(
        "AGENT_INSTALL_CANCELLED",
        "Agent 安装已取消。",
        { status: 409 },
      ));
      await job.promise.then(() => {}, () => {});
      return jobSnapshot(providerId);
    },
    async drain({ timeoutMs = 12_000 } = {}) {
      const pending = [...jobs.values()]
        .filter((job) => job.state === "installing" || job.state === "cancelling")
        .map((job) => {
          job.controller?.abort(agentProviderError(
            "AGENT_INSTALL_CANCELLED",
            "Agent 安装已取消。",
            { status: 409 },
          ));
          return job.promise;
        });
      if (pending.length === 0) return true;
      const timeout = new Promise((_, reject) => {
        const timer = setTimeout(() => {
          reject(agentProviderError(
            "AGENT_INSTALL_DRAIN_UNCONFIRMED",
            "无法确认 Agent 安装已停止。",
            { status: 503 },
          ));
        }, timeoutMs);
        timer.unref?.();
      });
      await Promise.race([Promise.allSettled(pending), timeout]);
      return [...jobs.values()].every((job) => job.state !== "installing" && job.state !== "cancelling");
    },
  };
}

export async function extractNpmTarball({ archivePath, destination, tarPath = TAR_BIN }) {
  if (typeof archivePath !== "string" || !path.isAbsolute(archivePath)) {
    fail("AGENT_INSTALL_ARCHIVE_UNTRUSTED", "Managed Agent archive path is invalid.");
  }
  const listing = await execFileAsync(tarPath, ["-tzf", archivePath], {
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
  }).catch((cause) => {
    fail("AGENT_INSTALL_ARCHIVE_UNTRUSTED", "Managed Agent archive could not be listed.", { cause });
  });
  const names = String(listing.stdout || "")
    .split(/\r?\n/u)
    .map((name) => name.trim())
    .filter(Boolean)
    .map(assertSafeTarEntry);
  if (!names.some((name) => name === "package/" || name.startsWith("package/"))) {
    fail("AGENT_INSTALL_ARCHIVE_UNTRUSTED", "Managed Agent archive is not an npm package tarball.");
  }
  await execFileAsync(tarPath, ["-xzf", archivePath, "-C", destination], {
    maxBuffer: 1024,
  }).catch((cause) => {
    fail("AGENT_INSTALL_ARCHIVE_UNTRUSTED", "Managed Agent archive could not be extracted.", { cause });
  });
  const packageRoot = path.join(destination, "package");
  const information = await lstat(packageRoot).catch(() => null);
  if (!information?.isDirectory()) {
    fail("AGENT_INSTALL_ARCHIVE_UNTRUSTED", "Managed Agent archive did not unpack a package directory.");
  }
  await protectTree(packageRoot);
}

async function pathExists(target) {
  try {
    await lstat(target);
    return true;
  } catch (cause) {
    if (cause?.code === "ENOENT") return false;
    throw cause;
  }
}

async function promoteInstallation(unpacked, destination) {
  const stagingDest = `${destination}.installing`;
  const backup = `${destination}.previous`;
  await rm(stagingDest, { recursive: true, force: true });
  await rename(unpacked, stagingDest);
  const hadPrevious = await pathExists(destination);
  if (hadPrevious) {
    await rm(backup, { recursive: true, force: true });
    await rename(destination, backup);
  }
  try {
    await rename(stagingDest, destination);
  } catch (cause) {
    if (hadPrevious) await rename(backup, destination).catch(() => {});
    await rm(stagingDest, { recursive: true, force: true }).catch(() => {});
    throw cause;
  }
  if (hadPrevious) await rm(backup, { recursive: true, force: true });
  await chmod(destination, 0o755);
}

async function defaultValidateInstallation(command, entry) {
  const packageName = entry.distribution?.packageName;
  let resolved;
  try {
    if (packageName === "@qoder-ai/qodercli") {
      resolved = await validateNpmQoderCommand(command);
    } else if (packageName === "@agentclientprotocol/codex-acp") {
      resolved = await validateNpmCodexAcpCommand(command, {
        expectedVersion: entry.distribution?.managedRelease?.version,
      });
    } else {
      fail("AGENT_INSTALL_UNSUPPORTED", "This Agent cannot be installed from PageRoot.", { status: 409 });
    }
  } catch (cause) {
    if (String(cause?.code || "").startsWith("QODER_") || String(cause?.code || "").startsWith("CODEX_")) {
      fail("AGENT_INSTALL_UNTRUSTED", "Installed Agent package did not pass identity checks.", {
        cause,
        status: 409,
      });
    }
    throw cause;
  }
  if (!resolved) {
    fail("AGENT_INSTALL_UNTRUSTED", "Installed Agent package did not pass identity checks.", {
      status: 409,
    });
  }
  const expectedVersion = entry.distribution?.managedRelease?.version;
  if (expectedVersion && resolved.version !== expectedVersion) {
    fail("AGENT_INSTALL_UNTRUSTED", "Installed Agent package version does not match the catalog pin.", {
      status: 409,
    });
  }
  return resolved;
}

async function protectTree(root) {
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    const information = await lstat(current);
    if (information.isDirectory()) {
      await chmod(current, 0o755);
      const children = await readdir(current);
      for (const child of children) stack.push(path.join(current, child));
    } else if (information.isFile()) {
      const executable = (information.mode & 0o111) !== 0
        || path.basename(current).endsWith(".js");
      await chmod(current, executable ? 0o755 : 0o644);
    }
  }
}
