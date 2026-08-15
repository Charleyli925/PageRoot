#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import path from "node:path";

const scriptPath = fileURLToPath(import.meta.url);
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const GITHUB_API_VERSION = "2022-11-28";

function parseOptions(argv) {
  const options = { repository: "", pullRequest: 0, head: "", tokenEnv: "GITHUB_TOKEN" };
  while (argv.length > 0) {
    const argument = argv.shift();
    const value = argv.shift();
    if (!value) throw new Error(`${argument} requires a value.`);
    if (argument === "--repository") options.repository = value;
    else if (argument === "--pull-request") options.pullRequest = Number(value);
    else if (argument === "--head") options.head = value.toLowerCase();
    else if (argument === "--token-env") options.tokenEnv = value;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!REPOSITORY_PATTERN.test(options.repository)) {
    throw new Error("--repository must use owner/name.");
  }
  if (!Number.isInteger(options.pullRequest) || options.pullRequest <= 0) {
    throw new Error("--pull-request must be a positive integer.");
  }
  if (!SHA_PATTERN.test(options.head)) {
    throw new Error("--head must be a 40-character Git SHA.");
  }
  return options;
}

export function reviewCommentBody(headSha) {
  return [
    "@codex review",
    "",
    `PageRoot requests a Codex review of exact head \`${headSha}\`.`,
    "",
    "This review is informational and does not block merge. `release-gate` remains the merge requirement.",
    "",
  ].join("\n");
}

export function alreadyRequestedForHead(comments, headSha) {
  return (Array.isArray(comments) ? comments : []).some((comment) => (
    String(comment?.user?.login || "").toLowerCase() === "github-actions[bot]"
    && String(comment?.body || "").includes("@codex review")
    && String(comment?.body || "").includes(headSha)
  ));
}

async function githubJson(url, token, init = {}) {
  const response = await globalThis.fetch(url, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
      ...(init.headers || {}),
    },
  });
  if (!response.ok) {
    const body = (await response.text()).slice(0, 500);
    throw new Error(`GitHub API ${response.status} for ${url}: ${body}`);
  }
  if (response.status === 204) return null;
  return await response.json();
}

export async function requestCodexReview(options) {
  const token = process.env[options.tokenEnv] || "";
  if (!token) throw new Error(`Environment variable ${options.tokenEnv} is required.`);
  const apiBase = `https://api.github.com/repos/${options.repository}`;
  const comments = await githubJson(
    `${apiBase}/issues/${options.pullRequest}/comments?per_page=100`,
    token,
  );
  const alreadyRequested = alreadyRequestedForHead(comments, options.head);
  if (alreadyRequested) {
    return { requested: false, reason: "already_requested_for_head" };
  }
  await githubJson(`${apiBase}/issues/${options.pullRequest}/comments`, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body: reviewCommentBody(options.head) }),
  });
  return { requested: true, reason: "posted_codex_review_request" };
}

async function run(options) {
  const result = await requestCodexReview(options);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  run(parseOptions(process.argv.slice(2))).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
