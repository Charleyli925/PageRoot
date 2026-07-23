import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

import {
  finishTask,
  parseTaskArguments,
  repositoryReport,
  startTask,
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
  assert.deepEqual(parseTaskArguments(["start", "agent/add-guidance"]), {
    command: "start",
    base: "origin/main",
    branch: "agent/add-guidance",
    json: false,
  });
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
  assert.throws(() => parseTaskArguments(["finish", "--json"]), /only by task:status/u);
  assert.throws(() => parseTaskArguments(["publish"]));
});

test("durable agent guidance keeps progressive disclosure and review boundaries", () => {
  assert.match(agentGuidance, /^## Progressive disclosure$/mu);
  assert.match(agentGuidance, /^## Code Review Rules$/mu);
  assert.match(agentGuidance, /update that document in the same PR/u);
  assert.match(agentGuidance, /Do not merge, create or move a tag, publish a Release/u);
  assert.doesNotMatch(agentGuidance, /\/Users\/|[A-Za-z]:\\/u);
  assert.doesNotMatch(codexWorkflow, /\/Users\/|[A-Za-z]:\\/u);
  assert.match(codexWorkflow, /^## Documentation impact$/mu);
  assert.match(codexWorkflow, /^## Scheduled monitoring$/mu);
});

test("task start synchronizes clean main and creates an isolated branch", async (t) => {
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
  assert.equal(await run(repository, "git", ["branch", "--show-current"]), "agent/test-workflow");
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
  await startTask({ root: repository, branch: "docs/report-fixture" });
  await writeFile(path.join(repository, "README.md"), "# changed\n", "utf8");
  await writeFile(path.join(repository, "new-file.md"), "new\n", "utf8");
  const report = await repositoryReport(repository);
  assert.equal(report.clean, false);
  assert.deepEqual(report.changedFiles, ["README.md", "new-file.md"]);
  assert.equal(report.branch, "docs/report-fixture");
});

test("task finish rejects source changes that occur during the gate", async (t) => {
  const repository = await createRepository(t);
  await startTask({ root: repository, branch: "fix/stable-gate-source" });
  await writeFile(path.join(repository, "README.md"), "# before gate\n", "utf8");
  await assert.rejects(
    finishTask({
      root: repository,
      runGate: async () => {
        await writeFile(path.join(repository, "README.md"), "# changed during gate\n", "utf8");
      },
    }),
    /source changed while the task gate was running/u,
  );
});
