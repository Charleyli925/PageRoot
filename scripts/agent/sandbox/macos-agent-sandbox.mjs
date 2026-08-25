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
  codeModeHost = null,
  packageRoot,
  contextRoot,
  stateRoot,
  authFile = null,
  allowOutputRoot = null,
  allowToolProcesses = false,
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
  if (codeModeHost !== null && (typeof codeModeHost !== "string" || !path.isAbsolute(codeModeHost))) {
    throw new TypeError("Codex sandbox code-mode host must be absolute.");
  }
  const readable = [
    literal(runtime),
    literal(codexBinary),
    subpath(packageRoot),
    subpath(contextRoot),
  ];
  const codexProcess = `(process-path ${sandboxString(path.resolve(codexBinary))})`;
  const codeModeHostProcess = codeModeHost
    ? `(process-path ${sandboxString(path.resolve(codeModeHost))})`
    : null;
  const toolExecutables = [
    "/bin/zsh",
    "/bin/bash",
    "/bin/sh",
    "/usr/bin/env",
    "/bin/cat",
    "/bin/cp",
    "/bin/ls",
    "/bin/mkdir",
    "/bin/mv",
    "/bin/pwd",
    "/bin/rm",
    "/usr/bin/awk",
    "/usr/bin/find",
    "/usr/bin/grep",
    "/usr/bin/head",
    "/usr/bin/sed",
    "/usr/bin/tail",
    "/usr/bin/tee",
    "/usr/bin/touch",
    "/usr/bin/tr",
    "/usr/bin/wc",
  ].map((filePath) => path.resolve(filePath));
  return [
    "(version 1)",
    "(deny default)",
    "(import \"system.sb\")",
    "(allow process-fork)",
    "(allow signal (target children))",
    "(allow file-read-metadata)",
    `(with-filter (process-path ${sandboxString("/usr/bin/sandbox-exec")})`
      + ` (allow process-exec ${literal(runtime)}))`,
    `(with-filter (process-path ${sandboxString(path.resolve(runtime))})`
      + ` (allow process-exec ${literal(codexBinary)}))`,
    ...(codeModeHost
      ? [
        `(with-filter ${codexProcess} (allow process-exec ${literal(codeModeHost)}))`,
        `(with-filter ${codeModeHostProcess}`
          + ` (allow process-exec ${literal("/usr/bin/sandbox-exec")}))`,
      ]
      : []),
    ...(allowToolProcesses
      ? toolExecutables.map((filePath) => `(allow process-exec ${literal(filePath)})`)
      : []),
    ...readable.map((filter) => `(allow file-read* ${filter})`),
    ...(codeModeHost ? [
      `(allow file-read* ${literal(codeModeHost)})`,
      `(allow file-read* ${literal("/usr/bin/sandbox-exec")})`,
    ] : []),
    ...(allowToolProcesses
      ? [
        ...toolExecutables.map((filePath) => `(allow file-read* ${literal(filePath)})`),
        `(allow file-read* ${subpath("/bin")})`,
        `(allow file-read* ${subpath("/usr/bin")})`,
        `(with-filter (process-path ${sandboxString("/bin/zsh")})`
          + ` (allow file-read* ${subpath(path.join(stateRoot, "codex-home", "shell_snapshots"))}))`,
      ]
      : []),
    `(with-filter ${codexProcess} (allow file-read* ${subpath(stateRoot)}))`,
    ...(authFile
      ? [`(with-filter (process-path ${sandboxString(path.resolve(codexBinary))})`
        + ` (allow file-read* ${literal(authFile)}))`]
      : []),
    `(with-filter ${codexProcess} (allow file-write* ${subpath(stateRoot)}))`,
    ...(allowOutputRoot ? [`(allow file-write* ${subpath(allowOutputRoot)})`] : []),
    // Only the verified Codex binary receives model-transport network access.
    // Tool descendants have a different process path and remain network-denied.
    `(with-filter ${codexProcess} (allow network*))`,
    "(allow mach*)",
    "(allow ipc*)",
    "(allow sysctl*)",
  ].join(" ");
}
