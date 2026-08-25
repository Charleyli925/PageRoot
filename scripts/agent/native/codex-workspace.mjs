import {
  chmod,
  constants as fsConstants,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  realpath,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { requireCompleteHtml, sha256 } from "../../lifecycle-core.mjs";
import {
  MAX_HTML_BYTES,
  MAX_PROMPT_BYTES,
  assertRuntimeProcessingAuthority,
  readVerifiedRegularFile,
  verifiedOutputParent,
} from "../policies/execution-policy.mjs";
import {
  macosAgentSandboxProfile,
  packagedRuntimeReadRoot,
} from "../sandbox/macos-agent-sandbox.mjs";

function nativeError(code, message) {
  const error = new Error(message);
  error.name = "CodexNativeWorkspaceError";
  error.code = code;
  return error;
}

function safeRelative(value) {
  const relative = String(value || "");
  const parts = relative.split("/");
  if (!relative || path.isAbsolute(relative) || relative.includes("\\")
    || parts.some((part) => !part || part === "." || part === "..")) {
    throw nativeError("CODEX_NATIVE_INPUT_PATH_INVALID", "A frozen input path is unsafe.");
  }
  return parts;
}

async function existingAuthFile(baseEnvironment) {
  const codexHome = baseEnvironment?.CODEX_HOME
    || (baseEnvironment?.HOME ? path.join(baseEnvironment.HOME, ".codex") : null);
  if (!codexHome) return null;
  const candidate = path.join(codexHome, "auth.json");
  const information = await lstat(candidate).catch(() => null);
  return information?.isFile() && !information.isSymbolicLink()
    ? realpath(candidate)
    : null;
}

async function runtimeState(root, baseEnvironment) {
  const stateRoot = path.join(root, "runtime-state");
  const codexHome = path.join(stateRoot, "codex-home");
  const homeRoot = path.join(stateRoot, "home");
  const temporaryRoot = path.join(stateRoot, "tmp");
  await Promise.all([
    mkdir(codexHome, { recursive: true, mode: 0o700 }),
    mkdir(homeRoot, { recursive: true, mode: 0o700 }),
    mkdir(temporaryRoot, { recursive: true, mode: 0o700 }),
  ]);
  const authFile = await existingAuthFile(baseEnvironment);
  if (authFile) await symlink(authFile, path.join(codexHome, "auth.json"));
  return Object.freeze({
    stateRoot,
    authFile,
    environment: Object.freeze({
      ...(baseEnvironment || {}),
      HOME: homeRoot,
      CODEX_HOME: codexHome,
      TMPDIR: temporaryRoot,
      XDG_CACHE_HOME: path.join(stateRoot, "cache"),
      XDG_CONFIG_HOME: path.join(stateRoot, "config"),
      XDG_DATA_HOME: path.join(stateRoot, "data"),
    }),
  });
}

async function copyFrozenInputs(policy, inputRoot) {
  const copied = [];
  for (const readable of policy.readableFiles) {
    const relative = safeRelative(readable.relativePath);
    const workspaceRelative = relative[0] === "input" ? relative.slice(1) : relative;
    const target = path.join(inputRoot, ...workspaceRelative);
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    const original = await readVerifiedRegularFile(
      readable.path,
      policy.requestRoot,
      `Frozen input ${readable.relativePath}`,
    );
    if (sha256(original.bytes) !== readable.sha256) {
      throw nativeError("CODEX_FROZEN_INPUT_DRIFT", "A frozen Request input changed before launch.");
    }
    await writeFile(target, original.bytes, { flag: "wx", mode: 0o400 });
    copied.push(Object.freeze({
      ...readable,
      path: target,
      workspaceRelativePath: path.posix.join("input", ...workspaceRelative),
    }));
  }
  const directories = new Set(copied.flatMap((entry) => {
    const values = [];
    let current = path.dirname(entry.path);
    while (current !== inputRoot && current.startsWith(`${inputRoot}${path.sep}`)) {
      values.push(current);
      current = path.dirname(current);
    }
    return values;
  }));
  for (const directory of [...directories].sort((left, right) => right.length - left.length)) {
    await chmod(directory, 0o500);
  }
  await chmod(inputRoot, 0o500);
  return Object.freeze(copied);
}

function executionPrompt(policy, copied) {
  const sections = copied.map((entry) => [
    `<stemmio-frozen-input path=${JSON.stringify(entry.workspaceRelativePath)}`,
    ` role=${JSON.stringify(entry.role)} sha256=${JSON.stringify(entry.sha256)}`,
    ` byteLength=${entry.byteLength} />`,
  ].join(""));
  const prompt = [
    "Complete this single frozen Stemmio HTML task.",
    "Read every authoritative input listed below from the read-only input/ directory.",
    "Treat PROMPT.md and the frozen Request metadata as the instruction authority.",
    "Write exactly one complete HTML document to output/index.html.",
    "Do not write another path. Do not run or mention a finalizer.",
    "The Bridge will validate and finalize the result after your process tree stops.",
    `Request: ${policy.requestId}; Attempt: ${policy.attemptId}.`,
    "",
    ...sections,
  ].join("\n");
  if (Buffer.byteLength(prompt, "utf8") > MAX_PROMPT_BYTES) {
    throw nativeError(
      "CODEX_EXECUTION_CONTEXT_TOO_LARGE",
      "The Codex execution instruction manifest is too large.",
    );
  }
  return prompt;
}

export async function prepareCodexExecutionWorkspace(launch) {
  if (process.platform !== "darwin") {
    throw nativeError(
      "CODEX_SANDBOX_PLATFORM_UNSUPPORTED",
      "Codex execution requires the pinned macOS sandbox boundary.",
    );
  }
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "stemmio-codex-execution-")));
  const attemptRoot = path.join(root, "attempt-root");
  const inputRoot = path.join(attemptRoot, "input");
  const outputRoot = path.join(attemptRoot, "output");
  try {
    await Promise.all([
      mkdir(inputRoot, { recursive: true, mode: 0o700 }),
      mkdir(outputRoot, { recursive: true, mode: 0o700 }),
    ]);
    const copied = await copyFrozenInputs(launch.policy, inputRoot);
    const state = await runtimeState(root, launch.baseEnvironment);
    const packageRoot = path.resolve(path.dirname(launch.adapterEntry), "..", "..", "..");
    const runtime = await realpath(process.execPath);
    const sandboxProfileFactory = ({ codexBinary, codeModeHost }) => macosAgentSandboxProfile({
      runtime,
      runtimeReadRoot: packagedRuntimeReadRoot(runtime),
      codexBinary,
      codeModeHost,
      packageRoot,
      contextRoot: attemptRoot,
      stateRoot: state.stateRoot,
      authFile: state.authFile,
      allowOutputRoot: outputRoot,
      allowToolProcesses: true,
    });
    return Object.freeze({
      root,
      outputRoot,
      launch: Object.freeze({
        ...launch,
        cwd: attemptRoot,
        prompt: executionPrompt(launch.policy, copied),
        sandboxProfileFactory,
        baseEnvironment: state.environment,
      }),
    });
  } catch (cause) {
    await chmod(inputRoot, 0o700).catch(() => {});
    await rm(root, { recursive: true, force: true });
    throw cause;
  }
}

