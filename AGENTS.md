# PageRoot agent guidance

This repository is the complete public source boundary for PageRoot. Keep this
file short: follow the rules below, then read only the task-specific documents
listed under Progressive disclosure.

## Model and multi-agent routing

- Preserve the model and reasoning level selected by the user for the root agent. No `AGENTS.md`, skill, project default or child profile may replace, upgrade or downgrade it.
- This repository opts into Codex multi-agent V2. The feature flag is project-scoped, so it selects the multi-agent runtime for every root model used in this checkout; the explicit child-model routing below applies only to non-Ultra Sol and Astra.
- Use Codex's built-in `explorer` and `worker` roles. Keep `explorer` read-only. Use the project-defined, model-neutral `reviewer` and `tester` roles. Do not create model-named copies of these roles.
- For a `gpt-5.6-sol` root below Ultra, spawn `explorer`, `worker` and `tester` with `gpt-5.6-luna` / `max`; spawn `reviewer` with `gpt-5.6-sol` / `high`.
- For a `gpt-6-astra` root below Ultra, spawn `explorer`, `worker` and `tester` with `gpt-5.6-luna` / `max`; spawn `reviewer` with `gpt-5.6-sol` / `xhigh`.
- For Sol Ultra or Astra Ultra, keep Codex's native delegation and model-selection behavior. Do not apply the non-Ultra routing tables or require a project `reviewer` or `tester`.
- For every other root model, omit child model and reasoning overrides so the child inherits the root selection.
- If an explicit child model or effort is unavailable, retry that spawn once without model or reasoning overrides so the child inherits the root. Report the fallback; do not silently substitute a third model.
- For non-Ultra Sol and Astra, the root agent decides proactively whether to delegate; it does not wait for a separate user request. Before starting substantial work, identify the immediate critical path and any concrete, bounded side tasks that can run independently while the root continues useful work. Delegate those side tasks when parallel execution is likely to save meaningful time or improve quality.
- Prefer subagents for read-heavy or high-noise work such as exploration, test execution, log analysis, issue triage and summarization so raw intermediate output does not crowd the root context. Keep decisions, integration and the final answer on the root agent.
- Keep short tasks, tightly coupled decisions and immediate blockers on the root agent. Do not duplicate a delegated task. Continue non-overlapping root work while children run and wait only when a child result is needed.
- Use the same delegation trigger for non-Ultra Sol and Astra; their child-model routing remains different as listed above. At most three child agents may be open concurrently. Independent read-only investigations may run in parallel, but only one agent may write a worktree at a time and no agents may receive overlapping files or shared interfaces.
- Every spawn brief must define the concrete task boundary, relevant inputs and constraints, whether or when the root will wait, and the exact summary or artifact expected. Require concise synthesized findings with evidence paths instead of raw intermediate logs; keep full logs in the designated report or artifact location. Prefer `fork_turns: "none"` with a self-contained task when a child does not need full history. Leaf agents complete their assignment directly and do not spawn more agents.
- The root agent remains available to the user, integrates results and retains all approval and final-decision authority.

## Shared testing and independent review

