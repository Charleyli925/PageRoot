# PageRoot agent guidance

This repository is the complete public source boundary for PageRoot. Keep this
file short: follow the rules below, then read only the task-specific documents
listed under Progressive disclosure.

## Repository and authorization boundary

- Work only in this repository. Any parent workspace directory is outside the Git repository and is not a source fallback.
- GitHub `main` is the single source of truth. Local checkouts, worktrees, installed apps, backups, `release/` and `output/` are working copies or generated outputs.
- Preserve unrelated user changes. Never stash, overwrite, discard, reformat or stage them without explicit approval.
- A request to analyze, inspect, explain, diagnose or review is read-only. Do not edit, commit, push, merge, publish or change external state unless the user also requests a change.
- For an implementation request, the default completion boundary is a tested branch and Pull Request. Do not merge, create or move a tag, publish a Release, or change repository/security settings unless the user explicitly asks.
- Never push directly to `main`, force-push a shared branch, rewrite a published tag or replace published Release assets.

## Standard task lifecycle

1. Run `npm run task:status` and inspect `git status -sb` before editing.
2. From the clean primary `main` worktree, run `npm run task:start -- <prefix/short-name>`. It keeps the primary worktree on `main` and creates an isolated checkout under the shared `.codex-worktrees/` directory. Allowed prefixes are `agent/`, `feature/`, `fix/`, `docs/`, `test/`, `integration/`, `refactor/`, `chore/` and `recovery/`. If the primary checkout is dirty, create an isolated worktree from `origin/main` instead of stashing.
3. Keep the diff focused. Add tests and documentation in the same change when behavior, contracts, commands or public expectations change.
4. While editing, use `npm run gate:edit`. Before publishing a branch, run `npm run task:finish`.
5. Review `git diff`, stage only intentional paths, review `git diff --cached`, then commit and push the task branch.
6. Open every PR as Draft. Ordinary Draft pushes run only impact-selected `pr-feedback`. Ready or the `full-gate` label starts the complete source matrix; `release-gate` is the sole required merge check. Codex review is informational and never blocks merge. Squash-merge only with explicit authorization.
7. End every task with: branch, commit, changed-file summary, tests run and results, documentation impact, PR/Release links, and whether the worktree is clean. After merge, run `npm run task:audit` from the primary worktree and retire only the exact merged task with `task:retire --apply`.

Command behavior, installer composition, and reporting format: `docs/CODEX_WORKFLOW.md`.
Release, packaging, and Candidate publication: `docs/RELEASING.md`.

Local gates: `npm run gate:edit` while editing; `npm run task:finish` before publishing.

## Product invariants

- Current HTML bytes are authoritative. Preview DOM is disposable and must never be serialized back as the persistence source.
- Visual edits use minimal source patches and preserve unrelated bytes, native selection, IME composition and source identity.
- Irreversible source commits fail closed on ambiguous targets, stale hashes, external writes, invalid patch scope, identity failures and unsafe paths. Layout preflight, outline and other presentation checks must not refuse edit entry.
- Privileged filesystem behavior stays behind the Electron/Bridge boundary with narrow validated IPC.
- AI output remains untrusted until protocol, identity, hash, path and complete-HTML checks pass. Authored scripts are part of the user's requested HTML. Weak page continuity forces review instead of failing an otherwise usable candidate.
- QoderWork handoff remains clipboard-only unless the user explicitly authorizes a different product boundary. The only currently authorized automatic path is ADR 0032's per-task `trusted-local-agent-v1` Qoder ACP driver.
- Tests and fixtures use synthetic data only. Never commit real user HTML, attachments, project records, credentials, personal paths, logs or generated binaries.

## Progressive disclosure

Read only the documents needed for the task. Start architecture work at
`docs/ARCHITECTURE_MAP.md`; read full state ownership only when crossing owners
or persistence.

