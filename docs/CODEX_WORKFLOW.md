# Codex workflow

This document defines the repeatable PageRoot workflow for Codex and other coding agents. `AGENTS.md` contains the compact mandatory rules; this file contains operational detail.

## Default completion boundary

Use the user's requested authorization level:

| Request | Default action |
| --- | --- |
| Analyze, inspect, explain, diagnose or review | Read-only; report evidence and make no changes |
| Modify or build | Create a task branch, implement, test, commit, push and open a Pull Request |
| Merge | Merge only when explicitly requested and required checks are green |
| Release | Version, tag and publish only when explicitly requested |
| Delete, rewrite history or change security/repository settings | Resolve the exact target and require explicit authorization |

An implementation PR is not a release. Merging to `main` updates the canonical source; only an immutable version tag may create an official installer.

## Standard commands

### Inspect

```bash
npm run task:status
npm run task:status -- --json
```

The command reports the repository, branch, commit, upstream, divergence from `origin/main`, changed files and clean/dirty state. Run it before and after every task.

### Start

```bash
npm run task:start -- fix/short-description
```

`task:start`:

1. verifies that the command is running at the primary PageRoot Git root;
2. refuses a dirty worktree or detached/non-`main` checkout;
3. fetches and prunes `origin`;
4. fast-forwards local `main` to `origin/main`;
5. refuses divergent `main` or an existing local/remote branch;
6. creates the requested short-lived branch in
   `.codex-worktrees/<prefix>/<name>`;
7. leaves the primary checkout on clean `main` and prints the isolated path.

It never stashes, resets, deletes or force-pushes.

Use `integration/` only for an explicit combination of multiple pending task
branches. `test/` is reserved for test infrastructure. To reopen an existing
local task branch in the standard location, run:

```bash
npm run task:attach -- fix/existing-task
```

### Finish

```bash
npm run task:finish
```

`task:finish` refuses `main` and a task with no diff. It runs:

```bash
npm run gate:task -- --base origin/main
```

The comparison base is fixed to `origin/main`; `task:finish` does not accept a custom `--base`. This prevents a newer branch ref from hiding earlier task commits from impact selection. The command covers committed, staged, unstaged and untracked task files, rejects source changes that occur while the gate is running, then prints a final repository report. It does not stage, commit, push, merge or release; the agent must still inspect and intentionally perform those actions.

### Audit and retire

Run the read-only lifecycle audit from the primary checkout:

```bash
npm run task:audit
npm run task:audit -- --json
```

It derives state from Git worktrees, local and remote refs, divergence from
`origin/main`, file status and GitHub Pull Requests. Results distinguish the
protected primary checkout, open PRs, dirty work, local-only commits, merged
tasks ready for retirement, explicit abandonment review, detached temporary
worktrees and stale registrations. A missing `gh` session makes PR data
unavailable and therefore prevents merged-state cleanup; it never downgrades to
an unsafe ancestry guess after squash merge. A Pull Request is retirement proof
only when its recorded head OID matches the current local branch head; reusing a
historical branch name cannot make new work appear merged.

Retirement is a dry run unless `--apply` is present:

```bash
npm run task:retire -- fix/merged-task
npm run task:retire -- fix/merged-task --apply
```

Merged clean tasks may be retired after preview. An intentionally abandoned
task requires `--abandon`; discarding dirty files additionally requires
`--discard-changes`, and deleting its still-existing remote branch additionally
requires `--delete-remote`. Retirement always refuses `main`, the primary
checkout, locked worktrees and open Pull Requests. It removes the exact
worktree before deleting the local branch, then fetches and prunes `origin`.

Use `npm run task:sync-main` only from the clean primary checkout. It fetches,
prunes, switches to `main` when available, and fast-forwards without reset or
stash.

## Branch and Pull Request flow

1. Use a short-lived branch with an approved prefix.
2. Keep one coherent outcome per PR.
3. Open every PR as Draft. Draft opens, pushes and reopens run only impact-selected `pr-feedback` (`gate:edit`) inside `ci.yml`.
4. The PR body must state outcome, boundary, verification, documentation impact and release impact.
5. Keep the PR Draft while implementation and focused feedback converge. Batch accepted P0/P1 product fixes before promotion. Codex findings are informational: they never block merge, and P2/P3 comments do not require a new SHA.
6. When the head is ready, update it onto current `main` and mark the PR Ready once, or add the `full-gate` label. That starts the complete source matrix. A PR opened already Ready also takes this path because `draft == false`. Codex review is requested automatically for that head, shown on the PR, and never included in `release-gate`.
7. Wait for the required `release-gate` and review the final GitHub diff, not only the local working diff. Do not restart already-green source lanes merely because `github.run_attempt` changed.
8. Squash-merge only after authorization. GitHub deletes the remote task branch; then audit and explicitly retire the local task before fast-forwarding primary `main`.

