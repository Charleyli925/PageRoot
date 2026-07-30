import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  lstat,
  mkdir,
  readFile,
  readlink,
  realpath,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const productRoot = path.resolve(path.dirname(scriptPath), "..");
const DEFAULT_BASE = "origin/main";
const DEFAULT_STALE_DAYS = 7;
const TASK_BRANCH = /^(?:agent|feature|fix|docs|test|integration|refactor|chore|recovery)\/[a-z0-9](?:[a-z0-9._/-]*[a-z0-9])?$/u;
const DEPENDABOT_BRANCH = /^dependabot\/[a-z0-9](?:[a-z0-9._/-]*[a-z0-9])?$/u;

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
    child.once("close", (exitCode, signal) => {
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
    child.once("close", (exitCode, signal) => {
      if (signal) reject(new Error(`${command} ended by ${signal}.`));
      else resolve(exitCode ?? 1);
    });
  });
  if (code !== 0) throw new Error(`${command} ${args.join(" ")} failed with exit ${code}.`);
}

async function git(root, args, options) {
  return runCapture(root, "git", args, options);
}

async function pathExists(target) {
  return Boolean(await lstat(target).catch(() => null));
}

async function assertRepositoryRoot(root) {
  const result = await git(root, ["rev-parse", "--show-toplevel"]);
  const [actual, expected] = await Promise.all([
    realpath(result.stdout.trim()),
    realpath(root),
  ]);
  if (actual !== expected) {
    throw new Error(`Run this command at a PageRoot worktree root. Expected ${expected}, found ${actual}.`);
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
      + "integration/, refactor/, chore/ or recovery/; example: fix/preserve-selection.",
    );
  }
  return branch;
}

export function validatePullRequestBranchName(value) {
  const branch = String(value || "").trim();
  if (branch === "main" || DEPENDABOT_BRANCH.test(branch)) return branch;
  return validateTaskBranchName(branch);
}