| Task area | Required source |
| --- | --- |
| Git, branches, commits, recovery, multi-PR package composition | `docs/GIT_WORKFLOW.md` |
| Codex task automation, installer composition and final reports | `docs/CODEX_WORKFLOW.md` |
| Development environment and test lanes | `docs/DEVELOPMENT.md`, then `tests/TEST_STRATEGY.md` when test ownership changes |
| Architecture capability map | `docs/ARCHITECTURE_MAP.md` |
| Cross-owner contracts, source patches, persistence, IPC | `docs/ARCHITECTURE.md`, `docs/ARCHITECTURE_CONTRACT.md`, `docs/STATE_OWNERSHIP.md`, `docs/ENGINEERING_STANDARDS.md`, `docs/SECURITY_MODEL.md` |
| User-visible blocking guards | `docs/GUARD_LEDGER.md` |
| User flows, state or UI behavior | `docs/INTERACTION_FLOW.md`, plus the relevant focused policy document |
| UI visual language, styling standards, design QA process | `docs/DESIGN_LANGUAGE.md`, then the root `design-qa.md` log when recording QA evidence |
| First-open import confirmation | `docs/IMPORT_CONFIRMATION_PRD.md`, then `docs/IMPORT_CONFIRMATION_PLAN.md` when implementing |
| Change Request, schemas, AI completion or versions | `docs/CHANGE_REQUEST_PROTOCOL.md`, relevant files in `schemas/` and `fixtures/` |
| Internal AI supplements or candidate validation | `docs/AI_SUPPLEMENT_AND_VALIDATION.md` |
| Dependencies or advisories | `docs/DEPENDENCY_SECURITY.md` |
| Public-source privacy and contribution boundary | `docs/OPEN_SOURCE_BOUNDARY.md`, `CONTRIBUTING.md`, `SECURITY.md` |
| Versioning, packaging, signing or GitHub Release | `docs/RELEASING.md` |
| Product scope or acceptance criteria | `docs/MVP_PRD.md`, then `docs/VERSION_AND_PROJECT_FILES_PRD.md` for versions and project files |
| AI conversation sidebar, discussion turns, model selection, adopt-and-continue | `docs/AI_CONVERSATION_WORKSPACE_PRD.md` |
| Post-MVP cleanup sequence | `docs/POST_MVP_CLEANUP_PROGRAM.md` |
| Simplification audit or ADR curation | `docs/SIMPLIFICATION_AUDIT.md`, `docs/ADR_CURATION.md` |

When code makes a routed document inaccurate, update that document in the same PR. Do not duplicate a complex contract in this file.

## Code Review Rules

Classify a failure by whether it is irreversible. Do not treat every fail-closed check as sacred.

Do not remove an irreversible authority-boundary protection unless an equivalent protection remains. For reversible interaction, presentation and preflight boundaries, a change may move a front-door block to post-validation, automatic repair or degradation when tests and a recovery path exist.

### Authority boundary (fail-closed)

Protects against wrong-disk writes, mistaken AI adoption, wrong Version activation, destructive deletes and wrong published packages. Same fact: validate at most at ingress, after an await, and immediately before irreversible commit.

- Flag any path that serializes preview DOM, rewrites unrelated HTML bytes, bypasses SourcePatchEngine, drops stale-hash or identity checks at a commit boundary, or makes concurrent writes last-writer-wins.
- Require negative and compatibility coverage for target resolution, source mapping, atomic writes, selection or IME behavior.
- Require one named owner, an asynchronous outcome model and a drain-boundary decision for every new mutable or persisted state. `npm run architecture:check` must pass; never bypass it with a new view-level Bridge call, browser-storage write or duplicated compatibility branch.

### Reversible coordination (converge automatically)

Stale queries, expired Canvas acknowledgements, catalog refresh failures, lost Bridge replies that can be reread, and expired projections must discard the old result, reread authority, rebuild, retry once within a bound, or degrade. They must not become a dialog, a locked canvas, or a user-owned retry for internal uncertainty.

### Presentation and edit eligibility (fail-open)

Layout preflight, hover/outline trust, Review runtime capture completeness, comment-marker location and UI projection lag must not refuse the user. Enter edit first; validate afterwards with MutationObserver, patch scope and the source commit. Keep a comment whose target failed, marked for relink. Hide a failed outline; do not forbid editing.

### Trust, protocol and release

- Flag widened renderer, IPC, filesystem, managed-path or AI-output authority without explicit validation and fail-closed tests at the irreversible boundary.
- Protocol or schema changes require synchronized schemas, fixtures, compatibility notes, validators and tests.
- QoderWork automation beyond clipboard-only handoff is a product and security boundary change; changes outside ADR 0032's fixed Qoder ACP contract require new explicit authorization.
- Flag committed secrets, personal paths, real user files, build output, installers or private operational records.
- Flag packages that cannot be traced to one clean commit/tree, publishing before all gates pass, or mutation of an existing tag or Release asset.
- User confirmation is for destructive deletes, discarding unsavable edits, explicit overwrite of external changes, and unrecoverable identity or permission changes. An uncertain async receipt is not a confirmation dialog.
- Review rules complement tests, branch protection and human acceptance; they do not replace them.
