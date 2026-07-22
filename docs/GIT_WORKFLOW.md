# Git workflow

## Single source of truth

`https://github.com/Charleyli925/PageRoot` is the canonical repository and `main` is the canonical source branch. A local checkout is a working copy. Build folders and installed applications are outputs only.

```text
GitHub main
  -> short-lived branch
  -> reviewed Pull Request + CI
  -> main commit
  -> immutable version tag
  -> reproducible GitHub Release assets
```

## Daily changes

Start from current `main`:

```bash
git switch main
git pull --ff-only
git switch -c feature/short-name
```

Inspect and save coherent checkpoints:

```bash
git status --short
git diff
npm run gate:task
git add <intentional-files>
git diff --cached
git commit -m "feat: describe the user-visible outcome"
git push -u origin feature/short-name
```

Open a Pull Request, wait for required CI, review the final diff, then squash-merge. Delete the merged branch. Never use a DMG, `.app`, copied folder or local backup as the basis for a new edit.

Recommended prefixes are `feature/`, `fix/`, `docs/`, `test/`, `refactor/` and `chore/`. Commits should be small enough to explain and restore. Avoid mixing formatting, generated output and behavioral changes.

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

Version, commit, tag and artifacts form one immutable set. `npm run release:mac` refuses a dirty worktree and embeds the exact commit/tree in `build-info.json`. If source changes after a successful gate, the entire release gate must run again.