export function parseTaskArguments(argv) {
  const args = [...argv];
  const command = args.shift() || "status";
  if (!["status", "start", "attach", "finish", "audit", "retire", "sync-main", "policy"].includes(command)) {
    throw new Error("Task command must be status, start, attach, finish, audit, retire, sync-main or policy.");
  }
  const options = {
    command,
    base: DEFAULT_BASE,
    branch: ["start", "attach", "retire", "policy"].includes(command) ? args.shift() || "" : null,
    json: false,
    apply: false,
    abandon: false,
    discardChanges: false,
    deleteRemote: false,
    staleDays: DEFAULT_STALE_DAYS,
  };
  while (args.length > 0) {
    const argument = args.shift();
    if (argument === "--base") {
      throw new Error("Task workflow base is fixed to origin/main.");
    } else if (argument === "--json") options.json = true;
    else if (argument === "--apply") options.apply = true;
    else if (argument === "--abandon") options.abandon = true;
    else if (argument === "--discard-changes") options.discardChanges = true;
    else if (argument === "--delete-remote") options.deleteRemote = true;
    else if (argument === "--stale-days") {
      const value = Number(args.shift());
      if (!Number.isInteger(value) || value < 1) throw new Error("--stale-days must be a positive integer.");
      options.staleDays = value;
    } else throw new Error(`Unknown argument: ${argument}`);
  }
  if (["start", "attach"].includes(command)) options.branch = validateTaskBranchName(options.branch);
  if (command === "policy") options.branch = validatePullRequestBranchName(options.branch);
  if (command === "retire" && !options.branch) throw new Error("retire requires an exact local branch name.");
  if (options.json && !["status", "start", "attach", "audit", "retire", "sync-main"].includes(command)) {
    throw new Error("--json is not supported by this task command.");
  }
  if (options.apply && command !== "retire") throw new Error("--apply is supported only by task:retire.");
  if ((options.abandon || options.discardChanges || options.deleteRemote) && command !== "retire") {
    throw new Error("Destructive retirement flags are supported only by task:retire.");
  }
  if (options.discardChanges && !options.abandon) {
    throw new Error("--discard-changes requires --abandon.");
  }
  if (options.deleteRemote && !options.abandon) {
    throw new Error("--delete-remote requires --abandon.");
  }
  if (options.staleDays !== DEFAULT_STALE_DAYS && command !== "audit" && command !== "retire") {
    throw new Error("--stale-days is supported only by task:audit and task:retire.");
  }
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

export function parseWorktreePorcelain(value) {
  const entries = [];
  let current = null;
  for (const line of value.split(/\r?\n/u)) {
    if (!line) {
      if (current) entries.push(current);
      current = null;
      continue;
    }
    const space = line.indexOf(" ");
    const key = space === -1 ? line : line.slice(0, space);
    const field = space === -1 ? true : line.slice(space + 1);
    if (key === "worktree") {
      if (current) entries.push(current);
      current = {
        path: field,
        head: null,
        branch: null,
        detached: false,
        locked: false,
        prunable: false,
      };
    } else if (current && key === "HEAD") current.head = field;
    else if (current && key === "branch") current.branch = String(field).replace(/^refs\/heads\//u, "");
    else if (current && key === "detached") current.detached = true;
    else if (current && key === "locked") current.locked = field;
    else if (current && key === "prunable") current.prunable = field;
  }
  if (current) entries.push(current);
  return entries;
}

async function listWorktrees(root) {
  const result = await git(root, ["worktree", "list", "--porcelain"]);
  return parseWorktreePorcelain(result.stdout);
}

async function primaryWorktree(root) {
  const [primary] = await listWorktrees(root);
  if (!primary) throw new Error("Git did not report a primary worktree.");
  return primary;
}

async function assertPrimaryWorktree(root) {
  await assertRepositoryRoot(root);
  const primary = await primaryWorktree(root);
  const [actual, expected] = await Promise.all([realpath(root), realpath(primary.path)]);
  if (actual !== expected) {
    throw new Error(`Run this command from the primary PageRoot worktree: ${primary.path}`);
  }
  return primary;
}

export function standardWorktreePath(primaryPath, branch) {
  const taskBranch = validateTaskBranchName(branch);
  const container = path.resolve(path.dirname(primaryPath), ".codex-worktrees");
  const target = path.resolve(container, ...taskBranch.split("/"));
  if (!target.startsWith(`${container}${path.sep}`)) {
    throw new Error(`Task worktree path escapes ${container}.`);
  }
  return target;
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
    schemaVersion: 2,
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
  if (report.primaryWorktree) lines.push(`- primary worktree: ${report.primaryWorktree}`);
  if (report.worktreePath) lines.push(`- task worktree: ${report.worktreePath}`);
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
  const primary = await assertPrimaryWorktree(root);
  const before = await repositoryReport(root, { base });
  if (!before.clean) throw new Error("Refusing to start: the primary worktree is dirty.");
  if (before.branch !== "main") {
    throw new Error(`Refusing to start from ${before.branch}; synchronize the primary worktree to clean main first.`);
  }
  const refCheck = await git(root, ["check-ref-format", "--branch", taskBranch], { allowFailure: true });
  if (refCheck.code !== 0) throw new Error(`Git rejected branch name ${taskBranch}.`);
  if (fetch) await runInherited(root, "git", ["fetch", "--prune", "origin"]);
  await runInherited(root, "git", ["merge", "--ff-only", base]);
  const synchronized = await repositoryReport(root, { base });
  if (!synchronized.clean || synchronized.branch !== "main") {
    throw new Error("Primary worktree changed while synchronizing main.");
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
  const target = standardWorktreePath(primary.path, taskBranch);
  if (await pathExists(target)) throw new Error(`Task worktree path already exists: ${target}`);
  await mkdir(path.dirname(target), { recursive: true });
  await runInherited(root, "git", ["worktree", "add", "-b", taskBranch, target, base]);
  await git(target, ["branch", "--unset-upstream"], { allowFailure: true });
  return {
    ...(await repositoryReport(target, { base })),
    primaryWorktree: primary.path,
    worktreePath: target,
  };
}

export async function attachTask({
  root = productRoot,
  branch,
} = {}) {
  const taskBranch = validateTaskBranchName(branch);
  const primary = await assertPrimaryWorktree(root);
  const before = await repositoryReport(root);
  if (!before.clean || before.branch !== "main") {
    throw new Error("Attaching an existing branch requires a clean primary main worktree.");
  }
  if (!await refExists(root, `refs/heads/${taskBranch}`)) {
    throw new Error(`Local branch does not exist: ${taskBranch}.`);
  }
  const worktrees = await listWorktrees(root);
  const existing = worktrees.find((entry) => entry.branch === taskBranch);
  if (existing) throw new Error(`Branch ${taskBranch} is already checked out at ${existing.path}.`);
  const target = standardWorktreePath(primary.path, taskBranch);
  if (await pathExists(target)) throw new Error(`Task worktree path already exists: ${target}`);
  await mkdir(path.dirname(target), { recursive: true });
  await runInherited(root, "git", ["worktree", "add", target, taskBranch]);
  return {
    ...(await repositoryReport(target)),
    primaryWorktree: primary.path,
    worktreePath: target,
  };
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

function githubRepositoryFromRemote(remote) {
  const value = String(remote || "").trim();
  const match = value.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/u);
  return match ? `${match[1]}/${match[2]}` : null;
}

async function discoverPullRequests(root) {
  const remoteResult = await git(root, ["remote", "get-url", "origin"], { allowFailure: true });
  const repository = remoteResult.code === 0 ? githubRepositoryFromRemote(remoteResult.stdout) : null;
  if (!repository) return { available: false, repository: null, pullRequests: [] };
  try {
    const result = await runCapture(
      root,
      "gh",
      [
        "pr",
        "list",
        "--repo",
        repository,
        "--state",
        "all",
        "--limit",
        "200",
        "--json",
        "number,state,isDraft,mergedAt,closedAt,headRefName,baseRefName,updatedAt,url",
      ],
      { allowFailure: true },
    );
    if (result.code !== 0) return { available: false, repository, pullRequests: [] };
    return {
      available: true,
      repository,
      pullRequests: JSON.parse(result.stdout),
    };
  } catch {
    return { available: false, repository, pullRequests: [] };
  }
}

async function discoverRemoteBranches(root) {
  const result = await git(root, ["ls-remote", "--heads", "origin"], { allowFailure: true });
  if (result.code !== 0) return { available: false, branches: new Set() };
  const branches = new Set();
  for (const line of result.stdout.split(/\r?\n/u).filter(Boolean)) {
    const match = line.match(/\srefs\/heads\/(.+)$/u);
    if (match) branches.add(match[1]);
  }
  return { available: true, branches };
}

async function localBranches(root) {
  const result = await git(root, [
    "for-each-ref",
    "--sort=refname",
    "--format=%(refname:short)%00%(objectname)%00%(committerdate:iso-strict)%00%(upstream:short)",
    "refs/heads",
  ]);
  return result.stdout.split(/\r?\n/u).filter(Boolean).map((line) => {
    const [branch, head, committedAt, upstream] = line.split("\0");
    return { branch, head, committedAt, upstream: upstream || null };
  });
}

async function worktreeStatus(entry) {
  if (!await pathExists(entry.path)) {
    return { ...entry, present: false, clean: null, changedFiles: null };
  }
  const result = await git(entry.path, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  return {
    ...entry,
    present: true,
    clean: result.stdout.length === 0,
    changedFiles: splitNullSeparated(result.stdout).length,
  };
}

function newestPullRequestByBranch(pullRequests) {
  const values = new Map();
  for (const pullRequest of pullRequests) {
    const existing = values.get(pullRequest.headRefName);
    if (!existing || String(pullRequest.updatedAt) > String(existing.updatedAt)) {
      values.set(pullRequest.headRefName, pullRequest);
    }
  }
  return values;
}

function classifyBranch({
  branch,
  worktree,
  primaryPath,
  pullRequest,
  localOnly,
  ageDays,
  staleDays,
}) {
  if (worktree?.prunable || worktree?.present === false) return "STALE_REGISTRATION";
  if (worktree?.path === primaryPath && (branch !== "main" || !worktree.clean)) {
    return "PRIMARY_VIOLATION";
  }
  if (branch === "main") {
    if (!worktree) return "PRIMARY_MISSING";
    return worktree.path === primaryPath ? "PRIMARY" : "MAIN_OUTSIDE_PRIMARY";
  }
  if (worktree && !worktree.clean) return "ACTIVE_DIRTY";
  if (pullRequest?.state === "OPEN") return "ACTIVE_PR";
  if (pullRequest?.mergedAt) return "MERGED_READY";
  if (localOnly) return "LOCAL_ONLY";
  if (pullRequest?.state === "CLOSED") return "ABANDON_REVIEW";
  if (ageDays >= staleDays) return "ABANDON_REVIEW";
  return "ACTIVE_BRANCH";
}

export async function auditRepository({
  root = productRoot,
  staleDays = DEFAULT_STALE_DAYS,
  now = new Date(),
  pullRequests = null,
} = {}) {
  await assertRepositoryRoot(root);
  const worktreeEntries = await listWorktrees(root);
  const primary = worktreeEntries[0];
  if (!primary) throw new Error("Git did not report a primary worktree.");
  const [branches, inspectedWorktrees, discovered, remoteHeads] = await Promise.all([
    localBranches(root),
    Promise.all(worktreeEntries.map(worktreeStatus)),
    pullRequests === null
      ? discoverPullRequests(root)
      : Promise.resolve({ available: true, repository: null, pullRequests }),
    discoverRemoteBranches(root),
  ]);
  const worktreeByBranch = new Map(
    inspectedWorktrees.filter((entry) => entry.branch).map((entry) => [entry.branch, entry]),
  );
  const pullRequestByBranch = newestPullRequestByBranch(discovered.pullRequests);
  const items = [];
  for (const branchInfo of branches) {
    const worktree = worktreeByBranch.get(branchInfo.branch) || null;
    const pullRequest = pullRequestByBranch.get(branchInfo.branch) || null;
    const divergence = await git(
      root,
      ["rev-list", "--left-right", "--count", `${DEFAULT_BASE}...${branchInfo.branch}`],
      { allowFailure: true },
    );
    const remoteBranch = remoteHeads.available
      ? remoteHeads.branches.has(branchInfo.branch)
      : await refExists(root, `refs/remotes/origin/${branchInfo.branch}`);
    let behind = null;
    let ahead = null;
    if (divergence.code === 0) {
      [behind, ahead] = divergence.stdout.trim().split(/\s+/u).map(Number);
    }
    const committedAt = new Date(branchInfo.committedAt);
    const ageDays = Number.isNaN(committedAt.valueOf())
      ? null
      : Math.max(0, Math.floor((now.valueOf() - committedAt.valueOf()) / 86_400_000));
    const localOnly = !remoteBranch && (ahead || 0) > 0 && !pullRequest?.mergedAt;
    const classification = classifyBranch({
      branch: branchInfo.branch,
      worktree,
      primaryPath: primary.path,
      pullRequest,
      localOnly,
      ageDays,
      staleDays,
    });
    items.push({
      kind: "branch",
      classification,
      branch: branchInfo.branch,
      head: branchInfo.head,
      committedAt: branchInfo.committedAt,
      ageDays,
      upstream: branchInfo.upstream,
      remoteBranch,
      ahead,
      behind,
      localOnly,
      worktreePath: worktree?.path || null,
      worktreePresent: worktree?.present ?? null,
      worktreeClean: worktree?.clean ?? null,
      worktreeChangedFiles: worktree?.changedFiles ?? null,
      worktreeLocked: Boolean(worktree?.locked),
      worktreePrunable: Boolean(worktree?.prunable),
      pullRequest,
    });
  }
  for (const worktree of inspectedWorktrees.filter((entry) => entry.detached)) {
    items.push({
      kind: "detached-worktree",
      classification: worktree.prunable || !worktree.present ? "STALE_REGISTRATION" : "DETACHED_TEMP",
      branch: null,
      head: worktree.head,
      committedAt: null,
      ageDays: null,
      upstream: null,
      remoteBranch: false,
      ahead: null,
      behind: null,
      localOnly: false,
      worktreePath: worktree.path,
      worktreePresent: worktree.present,
      worktreeClean: worktree.clean,
      worktreeChangedFiles: worktree.changedFiles,
      worktreeLocked: Boolean(worktree.locked),
      worktreePrunable: Boolean(worktree.prunable),
      pullRequest: null,
    });
  }
  const counts = {};
  for (const item of items) counts[item.classification] = (counts[item.classification] || 0) + 1;
  return {
    schemaVersion: 1,
    repository: await realpath(root),
    primaryWorktree: primary.path,
    base: DEFAULT_BASE,
    staleDays,
    pullRequestsAvailable: discovered.available,
    githubRepository: discovered.repository,
    remoteBranchesAvailable: remoteHeads.available,
    counts,
    items,
  };
}

export function formatAuditReport(report) {
  const lines = [
    "PageRoot worktree and branch audit",
    `- repository: ${report.repository}`,
    `- primary worktree: ${report.primaryWorktree}`,
    `- comparison base: ${report.base}`,
    `- stale threshold: ${report.staleDays} days`,
    `- GitHub PR data: ${report.pullRequestsAvailable ? "available" : "unavailable"}`,
    `- live remote branches: ${report.remoteBranchesAvailable ? "available" : "local cache only"}`,
  ];
  for (const [classification, count] of Object.entries(report.counts).sort()) {
    lines.push(`- ${classification}: ${count}`);
  }
  for (const item of report.items) {
    const identity = item.branch || `detached:${String(item.head || "").slice(0, 7)}`;
    const details = [
      item.worktreePath || "no worktree",
      item.worktreeClean === false ? `dirty:${item.worktreeChangedFiles}` : null,
      item.pullRequest ? `PR #${item.pullRequest.number} ${item.pullRequest.state}` : null,
      item.ageDays === null ? null : `${item.ageDays}d`,
    ].filter(Boolean).join(" | ");
    lines.push(`[${item.classification}] ${identity} | ${details}`);
  }
  return lines.join("\n");
}

export async function retireTask({
  root = productRoot,
  branch,
  apply = false,
  abandon = false,
  discardChanges = false,
  deleteRemote = false,
  staleDays = DEFAULT_STALE_DAYS,
  pullRequests = null,
} = {}) {
  await assertPrimaryWorktree(root);
  if (!branch || branch === "main") throw new Error("Refusing to retire main or an empty branch.");
  const refCheck = await git(root, ["check-ref-format", "--branch", branch], { allowFailure: true });
  if (refCheck.code !== 0) throw new Error(`Git rejected branch name ${branch}.`);
  const audit = await auditRepository({ root, staleDays, pullRequests });
  const item = audit.items.find((candidate) => candidate.kind === "branch" && candidate.branch === branch);
  if (!item) throw new Error(`Local branch does not exist: ${branch}.`);
  if (item.worktreePath === audit.primaryWorktree) {
    throw new Error(`Refusing to retire the branch checked out in the primary worktree: ${branch}.`);
  }
  if (item.worktreeLocked) throw new Error(`Refusing to retire locked worktree ${item.worktreePath}.`);
  if (item.pullRequest?.state === "OPEN") {
    throw new Error(`Refusing to retire ${branch}: Pull Request #${item.pullRequest.number} is open.`);
  }
  if (item.worktreeClean === false && !(abandon && discardChanges)) {
    throw new Error(
      `Refusing to retire dirty worktree ${item.worktreePath}; explicit abandonment requires `
      + "--abandon --discard-changes.",
    );
  }
  const merged = Boolean(item.pullRequest?.mergedAt);
  if (!merged && !abandon) {
    throw new Error(
      `Refusing to retire ${branch}: no merged Pull Request was found. `
      + "Use --abandon only after an explicit product decision.",
    );
  }
  if (deleteRemote && !item.remoteBranch) {
    throw new Error(`Remote branch origin/${branch} does not exist.`);
  }
  const actions = [];
  if (deleteRemote) actions.push(`delete remote branch origin/${branch}`);
  if (item.worktreePath) {
    actions.push(item.worktreePresent
      ? `remove worktree ${item.worktreePath}`
      : `prune stale worktree registration ${item.worktreePath}`);
  }
  actions.push(`delete local branch ${branch}`);
  actions.push("fetch and prune origin");
  const result = {
    schemaVersion: 1,
    branch,
    classification: item.classification,
    merged,
    abandon,
    discardChanges,
    deleteRemote,
    apply,
    actions,
  };
  if (!apply) return result;
  if (deleteRemote) await runInherited(root, "git", ["push", "origin", "--delete", branch]);
  if (item.worktreePath) {
    if (item.worktreePresent) {
      const args = ["worktree", "remove"];
      if (item.worktreeClean === false) args.push("--force");
      args.push(item.worktreePath);
      await runInherited(root, "git", args);
    } else {
      await runInherited(root, "git", ["worktree", "prune"]);
    }
  }
  if (await refExists(root, `refs/heads/${branch}`)) {
    await runInherited(root, "git", ["branch", "-D", branch]);
  }
  await runInherited(root, "git", ["fetch", "--prune", "origin"]);
  return { ...result, applied: true };
}

export function formatRetireReport(report) {
  const lines = [
    `PageRoot task retirement ${report.apply ? "apply" : "preview"}`,
    `- branch: ${report.branch}`,
    `- classification: ${report.classification}`,
    `- merged PR: ${report.merged ? "yes" : "no"}`,
    `- explicit abandonment: ${report.abandon ? "yes" : "no"}`,
  ];
  for (const action of report.actions) lines.push(`  - ${action}`);
  if (!report.apply) lines.push("- no changes were made; rerun with --apply to execute");
  return lines.join("\n");
}

export async function syncMain({
  root = productRoot,
  fetch = true,
} = {}) {
  const primary = await assertPrimaryWorktree(root);
  const before = await repositoryReport(root);
  if (!before.clean) throw new Error("Refusing to synchronize main: the primary worktree is dirty.");
  if (before.branch !== "main") {
    const worktrees = await listWorktrees(root);
    const otherMain = worktrees.find((entry) => entry.branch === "main" && entry.path !== primary.path);
    if (otherMain) {
      throw new Error(`Local main is checked out in another worktree: ${otherMain.path}`);
    }
  }
  if (fetch) await runInherited(root, "git", ["fetch", "--prune", "origin"]);
  if (before.branch !== "main") await runInherited(root, "git", ["switch", "main"]);
  await runInherited(root, "git", ["merge", "--ff-only", DEFAULT_BASE]);
  return {
    ...(await repositoryReport(root)),
    primaryWorktree: primary.path,
  };
}

async function main() {
  const options = parseTaskArguments(process.argv.slice(2));
  if (options.command === "policy") {
    console.log(`Valid PageRoot branch: ${options.branch}`);
    return;
  }
  let report;
  if (options.command === "start") {
    report = await startTask({
      root: productRoot,
      branch: options.branch,
    });
  } else if (options.command === "attach") {
    report = await attachTask({
      root: productRoot,
      branch: options.branch,
    });
  } else if (options.command === "finish") {
    report = await finishTask({
      root: productRoot,
    });
  } else if (options.command === "audit") {
    report = await auditRepository({
      root: productRoot,
      staleDays: options.staleDays,
    });
  } else if (options.command === "retire") {
    report = await retireTask({
      root: productRoot,
      branch: options.branch,
      apply: options.apply,
      abandon: options.abandon,
      discardChanges: options.discardChanges,
      deleteRemote: options.deleteRemote,
      staleDays: options.staleDays,
    });
  } else if (options.command === "sync-main") {
    report = await syncMain({ root: productRoot });
  } else {
    report = await repositoryReport(productRoot, { base: options.base });
  }
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else if (options.command === "audit") {
    console.log(formatAuditReport(report));
  } else if (options.command === "retire") {
    console.log(formatRetireReport(report));
  } else {
    console.log(formatTaskReport(report));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
