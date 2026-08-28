import {
  access,
  constants as fsConstants,
  lstat,
  open,
  realpath,
} from "node:fs/promises";
import { spawn } from "node:child_process";

import { sha256 } from "../../lifecycle-core.mjs";
import { assertAbsolutePath } from "../policies/execution-policy.mjs";
import { terminateManagedProcess } from "../hosts/execution-host.mjs";
import { acpPolicyError, acpProcessEnvironment } from "./acp-protocol.mjs";

const VERIFIED_ESM_LOADER_SOURCE = `
import { readFileSync } from "node:fs";
import { builtinModules, createRequire } from "node:module";
import { dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { SourceTextModule, SyntheticModule } from "node:vm";

const identifier = pathToFileURL(process.argv[1]).href;
const require = createRequire(identifier);
const builtins = new Set(builtinModules.map((name) => name.replace(/^node:/u, "")));
const resolveSpecifier = (specifier) => {
  if (specifier.startsWith("node:")) return specifier;
  if (builtins.has(specifier)) return "node:" + specifier;
  if (/^[a-zA-Z][a-zA-Z+.-]*:/u.test(specifier)) return specifier;
  if (specifier.startsWith(".") || specifier.startsWith("/")) {
    return new URL(specifier, identifier).href;
  }
  return pathToFileURL(require.resolve(specifier)).href;
};
const externalModules = new Map();
const linkExternal = async (specifier) => {
  const resolved = resolveSpecifier(specifier);
  if (!externalModules.has(resolved)) {
    externalModules.set(resolved, import(resolved).then((namespace) => {
      const names = Object.keys(namespace);
      return new SyntheticModule(names, function initialize() {
        for (const name of names) this.setExport(name, namespace[name]);
      }, { identifier: resolved });
    }));
  }
  return externalModules.get(resolved);
};
const module = new SourceTextModule(readFileSync(3, "utf8"), {
  identifier,
  initializeImportMeta(meta) {
    meta.url = identifier;
    meta.filename = fileURLToPath(identifier);
    meta.dirname = dirname(meta.filename);
    meta.resolve = (specifier) => resolveSpecifier(specifier);
  },
  importModuleDynamically: async (specifier) => {
    const dependency = await linkExternal(specifier);
    if (dependency.status === "unlinked") await dependency.link(() => {});
    if (dependency.status === "linked") await dependency.evaluate();
    return dependency;
  },
});
await module.link(linkExternal);
await module.evaluate();
`;

function sameFileIdentity(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.nlink === right.nlink
    && left.size === right.size;
}

function sameExecutableIdentity(left, right) {
  return Boolean(
    left
    && right
    && left.dev === right.dev
    && left.ino === right.ino
    && left.nlink === right.nlink
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.sha256 === right.sha256,
  );
}

async function readHandleAtStart(handle, size) {
  if (!Number.isSafeInteger(size) || size < 0) {
    throw acpPolicyError(
      "ACP_AGENT_EXECUTABLE_CHANGED",
      "The ACP Agent executable size is invalid.",
    );
  }
  const bytes = Buffer.allocUnsafe(size);
  let offset = 0;
  while (offset < size) {
    const result = await handle.read(bytes, offset, size - offset, offset);
    if (result.bytesRead === 0) break;
    offset += result.bytesRead;
  }
  return bytes.subarray(0, offset);
}

