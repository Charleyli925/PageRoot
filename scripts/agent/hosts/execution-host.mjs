import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  constants as fsConstants,
  link,
  lstat,
  open,
  unlink,
} from "node:fs/promises";
import path from "node:path";

import { sha256 } from "../../lifecycle-core.mjs";
import {
  AGENT_POLICY_BRAND,
  MAX_HTML_BYTES,
  assertAbsolutePath,
  assertObject,
  assertRuntimeProcessingAuthority,
  policyError,
  projectRootForRequest,
  readVerifiedRegularFile,
  verifiedOutputParent,
} from "../policies/execution-policy.mjs";

const DEFAULT_TERMINAL_OUTPUT_BYTES = 1024 * 1024;
const MAX_TERMINAL_OUTPUT_BYTES = 4 * 1024 * 1024;
const PROCESS_EXIT_GRACE_MS = 2_000;
const processClosePromises = new WeakMap();

function validateSession(boundSessionId, receivedSessionId) {
  if (!boundSessionId || receivedSessionId !== boundSessionId) {
    throw policyError(
      "SESSION_ID_MISMATCH",
      "The Agent operation does not belong to the active PageRoot task session.",
    );
  }
}

function slicedLines(content, line, limit) {
  if (line == null && limit == null) return content;
  const start = line == null ? 0 : line - 1;
  if (!Number.isSafeInteger(start) || start < 0 || start > 1_000_000) {
    throw policyError("READ_RANGE_INVALID", "Agent line must be a positive integer.");
  }
  if (
    limit != null
    && (!Number.isSafeInteger(limit) || limit <= 0 || limit > 100_000)
  ) {
    throw policyError("READ_RANGE_INVALID", "Agent limit must be a positive integer.");
  }
  const lines = content.match(/[^\n]*(?:\n|$)/gu) || [];
  if (lines.at(-1) === "") lines.pop();
  return lines.slice(start, limit == null ? undefined : start + limit).join("");
}

function terminalOutputLimit(value) {
  if (value == null) return DEFAULT_TERMINAL_OUTPUT_BYTES;
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_TERMINAL_OUTPUT_BYTES) {
    throw policyError(
      "TERMINAL_OUTPUT_LIMIT_INVALID",
      "The terminal output byte limit is outside PageRoot's supported range.",
    );
  }
  return value;
}

function truncateUtf8Tail(value, byteLimit) {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.byteLength <= byteLimit) return { value, truncated: false };
  let start = bytes.byteLength - byteLimit;
  while (start < bytes.byteLength && (bytes[start] & 0b1100_0000) === 0b1000_0000) {
    start += 1;
  }
  return {
    value: bytes.subarray(start).toString("utf8"),
    truncated: true,
  };
}

function envArrayMatches(requested, expected) {
  if (!Array.isArray(requested)) return false;
  const entries = Object.entries(expected);
  if (requested.length !== entries.length) return false;
  const received = new Map();
  for (const entry of requested) {
    if (
      !entry
      || typeof entry !== "object"
      || typeof entry.name !== "string"
      || typeof entry.value !== "string"
      || received.has(entry.name)
    ) return false;
    received.set(entry.name, entry.value);
  }
  return entries.every(([name, value]) => received.get(name) === value);
}

function finalizerRequestMatches(params, finalizer) {
  const args = Array.isArray(params.args) ? params.args : [];
  const cwdMatches = typeof params.cwd === "string"
    && path.isAbsolute(params.cwd)
    && path.resolve(params.cwd) === finalizer.cwd;
  if (!cwdMatches || !envArrayMatches(params.env, finalizer.env)) return false;
  return (
    typeof params.command === "string"
    && path.isAbsolute(params.command)
    && path.resolve(params.command) === finalizer.command
    && args.length === finalizer.args.length
    && args.every((argument, index) => argument === finalizer.args[index])
  );
}