async function verifiedNativeOutput(outputRoot) {
  const entries = await readdir(outputRoot, { withFileTypes: true });
  if (entries.length !== 1 || entries[0].name !== "index.html" || !entries[0].isFile()) {
    throw nativeError(
      "CODEX_NATIVE_OUTPUT_INVALID",
      "Codex must produce exactly one output/index.html regular file.",
    );
  }
  const outputPath = path.join(outputRoot, "index.html");
  const handle = await open(outputPath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0));
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1 || before.size <= 0 || before.size > MAX_HTML_BYTES) {
      throw nativeError("CODEX_NATIVE_OUTPUT_UNSAFE", "Codex output is not a safe bounded file.");
    }
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
      || bytes.byteLength !== after.size) {
      throw nativeError("CODEX_NATIVE_OUTPUT_DRIFT", "Codex output changed while being verified.");
    }
    requireCompleteHtml(bytes.toString("utf8"), "Codex Candidate HTML");
    return Object.freeze({ bytes, sha256: sha256(bytes) });
  } finally {
    await handle.close();
  }
}

function sameObjectIdentity(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.nlink === right.nlink;
}

function sameDirectoryIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function sameIdentity(left, right) {
  return sameObjectIdentity(left, right) && left.size === right.size;
}

export async function publishCodexOutputThroughVerifiedHandle(
  outputPath,
  requestRoot,
  expectedParent,
  bytes,
  { beforeWrite } = {},
) {
  const handle = await open(
    outputPath,
    fsConstants.O_RDWR
      | fsConstants.O_CREAT
      | fsConstants.O_EXCL
      | (fsConstants.O_NOFOLLOW || 0),
    0o600,
  );
  let handleIdentity;
  try {
    handleIdentity = await handle.stat();
    if (!handleIdentity.isFile() || handleIdentity.nlink !== 1 || handleIdentity.size !== 0) {
      throw nativeError("CODEX_PUBLISHED_OUTPUT_UNSAFE", "The reserved Candidate output is unsafe.");
    }
    const openedParent = await verifiedOutputParent(outputPath, requestRoot);
    const pathIdentity = await lstat(outputPath);
    if (!sameDirectoryIdentity(openedParent.information, expectedParent.information)
      || !sameIdentity(pathIdentity, handleIdentity)) {
      throw nativeError(
        "CODEX_OUTPUT_DIRECTORY_DRIFT",
        "The Candidate output directory changed while its destination was reserved.",
      );
    }
    if (typeof beforeWrite === "function") await beforeWrite();
    const written = await handle.write(bytes, 0, bytes.byteLength, 0);
    if (written.bytesWritten !== bytes.byteLength) {
      throw nativeError("CODEX_PUBLISHED_OUTPUT_INCOMPLETE", "The Candidate output write was incomplete.");
    }
    await handle.sync();
    const after = await handle.stat();
    const afterParent = await verifiedOutputParent(outputPath, requestRoot);
    const afterPath = await lstat(outputPath);
    if (!sameDirectoryIdentity(afterParent.information, expectedParent.information)
      || !sameIdentity(afterPath, after) || after.size !== bytes.byteLength) {
      throw nativeError(
        "CODEX_PUBLISHED_OUTPUT_DRIFT",
        "The Candidate output path changed during publication.",
      );
    }
    const published = Buffer.allocUnsafe(after.size);
    const read = await handle.read(published, 0, after.size, 0);
    if (read.bytesRead !== after.size || sha256(published) !== sha256(bytes)) {
      throw nativeError("CODEX_PUBLISHED_OUTPUT_DRIFT", "Published Codex output bytes changed.");
    }
  } catch (cause) {
    if (handleIdentity) {
      await handle.truncate(0).catch(() => {});
      await handle.sync().catch(() => {});
      const current = await lstat(outputPath).catch(() => null);
      if (current && sameObjectIdentity(current, handleIdentity)) {
        await unlink(outputPath).catch(() => {});
      }
    }
    throw cause;
  } finally {
    await handle.close();
  }
}

