#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFile,
  mkdir,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { officialStableTags } from "./developer-preview.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const productRoot = path.resolve(path.dirname(scriptPath), "..");
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u;
const STABLE_TAG_PATTERN = /^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const GITHUB_COMMAND_ATTEMPTS = 3;
const GITHUB_COMMAND_TIMEOUT_MS = 30_000;
export const GITHUB_METADATA_CONCURRENCY = 8;
export const DEFAULT_PACKAGE_DELIVERY_DEADLINE_MS = 8 * 60 * 1000;
const FAILED_CHECK_CONCLUSIONS = new Set([
  "ACTION_REQUIRED",
  "CANCELLED",
  "FAILURE",
  "STARTUP_FAILURE",
  "STALE",
  "TIMED_OUT",
]);
const execFileAsync = promisify(execFile);

export class PackageDeliveryReportTimeoutError extends Error {
  constructor({
    deadlineMs,
    phase,
    completed,
    total,
    current,
  }) {
    const progress = Number.isFinite(total)
      ? ` (${completed}/${total}; current ${current || "unknown"})`
      : "";
    super(
      `Package delivery report exceeded its ${deadlineMs} ms deadline during ${phase}${progress}. `
      + "GitHub metadata is incomplete; rerun with a narrower range or a larger --deadline-ms.",
    );
    this.name = "PackageDeliveryReportTimeoutError";
    this.code = "PACKAGE_DELIVERY_REPORT_TIMEOUT";
    this.deadlineMs = deadlineMs;
    this.phase = phase;
    this.completed = completed;
    this.total = total;
    this.current = current || null;
  }
}

function normalizeDeadlineMs(value = DEFAULT_PACKAGE_DELIVERY_DEADLINE_MS) {
  const deadlineMs = Number(value);
  assert(
    Number.isSafeInteger(deadlineMs) && deadlineMs > 0,
    "package delivery deadline must be a positive integer in milliseconds",
  );
  return deadlineMs;
}

function normalizeConcurrency(value = GITHUB_METADATA_CONCURRENCY) {
  const concurrency = Number(value);
  assert(
    Number.isSafeInteger(concurrency) && concurrency > 0,
    "GitHub metadata concurrency must be a positive integer",
  );
  return concurrency;
}

function timeoutError({ deadlineMs, phase, completed, total, current }) {
  return new PackageDeliveryReportTimeoutError({
    deadlineMs,
    phase,
    completed,
    total,
    current,
  });
}

function assertBeforeDeadline({
  deadlineAt,
  deadlineMs,
  phase,
  completed = 0,
  total = 0,
  current = null,
  now = Date.now,
}) {
  if (Number.isFinite(deadlineAt) && now() >= deadlineAt) {
    throw timeoutError({ deadlineMs, phase, completed, total, current });
  }
}

function commandOutput(command, arguments_, {
  cwd = productRoot,
  timeout = undefined,
} = {}) {
  const result = spawnSync(command, arguments_, {
    cwd,
    encoding: "utf8",
    env: process.env,
    maxBuffer: 20 * 1024 * 1024,
    timeout,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "").trim();
    const suffix = detail ? `: ${detail}` : ".";
    throw new Error(`${command} ${arguments_.join(" ")} failed${suffix}`);
  }
  return result.stdout.trim();
}

function gitOutput(root, arguments_) {
  return commandOutput("git", arguments_, { cwd: root });
}

export function isTransientGitHubCommandFailure(cause) {
  const code = String(cause?.code || cause?.cause?.code || "").toUpperCase();
  if (["ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "ENETUNREACH"].includes(code)) return true;
  const message = String(cause?.message || cause || "");
  return /(?:\bEOF\b|connection reset|could not resolve host|TLS handshake timeout|temporarily unavailable|HTTP (?:502|503|504)\b)/iu.test(message);
}

export function retryTransientGitHubCommand(run, {
  attempts = GITHUB_COMMAND_ATTEMPTS,
  onRetry = () => {},
} = {}) {
  if (typeof run !== "function") throw new TypeError("GitHub command runner must be a function.");
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new TypeError("GitHub command attempts must be a positive integer.");
  }
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return run();
    } catch (cause) {
      if (attempt === attempts || !isTransientGitHubCommandFailure(cause)) throw cause;
      onRetry({ attempt, nextAttempt: attempt + 1, attempts });
    }
  }
  throw new Error("GitHub command retry invariant failed.");
}

