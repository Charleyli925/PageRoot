# Git workflow

## Single source of truth

`https://github.com/Charleyli925/PageRoot` is the canonical repository and `main` is the canonical source branch. A local checkout is a working copy. Build folders and installed applications are outputs only.

```text
GitHub main
  -> short-lived branch
  -> reviewed Pull Request + complete source gate + Tree Hash attestation
  -> main commit + exact-tree verification + fast smoke
  -> immutable version tag + installer verification
  -> reproducible GitHub Release assets
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

Version, commit, tag and artifacts form one immutable set. `npm run release:mac` refuses a dirty worktree and embeds the exact commit/tree in `build-info.json`. CI may avoid repeating the source suite only when a successful PR source-gate attestation matches the exact tree and version and is no more than seven days old. If the source changes, evidence is stale or remote evidence is unavailable, the tag workflow runs the entire source and artifact gate again.