function terminalExitStatus(child) {
  if (child.exitCode === null && child.signalCode === null) return null;
  return { exitCode: child.exitCode, signal: child.signalCode };
}

async function waitForExit(child) {
  const existing = processClosePromises.get(child);
  if (existing) return existing;
  const terminal = terminalExitStatus(child);
  if (terminal) return terminal;
  const promise = new Promise((resolve, reject) => {
    const cleanup = () => {
      child.off("close", handleClose);
      child.off("error", handleError);
    };
    const handleClose = () => {
      cleanup();
      resolve(terminalExitStatus(child));
    };
    const handleError = (error) => {
      cleanup();
      reject(error);
    };
    child.once("close", handleClose);
    child.once("error", handleError);
  });
  processClosePromises.set(child, promise);
  return promise;
}

function signalProcessGroup(child, signal) {
  if (!Number.isSafeInteger(child?.pid) || child.pid <= 0) return false;
  try {
    process.kill(-child.pid, signal);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    if (error?.code === "EPERM") return false;
    throw error;
  }
}

function signalProcess(child, signal, { processGroup = false } = {}) {
  if (processGroup && Number.isSafeInteger(child?.pid) && child.pid > 0) {
    if (signalProcessGroup(child, signal)) return;
  }
  if (Number.isSafeInteger(child?.pid) && child.pid > 0) {
    try {
      child.kill(signal);
    } catch (error) {
      if (error?.code !== "ESRCH") throw error;
    }
  }
}