export async function retryTransientGitHubCommandAsync(run, {
  attempts = GITHUB_COMMAND_ATTEMPTS,
  onRetry = () => {},
  deadlineAt = Number.POSITIVE_INFINITY,
  deadlineMs = DEFAULT_PACKAGE_DELIVERY_DEADLINE_MS,
  phase = "GitHub metadata",
  progress = {},
  now = Date.now,
} = {}) {
  if (typeof run !== "function") throw new TypeError("GitHub command runner must be a function.");
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new TypeError("GitHub command attempts must be a positive integer.");
  }
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const remainingMs = Number.isFinite(deadlineAt)
      ? deadlineAt - now()
      : GITHUB_COMMAND_TIMEOUT_MS;
    if (remainingMs <= 0) {
      throw timeoutError({
        deadlineMs,
        phase,
        completed: progress.completed || 0,
        total: progress.total || 0,
        current: progress.current,
      });
    }
    try {
      return await run({
        timeout: Math.max(1, Math.min(GITHUB_COMMAND_TIMEOUT_MS, remainingMs)),
      });
    } catch (cause) {
      if (now() >= deadlineAt) {
        throw timeoutError({
          deadlineMs,
          phase,
          completed: progress.completed || 0,
          total: progress.total || 0,
          current: progress.current,
        });
      }
      if (attempt === attempts || !isTransientGitHubCommandFailure(cause)) throw cause;
      onRetry({ attempt, nextAttempt: attempt + 1, attempts });
    }
  }
  throw new Error("GitHub command retry invariant failed.");
}

async function commandOutputAsync(command, arguments_, {
  cwd = productRoot,
  timeout,
  signal,
} = {}) {
  const result = await execFileAsync(command, arguments_, {
    cwd,
    encoding: "utf8",
    env: process.env,
    maxBuffer: 20 * 1024 * 1024,
    ...(timeout === undefined ? {} : { timeout }),
    ...(signal ? { signal } : {}),
  });
  return result.stdout.trim();
}

async function githubJsonAsync(arguments_, root, {
  deadlineAt,
  deadlineMs,
  phase,
  progress,
  signal,
  now = Date.now,
} = {}) {
  const output = await retryTransientGitHubCommandAsync(
    ({ timeout }) => commandOutputAsync("gh", arguments_, {
      cwd: root,
      timeout,
      signal,
    }),
    {
      deadlineAt,
      deadlineMs,
      phase,
      progress,
      now,
      onRetry({ nextAttempt, attempts }) {
        console.warn(
          `Transient GitHub transport failure; retrying delivery evidence (${nextAttempt}/${attempts}).`,
        );
      },
    },
  );
  try {
    return JSON.parse(output);
  } catch {
    throw new Error(`gh returned invalid JSON for ${arguments_.join(" ")}.`);
  }
}

function normalizeOneLine(value) {
  return String(value ?? "").replace(/\s+/gu, " ").trim();
}

