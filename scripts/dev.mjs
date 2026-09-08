import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const sourceRuntimeRoot = mkdtempSync(path.join(tmpdir(), "pageroot-source-dev-"));
const developmentEnvironment = {
  ...process.env,
  PAGEROOT_RUNTIME_CHANNEL: "source",
  HTML_AI_RUNTIME_CHANNEL: "source",
  HTML_AI_WORKSPACE: process.env.HTML_AI_WORKSPACE || path.join(sourceRuntimeRoot, "workspace"),
  HTML_AI_PROJECT_FILES_ROOT: process.env.HTML_AI_PROJECT_FILES_ROOT || path.join(sourceRuntimeRoot, "project-files"),
  HTML_AI_AGENTS_ROOT: process.env.HTML_AI_AGENTS_ROOT || path.join(sourceRuntimeRoot, "agents"),
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
