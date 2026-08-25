import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { sha256 } from "../../lifecycle-core.mjs";
import {
  prepareVerifiedQoderJavaScriptExecution,
} from "../../qoder-acp-client.mjs";
import { terminateManagedProcess } from "../hosts/execution-host.mjs";
import {
  projectRootForRequest,
  readVerifiedRegularFile,
} from "../policies/execution-policy.mjs";

const FINALIZER_PATH = fileURLToPath(new URL("../../finalize-attempt.mjs", import.meta.url));
const FINALIZER_TIMEOUT_MS = 60_000;
const MAX_FINALIZER_OUTPUT_BYTES = 16 * 1024;

function finalizerError(code, message) {
  const error = new Error(message);
  error.name = "BridgeFinalizerError";
  error.code = code;
  return error;
}

async function fileIdentity(filePath) {
  const resolved = await realpath(filePath);
  const [information, bytes] = await Promise.all([lstat(resolved), readFile(resolved)]);
  if (!information.isFile() || information.isSymbolicLink() || information.nlink !== 1
    || (information.mode & 0o022) !== 0) {
    throw finalizerError("BRIDGE_FINALIZER_UNTRUSTED", "The fixed Bridge finalizer is untrusted.");
  }
  return Object.freeze({
    path: resolved,
    identity: Object.freeze({
      dev: information.dev,
      ino: information.ino,
      nlink: information.nlink,
      size: information.size,
      mtimeMs: information.mtimeMs,
      sha256: sha256(bytes),
    }),
  });
}

function assertFixedInvocation(policy) {
  const projectRoot = projectRootForRequest(policy.requestRoot, policy.requestId);
  const expected = [
    FINALIZER_PATH,
    "--project-root",
    projectRoot,
    "--request-id",
    policy.requestId,
    "--attempt-id",
    policy.attemptId,
  ];
  if (policy.finalizer.args.length !== expected.length
    || policy.finalizer.args.some((value, index) => value !== expected[index])
    || policy.finalizer.cwd !== policy.requestRoot
    || Object.keys(policy.finalizer.env).some((name) => name !== "ELECTRON_RUN_AS_NODE")) {
    throw finalizerError(
      "BRIDGE_FINALIZER_INVOCATION_INVALID",
      "The Bridge finalizer invocation is not the fixed Stemmio command.",
    );
  }
  return expected;
}

function waitForFinalizer(child, cancellationSignal) {
  return new Promise((resolve, reject) => {
    let bytes = 0;
    let settled = false;
    const finish = (operation) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      cancellationSignal?.removeEventListener("abort", abort);
      operation();
    };
    const append = (chunk) => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > MAX_FINALIZER_OUTPUT_BYTES) {
        finish(() => reject(finalizerError(
          "BRIDGE_FINALIZER_OUTPUT_TOO_LARGE",
          "The Bridge finalizer exceeded its output budget.",
        )));
      }
    };
    const abort = () => finish(() => reject(
      finalizerError("AGENT_CANCELLED", "The Agent Attempt was cancelled before finalization."),
    ));
    const timeout = setTimeout(() => finish(() => reject(
      finalizerError("BRIDGE_FINALIZER_TIMEOUT", "The Bridge finalizer timed out."),
    )), FINALIZER_TIMEOUT_MS);
    timeout.unref?.();
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
    child.once("error", () => finish(() => reject(
      finalizerError("BRIDGE_FINALIZER_START_FAILED", "The Bridge finalizer could not start."),
    )));
    child.once("close", (exitCode, signal) => finish(() => {
      if (exitCode === 0 && !signal) resolve();
      else reject(finalizerError("BRIDGE_FINALIZER_FAILED", "The Bridge finalizer failed."));
    }));
    if (cancellationSignal?.aborted) abort();
    else cancellationSignal?.addEventListener("abort", abort, { once: true });
  });
}

async function verifyCompletion(policy) {
  const [output, completionFile] = await Promise.all([
    readVerifiedRegularFile(policy.outputPath, policy.requestRoot, "Bridge-finalized Candidate"),
    readVerifiedRegularFile(policy.completionPath, policy.requestRoot, "Bridge completion evidence"),
  ]);
  let completion;
  try {
    completion = JSON.parse(completionFile.bytes.toString("utf8"));
  } catch {
    throw finalizerError("BRIDGE_COMPLETION_INVALID", "Bridge completion evidence is invalid.");
  }
  const projectRoot = projectRootForRequest(policy.requestRoot, policy.requestId);
  const relativeOutput = path.relative(
    path.join(projectRoot, ".pageroot"),
    policy.outputPath,
  ).split(path.sep).join("/");
  const outputSha256 = sha256(output.bytes);
  if (completion?.projectId !== policy.projectId
    || completion?.documentId !== policy.documentId
    || completion?.requestId !== policy.requestId
    || completion?.attemptId !== policy.attemptId
    || completion?.inputManifestSha256 !== policy.inputManifestSha256
    || completion?.outputRelativePath !== relativeOutput
    || completion?.outputSha256 !== outputSha256
    || !["completed", "no-change"].includes(completion?.status)) {
    throw finalizerError(
      "BRIDGE_COMPLETION_IDENTITY_MISMATCH",
      "Bridge completion evidence does not match the frozen Agent Attempt.",
    );
  }
  return Object.freeze({ status: completion.status, outputSha256 });
}

export async function runBridgeFinalizer({
  policy,
  cancellationSignal,
  onEvent = () => {},
} = {}) {
  if (cancellationSignal?.aborted) {
    throw finalizerError("AGENT_CANCELLED", "The Agent Attempt was cancelled before finalization.");
  }
  assertFixedInvocation(policy);
  if (policy.finalizer.command !== await realpath(process.execPath)) {
    throw finalizerError(
      "BRIDGE_FINALIZER_RUNTIME_INVALID",
      "The Bridge finalizer runtime is not the current verified executable.",
    );
  }
  const executable = await fileIdentity(FINALIZER_PATH);
  const prepared = await prepareVerifiedQoderJavaScriptExecution({
    command: executable.path,
    expectedExecutable: executable,
    environment: {},
    baseEnvironment: process.env,
    requireExecutable: false,
  });
  const processGroup = process.platform !== "win32";
  let child;
  try {
    child = await prepared.spawn({
      args: policy.finalizer.args.slice(1),
      cwd: policy.finalizer.cwd,
      detached: processGroup,
      stdin: "ignore",
    });
    onEvent(Object.freeze({ kind: "bridge-finalizer-started" }));
    await waitForFinalizer(child, cancellationSignal);
  } finally {
    if (child) {
      const cleanup = await terminateManagedProcess(child, { processGroup }).catch(() => false);
      if (!cleanup) {
        throw finalizerError(
          "AGENT_PROCESS_CLEANUP_UNCONFIRMED",
          "The Bridge finalizer process group could not be confirmed stopped.",
        );
      }
    } else {
      await prepared.close();
    }
  }
  const completion = await verifyCompletion(policy);
  onEvent(Object.freeze({ kind: "completion-verified", status: completion.status }));
  return completion;
}
