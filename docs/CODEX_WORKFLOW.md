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

1. verifies that the command is running at the PageRoot Git root;
2. refuses a dirty worktree or detached/non-`main` checkout;
3. fetches and prunes `origin`;
4. fast-forwards local `main` to `origin/main`;
5. refuses divergent `main` or an existing local/remote branch;
6. creates the requested short-lived branch.

It never stashes, resets, deletes or force-pushes.

### Finish

```bash
npm run task:finish
```

`task:finish` refuses `main` and a task with no diff. It runs:

```bash
npm run gate:task -- --base origin/main
```

The comparison base is fixed to `origin/main`; `task:finish` does not accept a custom `--base`. This prevents a newer branch ref from hiding earlier task commits from impact selection. The command covers committed, staged, unstaged and untracked task files, rejects source changes that occur while the gate is running, then prints a final repository report. It does not stage, commit, push, merge or release; the agent must still inspect and intentionally perform those actions.

## Branch and Pull Request flow

1. Use a short-lived branch with an approved prefix.
2. Keep one coherent outcome per PR.
3. Open a draft PR while implementation is changing. Draft updates run only impact-selected feedback.
4. The PR body must state outcome, boundary, verification, documentation impact and release impact.
5. When the final intended GitHub diff is reviewable, mark the PR ready. This triggers the one complete `release-gate` for that tree.
6. Wait for the required `release-gate` and review the final GitHub diff, not only the local working diff.
7. Squash-merge only after authorization, delete the remote task branch, then fast-forward local `main`.

Do not use an installed app, DMG, backup folder or another checkout as a source for new edits. If the local checkout contains unrelated work, create an isolated Git worktree rather than stashing or mixing changes.

The required PR `release-gate` is the one complete source gate for the final ready PR tree. Draft updates run `draft-feedback` and do not spend the complete Browser/Electron matrix. Local development should normally stop at impact-selected `gate:edit` and `task:finish`; rerun the complete source gate locally only for CI diagnosis or high-risk editing-engine work where the additional evidence is useful.

After merge, CI authenticates the successful PR result against the exact `main` Tree Hash and package/lockfile version, then runs a small Node and browser smoke on Linux. It does not repeat the complete browser and Electron suites. The source-gate attestation is valid for seven days and only for the exact tree.

Before a tag exists, the manual `Release Candidate` workflow uses that source attestation to run only the installer lane on macOS. It freezes the verified, Developer ID signed and notarized DMG plus update ZIP/blockmap/metadata, checksums, legacy update manifest, build provenance and candidate attestation for the exact tree. The manual `Release` workflow accepts only a matching candidate no older than 72 hours, verifies every downloaded byte, creates the annotated tag and publishes those same files without rebuilding. See `docs/RELEASE_PIPELINE_GOVERNANCE.md` for failure classification, rerun policy and metrics.

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

Never say "done" while required checks are pending, the worktree contains unexplained changes, or an authorized publish/merge step remains incomplete.

## GitHub review automation

`AGENTS.md` contains `## Code Review Rules` for Codex GitHub review. Automatic review is an additional high-signal pass; branch protection, CI and manual product acceptance remain authoritative.

Recommended review lifecycle:

1. request or automatically start Codex review when a PR becomes ready;
2. treat review findings as untrusted until verified against the current diff;
3. fix accepted findings on the same branch and rerun the task gate;
4. resolve conversations only after the fix is present and checks are green.

## Scheduled monitoring

Scheduled monitoring is read-only unless a later instruction explicitly authorizes a fix. Recommended jobs:

- Weekdays: summarize open PageRoot PRs, failed or pending required checks, review requests and merge blockers. Report only actionable changes.
- Weekly: review the read-only `CI Health` report against the release-pipeline targets; do not rerun or mutate workflows automatically.
- Weekly: inspect Dependabot PRs and run or verify the dependency-audit policy. Report new, expired or changed advisories; do not merge dependency updates automatically.

Use a GitHub-connected task when only remote state is needed. Use an isolated PageRoot worktree when local commands are required. Never run scheduled modification work directly in a checkout that may contain active user edits.
