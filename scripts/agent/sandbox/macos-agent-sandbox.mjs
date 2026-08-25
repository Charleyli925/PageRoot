import path from "node:path";

function sandboxString(value) {
  return `"${String(value).replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")}"`;
}

function literal(filePath) {
  return `(literal ${sandboxString(path.resolve(filePath))})`;
}

function subpath(filePath) {
  return `(subpath ${sandboxString(path.resolve(filePath))})`;
}

export function macosAgentSandboxProfile({
  runtime,
  codexBinary,
  packageRoot,
  contextRoot,
  stateRoot,
  authFile = null,
  allowOutputRoot = null,
} = {}) {
  if (process.platform !== "darwin") {
    throw Object.assign(new Error("The pinned Codex sandbox is available only on macOS."), {
      code: "CODEX_SANDBOX_PLATFORM_UNSUPPORTED",
    });
  }
  for (const [value, label] of [
    [runtime, "runtime"],
    [codexBinary, "Codex binary"],
    [packageRoot, "package root"],
    [contextRoot, "context root"],
    [stateRoot, "state root"],
  ]) {
    if (typeof value !== "string" || !path.isAbsolute(value)) {
      throw new TypeError(`Codex sandbox ${label} must be absolute.`);
    }
  }
  const readable = [
    literal(runtime),
    literal(codexBinary),
    subpath(packageRoot),
    subpath(contextRoot),
    subpath(stateRoot),
  ];
  if (authFile) readable.push(literal(authFile));
  const writable = [subpath(stateRoot)];
  if (allowOutputRoot) writable.push(subpath(allowOutputRoot));
  return [
    "(version 1)",
    "(deny default)",
    "(import \"system.sb\")",
    "(allow process-fork)",
    "(allow file-read-metadata)",
    `(allow process-exec ${literal(runtime)})`,
    `(allow process-exec ${literal(codexBinary)})`,
    ...readable.map((filter) => `(allow file-read* ${filter})`),
    ...writable.map((filter) => `(allow file-write* ${filter})`),
    // Codex model transport needs DNS plus bidirectional socket bookkeeping.
    // Tool networking remains unavailable because every tool/subprocess entry
    // point is disabled in config and process-exec is restricted to the two
    // verified runtime binaries above.
    "(allow network*)",
    "(allow mach*)",
    "(allow ipc*)",
    "(allow sysctl*)",
  ].join(" ");
}
