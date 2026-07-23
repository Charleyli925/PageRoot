import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  lstat,
  readFile,
  readlink,
  realpath,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const productRoot = path.resolve(path.dirname(scriptPath), "..");
const DEFAULT_BASE = "origin/main";
const TASK_BRANCH = /^(?:agent|feature|fix|docs|test|refactor|chore|recovery)\/[a-z0-9](?:[a-z0-9._/-]*[a-z0-9])?$/u;

function splitNullSeparated(value) {
  return value.split("\0").filter(Boolean);
}

async function runCapture(root, command, args, { allowFailure = false } = {}) {
  const child = spawn(command, args, {
    cwd: root,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout = [];
  const stderr = [];
  child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
  child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (exitCode, signal) => {
      if (signal) reject(new Error(`${command} ended by ${signal}.`));
      else resolve(exitCode ?? 1);
    });
  });
  const result = {
    code,
    stdout: Buffer.concat(stdout).toString("utf8"),
    stderr: Buffer.concat(stderr).toString("utf8"),
  };
  if (code !== 0 && !allowFailure) {
    const detail = result.stderr.trim() || result.stdout.trim() || `exit ${code}`;
    throw new Error(`${command} ${args.join(" ")} failed: ${detail}`);
  }
  return result;
}

async function runInherited(root, command, args) {
  const child = spawn(command, args, {
    cwd: root,
    env: process.env,
    stdio: "inherit",
  });
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (exitCode, signal) => {
      if (signal) reject(new Error(`${command} ended by ${signal}.`));
      else resolve(exitCode ?? 1);
    });
  });
  if (code !== 0) throw new Error(`${command} ${args.join(" ")} failed with exit ${code}.`);
}

async function git(root, args, options) {
  return runCapture(root, "git", args, options);
}

async function assertRepositoryRoot(root) {
  const result = await git(root, ["rev-parse", "--show-toplevel"]);
  const [actual, expected] = await Promise.all([
    realpath(result.stdout.trim()),
    realpath(root),
  ]);
  if (actual !== expected) {
    throw new Error(`Run this command at the PageRoot Git root. Expected ${expected}, found ${actual}.`);
  }
}

async function refExists(root, ref) {
  const result = await git(root, ["show-ref", "--verify", "--quiet", ref], { allowFailure: true });
  if (result.code !== 0 && result.code !== 1) {
    throw new Error(`Unable to inspect Git ref ${ref}.`);
  }
  return result.code === 0;
}

async function changedFiles(root, base) {
  const commands = [
    ["diff", "--name-only", "-z"],
    ["diff", "--cached", "--name-only", "-z"],
    ["ls-files", "--others", "--exclude-standard", "-z"],
  ];
  if (base) commands.unshift(["diff", "--name-only", "-z", `${base}...HEAD`]);
  const results = await Promise.all(commands.map((args) => git(root, args, { allowFailure: true })));
  const files = new Set();
  for (const result of results) {
    if (result.code === 0) splitNullSeparated(result.stdout).forEach((file) => files.add(file));
  }
  return [...files].sort();
}

async function readVersion(root) {
  try {
    const value = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
    return typeof value.version === "string" ? value.version : null;
  } catch {
    return null;
  }
}

export function validateTaskBranchName(value) {
  const branch = String(value || "").trim();
  const unsafe = branch.includes("//")
    || branch.includes("..")
    || branch.includes("@{")
    || /(?:^|\/)\./u.test(branch)
    || branch.endsWith(".lock");
  if (!TASK_BRANCH.test(branch) || unsafe) {
    throw new Error(
      "Branch must be lowercase and start with agent/, feature/, fix/, docs/, test/, "
      + "refactor/, chore/ or recovery/; example: fix/preserve-selection.",
    );
  }
  return branch;
}