- For task-level validation, longer existing test batches or CI evidence collection, use `tester` with the model and effort selected by the routing rules above. A short focused edit-time check may remain with the implementer or root when delegation would add no value.
- The implementer runs short checks and hands off source identity, commands and results. The root owns coverage, gate level, failure classification and acceptance; the tester runs existing deterministic gates and collects version-bound evidence. `task:finish` already owns `gate:task`, so never run both as separate completion gates.
- Give the tester the absolute checkout, source identity or working-tree hash, base, acceptance goal, gate entrypoint, report location and stop conditions. Use `tests/TEST_STRATEGY.md` and existing `gate:plan`, `gate:edit` and `gate:task` selection rather than inventing a replacement matrix.
- Freeze tested source while the tester owns build or test resources. The tester may write existing build output, isolated data and reports, but must not edit product code, tests, assertions, snapshots, gate rules or dependencies, and must not commit, push, change PR state, merge, install or publish.
- Reuse the same tester for an authorized retest. Preserve first-failure evidence, follow existing retry policy and use `--resume` only when the gate confirms compatible source, base, environment and command.
- Keep full logs, traces and screenshots in the report directory. The tester returns source/base, commands, exit status, planned/discovered/executed/pass/fail/skip/not-run counts where available, retry facts, failure classification, evidence paths and coverage gaps. Unknown counts remain unknown rather than becoming zero.
- The root reviews the actual evidence and expands validation only for changed source, missing coverage, a failure or a specific unresolved risk. Do not repeat a passed applicable gate as extra insurance.
- Use the model-neutral `reviewer` profile for independent review with the model and effort selected by the routing rules above. Give it the original acceptance goal, actual diff and relevant source; the root retains final acceptance.
- Verified P0/P1 defects and required deterministic gate failures block delivery; P2/P3 and unclassified minor findings follow the scope-stop rule and do not expand the task without explicit user escalation.
- These are delegation rules, not a background scheduler or authorization expansion. When handing off to a fresh checkout, repeat the applicable user constraints and routing explicitly.

## Repository and authorization boundary

- Work only in this repository. Any parent workspace directory is outside the Git repository and is not a source fallback.
- GitHub `main` is the single source of truth. Local checkouts, worktrees, installed apps, backups, `release/` and `output/` are working copies or generated outputs.
- Preserve unrelated user changes. Never stash, overwrite, discard, reformat or stage them without explicit approval.
- A request to analyze, inspect, explain, diagnose or review is read-only. Do not edit, commit, push, merge, publish or change external state unless the user also requests a change.
- For an implementation request, the default completion boundary is a tested branch and Pull Request. Do not merge, create or move a tag, publish a Release, or change repository/security settings unless the user explicitly asks.
- Never push directly to `main`, force-push a shared branch, rewrite a published tag or replace published Release assets.
- Unblocking local implementation choices may be decided in the task. New authority, destructive operations, merge and release need a separate explicit request.

## Standard task lifecycle

1. Run `npm run task:status` and inspect `git status -sb` before editing.
2. From the clean primary `main` worktree, run `npm run task:start -- <prefix/short-name>`. It keeps the primary worktree on `main` and creates an isolated checkout under the shared `.codex-worktrees/` directory. Allowed prefixes are `agent/`, `feature/`, `fix/`, `docs/`, `test/`, `integration/`, `refactor/`, `chore/` and `recovery/`. If the primary checkout is dirty, create an isolated worktree from `origin/main` instead of stashing.
3. Keep the diff focused. Add tests and documentation in the same change when behavior, contracts, commands or public expectations change.
4. While editing, use `npm run gate:edit` as needed. Before publishing a branch, run `npm run task:finish` once; it already owns the end-of-task gate, so do not precede it with a duplicate `gate:task` run.
5. Review `git diff`, stage only intentional paths, review `git diff --cached`, then commit and push the task branch.
6. Open every PR as Draft. Ordinary Draft pushes run only impact-selected `pr-feedback`. Moving the frozen head to Ready starts the complete source matrix; `release-gate` is the sole required merge check. The review service status, absence and unverified comments are informational; verified P0/P1 defects still block delivery. Apply the mandatory P0/P1 scope-stop rule in `docs/CODEX_WORKFLOW.md`: record P2/P3 and unclassified minor findings, but do not let them cause another edit, commit, Ready run, packaging delay or merge delay unless the user explicitly escalates them. After explicit merge authorization, prefer GitHub native Auto-merge over polling and a later manual merge click.
7. For implementation tasks, report outcome, verification, documentation impact, branch/commit, PR and worktree state; include release details only when applicable. For read-only tasks, report findings, evidence and unresolved questions. After merge, run `npm run task:audit` from the primary worktree and retire only the exact merged task with `task:retire --apply`.

Ordinary development stops at `gate:edit` / `task:finish` and a Draft PR.
Installer composition and package delivery: `docs/CODEX_WORKFLOW.md`.
Release, packaging, and Candidate publication: `docs/RELEASING.md`.

## Product invariants

