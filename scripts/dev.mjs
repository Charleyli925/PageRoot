import { spawn } from "node:child_process";

const children = [];

function start(command, args, label) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: process.env,
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