function processGroupExists(child) {
  if (!Number.isSafeInteger(child?.pid) || child.pid <= 0) return false;
  try {
    process.kill(-child.pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    if (error?.code === "EPERM") {
      return child.exitCode === null && child.signalCode === null;
    }
    throw error;
  }
}

async function waitForProcessGroupExit(child, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (processGroupExists(child) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return !processGroupExists(child);
}

async function waitForChildExitWithin(child, timeoutMs) {
  if (terminalExitStatus(child)) return true;
  return Promise.race([
    waitForExit(child).then(() => true, () => true),
    new Promise((resolve) => setTimeout(resolve, timeoutMs, false)),
  ]);
}

export async function terminateManagedProcess(child, { processGroup = false } = {}) {
  if (!child) return true;
  let leaderExited = !Number.isSafeInteger(child.pid)
    || child.exitCode !== null
    || child.signalCode !== null;
  signalProcess(child, "SIGTERM", { processGroup });
  if (!leaderExited) {
    leaderExited = await waitForChildExitWithin(child, PROCESS_EXIT_GRACE_MS);
    if (!leaderExited && child.exitCode === null && child.signalCode === null) {
      signalProcess(child, "SIGKILL", { processGroup });
      leaderExited = await waitForChildExitWithin(child, PROCESS_EXIT_GRACE_MS);
    }
  }
  if (
    processGroup
    && processGroupExists(child)
    && !(await waitForProcessGroupExit(child, PROCESS_EXIT_GRACE_MS))
  ) {
    signalProcessGroup(child, "SIGKILL");
    await waitForProcessGroupExit(child, PROCESS_EXIT_GRACE_MS);
  }
  if (processGroup) return leaderExited && !processGroupExists(child);
  return leaderExited || !Number.isSafeInteger(child.pid);
}

async function fileExists(filePath) {
  try {
    await lstat(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function atomicNoReplace(stagingPath, outputPath) {
  await link(stagingPath, outputPath);
  await unlink(stagingPath);
}

export function createExecutionHost(policy, {
  spawnProcess = spawn,
  renameOutput = atomicNoReplace,
  onEvent = () => {},
} = {}) {
  assertObject(policy, "policy");
  if (
    policy[AGENT_POLICY_BRAND] !== true
    || policy.mode !== "execution"
    || !Array.isArray(policy.readableFiles)
  ) {
    throw new TypeError("Restricted execution host requires a verified PageRoot task policy.");
  }
  if (
    typeof spawnProcess !== "function"
    || typeof renameOutput !== "function"
    || typeof onEvent !== "function"
  ) {
    throw new TypeError("Restricted execution host dependencies are invalid.");
  }
  let sessionId = null;
  let finalizerStarted = false;
  let finalizerOutcome = null;
  let finalizedOutputSha256 = null;
  let outputWritten = false;
  let phase = "active";
  let cancellationRequested = false;
  let cancellationPromise = null;
  let mutationTail = Promise.resolve();
  const terminals = new Map();
  const inFlight = new Set();
  const readableFiles = new Map(
    policy.readableFiles.map((entry) => [entry.path, entry]),
  );

  const event = (kind, details = {}) => onEvent(Object.freeze({ kind, ...details }));
  const assertActive = (signal) => {
    if (signal?.aborted) {
      throw policyError("REQUEST_CANCELLED", "The Agent request was cancelled.");
    }
    if (cancellationRequested || phase === "cancelling") {
      throw policyError("HOST_CANCELLING", "The Agent task host is cancelling.");
    }
    if (phase === "finalized") {
      throw policyError("HOST_FINALIZED", "The Agent task host already finalized its Candidate.");
    }
    if (phase === "disposed") {
      throw policyError("HOST_DISPOSED", "The Agent task host is already closed.");
    }
  };
  const trackActive = async (signal, operation) => {
    const promise = (async () => {
      assertActive(signal);
      return operation(() => assertActive(signal));
    })();
    inFlight.add(promise);
    try {
      return await promise;
    } finally {
      inFlight.delete(promise);
    }
  };
  const acquireMutationLock = async () => {
    let release;
    const current = new Promise((resolve) => {
      release = resolve;
    });
    const previous = mutationTail;
    mutationTail = previous.then(() => current, () => current);
    await previous.catch(() => {});
    return release;
  };
  const mutate = async (signal, operation) => {
    const release = await acquireMutationLock();
    try {
      assertActive(signal);
      await assertRuntimeProcessingAuthority(policy);
      assertActive(signal);
      return await operation(() => assertActive(signal));
    } finally {
      release();
    }
  };
  const terminal = (receivedSessionId, terminalId, signal) => {
    assertActive(signal);
    validateSession(sessionId, receivedSessionId);
    const record = terminals.get(terminalId);
    if (!record) {
      throw policyError("TERMINAL_UNKNOWN", "The Agent terminal is not owned by this task.");
    }
    return record;
  };
  const stopTerminals = async () => {
    const releases = [...terminals.values()].map(async (record) => {
      await terminateManagedProcess(record.child, { processGroup: record.processGroup });
      await record.exitPromise.catch(() => {});
    });
    await Promise.all(releases);
    terminals.clear();
  };

  const host = {
    bindSessionId(nextSessionId) {
      assertActive();
      if (
        sessionId
        || typeof nextSessionId !== "string"
        || !/^[^\u0000-\u001f\u007f]{1,256}$/u.test(nextSessionId)
      ) {
        throw policyError("SESSION_BIND_INVALID", "The Agent session could not be bound.");
      }
      sessionId = nextSessionId;
      event("session-bound");
    },
    async requestPermission(params, signal) {
      validateSession(sessionId, params.sessionId);
      if (signal?.aborted || cancellationRequested || phase !== "active") {
        return { outcome: { outcome: "cancelled" } };
      }
      const options = Array.isArray(params.options) ? params.options : [];
      const optionIds = new Set();
      const validOptions = options.every((option) => (
        option
        && typeof option.optionId === "string"
        && option.optionId.length > 0
        && option.optionId.length <= 256
        && !optionIds.has(option.optionId)
        && Boolean(optionIds.add(option.optionId))
      ));
      const allowOnce = validOptions
        ? options.find((option) => option.kind === "allow_once")
        : null;
      if (!allowOnce) {
        event("permission-rejected", { toolKind: params.toolCall?.kind || "unknown" });
        return { outcome: { outcome: "cancelled" } };
      }
      event("permission-allowed-once", { toolKind: params.toolCall?.kind || "unknown" });
      return { outcome: { outcome: "selected", optionId: allowOnce.optionId } };
    },
    async readTextFile(params, signal) {
      return trackActive(signal, async (checkActive) => {
        validateSession(sessionId, params.sessionId);
        const requestedPath = assertAbsolutePath(
          params.path,
          "agent/read_text_file path",
        );
        const authorized = readableFiles.get(requestedPath);
        if (!authorized) {
          throw policyError(
            "READ_NOT_AUTHORIZED",
            "The Agent requested a file outside the frozen read set.",
          );
        }
        const file = await readVerifiedRegularFile(
          requestedPath,
          policy.requestRoot,
          "Agent read target",
        );
        checkActive();
        const { bytes } = file;
        if (bytes.byteLength !== authorized.byteLength || sha256(bytes) !== authorized.sha256) {
          throw policyError(
            "FROZEN_INPUT_DRIFT",
            "A frozen input changed after the Agent session started.",
          );
        }
        event("file-read", { role: authorized.role });
        return { content: slicedLines(bytes.toString("utf8"), params.line, params.limit) };
      });
    },
    async writeTextFile(params, signal) {
      return trackActive(signal, () => mutate(signal, async (checkActive) => {
        validateSession(sessionId, params.sessionId);
        const requestedPath = assertAbsolutePath(
          params.path,
          "agent/write_text_file path",
        );
        if (requestedPath !== policy.outputPath) {
          throw policyError(
            "WRITE_NOT_AUTHORIZED",
            "The Agent may only write the exact Candidate output path.",
          );
        }
        let temporaryPath = null;
        try {
          if (await fileExists(policy.completionPath)) {
            throw policyError(
              "OUTPUT_ALREADY_FINALIZED",
              "The Candidate output is immutable after finalization.",
            );
          }
          checkActive();
          if (finalizerStarted) {
            throw policyError(
              "FINALIZER_ALREADY_STARTED",
              "The Candidate output is immutable once finalization starts.",
            );
          }
          if (outputWritten) {
            throw policyError(
              "OUTPUT_ALREADY_WRITTEN",
              "The synthetic Candidate output accepts exactly one committed write.",
            );
          }
          if (typeof params.content !== "string" || !params.content.trim()) {
            throw policyError("OUTPUT_EMPTY", "The Candidate output must not be empty.");
          }
          const bytes = Buffer.from(params.content, "utf8");
          if (bytes.byteLength > MAX_HTML_BYTES) {
            throw policyError("OUTPUT_TOO_LARGE", "The Candidate output exceeds 20 MiB.");
          }
          await verifiedOutputParent(policy.outputPath, policy.requestRoot);
          checkActive();
          try {
            const existing = await lstat(policy.outputPath);
            if (existing.isSymbolicLink() || !existing.isFile() || existing.nlink !== 1) {
              throw policyError(
                "UNSAFE_OUTPUT_FILE",
                "The Candidate output must be a single-link regular file.",
              );
            }
            throw policyError(
              "OUTPUT_ALREADY_WRITTEN",
              "The synthetic Candidate output must be fresh before its single committed write.",
            );
          } catch (error) {
            if (error?.code !== "ENOENT") throw error;
          }
          checkActive();
          temporaryPath = `${policy.outputPath}.pageroot-agent-${randomUUID()}.tmp`;
          const flags = fsConstants.O_WRONLY
            | fsConstants.O_CREAT
            | fsConstants.O_EXCL
            | (fsConstants.O_NOFOLLOW || 0);
          const handle = await open(temporaryPath, flags, 0o600);
          try {
            const information = await handle.stat();
            if (!information.isFile() || information.nlink !== 1) {
              throw policyError(
                "UNSAFE_OUTPUT_FILE",
                "The Candidate output staging file must be a single-link regular file.",
              );
            }
            await handle.writeFile(bytes);
            await handle.sync();
          } finally {
            await handle.close();
          }
          checkActive();
          await assertRuntimeProcessingAuthority(policy);
          checkActive();
          await renameOutput(temporaryPath, policy.outputPath);
          temporaryPath = null;
          try {
            checkActive();
            await assertRuntimeProcessingAuthority(policy);
            checkActive();
          } catch (error) {
            const published = await readVerifiedRegularFile(
              policy.outputPath,
              policy.requestRoot,
              "Cancelled Candidate output",
            );
            if (sha256(published.bytes) === sha256(bytes)) {
              await unlink(policy.outputPath);
            }
            throw error;
          }
          outputWritten = true;
          event("file-written", { byteLength: bytes.byteLength });
          return {};
        } finally {
          if (temporaryPath) await unlink(temporaryPath).catch(() => {});
        }
      }));
    },
    async createTerminal(params, signal) {
      return trackActive(signal, () => mutate(signal, async (checkActive) => {
        validateSession(sessionId, params.sessionId);
        if (finalizerStarted) {
          throw policyError(
            "FINALIZER_ALREADY_STARTED",
            "The task finalizer can be launched only once.",
          );
        }
        if (!finalizerRequestMatches(params, policy.finalizer)) {
          throw policyError(
            "TERMINAL_NOT_AUTHORIZED",
            "The Agent terminal may execute only the frozen PageRoot finalizer.",
          );
        }
        const outputInformation = await readVerifiedRegularFile(
          policy.outputPath,
          policy.requestRoot,
          "Candidate output",
        );
        checkActive();
        if (
          outputInformation.information.size <= 0
          || outputInformation.information.size > MAX_HTML_BYTES
        ) {
          throw policyError(
            "OUTPUT_NOT_READY",
            "The Candidate output is not ready for finalization.",
          );
        }
        await assertRuntimeProcessingAuthority(policy);
        checkActive();
        finalizerStarted = true;
        finalizedOutputSha256 = sha256(outputInformation.bytes);
        const outputByteLimit = terminalOutputLimit(params.outputByteLimit);
        const child = spawnProcess(policy.finalizer.command, [...policy.finalizer.args], {
          cwd: policy.finalizer.cwd,
          env: { ...policy.finalizer.env },
          detached: process.platform !== "win32",
          shell: false,
          stdio: ["ignore", "pipe", "pipe"],
        });
        const terminalId = `term_${randomUUID().replaceAll("-", "")}`;
        const record = {
          child,
          processGroup: process.platform !== "win32",
          output: "",
          outputByteLimit,
          truncated: false,
          exitPromise: null,
        };
        const append = (chunk) => {
          const next = truncateUtf8Tail(record.output + chunk.toString(), outputByteLimit);
          record.output = next.value;
          record.truncated ||= next.truncated;
        };
        child.stdout?.on("data", append);
        child.stderr?.on("data", append);
        record.exitPromise = waitForExit(child).then((status) => {
          finalizerOutcome = { status, truncated: record.truncated };
          event("terminal-exited", { exitCode: status?.exitCode ?? null });
          return status;
        });
        void record.exitPromise.catch(() => {});
        terminals.set(terminalId, record);
        event("terminal-created", { executable: path.basename(policy.finalizer.command) });
        return { terminalId };
      }));
    },
    async terminalOutput(params, signal) {
      return trackActive(signal, async () => {
        const record = terminal(params.sessionId, params.terminalId, signal);
        return {
          output: record.output,
          truncated: record.truncated,
          ...(terminalExitStatus(record.child)
            ? { exitStatus: terminalExitStatus(record.child) }
            : {}),
        };
      });
    },
    async waitForTerminalExit(params, signal) {
      return trackActive(signal, async (checkActive) => {
        const record = terminal(params.sessionId, params.terminalId, signal);
        const status = await record.exitPromise;
        checkActive();
        return status;
      });
    },
    async killTerminal(params, signal) {
      return trackActive(signal, async () => {
        const record = terminal(params.sessionId, params.terminalId, signal);
        if (record.child.exitCode === null && record.child.signalCode === null) {
          signalProcess(record.child, "SIGTERM", { processGroup: record.processGroup });
        }
        event("terminal-killed");
        return {};
      });
    },
    async releaseTerminal(params, signal) {
      return trackActive(signal, async (checkActive) => {
        const record = terminal(params.sessionId, params.terminalId, signal);
        await terminateManagedProcess(record.child, { processGroup: record.processGroup });
        await record.exitPromise.catch(() => {});
        checkActive();
        terminals.delete(params.terminalId);
        event("terminal-released");
        return {};
      });
    },
    async assertTurnCompleted() {
      return trackActive(null, async (checkActive) => {
        if (
          !finalizerStarted
          || !finalizerOutcome
          || finalizerOutcome.status?.exitCode !== 0
          || finalizerOutcome.status?.signal
          || finalizerOutcome.truncated
        ) {
          throw policyError(
            "FINALIZER_NOT_COMPLETED",
            "The Agent turn stopped without one clean, complete PageRoot finalizer run.",
          );
        }
        const [output, completionFile] = await Promise.all([
          readVerifiedRegularFile(policy.outputPath, policy.requestRoot, "Finalized Candidate"),
          readVerifiedRegularFile(policy.completionPath, policy.requestRoot, "Completion record"),
        ]);
        checkActive();
        const currentOutputSha256 = sha256(output.bytes);
        if (currentOutputSha256 !== finalizedOutputSha256) {
          throw policyError(
            "FINALIZED_OUTPUT_CHANGED",
            "The Candidate output changed during or after finalization.",
          );
        }
        let completion;
        try {
          completion = JSON.parse(completionFile.bytes.toString("utf8"));
        } catch {
          throw policyError(
            "COMPLETION_INVALID",
            "The finalizer did not write a valid completion record.",
          );
        }
        const projectRoot = projectRootForRequest(policy.requestRoot, policy.requestId);
        const controlRoot = path.join(projectRoot, ".pageroot");
        const outputRelativePath = path.relative(controlRoot, policy.outputPath).split(path.sep).join("/");
        if (
          completion?.projectId !== policy.projectId
          || completion?.documentId !== policy.documentId
          || completion?.requestId !== policy.requestId
          || completion?.attemptId !== policy.attemptId
          || completion?.inputManifestSha256 !== policy.inputManifestSha256
          || completion?.outputRelativePath !== outputRelativePath
          || completion?.outputSha256 !== currentOutputSha256
          || !["completed", "no-change"].includes(completion?.status)
        ) {
          throw policyError(
            "COMPLETION_IDENTITY_MISMATCH",
            "The completion record does not match the frozen PageRoot task and Candidate.",
          );
        }
        checkActive();
        phase = "finalized";
        event("completion-verified", { status: completion.status });
        return Object.freeze({
          status: completion.status,
          outputSha256: currentOutputSha256,
        });
      });
    },
    async cancel() {
      if (cancellationRequested || phase !== "active") {
        return cancellationPromise || Promise.resolve();
      }
      cancellationRequested = true;
      event("host-cancelling");
      cancellationPromise = (async () => {
        const release = await acquireMutationLock();
        try {
          if (phase === "active") phase = "cancelling";
        } finally {
          release();
        }
        await stopTerminals();
      })();
      await cancellationPromise;
    },
    async dispose() {
      if (phase === "disposed") return;
      phase = "disposed";
      await cancellationPromise?.catch(() => {});
      await stopTerminals();
      await Promise.allSettled([...inFlight]);
    },
  };
  return host;
}