function assertManagedPath(root, value, label) {
  const resolved = path.resolve(root, value);
  const relative = path.relative(root, resolved);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} must be a file or directory inside the repository.`);
  }
  return resolved;
}

function parseRepositoryRemote(remote) {
  const normalized = String(remote || "").trim().replace(/\.git$/u, "");
  const match = normalized.match(
    /^(?:https?:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/]+\/[^/]+)$/u,
  );
  return match?.[1] || null;
}

function resolveRepository(root, explicitRepository) {
  const candidate = explicitRepository
    || process.env.GITHUB_REPOSITORY
    || parseRepositoryRemote(gitOutput(root, ["config", "--get", "remote.origin.url"]));
  assert.match(candidate ?? "", REPOSITORY_PATTERN, "repository must use owner/name form");
  return candidate;
}

function stableTags(root) {
  return officialStableTags({ productRoot: root })
    .sort((left, right) => (
      right.parsed.major - left.parsed.major
      || right.parsed.minor - left.parsed.minor
      || right.parsed.patch - left.parsed.patch
    ))
    .map(({ tag }) => tag);
}

export function selectPackageBaseline({
  tags,
  tagCommits,
  headSha,
  kind,
  explicitBaseTag = null,
}) {
  assert.match(headSha ?? "", SHA_PATTERN, "headSha must be a full Git SHA");
  assert.match(kind ?? "", /^(?:developer-preview|formal)$/u, "unsupported package kind");
  if (explicitBaseTag) {
    assert.match(explicitBaseTag, STABLE_TAG_PATTERN, "base tag must be a stable vA.B.C tag");
    assert.ok(tags.includes(explicitBaseTag), "base tag must be reachable from HEAD");
    return explicitBaseTag;
  }
  if (kind === "developer-preview") {
    assert.ok(tags[0], "developer preview report requires a reachable stable tag");
    return tags[0];
  }
  const baseline = tags.find((tag) => tagCommits[tag] !== headSha);
  assert.ok(
    baseline,
    "formal package report requires a stable tag before the packaged source state",
  );
  return baseline;
}

function resolveBaselineTag({ root, kind, explicitBaseTag, headSha }) {
  const tags = stableTags(root);
  const tagCommits = Object.fromEntries(tags.map((tag) => [
    tag,
    gitOutput(root, ["rev-list", "-n", "1", tag]),
  ]));
  return selectPackageBaseline({
    tags,
    tagCommits,
    headSha,
    kind,
    explicitBaseTag,
  });
}

function commitsInRange(root, baseTag) {
  const output = gitOutput(root, [
    "log",
    "--reverse",
    "--format=%H%x1f%s%x1e",
    `${baseTag}..HEAD`,
  ]);
  return output.split("\x1e").flatMap((record) => {
    const normalized = record.replace(/^\s+/u, "").replace(/\s+$/u, "");
    if (!normalized) return [];
    const [sha, subject = ""] = normalized.split("\x1f");
    assert.match(sha, SHA_PATTERN, "package history contains an invalid commit SHA");
    return [{ sha, subject: normalizeOneLine(subject) }];
  });
}

function diffSummary(root, baseTag) {
  const nameOutput = commandOutput(
    "git",
    ["diff", "--name-only", "-z", `${baseTag}..HEAD`],
    { cwd: root },
  );
  const files = nameOutput.split("\0").filter(Boolean).sort();
  const numstat = gitOutput(root, ["diff", "--numstat", `${baseTag}..HEAD`]);
  let additions = 0;
  let deletions = 0;
  for (const line of numstat.split("\n").filter(Boolean)) {
    const [added, deleted] = line.split("\t");
    if (/^\d+$/u.test(added)) additions += Number(added);
    if (/^\d+$/u.test(deleted)) deletions += Number(deleted);
  }
  return { files, additions, deletions };
}

export function summarizeStatusChecks(statusCheckRollup = []) {
  const counts = {
    total: statusCheckRollup.length,
    passing: 0,
    failing: 0,
    pending: 0,
    skipped: 0,
  };
  for (const check of statusCheckRollup) {
    if (check?.__typename === "StatusContext") {
      const state = String(check.state || "").toUpperCase();
      if (state === "SUCCESS") counts.passing += 1;
      else if (state === "FAILURE" || state === "ERROR") counts.failing += 1;
      else counts.pending += 1;
      continue;
    }
    const status = String(check?.status || "").toUpperCase();
    const conclusion = String(check?.conclusion || "").toUpperCase();
    if (status !== "COMPLETED" || !conclusion) counts.pending += 1;
    else if (FAILED_CHECK_CONCLUSIONS.has(conclusion)) counts.failing += 1;
    else if (conclusion === "SKIPPED") counts.skipped += 1;
    else counts.passing += 1;
  }
  return Object.freeze({
    ...counts,
    status: counts.failing > 0
      ? "FAILING"
      : counts.pending > 0
        ? "PENDING"
        : counts.total === 0
          ? "NONE"
          : "PASSING",
  });
}

export function pullRequestStatusLabel(pullRequest) {
  const state = String(pullRequest?.state || "").toUpperCase();
  if (state === "MERGED") return "已合并";
  if (state === "CLOSED") return "已关闭";
  assert.equal(state, "OPEN", "pull request state must be OPEN, CLOSED or MERGED");
  const labels = ["开放", pullRequest.isDraft ? "草稿" : "可审查"];
  const mergeState = String(pullRequest.mergeStateStatus || "").toUpperCase();
  const mergeLabels = {
    BEHIND: "落后于基准分支",
    BLOCKED: "合并受阻",
    CLEAN: "可合并",
    DIRTY: "存在冲突",
    UNSTABLE: "检查未稳定",
  };
  if (mergeLabels[mergeState]) labels.push(mergeLabels[mergeState]);
  const reviewDecision = String(pullRequest.reviewDecision || "").toUpperCase();
  const reviewLabels = {
    APPROVED: "已批准",
    CHANGES_REQUESTED: "要求修改",
    REVIEW_REQUIRED: "待审查",
  };
  if (reviewLabels[reviewDecision]) labels.push(reviewLabels[reviewDecision]);
  const checkLabels = {
    FAILING: "检查失败",
    NONE: "无检查",
    PASSING: "检查通过",
    PENDING: "检查进行中",
  };
  labels.push(checkLabels[pullRequest.checks?.status || "NONE"]);
  return labels.join(" · ");
}

function pullRequestRecord(detail, commitShas) {
  const checks = summarizeStatusChecks(detail.statusCheckRollup || []);
  const normalized = {
    number: detail.number,
    url: detail.url,
    title: normalizeOneLine(detail.title),
    summary: normalizeOneLine(detail.title),
    state: String(detail.state || "").toUpperCase(),
    isDraft: detail.isDraft === true,
    mergeStateStatus: String(detail.mergeStateStatus || "").toUpperCase() || null,
    reviewDecision: String(detail.reviewDecision || "").toUpperCase() || null,
    mergedAt: detail.mergedAt || null,
    headRefOid: detail.headRefOid || null,
    checks,
    commitShas: [...commitShas].sort(),
  };
  return Object.freeze({
    ...normalized,
    statusLabel: pullRequestStatusLabel(normalized),
  });
}

function reportProgress({ phase, current, completed, total }) {
  console.error(
    `Package delivery report: ${phase} ${completed}/${total}; current ${current || "none"}.`,
  );
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const consume = async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(items.length, concurrency) }, () => consume()),
  );
  return results;
}

export async function collectPullRequests({
  root,
  repository,
  commits,
  concurrency = GITHUB_METADATA_CONCURRENCY,
  deadlineAt = null,
  deadlineMs = DEFAULT_PACKAGE_DELIVERY_DEADLINE_MS,
  now = Date.now,
  onProgress = reportProgress,
  requestJson = null,
}) {
  assert.ok(Array.isArray(commits), "package report commits must be an array");
  const normalizedConcurrency = normalizeConcurrency(concurrency);
  const normalizedDeadlineMs = normalizeDeadlineMs(deadlineMs);
  const startedAt = now();
  const scanDeadlineAt = Number.isFinite(deadlineAt)
    ? Number(deadlineAt)
    : startedAt + normalizedDeadlineMs;
  const abortController = new AbortController();
  const request = typeof requestJson === "function"
    ? requestJson
    : (arguments_, context) => githubJsonAsync(arguments_, root, context);
  const responseCache = new Map();
  let githubRequestCount = 0;
  let cacheHitCount = 0;
  const progress = {
    phase: "commit metadata",
    current: null,
    completed: 0,
    total: commits.length,
  };
  const emitProgress = (phase, current, completed, total) => {
    progress.phase = phase;
    progress.current = current;
    progress.completed = completed;
    progress.total = total;
    try {
      onProgress(Object.freeze({ ...progress }));
    } catch {
      // Progress reporting is diagnostic and must not change report correctness.
    }
  };
  const requestCached = (arguments_, context) => {
    const key = JSON.stringify(arguments_);
    const cached = responseCache.get(key);
    if (cached) {
      cacheHitCount += 1;
      return cached;
    }
    githubRequestCount += 1;
    const pending = Promise.resolve()
      .then(() => request(arguments_, context))
      .catch((cause) => {
        responseCache.delete(key);
        throw cause;
      });
    responseCache.set(key, pending);
    return pending;
  };
  const requestContext = (phase) => ({
    deadlineAt: scanDeadlineAt,
    deadlineMs: normalizedDeadlineMs,
    phase,
    progress,
    signal: abortController.signal,
    now,
  });
  const handleFailure = (cause) => {
    if (cause instanceof PackageDeliveryReportTimeoutError) throw cause;
    if (now() >= scanDeadlineAt) {
      throw timeoutError({
        deadlineMs: normalizedDeadlineMs,
        phase: progress.phase,
        completed: progress.completed,
        total: progress.total,
        current: progress.current,
      });
    }
    throw cause;
  };

  let associatedByCommit;
  try {
    associatedByCommit = await mapWithConcurrency(
      commits,
      normalizedConcurrency,
      async (commit) => {
        const current = commit.sha.slice(0, 12);
        emitProgress("commit metadata", current, progress.completed, commits.length);
        assertBeforeDeadline({
          deadlineAt: scanDeadlineAt,
          deadlineMs: normalizedDeadlineMs,
          phase: "commit metadata",
          completed: progress.completed,
          total: commits.length,
          current,
          now,
        });
        try {
          const associated = await requestCached([
            "api",
            "-H",
            "Accept: application/vnd.github+json",
            `/repos/${repository}/commits/${commit.sha}/pulls`,
          ], requestContext("commit metadata"));
          assert.ok(
            Array.isArray(associated),
            "GitHub commit Pull Request response must be an array",
          );
          const numbers = [...new Set(
            associated.map((entry) => entry?.number).filter(Number.isInteger),
          )].sort((left, right) => left - right);
          progress.completed += 1;
          emitProgress("commit metadata", current, progress.completed, commits.length);
          return { commit, numbers };
        } catch (cause) {
          return handleFailure(cause);
        }
      },
    );
  } catch (cause) {
    abortController.abort();
    return handleFailure(cause);
  }

  const commitToPullRequests = new Map();
  const pullRequestToCommits = new Map();
  for (const { commit, numbers } of associatedByCommit) {
    commitToPullRequests.set(commit.sha, numbers);
    for (const number of numbers) {
      const shas = pullRequestToCommits.get(number) || new Set();
      shas.add(commit.sha);
      pullRequestToCommits.set(number, shas);
    }
  }
  const fields = [
    "number",
    "url",
    "title",
    "state",
    "isDraft",
    "mergeStateStatus",
    "reviewDecision",
    "statusCheckRollup",
    "headRefOid",
    "mergedAt",
  ].join(",");
  const pullRequestEntries = [...pullRequestToCommits.entries()]
    .sort(([left], [right]) => left - right);
  progress.completed = 0;
  progress.total = pullRequestEntries.length;
  if (pullRequestEntries.length === 0) {
    emitProgress("Pull Request metadata", null, 0, 0);
  }
  let pullRequests;
  try {
    pullRequests = await mapWithConcurrency(
      pullRequestEntries,
      normalizedConcurrency,
      async ([number, shas]) => {
        const current = `#${number}`;
        emitProgress(
          "Pull Request metadata",
          current,
          progress.completed,
          pullRequestEntries.length,
        );
        assertBeforeDeadline({
          deadlineAt: scanDeadlineAt,
          deadlineMs: normalizedDeadlineMs,
          phase: "Pull Request metadata",
          completed: progress.completed,
          total: pullRequestEntries.length,
          current,
          now,
        });
        try {
          const detail = await requestCached([
            "pr",
            "view",
            String(number),
            "--repo",
            repository,
            "--json",
            fields,
          ], requestContext("Pull Request metadata"));
          const record = pullRequestRecord(detail, shas);
          progress.completed += 1;
          emitProgress(
            "Pull Request metadata",
            current,
            progress.completed,
            pullRequestEntries.length,
          );
          return record;
        } catch (cause) {
          return handleFailure(cause);
        }
      },
    );
  } catch (cause) {
    abortController.abort();
    return handleFailure(cause);
  }
  return {
    commits: commits.map((commit) => ({
      ...commit,
      pullRequestNumbers: commitToPullRequests.get(commit.sha) || [],
    })),
    pullRequests,
    scan: Object.freeze({
      deadlineMs: normalizedDeadlineMs,
      concurrency: normalizedConcurrency,
      elapsedMs: Math.max(0, now() - startedAt),
      commitMetadataRequested: commits.length,
      commitMetadataCompleted: commits.length,
      pullRequestMetadataRequested: pullRequestEntries.length,
      pullRequestMetadataCompleted: pullRequestEntries.length,
      githubRequestCount,
      cacheHitCount,
    }),
  };
}

