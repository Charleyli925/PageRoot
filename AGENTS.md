# PageRoot agent guidance

This repository is the complete public source boundary for PageRoot. Keep this file short: follow the rules below, then read only the task-specific documents listed under Progressive disclosure.

## Repository and authorization boundary

- Work only in this repository. Any parent workspace directory is outside the Git repository and is not a source fallback.
- GitHub `main` is the single source of truth. Local checkouts, worktrees, installed apps, backups, `release/` and `output/` are working copies or generated outputs.
- Preserve unrelated user changes. Never stash, overwrite, discard, reformat or stage them without explicit approval.
- A request to analyze, inspect, explain, diagnose or review is read-only. Do not edit, commit, push, merge, publish or change external state unless the user also requests a change.
- For an implementation request, the default completion boundary is a tested branch and Pull Request. Do not merge, create or move a tag, publish a Release, or change repository/security settings unless the user explicitly asks.
- Never push directly to `main`, force-push a shared branch, rewrite a published tag or replace published Release assets.

## Standard task lifecycle

1. Run `npm run task:status` and inspect `git status -sb` before editing.
2. From a clean, current `main`, run `npm run task:start -- <prefix/short-name>`. Allowed prefixes are `agent/`, `feature/`, `fix/`, `docs/`, `test/`, `refactor/`, `chore/` and `recovery/`.
3. Keep the diff focused. Add tests and documentation in the same change when behavior, contracts, commands or public expectations change.
4. While editing, use `npm run gate:edit`. Before publishing a branch, run `npm run task:finish`.
5. Review `git diff`, stage only intentional paths, review `git diff --cached`, then commit and push the task branch.
6. Open a draft PR while work is incomplete. When the final intended diff is reviewable, mark it ready to run the required complete gate once. Squash-merge only with explicit authorization.
7. End every task with: branch, commit, changed-file summary, tests run and results, documentation impact, PR/Release links, and whether the worktree is clean.

For command behavior, authorization levels, worktrees and reporting format, read `docs/CODEX_WORKFLOW.md`.

## Test and release ladder

- Focused edit feedback: `npm run gate:edit`
- Completed task: `npm run task:finish` (runs `gate:task` against `origin/main`)
- Complete clean source candidate: `npm run gate:release:auto`
- Verified arm64 installer candidate: `npm run release:mac`

The release and artifact gates require a clean committed tree. Any source change invalidates earlier release evidence. Draft Pull Requests run impact-selected feedback; marking the final tree ready runs the complete source gate once. `main` verifies its exact-tree attestation and runs only a fast smoke. The manual `Release Candidate` workflow may use the internal `gate:artifact-only:auto` lane only when CI has authenticated a fresh successful PR gate for the identical Git tree and version. The separate `Release` workflow then verifies and publishes those exact candidate bytes and creates the immutable tag; it never rebuilds during publication. Release only from reviewed `main` using `docs/RELEASING.md`.

## Product invariants

- Current HTML bytes are authoritative. Preview DOM is disposable and must never be serialized back as the persistence source.
- Visual edits use minimal source patches and preserve unrelated bytes, native selection, IME composition and source identity.
- Ambiguous targets, stale hashes, external writes, invalid scope, identity failures and unsafe paths fail closed.
- Privileged filesystem behavior stays behind the Electron/Bridge boundary with narrow validated IPC.
- AI output remains untrusted until protocol, identity, hash, path, scope and complete-HTML checks pass.
- QoderWork handoff remains clipboard-only unless the user explicitly authorizes a different product boundary.
- Tests and fixtures use synthetic data only. Never commit real user HTML, attachments, project records, credentials, personal paths, logs or generated binaries.

## Progressive disclosure

Read only the documents needed for the task:

| Task area | Required source |
| --- | --- |
| Git, branches, commits, recovery | `docs/GIT_WORKFLOW.md` |
| Codex task automation and final reports | `docs/CODEX_WORKFLOW.md` |
| Development environment and test lanes | `docs/DEVELOPMENT.md`, then `tests/TEST_STRATEGY.md` when test ownership changes |
| Architecture, source patches, persistence, IPC | `docs/ARCHITECTURE.md`, `docs/SECURITY_MODEL.md` |
| User flows, state or UI behavior | `docs/INTERACTION_FLOW.md`, plus the relevant focused policy document |
| Change Request, schemas, AI completion or versions | `docs/CHANGE_REQUEST_PROTOCOL.md`, relevant files in `schemas/` and `fixtures/` |
| Internal AI supplements or validation waivers | `docs/AI_SUPPLEMENT_AND_VALIDATION.md` |
| Dependencies or advisories | `docs/DEPENDENCY_SECURITY.md` |
| Public-source privacy and contribution boundary | `docs/OPEN_SOURCE_BOUNDARY.md`, `CONTRIBUTING.md`, `SECURITY.md` |
| Versioning, packaging, signing or GitHub Release | `docs/RELEASING.md` |
| Product scope or acceptance criteria | `docs/MVP_PRD.md` |

When code makes a routed document inaccurate, update that document in the same PR. Do not duplicate a complex contract in this file.

## Code Review Rules

### Source fidelity and persistence

- Flag any path that serializes preview DOM, rewrites unrelated HTML bytes, bypasses SourcePatchEngine, weakens stale-source checks, or makes concurrent writes last-writer-wins.
- Require negative and compatibility coverage for changes to target resolution, source mapping, atomic writes, selection or IME behavior.

### Trust and protocol boundaries

- Flag widened renderer, IPC, filesystem, managed-path or AI-output authority without explicit validation and fail-closed tests.
- Protocol or schema changes require synchronized schemas, fixtures, compatibility notes, validators and tests.
- QoderWork automation beyond clipboard-only handoff is a product and security boundary change.

### Release and public boundary

- Flag committed secrets, personal paths, real user files, build output, installers or private operational records.
- Flag packages that cannot be traced to one clean commit/tree, publishing before all gates pass, or mutation of an existing tag or Release asset.
- Review rules complement tests, branch protection and human acceptance; they do not replace them.