Do not use an installed app, DMG, backup folder or another checkout as a source for new edits. If the local checkout contains unrelated work, create an isolated Git worktree rather than stashing or mixing changes.

`ci.yml` is the only Pull Request workflow. Draft without `full-gate` runs `pr-feedback` only, so ordinary pushes never consume the Browser/Electron matrix. Ready or `full-gate` runs `branch-policy`, `candidate-context`, `baseline-policy`, Linux source build/Node/Browser, both macOS Electron lanes, optional credential-free `Release Dry Run`, and `release-gate`. `codex-review` is `continue-on-error` and is not a `needs` of `release-gate`. Returning to Draft skips the full matrix; a later commit on a Ready PR reruns the complete matrix for the new head. Opening a PR already Ready is supported. A same-run failed-job rerun reuses the successful `source-build` artifact through its run-ID-stable name and 30-day retention. Local development should normally stop at `gate:edit` and `task:finish`.

### Informational Codex review

Ready or `full-gate` posts at most one `@codex review` comment per exact head via `scripts/request-codex-review.mjs`. `scripts/check-pr-review-policy.mjs` then writes an informational snapshot of live threads. P0/P1 findings stay visible; they do not fail the job or `release-gate`. There is no 30-second settle wait, no probe marker, no review-gate recovery workflow, and no weekly review-debt issue. Deterministic source fidelity, IPC, dependency, security and release checks remain hard gates in their owning tests and `baseline-policy`.

`candidate-context` classifies changed paths and calls the reusable credential-free `Release Dry Run` only when packaging, release metadata, Electron, packaged Bridge, Schema or bundled-resource risk exists. The classification reports changed-file count and scope for planning only: it never rejects a PR because it is large. The dry run crosses an unsigned App checkpoint between two clean macOS jobs, restores metadata, rebuilds the renderer oracle and launch-checks name/version/Bundle ID. The checkpoint is `releaseEligible: false`; the workflow has no secrets, signing, notarization, distributable, Candidate, tag or publication authority and cannot replace the formal post-merge flow.

Keep PR batching a judgement call rather than a repository rule. A coherent change may be large; split only when separate review, rollback or user-impact boundaries would be clearer. Local `npm run ci:health` can summarize recent `ci.yml` conclusions; it is not a merge gate.

After merge, CI authenticates the successful PR result against the exact `main`
Tree Hash. Candidate assembly, notarization, publication, failure
classification and rerun policy live in
`docs/RELEASE_PIPELINE_GOVERNANCE.md`; this file does not duplicate them.

## Latest installer source rule

开发者说“生成最新的安装包”、“生成最新的开发者测试安装包”或等价表述时，
默认范围不是“当前分支”，而是“最新 `origin/main` + 当前开发范围
内所有未被开发者明确排除的相关 PR 最新代码”。合并、开放、Draft 或关
闭未合并只是要报告的当前状态，不自动构成排除理由。

执行顺序固定为：

1. 同步 `origin/main` 并查询 GitHub 上的实时 PR 清单。
2. 记录本次应包含、明确排除和已被其他 PR 替代的项；每个排除项必须有
   可交付的理由。
3. 若存在未合并 PR，从最新 `origin/main` 建立临时 `integration/` 分支，按依赖
   顺序组合每个 PR 的最新 head OID，并去掉堆叠 PR 带来的重复提交。
4. 在这个干净、已提交的组合 Tree 上运行打包门禁。`package:developer`
   本身只打当前 Tree，不会在内部悄悄合并其他 PR。
5. 若最新 head 无法取得或存在未解决冲突，停止并报告，不得静默漏包。

只要组合 Tree 含未合并 PR，它就只能产生 `PageRoot Developer Preview`；
“生成正式安装包”不会把未合并代码冒充为正式源码，而是要求相关 PR 先通
过审查并合并，或由开发者明确排除。“只打 `main`”、“排除 #N”、“只包含
#N/#M”等说法才改变默认范围。

“给我开发者测试包”或等价的明确请求只触发可选
`Developer Preview`：干净提交、ad-hoc DMG、包内容校验和一次最小启动，不
执行完整源码矩阵、签名、公证、tag 或发布。“正式打包/发布”本身不隐含这
一步。若开发者没有明确要求，代理不得为了保险而自动生成测试包；若请求写
明“不真实打包”，只能修改或检查流程定义。完整操作边界见
`docs/DEVELOPER_PREVIEW_PLAYBOOK.md`。