export async function openVerifiedAgentExecutable(executable, expectedExecutable) {
  const expectedPath = assertAbsolutePath(expectedExecutable?.path, "expected ACP executable");
  if (executable !== expectedPath) {
    throw acpPolicyError(
      "ACP_AGENT_EXECUTABLE_CHANGED",
      "The ACP Agent executable path changed after PageRoot preflight.",
    );
  }
  const handle = await open(
    executable,
    fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0),
  ).catch(() => {
    throw acpPolicyError(
      "ACP_AGENT_EXECUTABLE_CHANGED",
      "The ACP Agent executable could not be reopened after PageRoot preflight.",
    );
  });
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1 || (before.mode & 0o022) !== 0) {
      throw acpPolicyError(
        "ACP_AGENT_EXECUTABLE_CHANGED",
        "The ACP Agent executable is no longer a protected regular file.",
      );
    }
    const bytes = await readHandleAtStart(handle, before.size);
    const after = await handle.stat();
    const identity = {
      dev: after.dev,
      ino: after.ino,
      nlink: after.nlink,
      size: after.size,
      mtimeMs: after.mtimeMs,
      sha256: sha256(bytes),
    };
    if (
      !sameFileIdentity(before, after)
      || bytes.byteLength !== after.size
      || !sameExecutableIdentity(identity, expectedExecutable.identity)
    ) {
      throw acpPolicyError(
        "ACP_AGENT_EXECUTABLE_CHANGED",
        "The ACP Agent executable identity changed after PageRoot preflight.",
      );
    }
    return handle;
  } catch (cause) {
    await handle.close().catch(() => {});
    throw cause;
  }
}

async function trustedCurrentJavaScriptRuntime() {
  const runtime = await realpath(process.execPath).catch(() => {
    throw acpPolicyError(
      "ACP_AGENT_RUNTIME_INVALID",
      "The trusted PageRoot JavaScript runtime is unavailable.",
    );
  });
  const information = await lstat(runtime).catch(() => null);
  if (!information?.isFile() || information.isSymbolicLink()) {
    throw acpPolicyError(
      "ACP_AGENT_RUNTIME_INVALID",
      "The trusted PageRoot JavaScript runtime is invalid.",
    );
  }
  await access(runtime, fsConstants.X_OK).catch(() => {
    throw acpPolicyError(
      "ACP_AGENT_RUNTIME_INVALID",
      "The trusted PageRoot JavaScript runtime is not executable.",
    );
  });
  return runtime;
}

export async function prepareVerifiedJavaScriptExecution({
  command,
  expectedExecutable,
  environment = {},
  baseEnvironment = process.env,
} = {}) {
  const requestedExecutable = assertAbsolutePath(command, "ACP JavaScript command");
  const executable = await realpath(requestedExecutable).catch(() => {
    throw acpPolicyError("ACP_AGENT_EXECUTABLE_INVALID", "The ACP Agent executable is unavailable.");
  });
  const executableInformation = await lstat(executable);
  if (!executableInformation.isFile() || executableInformation.isSymbolicLink()) {
    throw acpPolicyError(
      "ACP_AGENT_EXECUTABLE_INVALID",
      "The ACP Agent executable must resolve to a regular file.",
    );
  }
  await access(executable, fsConstants.X_OK).catch(() => {
    throw acpPolicyError("ACP_AGENT_EXECUTABLE_INVALID", "The ACP Agent executable is not executable.");
  });
  const executableHandle = await openVerifiedAgentExecutable(executable, expectedExecutable);
  let consumed = false;
  try {
    const runtime = await trustedCurrentJavaScriptRuntime();
    const childEnvironment = acpProcessEnvironment(environment, baseEnvironment);
    if (process.versions.electron) {
      childEnvironment.ELECTRON_RUN_AS_NODE = "1";
    }
    return Object.freeze({
      executable,
      async spawn({ args = [], cwd, detached = false, stdin = "pipe" } = {}) {
        if (consumed) {
          throw acpPolicyError(
            "ACP_AGENT_EXECUTION_CONSUMED",
            "The verified JavaScript execution descriptor has already been consumed.",
          );
        }
        consumed = true;
        try {
          return spawn(runtime, [
            "--no-warnings",
            "--experimental-vm-modules",
            "--input-type=module",
            "--eval",
            VERIFIED_ESM_LOADER_SOURCE,
            "--",
            executable,
            ...args,
          ], {
            cwd,
            env: childEnvironment,
            detached,
            shell: false,
            stdio: [stdin, "pipe", "pipe", executableHandle.fd],
          });
        } finally {
          await executableHandle.close().catch(() => {});
        }
      },
      async close() {
        if (consumed) return;
        consumed = true;
        await executableHandle.close().catch(() => {});
      },
    });
  } catch (cause) {
    await executableHandle.close().catch(() => {});
    throw cause;
  }
}