- Current HTML bytes are authoritative. Preview DOM is disposable and must never be serialized back as the persistence source.
- Visual edits enter through Stable ID semantic operations. The current source materializer and commit checks then produce complete Working HTML. SourcePatch is the current internal implementation, not a second public edit API. Preserve unrelated bytes, native selection, IME composition and source identity.
- Irreversible source commits fail closed on ambiguous targets, stale hashes, external writes, invalid patch scope, identity failures and unsafe paths. Layout preflight, outline and other presentation checks must not refuse edit entry.
- Privileged filesystem behavior stays behind the Electron/Bridge boundary with narrow validated IPC.
- AI output remains untrusted until protocol, identity, hash, path and complete-HTML checks pass. Authored scripts are part of the user's requested HTML. Weak page continuity forces review instead of failing an otherwise usable candidate.
- QoderWork handoff remains clipboard-only unless the user explicitly authorizes a different product boundary. Authorized automatic paths are ADR 0032's Qoder ACP driver, ADR 0053's Codex ACP adapter, and ADR 0069's PageRoot native OpenAI-compatible HTTP Agent. Anthropic is not authorized.
- Committed tests and fixtures use synthetic data only. Relevant editor/runtime/recovery changes also require real Electron acceptance using the user-designated local HTML corpus, as defined in `tests/TEST_STRATEGY.md`. Never commit real user HTML, attachments, project records, credentials, personal paths, logs or generated binaries.

1. Keep the architecture small, explicit, and internally consistent; prefer the smallest coherent solution and avoid speculative abstractions, compatibility layers, or parallel flows.
2. Give every module and piece of mutable state one clear responsibility and owner, with predictable dependency direction and minimal hidden coupling.
3. Optimize for local reasoning through clear names, types, contracts, visible control flow, predictable file locations, and comments that explain why.
4. Keep changes narrowly scoped, extend existing patterns instead of creating parallel implementations, and avoid unrelated refactoring.
5. Verify changed behavior with focused tests and update architecture documentation whenever ownership, interfaces, lifecycle, or data flow changes.

## Locate, execute, and finish

- Locate first through `docs/ARCHITECTURE_MAP.md` and `npm run gate:plan -- --context-domain <id>` or `--context-file <path>`. Read the matched contract, then owners, implementation, tests and named doc sections. Do not default to reading the whole repository.
- Expand reading only when a dependency, a failing check or a contract change requires it. A smaller reading set is not permission to skip persistence, authority or cross-owner checks.
- If guidance conflicts, name the files, quote the sentences and state the affected decision. Distinguish living contracts, historical ADR text and your own inference. Do not silently pick the stricter sentence.
- Living ADR status lives in `docs/decisions/README.md`. Use that index and `ARCHITECTURE_MAP.md` for today's contract; do not reconstruct current architecture from historical ADR paragraphs.
- Preserve the user-selected root model and reasoning level. Delegate only bounded work that adds value, using the applicable session routing; local profiles do not authorize model substitution. Independent read-only investigations may run in parallel; only one agent may write a given worktree at a time.
- After the checks required by this change pass, enlarge or repeat verification only for new code, a new failure or a specific unresolved risk. Do not rerun the complete matrix, Browser, Electron or packaging as extra insurance. Environment flakes resume only through the existing fingerprint / `--resume` rules.
- Node tests do not prove Enter, IME, caret or iframe continuity. Keep public-behavior evidence for those paths. Do not replace that evidence with private field names, method names or source-string checks.
- Deliver the actual result, verification evidence and remaining limits. Do not widen the task into packaging, merge or release.

## User-facing design changes

For any change affecting what a Stemmio user sees, understands or operates, read
`docs/PRODUCT_DESIGN_SYSTEM.md` and the relevant interaction contract, then use
`.agents/skills/stemmio-product-design/SKILL.md`. This includes UI copy, states,
navigation, keyboard behavior, Agent progress, Review and adoption. Pure internal
changes without user-visible effects are exempt. Scale evidence to the change:
one-copy/token edits retain DESIGN_LANGUAGE §5’s lightweight exception; this is
not a requirement to run a full audit or add a new CI lane for every UI edit.

