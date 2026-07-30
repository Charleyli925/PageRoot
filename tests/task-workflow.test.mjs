import assert from "node:assert/strict";
import { lstat, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

import {
  attachTask,
  auditRepository,
  finishTask,
  parseTaskArguments,
  repositoryReport,
  retireTask,
  standardWorktreePath,
  startTask,
  syncMain,
  validatePullRequestBranchName,
  validateTaskBranchName,
} from "../scripts/task-workflow.mjs";

const agentGuidance = await readFile(new URL("../AGENTS.md", import.meta.url), "utf8");
const codexWorkflow = await readFile(new URL("../docs/CODEX_WORKFLOW.md", import.meta.url), "utf8");

async function run(root, command, args) {
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
    child.once("close", (exitCode) => resolve(exitCode ?? 1));
  });
  if (code !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed: ${Buffer.concat(stderr).toString("utf8")}`);
  }
  return Buffer.concat(stdout).toString("utf8").trim();
}

async function createRepository(t) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "pageroot-task-workflow-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const origin = path.join(temporary, "origin.git");
  const repository = path.join(temporary, "repo");
  await run(temporary, "git", ["init", "--bare", origin]);
  await run(temporary, "git", ["init", "-b", "main", repository]);
  await run(repository, "git", ["config", "user.name", "PageRoot Test"]);
  await run(repository, "git", ["config", "user.email", "pageroot@example.invalid"]);
  await writeFile(path.join(repository, "README.md"), "# fixture\n", "utf8");
  await writeFile(path.join(repository, "package.json"), "{\"version\":\"1.2.3\"}\n", "utf8");
  await run(repository, "git", ["add", "README.md", "package.json"]);
  await run(repository, "git", ["commit", "-m", "initial"]);
  await run(repository, "git", ["remote", "add", "origin", origin]);
  await run(repository, "git", ["push", "-u", "origin", "main"]);
  return repository;
}

test("task arguments and branch names fail closed", () => {
  assert.equal(validateTaskBranchName("fix/preserve-selection"), "fix/preserve-selection");
  assert.equal(validateTaskBranchName("integration/next-release"), "integration/next-release");
  assert.equal(validatePullRequestBranchName("dependabot/npm_and_yarn/example-1.0.0"), "dependabot/npm_and_yarn/example-1.0.0");
  assert.equal(parseTaskArguments(["start", "agent/add-guidance", "--json"]).json, true);
  assert.equal(parseTaskArguments(["retire", "fix/old-task", "--abandon"]).abandon, true);
  for (const invalid of [
    "main",
    "Fix/uppercase",
    "fix/",
    "fix//double",
    "fix/../escape",
    "fix/.hidden",
    "unknown/name",
  ]) {
    assert.throws(() => validateTaskBranchName(invalid));
  }
  assert.throws(
    () => parseTaskArguments(["finish", "--base", "HEAD~1"]),
    /base is fixed to origin\/main/u,
  );
  assert.throws(() => parseTaskArguments(["finish", "--json"]), /not supported/u);
  assert.throws(
    () => parseTaskArguments(["retire", "fix/old-task", "--discard-changes"]),
    /requires --abandon/u,
  );
  assert.throws(() => parseTaskArguments(["publish"]));
});

test("durable agent guidance keeps progressive disclosure and review boundaries", () => {
  assert.match(agentGuidance, /^## Progressive disclosure$/mu);
  assert.match(agentGuidance, /^## Code Review Rules$/mu);
  assert.match(agentGuidance, /update that document in the same PR/u);
  assert.match(agentGuidance, /ENGINEERING_STANDARDS\.md/u);
  assert.match(agentGuidance, /Do not merge, create or move a tag, publish a Release/u);
  assert.doesNotMatch(agentGuidance, /\/Users\/|[A-Za-z]:\\/u);
  assert.doesNotMatch(codexWorkflow, /\/Users\/|[A-Za-z]:\\/u);
  assert.match(codexWorkflow, /^## Documentation impact$/mu);
  assert.match(codexWorkflow, /^## Scheduled monitoring$/mu);
});

test("task start synchronizes clean main and creates an isolated worktree", async (t) => {
  const repository = await createRepository(t);
  const report = await startTask({
    root: repository,
    branch: "agent/test-workflow",
  });
  assert.equal(report.branch, "agent/test-workflow");
  assert.equal(report.clean, true);
  assert.equal(report.ahead, 0);
  assert.equal(report.behind, 0);
  assert.equal(report.version, "1.2.3");
  assert.equal(
    await realpath(report.worktreePath),
    await realpath(standardWorktreePath(repository, "agent/test-workflow")),
  );
  assert.equal(await run(repository, "git", ["branch", "--show-current"]), "main");
  assert.equal(await run(report.worktreePath, "git", ["branch", "--show-current"]), "agent/test-workflow");
  assert.equal(await run(report.worktreePath, "git", ["status", "--short"]), "");
});

test("task start refuses dirty or non-main work without changing it", async (t) => {
  const repository = await createRepository(t);
  await writeFile(path.join(repository, "untracked.txt"), "keep me\n", "utf8");
  await assert.rejects(
    startTask({ root: repository, branch: "fix/should-not-start" }),
    /worktree is dirty/u,
  );
  assert.equal(await run(repository, "git", ["branch", "--show-current"]), "main");
  assert.equal(await run(repository, "git", ["status", "--short"]), "?? untracked.txt");
});

test("task report covers committed and uncommitted changes against main", async (t) => {
  const repository = await createRepository(t);
  const task = await startTask({ root: repository, branch: "docs/report-fixture" });
  await writeFile(path.join(task.worktreePath, "README.md"), "# changed\n", "utf8");
  await writeFile(path.join(task.worktreePath, "new-file.md"), "new\n", "utf8");
  const report = await repositoryReport(task.worktreePath);
  assert.equal(report.clean, false);
  assert.deepEqual(report.changedFiles, ["README.md", "new-file.md"]);
  assert.equal(report.branch, "docs/report-fixture");
});

test("task finish rejects source changes that occur during the gate", async (t) => {
  const repository = await createRepository(t);
  const task = await startTask({ root: repository, branch: "fix/stable-gate-source" });
  await writeFile(path.join(task.worktreePath, "README.md"), "# before gate\n", "utf8");
  await assert.rejects(
    finishTask({
      root: task.worktreePath,
      runGate: async () => {
        await writeFile(path.join(task.worktreePath, "README.md"), "# changed during gate\n", "utf8");
      },
    }),
    /source changed while the task gate was running/u,
  );
});

test("task attach places an existing branch in the standard worktree directory", async (t) => {
  const repository = await createRepository(t);
  await run(repository, "git", ["branch", "fix/existing-task", "origin/main"]);
  const report = await attachTask({ root: repository, branch: "fix/existing-task" });
  assert.equal(
    await realpath(report.worktreePath),
    await realpath(standardWorktreePath(repository, "fix/existing-task")),
  );
  assert.equal(await run(repository, "git", ["branch", "--show-current"]), "main");
  assert.equal(await run(report.worktreePath, "git", ["branch", "--show-current"]), "fix/existing-task");
});

test("task audit distinguishes primary, open PR and local-only work", async (t) => {
  const repository = await createRepository(t);
  const task = await startTask({ root: repository, branch: "integration/pending-release" });
  await writeFile(path.join(task.worktreePath, "README.md"), "# integrated\n", "utf8");
  await run(task.worktreePath, "git", ["add", "README.md"]);
  await run(task.worktreePath, "git", ["commit", "-m", "integrate pending work"]);
  const worktreesBefore = await run(repository, "git", ["worktree", "list", "--porcelain"]);
  const localAudit = await auditRepository({
    root: repository,
    pullRequests: [],
    now: new Date("2026-07-30T12:00:00Z"),
  });
  assert.equal(
    localAudit.items.find((item) => item.branch === "integration/pending-release").classification,
    "LOCAL_ONLY",
  );
  assert.equal(localAudit.items.find((item) => item.branch === "main").classification, "PRIMARY");
  const prAudit = await auditRepository({
    root: repository,
    pullRequests: [{
      number: 12,
      state: "OPEN",
      mergedAt: null,
      headRefName: "integration/pending-release",
      baseRefName: "main",
      updatedAt: "2026-07-30T11:00:00Z",
      url: "https://example.invalid/pr/12",
    }],
  });
  assert.equal(
    prAudit.items.find((item) => item.branch === "integration/pending-release").classification,
    "ACTIVE_PR",
  );
  assert.equal(await run(repository, "git", ["worktree", "list", "--porcelain"]), worktreesBefore);
});

test("task retirement is a dry run by default and removes only merged clean work on apply", async (t) => {
  const repository = await createRepository(t);
  const task = await startTask({ root: repository, branch: "fix/merged-task" });
  await writeFile(path.join(task.worktreePath, "README.md"), "# merged task\n", "utf8");
  await run(task.worktreePath, "git", ["add", "README.md"]);
  await run(task.worktreePath, "git", ["commit", "-m", "fix merged task"]);
  const pullRequests = [{
    number: 14,
    state: "MERGED",
    mergedAt: "2026-07-30T10:00:00Z",
    headRefName: "fix/merged-task",
    baseRefName: "main",
    updatedAt: "2026-07-30T10:00:00Z",
    url: "https://example.invalid/pr/14",
  }];
  const preview = await retireTask({
    root: repository,
    branch: "fix/merged-task",
    pullRequests,
  });
  assert.equal(preview.apply, false);
  assert.equal(await run(task.worktreePath, "git", ["branch", "--show-current"]), "fix/merged-task");
  const applied = await retireTask({
    root: repository,
    branch: "fix/merged-task",
    pullRequests,
    apply: true,
  });
  assert.equal(applied.applied, true);
  assert.equal(await lstat(task.worktreePath).catch(() => null), null);
  assert.equal(await run(repository, "git", ["branch", "--list", "fix/merged-task"]), "");
});

test("task retirement refuses dirty work unless abandonment and discard are both explicit", async (t) => {
  const repository = await createRepository(t);
  const task = await startTask({ root: repository, branch: "agent/abandoned-task" });
  await writeFile(path.join(task.worktreePath, "README.md"), "# discard\n", "utf8");
  await assert.rejects(
    retireTask({
      root: repository,
      branch: "agent/abandoned-task",
      pullRequests: [],
      abandon: true,
    }),
    /--abandon --discard-changes/u,
  );
  const applied = await retireTask({
    root: repository,
    branch: "agent/abandoned-task",
    pullRequests: [],
    abandon: true,
    discardChanges: true,
    apply: true,
  });
  assert.equal(applied.applied, true);
  assert.equal(await lstat(task.worktreePath).catch(() => null), null);
});

test("task retirement never removes an open Pull Request branch", async (t) => {
  const repository = await createRepository(t);
  const task = await startTask({ root: repository, branch: "fix/open-task" });
  await assert.rejects(
    retireTask({
      root: repository,
      branch: "fix/open-task",
      pullRequests: [{
        number: 18,
        state: "OPEN",
        mergedAt: null,
        headRefName: "fix/open-task",
        baseRefName: "main",
        updatedAt: "2026-07-30T11:00:00Z",
        url: "https://example.invalid/pr/18",
      }],
      abandon: true,
      apply: true,
    }),
    /Pull Request #18 is open/u,
  );
  assert.equal(await run(task.worktreePath, "git", ["branch", "--show-current"]), "fix/open-task");
});

test("sync main refuses another main worktree and otherwise remains fast-forward only", async (t) => {
  const repository = await createRepository(t);
  const report = await syncMain({ root: repository });
  assert.equal(report.branch, "main");
  assert.equal(report.ahead, 0);
  assert.equal(report.behind, 0);
});