export async function runVerifiedJavaScript({
  command,
  expectedExecutable,
  args = [],
  cwd,
  environment = {},
  baseEnvironment = process.env,
  timeoutMs = 30_000,
  maxBuffer = 128 * 1024,
  processTerminator = terminateManagedProcess,
} = {}) {
  if (typeof processTerminator !== "function") {
    throw new TypeError("Verified JavaScript process terminator must be a function.");
  }
  const prepared = await prepareVerifiedJavaScriptExecution({
    command,
    expectedExecutable,
    environment,
    baseEnvironment,
  });
  const processGroup = process.platform !== "win32";
  let child;
  try {
    child = await prepared.spawn({
      args,
      cwd,
      detached: processGroup,
      stdin: "ignore",
    });
  } catch (cause) {
    await prepared.close();
    throw cause;
  }

  const stdout = [];
  const stderr = [];
  let stdoutBytes = 0;
  let stderrBytes = 0;
  return new Promise((resolve, reject) => {
    let settled = false;
    let timeoutHandle;

    const cleanup = () => {
      clearTimeout(timeoutHandle);
      child.stdout?.off("data", handleStdout);
      child.stderr?.off("data", handleStderr);
      child.off("close", handleClose);
      child.off("error", handleError);
    };
    const output = () => ({
      stdout: Buffer.concat(stdout).toString("utf8"),
      stderr: Buffer.concat(stderr).toString("utf8"),
    });
    const fail = async (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      const cleanupConfirmed = await processTerminator(child, { processGroup }).then(
        (value) => value === true,
        () => false,
      );
      const failure = cleanupConfirmed
        ? error
        : acpPolicyError(
          "ACP_PREFLIGHT_CLEANUP_UNCONFIRMED",
          "The ACP preflight process group could not be confirmed stopped.",
        );
      Object.assign(failure, output());
      reject(failure);
    };
    const append = (target, chunk, currentBytes, label) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (currentBytes + bytes.byteLength > maxBuffer) {
        const error = new Error(`ACP ${label} exceeded the preflight output limit.`);
        error.code = "ERR_CHILD_PROCESS_STDIO_MAXBUFFER";
        void fail(error);
        return currentBytes;
      }
      target.push(bytes);
      return currentBytes + bytes.byteLength;
    };
    const handleStdout = (chunk) => {
      stdoutBytes = append(stdout, chunk, stdoutBytes, "stdout");
    };
    const handleStderr = (chunk) => {
      stderrBytes = append(stderr, chunk, stderrBytes, "stderr");
    };
    const handleError = (cause) => {
      void fail(cause instanceof Error ? cause : new Error(String(cause)));
    };
    const handleClose = async (exitCode, signal) => {
      if (settled) return;
      settled = true;
      cleanup();
      const captured = output();
      const cleanupConfirmed = await processTerminator(child, { processGroup }).then(
        (value) => value === true,
        () => false,
      );
      if (!cleanupConfirmed) {
        const error = acpPolicyError(
          "ACP_PREFLIGHT_CLEANUP_UNCONFIRMED",
          "The ACP preflight process group could not be confirmed stopped.",
        );
        Object.assign(error, captured);
        reject(error);
        return;
      }
      if (exitCode === 0) {
        resolve(captured);
        return;
      }
      const error = new Error(`ACP Agent exited with status ${exitCode ?? signal ?? "unknown"}.`);
      error.code = exitCode;
      error.signal = signal;
      Object.assign(error, captured);
      reject(error);
    };

    child.stdout?.on("data", handleStdout);
    child.stderr?.on("data", handleStderr);
    child.once("close", (...values) => {
      void handleClose(...values);
    });
    child.once("error", handleError);
    timeoutHandle = setTimeout(() => {
      const error = new Error("The ACP preflight command timed out.");
      error.code = "ETIMEDOUT";
      error.killed = true;
      void fail(error);
    }, timeoutMs);
    timeoutHandle.unref?.();
  });
}