export async function collectCodexExecutionOutput({
  workspace,
  cancellationSignal,
} = {}) {
  if (cancellationSignal?.aborted) {
    throw nativeError("AGENT_CANCELLED", "Codex execution was cancelled before output collection.");
  }
  const output = await verifiedNativeOutput(workspace.outputRoot);
  if (cancellationSignal?.aborted) {
    throw nativeError("AGENT_CANCELLED", "Codex execution was cancelled before output collection.");
  }
  return Object.freeze({
    outputSha256: output.sha256,
    outputBytes: Buffer.from(output.bytes),
  });
}

export async function publishCodexExecutionOutput({
  workspace,
  pendingCompletion,
  policy,
  cancellationSignal,
} = {}) {
  if (cancellationSignal?.aborted) {
    throw nativeError("AGENT_CANCELLED", "Codex execution was cancelled before output publication.");
  }
  const output = pendingCompletion || await collectCodexExecutionOutput({
    workspace,
    cancellationSignal,
  });
  if (!Buffer.isBuffer(output?.outputBytes)
    || output.outputSha256 !== sha256(output.outputBytes)) {
    throw nativeError("CODEX_NATIVE_OUTPUT_INVALID", "The collected Codex output is invalid.");
  }
  await assertRuntimeProcessingAuthority(policy);
  for (const readable of policy.readableFiles) {
    const current = await readVerifiedRegularFile(
      readable.path,
      policy.requestRoot,
      `Frozen input ${readable.relativePath}`,
    );
    if (sha256(current.bytes) !== readable.sha256) {
      throw nativeError("CODEX_FROZEN_INPUT_DRIFT", "A frozen Request input changed during execution.");
    }
  }
  const outputParent = await verifiedOutputParent(policy.outputPath, policy.requestRoot);
  const completionExists = await lstat(policy.completionPath).then(
    () => true,
    (cause) => cause?.code !== "ENOENT",
  );
  if (completionExists) {
    throw nativeError("CODEX_COMPLETION_PREEXISTS", "Completion evidence existed before Bridge finalization.");
  }
  if (cancellationSignal?.aborted) {
    throw nativeError("AGENT_CANCELLED", "Codex execution was cancelled before output publication.");
  }
  await publishCodexOutputThroughVerifiedHandle(
    policy.outputPath,
    policy.requestRoot,
    outputParent,
    output.outputBytes,
  );
  return Object.freeze({ outputSha256: output.outputSha256 });
}

export async function disposeCodexExecutionWorkspace(workspace) {
  const inputRoot = path.join(workspace.root, "attempt-root", "input");
  const makeWritable = async (directory) => {
    await chmod(directory, 0o700).catch(() => {});
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.isDirectory()) await makeWritable(path.join(directory, entry.name));
    }
  };
  await makeWritable(inputRoot);
  await rm(workspace.root, { recursive: true, force: true });
}
