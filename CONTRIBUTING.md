# Contributing to PageRoot

Thank you for helping improve PageRoot.

## Before opening a change

1. Search existing Issues and Pull Requests.
2. Create a focused branch from the latest `main`.
3. Keep user files, local paths, credentials, generated builds and private design records out of the repository.
4. Preserve source fidelity: a visual edit must not serialize unrelated DOM or rewrite bytes outside the authorized source range.

## Development workflow

```bash
git switch main
git pull --ff-only
git worktree add -b fix/short-description ../.codex-worktrees/fix/short-description origin/main
npm ci
npx playwright install chromium
```

Repository agents may use `npm run task:start -- fix/short-description` for the
first three Git commands. It keeps the primary checkout on clean `main` and
prints the isolated task path. Run `npm run gate:edit` while working and
`npm run task:finish` before committing. Update tests and the routed
documentation in `AGENTS.md` with behavioral, contract or workflow changes. Use
a clear imperative commit message such as `fix: preserve selection across
source refresh`.

State, persistence and lifecycle changes must follow
`docs/ARCHITECTURE_CONTRACT.md`, `docs/STATE_OWNERSHIP.md` and
`docs/ENGINEERING_STANDARDS.md`. Name one owner, define rejected versus unknown
mutation outcomes, reuse the shared drain boundaries and remove any workaround
the new invariant supersedes. `npm run architecture:check` is mandatory.

Push the branch and open a Draft Pull Request. The PR must explain the problem, the chosen boundary, verification performed and any user-visible impact. Keep changes coherent, but PR size is advisory rather than a hard repository limit: split only when review, rollback or product boundaries are genuinely separate. Ready or the `full-gate` label starts the complete source matrix; Codex review is requested automatically, shown on the PR, and never blocks merge. Batch verified P0/P1 product fixes before marking the final head Ready.

GitHub removes the remote task branch after squash merge. Maintainers use the
read-only `npm run task:audit` report and an explicit
`npm run task:retire -- <branch> --apply` to remove the corresponding local
worktree and branch. Dirty, local-only, locked or open-PR work is never retired
implicitly.

## Pull Request requirements

- CI passes the required `release-gate` check.
- Codex review comments are informational; they do not block merge.
- No secrets, personal data, user HTML, generated output or release binary is committed.
- Protocol or schema changes include fixtures, migration/compatibility notes and tests.
- UI changes include a concise description or screenshot when it materially helps review.
- Release-impacting changes update `CHANGELOG.md`.

By contributing, you agree that your contribution is licensed under Apache-2.0.