## Progressive disclosure

Read only the documents needed for the task. Start architecture work at
`docs/ARCHITECTURE_MAP.md` and the capability-context query above. Read the
relevant state-ownership sections when crossing owners or persistence; expand to
the full document only if those sections leave a specific contract unresolved.
The table routes to relevant sections, not a full-document reading checklist.
Update the unique owner document when a contract changes; other files should keep a pointer.

| Task area | Source for relevant sections |
| --- | --- |
| Git, branches, commits, recovery, multi-PR package composition | `docs/GIT_WORKFLOW.md` |
| Ordinary Codex task commands and final reports | `docs/CODEX_WORKFLOW.md` (`## Standard commands`); installer composition stays in that file's installer section and `docs/RELEASING.md` |
| Development environment and test lanes | `docs/DEVELOPMENT.md`, then `tests/TEST_STRATEGY.md` when test ownership changes |
| Architecture capability map and current edit contract | `docs/ARCHITECTURE_MAP.md` |
| Cross-owner contracts, persistence, IPC | Only when the task crosses owners or changes commit, identity or IPC: `docs/ARCHITECTURE_CONTRACT.md`, `docs/STATE_OWNERSHIP.md`, `docs/SECURITY_MODEL.md`. Broader architecture narrative: `docs/ARCHITECTURE.md`. Engineering/assertion form: `docs/ENGINEERING_STANDARDS.md` |
| User-visible blocking guards | `docs/GUARD_LEDGER.md` |
| User flows, state or UI behavior | Named `docs/INTERACTION_FLOW.md` sections from capability-context, plus the relevant focused policy document |
| Product design principles, flow audit, design review | `docs/PRODUCT_DESIGN_SYSTEM.md`, `docs/DESIGN_REVIEW_PROTOCOL.md` |
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

- Flag any path that serializes preview DOM, rewrites unrelated HTML bytes, bypasses current hash, identity, scope or persistence checks at a commit boundary, treats SourcePatch as a second public edit API, or makes concurrent writes last-writer-wins.
- Require negative and compatibility coverage for target resolution, source mapping, atomic writes, selection or IME behavior.
- Require one named owner, an asynchronous outcome model and a drain-boundary decision for every new mutable or persisted state. `npm run architecture:check` must pass; never bypass it with a new view-level Bridge call, browser-storage write or duplicated compatibility branch.

### Reversible coordination (converge automatically)

Stale queries, expired Canvas acknowledgements, catalog refresh failures, lost Bridge replies that can be reread, and expired projections must discard the old result, reread authority, rebuild, retry once within a bound, or degrade. They must not become a dialog, a locked canvas, or a user-owned retry for internal uncertainty.

### Presentation and edit eligibility (fail-open)

Layout preflight, hover/outline trust, Review runtime capture completeness, comment-marker location and UI projection lag must not refuse the user. Enter edit first; validate afterwards with MutationObserver, patch scope and the source commit. Keep a comment whose target failed outside an explicit element delete, mark its location as lost, and direct the user to delete and comment again. Hide a failed outline; do not forbid editing.

### Trust, protocol and release

- Flag widened renderer, IPC, filesystem, managed-path or AI-output authority without explicit validation and fail-closed tests at the irreversible boundary.
- Protocol or schema changes require synchronized schemas, fixtures, compatibility notes, validators and tests.
- QoderWork automation beyond clipboard-only handoff is a product and security boundary change; changes outside ADR 0032's fixed Qoder ACP contract require new explicit authorization.
- Flag committed secrets, personal paths, real user files, build output, installers or private operational records.
- Flag packages that cannot be traced to one clean commit/tree, publishing before all gates pass, or mutation of an existing tag or Release asset.
- User confirmation is for destructive deletes, discarding unsavable edits, explicit overwrite of external changes, and unrecoverable identity or permission changes. An uncertain async receipt is not a confirmation dialog.
- Review rules complement tests, branch protection and human acceptance; they do not replace them.