export function parseTaskArguments(argv) {
  const args = [...argv];
  const command = args.shift() || "status";
  if (!["status", "start", "finish"].includes(command)) {
    throw new Error("Task command must be status, start or finish.");
  }
  const options = {
    command,
    base: DEFAULT_BASE,
    branch: command === "start" ? args.shift() || "" : null,
    json: false,
  };
  while (args.length > 0) {
    const argument = args.shift();
    if (argument === "--base") {
      throw new Error("Task workflow base is fixed to origin/main.");
    } else if (argument === "--json") options.json = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (options.json && command !== "status") {
    throw new Error("--json is supported only by task:status.");
  }
  if (command === "start") options.branch = validateTaskBranchName(options.branch);
  return options;
}

async function repositoryStateFingerprint(root) {
  const [
    headResult,
    unstagedResult,
    stagedResult,
    untrackedResult,
  ] = await Promise.all([
    git(root, ["rev-parse", "HEAD"]),
    git(root, ["diff", "--binary", "--no-ext-diff", "--"]),
    git(root, ["diff", "--cached", "--binary", "--no-ext-diff", "HEAD", "--"]),
    git(root, ["ls-files", "--others", "--exclude-standard", "-z"]),
  ]);
  const hash = createHash("sha256");
  hash.update("head\0");
  hash.update(headResult.stdout);
  hash.update("\0unstaged\0");
  hash.update(unstagedResult.stdout);
  hash.update("\0staged\0");
  hash.update(stagedResult.stdout);
  for (const file of splitNullSeparated(untrackedResult.stdout).sort()) {
    const absolute = path.resolve(root, file);
    if (!absolute.startsWith(`${root}${path.sep}`)) {
      throw new Error(`Untracked path escapes the repository: ${file}.`);
    }
    hash.update("\0untracked\0");
    hash.update(file);
    const info = await lstat(absolute).catch(() => null);
    if (!info) {
      hash.update("\0missing");
    } else if (info.isSymbolicLink()) {
      hash.update(`\0symlink:${info.mode.toString(8)}\0`);
      hash.update(await readlink(absolute));
    } else if (info.isFile()) {
      hash.update(`\0file:${info.mode.toString(8)}\0`);
      hash.update(await readFile(absolute));
    } else {
      hash.update(`\0other:${info.mode.toString(8)}`);
    }
  }
  return hash.digest("hex");
}

export async function repositoryReport(root, { base = DEFAULT_BASE } = {}) {
  await assertRepositoryRoot(root);
  const [
    branchResult,
    headResult,
    statusResult,
    upstreamResult,
    divergenceResult,
    remoteResult,
    files,
    version,
  ] = await Promise.all([
    git(root, ["branch", "--show-current"]),
    git(root, ["rev-parse", "HEAD"]),
    git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
    git(root, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], { allowFailure: true }),
    git(root, ["rev-list", "--left-right", "--count", `${base}...HEAD`], { allowFailure: true }),
    git(root, ["remote", "get-url", "origin"], { allowFailure: true }),
    changedFiles(root, base),
    readVersion(root),
  ]);
  const branch = branchResult.stdout.trim();
  if (!branch) throw new Error("Detached HEAD is not a supported task checkout.");
  let behind = null;
  let ahead = null;
  if (divergenceResult.code === 0) {
    const values = divergenceResult.stdout.trim().split(/\s+/u).map(Number);
    [behind, ahead] = values;
  }
  return {
    schemaVersion: 1,
    repository: await realpath(root),
    remote: remoteResult.code === 0 ? remoteResult.stdout.trim() : null,
    version,
    branch,
    head: headResult.stdout.trim(),
    upstream: upstreamResult.code === 0 ? upstreamResult.stdout.trim() : null,
    base,
    ahead,
    behind,
    clean: statusResult.stdout.length === 0,
    changedFiles: files,
  };
}

