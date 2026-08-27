import {
  constants as fsConstants,
  lstat,
  mkdir,
  open,
  unlink,
} from "node:fs/promises";
import path from "node:path";

import { sha256 } from "../lifecycle-core.mjs";
import { failAgentRuntime } from "./agent-errors.mjs";

const AGENT_LEASE_DIRECTORY = "agent-bridge-leases";
function requiredComponent(value, label) {
  const normalized = String(value || "");
  if (!/^[A-Za-z0-9_-]{1,160}$/u.test(normalized)) {
    throw new TypeError(`Agent lease ${label} is invalid.`);
  }
  return normalized;
}

export function agentLeaseKey({
  providerId,
  runtimeId,
  purpose,
  projectId,
  documentId,
  requestId,
  attemptId,
} = {}) {
  if (purpose !== "execution") throw new TypeError("Agent lease purpose is invalid.");
  const subject = [
    requiredComponent(requestId, "requestId"),
    requiredComponent(attemptId, "attemptId"),
  ];
  return [
    requiredComponent(providerId, "providerId"),
    requiredComponent(runtimeId, "runtimeId"),
    purpose,
    requiredComponent(projectId, "projectId"),
    requiredComponent(documentId, "documentId"),
    ...subject,
  ].join(":");
}

function leaseRoot({ purpose, requestPath }) {
  const requestRoot = path.resolve(String(requestPath || ""));
  const requestsRoot = path.dirname(requestRoot);
  if (purpose !== "execution" || !path.isAbsolute(requestRoot)
    || path.basename(requestRoot) !== path.basename(String(requestPath || ""))
    || path.basename(requestsRoot) !== "requests") {
    failAgentRuntime(
      "AGENT_TASK_POLICY_INVALID",
      "本轮 Request 路径不能建立安全的 Agent 启动租约。",
      { status: 409 },
    );
  }
  return path.dirname(requestsRoot);
}

function leaseTarget(input) {
  const key = agentLeaseKey(input);
  const directory = path.join(leaseRoot(input), AGENT_LEASE_DIRECTORY);
  const digest = sha256(Buffer.from(key, "utf8")).replace(/^sha256:/u, "");
  return Object.freeze({ key, directory, path: path.join(directory, `${digest}.json`) });
}

function nowIso(clock) {
  return new Date(Math.max(0, Number(clock.now()) || 0)).toISOString();
}

export async function acquireAgentLease(input) {
  const target = leaseTarget(input);
  await mkdir(target.directory, { recursive: true, mode: 0o700 });
  const directoryInformation = await lstat(target.directory).catch(() => null);
  if (!directoryInformation?.isDirectory()
    || directoryInformation.isSymbolicLink()
    || (directoryInformation.mode & 0o022) !== 0) {
    failAgentRuntime("AGENT_LEASE_UNSAFE", "Agent 启动租约目录不安全，PageRoot 没有启动 Qoder。", {
      status: 409,
    });
  }
  let handle;
  try {
    handle = await open(
      target.path,
      fsConstants.O_WRONLY
        | fsConstants.O_CREAT
        | fsConstants.O_EXCL
        | (fsConstants.O_NOFOLLOW || 0),
      0o600,
    );
  } catch (cause) {
    if (cause?.code === "EEXIST") {
      failAgentRuntime(
        "AGENT_RESTART_RECOVERY_REQUIRED",
        "Bridge 上次退出后无法证明旧 Qoder 会话已经停止。请结束本轮，再重新发送。",
        { status: 409 },
      );
    }
    failAgentRuntime("AGENT_LEASE_UNAVAILABLE", "Agent 启动租约无法安全建立，PageRoot 没有启动 Qoder。", {
      status: 409,
    });
  }
  const record = {
    schemaVersion: 2,
    kind: "agent-runtime-lease",
    key: target.key,
    providerId: input.providerId,
    runtimeId: input.runtimeId,
    purpose: input.purpose,
    projectId: input.projectId,
    documentId: input.documentId,
    ...(input.turnId ? { turnId: input.turnId } : {}),
    ...(input.requestId ? { requestId: input.requestId } : {}),
    ...(input.attemptId ? { attemptId: input.attemptId } : {}),
    ownerToken: input.ownerToken,
    bridgePid: process.pid,
    createdAt: nowIso(input.clock || Date),
  };
  try {
    await handle.writeFile(`${JSON.stringify(record)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  return Object.freeze({ ...target, ownerToken: input.ownerToken });
}

export async function releaseAgentLease(lease) {
  if (!lease?.path || !lease.ownerToken || !lease.key) return false;
  let handle;
  try {
    handle = await open(lease.path, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0));
    const information = await handle.stat();
    if (!information.isFile() || information.nlink !== 1) return false;
    const record = JSON.parse(await handle.readFile("utf8"));
    if (record?.ownerToken !== lease.ownerToken || record?.key !== lease.key) return false;
  } catch {
    return false;
  } finally {
    await handle?.close().catch(() => {});
  }
  return unlink(lease.path).then(() => true, () => false);
}

export function createAgentLeaseStore() {
  return Object.freeze({ acquire: acquireAgentLease, release: releaseAgentLease });
}

export const defaultAgentLeaseStore = createAgentLeaseStore();
