# Git workflow

## Single source of truth

`https://github.com/Charleyli925/PageRoot` is the canonical repository and `main` is the canonical source branch. A local checkout is a working copy. Build folders and installed applications are outputs only.

```text
GitHub main
  -> short-lived branch
  -> Pull Request updates + impact-selected feedback
  -> one explicit Draft-to-Ready final promotion + parallel review/test candidate gate + Tree Hash attestation
  -> main commit + exact-tree/version/PR attestation verification
  -> pre-tag installer candidate + packaged-runtime verification
  -> exact candidate verification + immutable version tag + GitHub Release
```

When `candidate-context` finds packaging, release metadata, Electron, packaged
Bridge, Schema or resource risk on a Ready candidate, it calls the reusable
`Release Dry Run` to assemble and restore an explicitly unsigned
(`identity=null`) App across two clean jobs. Source-only candidates skip it. It
is early feedback only: its checkpoint is `releaseEligible: false` and is not
on the linear Candidate/publication chain above.

## Daily changes

Start from current `main`:

```bash
npm run task:status
npm run task:start -- feature/short-name
```

`task:start` refuses dirty, detached, divergent or non-`main` primary checkouts. It fetches `origin`, fast-forwards `main` and creates the short-lived branch in a managed isolated worktree without stashing or deleting work. The equivalent manual commands remain:

```bash
git switch main
git pull --ff-only
git worktree add -b feature/short-name ../.codex-worktrees/feature/short-name origin/main
```

The primary checkout remains a clean `main`. `task:start` prints the new
worktree path; run all edits and task checks from that isolated checkout.
`integration/` is reserved for an explicitly reviewed combination of multiple
pending task branches. `test/` is only for test infrastructure.

### Latest-installer source composition

The phrases "latest installer" and "latest developer test installer" select a
source set, not merely the branch that happens to be checked out. Unless the
developer gives an inclusion or exclusion override, first make a live PR
inventory, then compose the package source as follows:

1. Fetch current `origin/main`; it supplies the canonical base and every change
   that has already merged.
2. Include the latest head OID of every applicable PageRoot PR in the current
   development scope that is not explicitly excluded. Open, draft and closed
   without merge are all eligible; PR state is evidence to report, not an
   implicit exclusion.
3. Create a clean temporary `integration/` branch and worktree from
   `origin/main`, and integrate unmerged heads in dependency order. Stacked PRs
   are composed once and duplicate commits are de-duplicated.
4. Record every selected PR and exact head OID before packaging. Also record
   every excluded or superseded PR with its reason so omission is visible.
5. If a selected head is unavailable or cannot be integrated without an
   unresolved conflict, stop and report the blocker; never build a package and
   describe it as containing all PRs.

This integration branch is disposable package input. Creating it does not
merge any source PR or authorize a merge to `main`. If even one selected PR is
not merged, the output must use the Developer Preview identity and remain
non-release-eligible. A formal candidate is still built only from reviewed
`main`; outstanding selected PRs must be merged first or explicitly excluded
by the developer.

Inspect and save coherent checkpoints from the task worktree:

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

Every Pull Request starts as Draft. `opened`, `synchronize` and `reopened`
events run only the impact-selected `PR Feedback` workflow plus its
non-blocking review-advisory snapshot; returning to Draft
alone starts nothing. Batch implementation and accepted P0/P1 corrections while
Draft. When the intended head is frozen, update it onto current `origin/main`
and mark it Ready once. That single `ready_for_review` transition starts
`review-policy` and the final Codex pass; do not post a Draft marker or another
review command while it runs. A substantive exact-commit Codex review, an
immutable clean exact-commit comment or a Codex Bot `+1` after Ready, a
30-second settle window and continuous live head/base validation are required.
The reaction is accepted only from Codex on the latest frozen Ready pair; older
or human reactions are ignored. Active P0/P1 findings and P0/P1
`CHANGES_REQUESTED` reviews block regardless of reviewer; P2/P3/unclassified findings become review debt and
are triaged in regular maintenance work. Deterministic dependency, source,
security and release checks remain hard gates regardless of review priority.