export function formatTaskReport(report) {
  const divergence = report.ahead === null
    ? `unavailable against ${report.base}`
    : `${report.ahead} ahead / ${report.behind} behind ${report.base}`;
  const lines = [
    "PageRoot task report",
    `- repository: ${report.repository}`,
    `- remote: ${report.remote || "unavailable"}`,
    `- version: ${report.version || "unavailable"}`,
    `- branch: ${report.branch}`,
    `- head: ${report.head}`,
    `- upstream: ${report.upstream || "none"}`,
    `- divergence: ${divergence}`,
    `- worktree: ${report.clean ? "clean" : "dirty"}`,
    `- changed files: ${report.changedFiles.length}`,
  ];
  for (const file of report.changedFiles) lines.push(`  - ${file}`);
  if (report.verification) {
    lines.push(`- verification: ${report.verification.status} (${report.verification.command})`);
  }
  return lines.join("\n");
}

export async function startTask({
  root = productRoot,
  branch,
  fetch = true,
} = {}) {
  const base = DEFAULT_BASE;
  const taskBranch = validateTaskBranchName(branch);
  await assertRepositoryRoot(root);
  const before = await repositoryReport(root, { base });
  if (!before.clean) throw new Error("Refusing to start: the worktree is dirty.");
  if (before.branch !== "main") {
    throw new Error(`Refusing to start from ${before.branch}; switch to clean main first.`);
  }
  const refCheck = await git(root, ["check-ref-format", "--branch", taskBranch], { allowFailure: true });
  if (refCheck.code !== 0) throw new Error(`Git rejected branch name ${taskBranch}.`);
  if (fetch) await runInherited(root, "git", ["fetch", "--prune", "origin"]);
  await runInherited(root, "git", ["merge", "--ff-only", base]);
  const synchronized = await repositoryReport(root, { base });
  if (!synchronized.clean || synchronized.branch !== "main") {
    throw new Error("Repository changed while synchronizing main.");
  }
  if (synchronized.ahead !== 0 || synchronized.behind !== 0) {
    throw new Error(`Local main is not identical to ${base}; resolve divergence before starting.`);
  }
  if (await refExists(root, `refs/heads/${taskBranch}`)) {
    throw new Error(`Local branch already exists: ${taskBranch}.`);
  }
  if (await refExists(root, `refs/remotes/origin/${taskBranch}`)) {
    throw new Error(`Remote branch already exists: origin/${taskBranch}.`);
  }
  await runInherited(root, "git", ["switch", "-c", taskBranch]);
  return repositoryReport(root, { base });
}

export async function finishTask({
  root = productRoot,
  runGate = (gateRoot, base) => runInherited(
    gateRoot,
    "npm",
    ["run", "gate:task", "--", "--base", base],
  ),
} = {}) {
  const base = DEFAULT_BASE;
  const before = await repositoryReport(root, { base });
  if (before.branch === "main") throw new Error("Refusing to finish a task directly on main.");
  if (before.changedFiles.length === 0) {
    throw new Error(`No task changes were found against ${base}.`);
  }
  const beforeGate = await repositoryStateFingerprint(root);
  await runGate(root, base);
  const afterGate = await repositoryStateFingerprint(root);
  const report = await repositoryReport(root, { base });
  const afterReport = await repositoryStateFingerprint(root);
  if (beforeGate !== afterGate || beforeGate !== afterReport) {
    throw new Error(
      "Repository source changed while the task gate was running. "
      + "Review the new state and rerun npm run task:finish.",
    );
  }
  return {
    ...report,
    verification: {
      command: `npm run gate:task -- --base ${base}`,
      status: "passed",
    },
  };
}

async function main() {
  const options = parseTaskArguments(process.argv.slice(2));
  let report;
  if (options.command === "start") {
    report = await startTask({
      root: productRoot,
      branch: options.branch,
    });
  } else if (options.command === "finish") {
    report = await finishTask({
      root: productRoot,
    });
  } else {
    report = await repositoryReport(productRoot, { base: options.base });
  }
  console.log(options.json ? JSON.stringify(report, null, 2) : formatTaskReport(report));
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
