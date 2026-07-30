# ADR 0008: Short-lived branches use managed isolated worktrees

- Status: Accepted
- Date: 2026-07-30

## Context

PageRoot already treats GitHub `main` as the source of truth and uses
short-lived Pull Request branches with squash merge. Local tasks nevertheless
accumulated across several worktree directory conventions, temporary paths and
deleted upstream branches. A branch could be merged or abandoned while its
local checkout remained indefinitely, and squash merge made ancestry-only
cleanup checks unreliable.

## Decision

The primary PageRoot checkout remains a clean `main` and owns the shared Git
metadata. New tasks are created from synchronized `origin/main` under
`.codex-worktrees/<prefix>/<name>`. The supported task prefixes include
`integration/` for an explicit combination of pending changes; `test/` remains
reserved for test infrastructure.

Lifecycle state is derived from Git worktrees, refs, file status, divergence and
GitHub Pull Request metadata instead of a second mutable task registry. Audits
are read-only. Retirement is a preview by default and requires an explicit
`--apply`; dirty abandonment and remote deletion require additional explicit
flags. `main`, the primary checkout, locked worktrees and open Pull Requests
cannot be retired.

GitHub remains responsible for protecting `main`, enforcing the final source
gate, squash merging and deleting merged remote branches. Local retirement is
separate because GitHub cannot safely inspect developer worktrees or
uncommitted files.

## Consequences

- Starting a task no longer moves the primary checkout away from `main`.
- Worktree paths directly reflect branch ownership and do not need a local
  registry file.
- A weekly audit can report drift without mutating developer state.
- Squash-merged branches are retired using Pull Request state rather than
  `git branch --merged`.
- Abandoned work remains recoverable until a developer explicitly applies the
  retirement plan.
- Historical nonstandard worktrees require a one-time reviewed migration.
