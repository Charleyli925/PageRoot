# Git workflow

## Single source of truth

`https://github.com/Charleyli925/PageRoot` is the canonical repository and `main` is the canonical source branch. A local checkout is a working copy. Build folders and installed applications are outputs only.

```text
GitHub main
  -> short-lived branch
  -> draft Pull Request + impact-selected feedback
  -> ready Pull Request + complete source gate + Tree Hash attestation
  -> main commit + exact-tree verification + fast smoke
  -> pre-tag installer candidate + packaged-runtime verification
  -> exact candidate verification + immutable version tag + GitHub Release
```

## Daily changes

Start from current `main`:

```bash
npm run task:status
npm run task:start -- feature/short-name
```

`task:start` refuses dirty, detached, divergent or non-`main` checkouts. It fetches `origin`, fast-forwards `main` and creates the short-lived branch without stashing or deleting work. The equivalent manual commands remain:

```bash
git switch main
git pull --ff-only
git switch -c feature/short-name
```

Inspect and save coherent checkpoints:

```bash
git status --short
git diff
npm run task:finish
git add <intentional-files>
git diff --cached
git commit -m "feat: describe the user-visible outcome"
git push -u origin feature/short-name
```

Open a Pull Request, wait for required CI, review the final diff, then squash-merge. Delete the merged branch. Never use a DMG, `.app`, copied folder or local backup as the basis for a new edit.

An installable developer preview is an optional side output of an exact clean
commit, not a branch stage. Generate it only after an explicit developer
request; never commit its `output/developer-preview/` files, merge because it
passed, or promote its ad-hoc DMG into a formal release. See
`docs/DEVELOPER_PREVIEW_PLAYBOOK.md`.

Recommended prefixes are `agent/`, `feature/`, `fix/`, `docs/`, `test/`, `refactor/`, `chore/` and `recovery/`. Commits should be small enough to explain and restore. Avoid mixing formatting, generated output and behavioral changes.

Codex and other coding agents follow `AGENTS.md`; detailed authorization, worktree, documentation and final-report behavior is in `docs/CODEX_WORKFLOW.md`. Implementation tasks normally end at a tested Pull Request. Merge and release remain separate explicit decisions.

## Updating an active branch

```bash
git fetch origin
git rebase origin/main
```

If other people already depend on the branch, prefer merging `origin/main` instead of rewriting shared history. Never force-push `main` or a release tag.

## Recovering and comparing

```bash
git log --oneline --decorate --graph --all
git diff main...HEAD
git show <commit>:path/to/file
git switch -c recovery/<name> <commit>
```

Use `git revert <commit>` to undo a merged public change while preserving history. Do not delete history to conceal a secret; revoke the secret first, then follow GitHub's sensitive-data removal procedure.

## Release rule

Version, commit, tag and artifacts form one immutable set. `npm run release:mac` remains the complete local source-and-artifact gate and refuses a dirty worktree. The governed GitHub path first runs `Release Candidate` on reviewed `main`: a successful PR source-gate attestation must match the exact tree/version and be no more than seven days old. The workflow embeds the commit/tree in `build-info.json`, verifies one pre-sign App before Apple work, signs/notarizes that same App, freezes it as a resumable checkpoint, and generates the final DMG/ZIP from that checkpoint without rebuilding the App.

Only after that candidate succeeds may the separate `Release` workflow run for the exact version on current `main`. It accepts a matching candidate no more than 72 hours old, verifies every downloaded asset hash, creates the annotated tag and publishes the same files without rebuilding. Do not push release tags manually. See `docs/RELEASING.md` and `docs/RELEASE_PIPELINE_GOVERNANCE.md`.