`branch-policy` and `baseline-policy` run independently of review, and the
complete source matrix starts after the deterministic baseline so review and
tests overlap. `release-gate` joins every lane, relevant candidate-only dry run
and review result, then revalidates the exact pair before attesting the tree.
The candidate classifier records PR scope and size only as advisory information;
it never rejects a PR for being large.

If `review-policy` alone times out before the exact-commit Codex result arrives,
`Review Gate Recovery` handles the late result from trusted default-branch code.
It revalidates the current Ready head/base and timeout artifact, requires every
source job to be green, and reruns only the failed jobs of that same CI run.
Never use this path for a product-test failure, active P0/P1, Draft PR, changed
head/base or a new commit; those require the normal fix-and-promote flow.

A Ready event freezes the expected head/base and must not be followed by a
commit. A new commit cancels any in-flight stale candidate and receives only PR
feedback. The new head cannot merge because it has no `release-gate`; convert it
to Draft, batch required P0/P1 work and mark it Ready again only after the new
pair is final. `main` accepts the resulting tree only when provenance
verification finds the fresh matching attestation; it does not repeat Node or
Browser smoke after that equality proof.

GitHub deletes the remote task branch after squash merge. Local worktrees are a
separate lifecycle: run `npm run task:audit` from the primary checkout, preview
the exact retirement with `npm run task:retire -- <branch>`, and apply it only
with `--apply`. Audit is read-only. Retirement refuses `main`, an open Pull
Request, the primary checkout, locked worktrees, and unexplained dirty or
local-only work. A deliberately abandoned dirty task additionally requires
`--abandon --discard-changes`; deleting an abandoned remote branch additionally
requires `--delete-remote`.

Use `npm run task:attach -- <branch>` to place an existing local task branch in
the standard `.codex-worktrees/<prefix>/<name>` location. Use
`npm run task:sync-main` to fetch, prune and fast-forward the clean primary
checkout without reset or stash.

An installable developer preview is an optional side output of an exact clean
commit, not a branch stage. Generate it only after an explicit developer
request; never commit its `output/developer-preview/` files, merge because it
passed, or promote its ad-hoc DMG into a formal release. See
`docs/DEVELOPER_PREVIEW_PLAYBOOK.md`.

Recommended prefixes are `agent/`, `feature/`, `fix/`, `docs/`, `test/`, `integration/`, `refactor/`, `chore/` and `recovery/`. Commits should be small enough to explain and restore. Avoid mixing formatting, generated output and behavioral changes. Pull Request CI enforces these prefixes; Dependabot branches remain allowed.

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

Version, commit, tag and artifacts form one immutable set. `npm run release:mac` remains the complete local source-and-artifact gate and refuses a dirty worktree. A candidate-classified Ready PR may invoke the credential-free unsigned (`identity=null`) dry run to prove App assembly, checkpoint recovery, metadata/renderer reconstruction and startup identity without credentials; source-only candidates intentionally skip it, and its distinct non-release checkpoint is never reusable here. The governed GitHub path first runs `Release Candidate` on reviewed `main`: a successful PR source-gate attestation must match the exact tree/version and be no more than seven days old. The workflow embeds the commit/tree in `build-info.json`, verifies one pre-sign App before Apple work, signs/notarizes that same App, freezes it as a resumable checkpoint, and generates the final DMG/ZIP from that checkpoint without rebuilding the App.

Only after that candidate succeeds may the separate `Release` workflow run for the exact version on current `main`. It accepts a matching candidate no more than 72 hours old, verifies every downloaded asset hash, creates the annotated tag and publishes the same files without rebuilding. Do not push release tags manually. See `docs/RELEASING.md` and `docs/RELEASE_PIPELINE_GOVERNANCE.md`.
