import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const sourceRuntimeRoot = mkdtempSync(path.join(tmpdir(), "stemmio-source-dev-"));
const developmentEnvironment = {
  ...process.env,
  STEMMIO_RUNTIME_CHANNEL: "source",
  STEMMIO_WORKSPACE: process.env.STEMMIO_WORKSPACE || path.join(sourceRuntimeRoot, "workspace"),
  STEMMIO_PROJECT_FILES_ROOT: process.env.STEMMIO_PROJECT_FILES_ROOT || path.join(sourceRuntimeRoot, "project-files"),
  STEMMIO_AGENTS_ROOT: process.env.STEMMIO_AGENTS_ROOT || path.join(sourceRuntimeRoot, "agents"),
};

const children = [];

function start(command, args, label) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: developmentEnvironment,
    stdio: "inherit",
  });
  children.push(child);
  child.on("exit", (code, signal) => {
    if (signal || code === 0) return;
    console.error(`${label} exited with code ${code}`);
    shutdown(code ?? 1);
  });
}

function shutdown(code = 0) {
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  setTimeout(() => process.exit(code), 80).unref();
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

start(process.execPath, ["bridge/workspace-bridge.mjs"], "workspace bridge");
start("npm", ["exec", "--", "vinext", "dev"], "vinext");
