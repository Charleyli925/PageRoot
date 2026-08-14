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
3. Open every PR as draft. All ordinary PR updates run only impact-selected feedback, regardless of the current draft flag.
4. The PR body must state outcome, boundary, verification, documentation impact and release impact.
5. Keep the PR Draft while implementation, focused feedback and local task verification converge. Batch accepted P0/P1 fixes before promotion. P2/P3 and unclassified findings are review debt unless the maintainer deliberately escalates them; do not create a new SHA merely to clear non-blocking debt.
6. Update the final head onto current `main`, freeze it and mark the PR Ready once. Ready is the sole final-review trigger; do not post a separate Draft review command or a second review command while promotion is running. `review-policy` binds the final Codex response to the exact live head/base, accepts an exact-commit review or clean comment written after the frozen base commit existed (Draft included), requires post-Ready root `+1` reactions, waits a 30-second settle window, blocks user-impact P0/P1 findings and P0/P1 `CHANGES_REQUESTED` reviews, and writes P2/P3/unclassified findings to a machine-readable debt artifact regardless of reviewer. The branch/dependency baseline and test lanes run in parallel with that review.
7. Wait for the required `release-gate` and review the final GitHub diff, not only the local working diff. If the bounded review wait expires before a valid Codex completion arrives, the trusted default-branch recovery workflow will revalidate the exact pair and reuse only the failed jobs after that completion appears; do not manually restart green source lanes.
8. Squash-merge only after authorization. GitHub deletes the remote task branch; then audit and explicitly retire the local task before fast-forwarding primary `main`.

Do not use an installed app, DMG, backup folder or another checkout as a source for new edits. If the local checkout contains unrelated work, create an isolated Git worktree rather than stashing or mixing changes.

The required PR `release-gate` is the one complete source gate for an explicitly promoted final tree. `PR Feedback` owns only `opened`, `synchronize` and `reopened`; returning to Draft changes no code and starts no Feedback run. It runs `gate:edit` and never reports the `release-gate` status; it also runs a non-blocking `review-advisory` job that evaluates the live pair with the same review-policy evidence contract, so Draft-phase Codex P0/P1 findings are visible before promotion. The complete workflow listens only to `ready_for_review`. `review-policy`, `branch-policy` and `candidate-context` start independently; `baseline-policy` depends only on branch policy, and source build plus both macOS lanes depend only on the deterministic dependency/runtime baseline. This lets review and the costly test matrix overlap without reusing stale evidence. A later commit shares the same concurrency key, cancels an in-flight candidate and leaves the new SHA without the required check. A base update invalidates the final head/base pair even when the head is unchanged. Convert the PR back to Draft, batch work and Ready the new final pair once. Opening a PR directly as Ready is not a supported promotion route: GitHub emits `opened`, not `ready_for_review`, so create it as Draft and perform one explicit final Ready transition. A same-run failed-job rerun reuses the successful `source-build` and `electron-renderer` artifacts through their run-ID-stable names and 30-day retention; it must not restart already-green source lanes merely because `github.run_attempt` changed. Local development should normally stop at impact-selected `gate:edit` and `task:finish`; rerun the complete source gate locally only for CI diagnosis or high-risk editing-engine work where the additional evidence is useful.

### Final-review policy

`review-policy` is intentionally a single final-candidate contract, not a second Draft review. It re-reads the live head/base, the latest `ready_for_review` event and root Pull Request reactions on every 15-second poll. The workflow event freezes the expected pair; a changed head, changed base, closed PR or return to Draft fails closed. A final Codex Pull Request review must name the exact `commit_id`, carry a matching `**Reviewed commit:**` prefix and be submitted after the frozen base commit existed; a review of the exact head written while the PR was still Draft therefore counts, and when the base commit date is unavailable the policy falls back to requiring submission after the Ready transition. An unedited clean Codex issue comment beginning `Codex Review: Didn't find any major issues.` and bound to the exact commit is accepted on the same basis. Codex may instead report a clean review by adding `+1` to the Pull Request itself; only a `+1` from `chatgpt-codex-connector[bot]` after the latest Ready transition is accepted, because reactions carry no commit identity and the Ready transition is their only tree binding. Human, non-`+1` and prior-promotion reactions never complete the policy.

The policy waits 30 seconds after the observed final completion, allowing the associated threads to arrive before classifying them. It blocks active, non-outdated P0/P1 findings because they represent user-impact risk. A P0/P1 `CHANGES_REQUESTED` review on the current final head remains blocking even if it was submitted while the PR was Draft; only root `+1` completion evidence must occur after Ready, while exact-commit review and comment evidence must occur after the frozen base commit. GitHub retains historical reviews, so the policy uses each reviewer's latest submitted decision on that head; only a later approval or dismissal withdraws their earlier change request, while a plain comment or pending review never does. P2, P3 and unclassified findings are retained as non-blocking debt. The P0/P1 boundary does not weaken deterministic source fidelity, IPC, dependency, security or release checks: those remain hard gates in their owning tests and policy jobs.