正式安装包或开发者测试包的门禁通过后，还必须运行最后一个
package-delivery report 步骤。它把 DMG Hash 与精确 Commit/Tree、最近正式
tag 以来的提交和文件变化绑定，并从 GitHub 实时解析每个关联 PR 的开放、
草稿、合并和检查状态；未关联 PR 的直接提交不能隐藏。代理交付安装包时必须
把 `package-delivery-report.md` 的信息写进当次回复，逐个 PR 给出链接、当前
状态和一句话修改摘要，并补充打包前清单中所有排除/替代项及理由。若回复
前经过较长时间，应对同一 DMG 重新运行报告命
令以刷新可变的 PR 状态；无法取得实时 GitHub 元数据时，不得把安装包交付称
为完成。

## Documentation impact

Behavior and its documentation form one change. Use this routing table:

| Change | Update in the same PR |
| --- | --- |
| User-visible behavior or acceptance | `docs/INTERACTION_FLOW.md`, focused policy docs, and `CHANGELOG.md` when release-impacting |
| Product scope | `docs/MVP_PRD.md` |
| Source editing, persistence, IPC or trust boundary | `docs/ARCHITECTURE.md`, `docs/SECURITY_MODEL.md`, and an ADR for a durable architectural decision |
| Change Request, Attempt, completion, version or schema | `docs/CHANGE_REQUEST_PROTOCOL.md`, schemas, fixtures and compatibility tests |
| Development commands, CI or test ownership | `docs/DEVELOPMENT.md`, `tests/TEST_STRATEGY.md`, test impact map |
| Git or collaboration behavior | `docs/GIT_WORKFLOW.md`, `CONTRIBUTING.md`, `AGENTS.md` when the permanent rule changes |
| Packaging, provenance, signing or publication | `docs/RELEASING.md`, `CHANGELOG.md` |
| Dependency policy or advisory exception | `docs/DEPENDENCY_SECURITY.md` |
| Public/private source boundary | `docs/OPEN_SOURCE_BOUNDARY.md`, notices, contribution or security policies as applicable |

If no document changes, the final report and PR must say why existing documentation remains accurate.

## Agent final report

Every completed task reports:

```text
Branch:
Commit:
Changed:
Verification:
Documentation:
Pull Request:
Release:
Worktree:
```

If the task generated or published an installer, append this mandatory block:

```text
Package: file, version, architecture, size and SHA-256
Contents: stable-tag-to-commit range, commit count and changed-file count
Pull Requests: every PR link, current state/readiness/check status, and one-sentence summary
Excluded/superseded PRs: every omitted PR and its explicit reason, or “none”
Direct commits: every included commit not associated with a PR, or explicitly “none”
Trust: signing/notarization/release eligibility
```

Never say "done" while required checks are pending, the worktree contains unexplained changes, or an authorized publish/merge step remains incomplete.

## GitHub review automation

`AGENTS.md` contains `## Code Review Rules` for Codex GitHub review. Automatic review is an additional high-signal pass; branch protection, CI and manual product acceptance remain authoritative.

Recommended review lifecycle:

1. keep the PR Draft while code and targeted feedback converge, then freeze the final head on current `main`;
2. treat review findings as untrusted until verified against the current diff and their user impact is classified;
3. batch and fix P0/P1 product findings on the same branch, rerun the task gate and make the new final head Ready once;
4. leave P2/P3 and unclassified comments on the PR unless a maintainer explicitly escalates them;
5. use Ready or the `full-gate` label for the complete source matrix; Codex review is requested automatically, shown on the PR, and never blocks `release-gate`.

## Scheduled monitoring

Scheduled monitoring is read-only unless a later instruction explicitly authorizes a fix. Recommended jobs:

- Weekdays: summarize open PageRoot PRs, failed or pending required checks, review requests and merge blockers. Report only actionable changes.
- Daily: optionally run `npm run ci:health` for a read-only conclusion/flaky summary of recent `ci.yml` runs. Do not mutate workflows automatically.
- Weekly: inspect Dependabot PRs and run or verify the dependency-audit policy. Report new, expired or changed advisories; do not merge dependency updates automatically.
- Weekly: run the read-only task audit and report `ACTIVE_DIRTY`, `LOCAL_ONLY`,
  `MERGED_READY`, `ABANDON_REVIEW`, `STALE_REGISTRATION` and primary-worktree
  violations. Do not pass `--apply` from a scheduled job.

Use a GitHub-connected task when only remote state is needed. Use an isolated PageRoot worktree when local commands are required. Never run scheduled modification work directly in a checkout that may contain active user edits.