export function createPackageDeliverySnapshot({
  kind,
  artifact,
  repository,
  baseTag,
  headSha,
  treeSha,
  commits,
  changedFiles,
  additions,
  deletions,
  pullRequests,
  scan = null,
  generatedAt,
}) {
  assert.match(kind ?? "", /^(?:developer-preview|formal)$/u, "unsupported package kind");
  assert.match(repository ?? "", REPOSITORY_PATTERN, "repository must use owner/name form");
  assert.match(baseTag ?? "", STABLE_TAG_PATTERN, "baseTag must be a stable tag");
  assert.match(headSha ?? "", SHA_PATTERN, "headSha must be a full Git SHA");
  assert.match(treeSha ?? "", SHA_PATTERN, "treeSha must be a full Git SHA");
  assert.ok(Array.isArray(commits) && commits.length > 0, "package report range has no commits");
  const directCommits = commits.filter((commit) => commit.pullRequestNumbers.length === 0);
  return Object.freeze({
    schemaVersion: 1,
    kind: "package-delivery-report",
    packageKind: kind,
    repository,
    generatedAt,
    artifact,
    source: {
      baseTag,
      range: `${baseTag}..${headSha}`,
      commitSha: headSha,
      treeSha,
      commitCount: commits.length,
      changedFileCount: changedFiles.length,
      additions,
      deletions,
      changedFiles,
      commits,
      directCommits,
    },
    pullRequests,
    ...(scan ? { scan } : {}),
  });
}