The check writes `output/review-policy/review-policy.json` with expected/current SHA pairs, completion kind and latency, blocking findings and deferred findings. `release-gate` reruns the same check in immediate revalidation mode after all source lanes; it never waits again or accepts a stale result. If the check records `review_wait_timed_out` and every deterministic source job is green, a later Codex review/comment starts `review-gate-recovery.yml`. GitHub Actions has no root-reaction trigger, so `+1` is consumed by the active bounded poll rather than the late-event recovery path. The trusted default-branch recovery workflow requires the current Ready head/base, a now-passing live policy, the original exact-pair timeout artifact and exactly `review-policy` plus `release-gate` as the failed jobs, then asks GitHub to rerun failed jobs on the original run. It refuses Draft/closed or changed pairs, P0/P1 findings, missing/mismatched artifacts and any source, Browser, Electron or dry-run failure. If Codex review infrastructure remains unavailable, keep the candidate Ready or repair the external configuration; do not compensate by adding a second manual review protocol.

`review-debt.yml` runs only from trusted scheduled/manual default-branch workflow code. It scans both current deferred inline threads and review-level P2/P3/unclassified `CHANGES_REQUESTED` findings, then updates one weekly rolling issue; its hidden machine-readable state carries a known finding forward when its PR has aged out of the seven-day activity scan, and removes it only after a later scan of that PR no longer observes it. It uses each reviewer's latest effective decision, does not check out PR heads, change code or merge anything. This is the regular batch queue for P2/P3/unclassified findings.

`candidate-context` classifies changed paths and calls the reusable credential-free `Release Dry Run` only when packaging, release metadata, Electron, packaged Bridge, Schema or bundled-resource risk exists. The classification reports changed-file count and scope for planning only: it never rejects a PR because it is large. The dry run crosses an unsigned App checkpoint between two clean macOS jobs, restores metadata, rebuilds the renderer oracle and launch-checks name/version/Bundle ID. The checkpoint is `releaseEligible: false`; the workflow has no secrets, signing, notarization, distributable, Candidate, tag or publication authority and cannot replace the formal post-merge flow.

Keep PR batching a judgement call rather than a repository rule. A coherent change may be large; split only when separate review, rollback or user-impact boundaries would be clearer. CI Health reports Ready count, candidate-to-merge time, review time, test completion, gate-to-merge wait and candidate churn so the team can correct actual congestion rather than enforce a mechanical size limit.

After merge, CI authenticates the successful PR result against the exact `main` Tree Hash, package/lockfile version and merged PR. Equality failure blocks immediately; equality success does not repeat Node, Browser or Electron source tests. The source-gate attestation is valid for seven days and only for the exact tree.

Before a tag exists, the manual `Release Candidate` workflow uses that source
attestation to assemble one pre-sign App on macOS. It checks package contents
and full packaged runtime before signing, checks signed startup before Apple,
then notarizes and freezes that exact App as an internal checkpoint. A second
job validates the checkpoint, passes it to electron-builder as `--prepackaged`,
notarizes the final DMG and freezes the verified DMG plus update
ZIP/blockmap/metadata, checksums, legacy update manifest, build provenance and
candidate attestation. If only the second job has an environment or Apple
failure, rerun failed jobs so the signed-App checkpoint is reused. The manual
`Release` workflow accepts only a matching candidate no older than 72 hours,
verifies every downloaded byte, creates the annotated tag and publishes those
same files without rebuilding. See
`docs/RELEASE_PIPELINE_GOVERNANCE.md` for failure classification, rerun policy
and metrics.

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
3. batch and fix P0/P1 findings on the same branch, rerun the task gate and make the new final head Ready once;
4. record P2/P3 and unclassified findings in the weekly review-debt queue unless a maintainer explicitly escalates them;
5. use Ready only for final promotion; its automatic Codex pass runs alongside the deterministic baseline and full test matrix, and `release-gate` immediately revalidates the exact final head/base before attestation.

## Scheduled monitoring

Scheduled monitoring is read-only unless a later instruction explicitly authorizes a fix. Recommended jobs:

- Weekdays: summarize open PageRoot PRs, failed or pending required checks, review requests and merge blockers. Report only actionable changes.
- Daily: generate the read-only `CI Health` dependency baseline and thirty-day metrics report; keep terminal gate metrics separate from active-run counts and recorded active runner minutes, then review misses without rerunning or mutating workflows automatically.
- Weekly: refresh the trusted rolling P2/P3/unclassified review-debt issue. The workflow may update only that issue; it never checks out PR code, changes a PR or merges.
- Weekly: inspect Dependabot PRs and run or verify the dependency-audit policy. Report new, expired or changed advisories; do not merge dependency updates automatically.
- Weekly: run the read-only task audit and report `ACTIVE_DIRTY`, `LOCAL_ONLY`,
  `MERGED_READY`, `ABANDON_REVIEW`, `STALE_REGISTRATION` and primary-worktree
  violations. Do not pass `--apply` from a scheduled job.

Use a GitHub-connected task when only remote state is needed. Use an isolated PageRoot worktree when local commands are required. Never run scheduled modification work directly in a checkout that may contain active user edits.