export function renderPackageDeliveryMarkdown(report) {
  const kindLabel = report.packageKind === "developer-preview" ? "开发者测试包" : "正式安装包";
  const lines = [
    "## 安装包内容报告",
    "",
    `- 安装包：\`${report.artifact.file}\``,
    `- 类型：${kindLabel}`,
    `- 版本 / 架构：\`${report.artifact.version}\` / \`${report.artifact.architecture}\``,
    `- 源码：\`${report.source.commitSha}\`（Tree \`${report.source.treeSha}\`）`,
    `- 内容范围：\`${report.source.baseTag}..${report.source.commitSha.slice(0, 12)}\``,
    `- 变更规模：${report.source.commitCount} 个提交、${report.source.changedFileCount} 个文件（+${report.source.additions} / -${report.source.deletions}）`,
    `- SHA-256：\`${report.artifact.sha256}\``,
    ...(report.scan ? [
      `- GitHub 元数据扫描：${report.scan.commitMetadataCompleted}/${report.scan.commitMetadataRequested} 个提交、${report.scan.pullRequestMetadataCompleted}/${report.scan.pullRequestMetadataRequested} 个 PR；${report.scan.concurrency} 并发，截止 ${report.scan.deadlineMs} ms`,
    ] : []),
    "",
    "### 关联 PR",
    "",
  ];
  if (report.pullRequests.length === 0) {
    lines.push("- 无关联 PR。", "");
  } else {
    for (const pullRequest of report.pullRequests) {
      lines.push(
        `- [#${pullRequest.number}](${pullRequest.url}) — ${pullRequest.statusLabel} — ${pullRequest.summary}`,
      );
    }
    lines.push("");
  }
  lines.push("### 未关联 PR 的直接提交", "");
  if (report.source.directCommits.length === 0) {
    lines.push("- 无。所有范围内提交均已关联到上述 PR。", "");
  } else {
    for (const commit of report.source.directCommits) {
      lines.push(`- \`${commit.sha.slice(0, 12)}\` — ${commit.subject}`);
    }
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

async function artifactRecord({ root, artifactPath, version, architecture }) {
  assert.match(version ?? "", VERSION_PATTERN, "version must be semantic");
  assert.match(architecture ?? "", /^(?:arm64|x64)$/u, "architecture must be arm64 or x64");
  const resolved = assertManagedPath(root, artifactPath, "artifact path");
  assert.equal(path.extname(resolved), ".dmg", "package delivery artifact must be a DMG");
  const info = await stat(resolved).catch(() => null);
  assert.ok(info?.isFile(), `package delivery artifact is missing: ${resolved}`);
  const bytes = await readFile(resolved);
  return Object.freeze({
    file: path.basename(resolved),
    path: path.relative(root, resolved),
    version,
    architecture,
    size: info.size,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}

export async function writePackageDeliveryReport({
  root = productRoot,
  kind,
  artifactPath,
  version,
  architecture,
  baseTag: explicitBaseTag = null,
  repository: explicitRepository = null,
  outputDirectory = null,
  deadlineMs = DEFAULT_PACKAGE_DELIVERY_DEADLINE_MS,
  now = new Date(),
}) {
  const normalizedDeadlineMs = normalizeDeadlineMs(deadlineMs);
  const scanStartedAt = Date.now();
  const scanDeadlineAt = scanStartedAt + normalizedDeadlineMs;
  const dirty = gitOutput(root, ["status", "--porcelain", "--untracked-files=all"]);
  assert.equal(dirty, "", "package delivery report requires a clean committed source tree");
  const headSha = gitOutput(root, ["rev-parse", "HEAD"]);
  const treeSha = gitOutput(root, ["rev-parse", "HEAD^{tree}"]);
  const repository = resolveRepository(root, explicitRepository);
  const baseTag = resolveBaselineTag({
    root,
    kind,
    explicitBaseTag,
    headSha,
  });
  const commits = commitsInRange(root, baseTag);
  const diff = diffSummary(root, baseTag);
  const github = await collectPullRequests({
    root,
    repository,
    commits,
    deadlineAt: scanDeadlineAt,
    deadlineMs: normalizedDeadlineMs,
  });
  const artifact = await artifactRecord({
    root,
    artifactPath,
    version,
    architecture,
  });
  const currentHeadSha = gitOutput(root, ["rev-parse", "HEAD"]);
  const currentTreeSha = gitOutput(root, ["rev-parse", "HEAD^{tree}"]);
  assert.equal(
    currentHeadSha,
    headSha,
    "source HEAD changed while creating the package delivery report; rerun on the exact package commit",
  );
  assert.equal(
    currentTreeSha,
    treeSha,
    "source Tree changed while creating the package delivery report; rerun on the exact package commit",
  );
  const report = createPackageDeliverySnapshot({
    kind,
    artifact,
    repository,
    baseTag,
    headSha,
    treeSha,
    commits: github.commits,
    changedFiles: diff.files,
    additions: diff.additions,
    deletions: diff.deletions,
    pullRequests: github.pullRequests,
    scan: github.scan,
    generatedAt: now.toISOString(),
  });
  const managedOutput = assertManagedPath(
    root,
    outputDirectory || path.join("output", "package-delivery"),
    "report output",
  );
  await mkdir(managedOutput, { recursive: true });
  const jsonPath = path.join(managedOutput, "package-delivery-report.json");
  const markdownPath = path.join(managedOutput, "package-delivery-report.md");
  const markdown = renderPackageDeliveryMarkdown(report);
  await Promise.all([
    writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8"),
    writeFile(markdownPath, markdown, "utf8"),
  ]);
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `\n${markdown}`, "utf8");
  }
  console.log(`Package delivery JSON: ${jsonPath}`);
  console.log(`Package delivery Markdown: ${markdownPath}`);
  console.log("");
  process.stdout.write(markdown);
  return { report, jsonPath, markdownPath };
}

export function parseArguments(argv) {
  const options = {
    kind: null,
    artifactPath: null,
    version: null,
    architecture: null,
    baseTag: null,
    repository: null,
    outputDirectory: null,
    deadlineMs: DEFAULT_PACKAGE_DELIVERY_DEADLINE_MS,
  };
  while (argv.length > 0) {
    const argument = argv.shift();
    const value = argv.shift();
    if (!value) throw new Error(`${argument} requires a value.`);
    if (argument === "--kind") options.kind = value;
    else if (argument === "--artifact") options.artifactPath = value;
    else if (argument === "--version") options.version = value;
    else if (argument === "--architecture") options.architecture = value;
    else if (argument === "--base-tag") options.baseTag = value;
    else if (argument === "--repository") options.repository = value;
    else if (argument === "--output") options.outputDirectory = value;
    else if (argument === "--deadline-ms") options.deadlineMs = normalizeDeadlineMs(value);
    else throw new Error(`Unknown package delivery argument: ${argument}`);
  }
  if (!options.kind || !options.artifactPath || !options.version || !options.architecture) {
    throw new Error("--kind, --artifact, --version and --architecture are required.");
  }
  return options;
}

async function main() {
  await writePackageDeliveryReport(parseArguments(process.argv.slice(2)));
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  });
}
