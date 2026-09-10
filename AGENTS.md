# PageRoot agent guidance

This repository is the complete public source boundary for PageRoot. Keep this
file short: follow the rules below, then read only the task-specific documents
listed under Progressive disclosure.

## Model and multi-agent routing

- Preserve the model and reasoning level selected by the user for the root agent. No `AGENTS.md`, skill, project default or child profile may replace, upgrade or downgrade it.
- This repository uses Codex multi-agent V2. Use the built-in read-only `explorer` and built-in `worker`; use the project-defined, model-neutral `reviewer` and `tester`. Do not create model-named role copies.

| Root selection | `explorer` / `worker` / `tester` | `reviewer` |
| --- | --- | --- |
| Sol below Ultra | `gpt-5.6-luna` / `max` | `gpt-5.6-sol`; High floor, then match XHigh or Max |
| Astra below Ultra | `gpt-5.6-luna` / `max` | `gpt-6-astra`; High floor, then match XHigh or Max |
| Sol or Astra Ultra | Codex native routing | Codex native routing |
| Any other root | Inherit root model and effort | Inherit root model and effort |

- For non-Ultra Sol and Astra, the root proactively delegates concrete, bounded work when parallel execution is likely to save meaningful time or improve quality. Prefer read-heavy or noisy exploration, tests, logs, triage and summaries; keep short, tightly coupled or critical-path work on the root.
- Before the first non-Ultra spawn in a substantial task, the root must read `docs/CODEX_SUBAGENT_ROUTING_WORKSHEET.md` section 5 and follow its route-evidence, fallback, dependency-wave, task-packet, lifecycle and result-acceptance rules. Children receive only their self-contained task packet unless they need that document to perform the assigned task.
- At most three children may be open concurrently. Only one agent may write a worktree at a time, including test artifacts; read-only work may inspect frozen source and diffs. Leaf agents do not spawn children.
- The root remains available to the user, owns steering, stopping, integration and final decisions, and verifies cited evidence before accepting a child result.

## Shared testing and independent review

- Use `tester` for longer existing test batches or CI evidence collection and `reviewer` for independent review; short focused checks may stay with the implementer or root. The root owns coverage, gate level, failure classification and acceptance.
- Follow `tests/TEST_STRATEGY.md` and the existing gate selection. `task:finish` already owns `gate:task`; never run both as separate completion gates or repeat a passed applicable gate without changed source, missing coverage, a failure or a specific unresolved risk.
- Freeze the tested source. The tester may create existing build/test output and reports, but must not edit source, tests, assertions, snapshots, gates or dependencies, or commit, push, change PR state, merge, install or publish. Preserve full logs and first-failure evidence in the report directory.
- Give the reviewer the acceptance goal, actual diff and relevant source. A tester or reviewer summary is evidence to inspect, not final acceptance.
- Verified P0/P1 defects and required deterministic gate failures block delivery; P2/P3 and unclassified minor findings follow the scope-stop rule and do not expand the task without explicit user escalation.
- Delegation is not a background scheduler or authorization expansion. Repeat applicable user constraints and routing in every fresh-context handoff.

## Repository and authorization boundary

- Work only in this repository. Any parent workspace directory is outside the Git repository and is not a source fallback.
- GitHub `main` is the single source of truth. Local checkouts, worktrees, installed apps, backups, `release/` and `output/` are working copies or generated outputs.
- Preserve unrelated user changes. Never stash, overwrite, discard, reformat or stage them without explicit approval.
- A request to analyze, inspect, explain, diagnose or review is read-only. Do not edit, commit, push, merge, publish or change external state unless the user also requests a change.
- For an implementation request, the default completion boundary is a tested branch and Pull Request. Do not merge, create or move a tag, publish a Release, or change repository/security settings unless the user explicitly asks.
- Never push directly to `main`, force-push a shared branch, rewrite a published tag or replace published Release assets.
- Unblocking local implementation choices may be decided in the task. New authority, destructive operations, merge and release need a separate explicit request.

## Standard task lifecycle

For any implementation or delivery task, the root reads `docs/CODEX_WORKFLOW.md` sections `Standard commands` and `Branch and Pull Request flow`; it reads `docs/RELEASING.md` only for packaging or release work. Children receive only the applicable steps in their task packet. The non-negotiable summary is:

1. Inspect with `npm run task:status`; work on an isolated task branch/worktree and never stash unrelated user changes.
2. Keep the diff focused. Use `gate:edit` while editing and run `npm run task:finish` once before publication; it already owns `gate:task`.
3. Review the unstaged and staged diff, stage only intended paths, then commit, push and open a Draft PR.
4. Stop at the tested Draft PR unless the user separately authorizes Ready, merge, packaging or release. After merge, audit and retire only the exact merged task.

## Product invariants

- Current HTML bytes are authoritative. Preview DOM is disposable and must never be serialized back as the persistence source.
- Visual edits enter through Stable ID semantic operations. The current source materializer and commit checks then produce complete Working HTML. SourcePatch is the current internal implementation, not a second public edit API. Preserve unrelated bytes, native selection, IME composition and source identity.
- Irreversible source commits fail closed on ambiguous targets, stale hashes, external writes, invalid patch scope, identity failures and unsafe paths. Layout preflight, outline and other presentation checks must not refuse edit entry.
- Privileged filesystem behavior stays behind the Electron/Bridge boundary with narrow validated IPC.
- AI output remains untrusted until protocol, identity, hash, path and complete-HTML checks pass. Authored scripts are part of the user's requested HTML. Weak page continuity forces review instead of failing an otherwise usable candidate.
- QoderWork handoff remains clipboard-only unless the user explicitly authorizes a different product boundary. Authorized automatic paths are ADR 0032's Qoder ACP driver, ADR 0053's Codex ACP adapter, and ADR 0069's PageRoot native OpenAI-compatible HTTP Agent. Anthropic is not authorized.
- Committed tests and fixtures use synthetic data only. Relevant editor/runtime/recovery changes also require real Electron acceptance using the user-designated local HTML corpus, as defined in `tests/TEST_STRATEGY.md`. Never commit real user HTML, attachments, project records, credentials, personal paths, logs or generated binaries.
- Implementation shape, ownership, testing and completion rules live in `docs/ENGINEERING_STANDARDS.md`; read only the sections relevant to the routed task.

## Locate, execute, and finish

- Locate first through `docs/ARCHITECTURE_MAP.md` and `npm run gate:plan -- --context-domain <id>` or `--context-file <path>`. Read the matched contract, then owners, implementation, tests and named doc sections. Do not default to reading the whole repository.
- Expand reading only when a dependency, a failing check or a contract change requires it. A smaller reading set is not permission to skip persistence, authority or cross-owner checks.
- If guidance conflicts, name the files, quote the sentences and state the affected decision. Distinguish living contracts, historical ADR text and your own inference. Do not silently pick the stricter sentence.
- Living ADR status lives in `docs/decisions/README.md`. Use that index and `ARCHITECTURE_MAP.md` for today's contract; do not reconstruct current architecture from historical ADR paragraphs.
- After the checks required by this change pass, enlarge or repeat verification only for new code, a new failure or a specific unresolved risk. Do not rerun the complete matrix, Browser, Electron or packaging as extra insurance. Environment flakes resume only through the existing fingerprint / `--resume` rules.
- Node tests do not prove Enter, IME, caret or iframe continuity. Keep public-behavior evidence for those paths. Do not replace that evidence with private field names, method names or source-string checks.
- Deliver the actual result, verification evidence and remaining limits. Do not widen the task into packaging, merge or release.

## User-facing design changes

For any change affecting what a Stemmio user sees, understands or operates, read `docs/PRODUCT_DESIGN_SYSTEM.md` and the relevant interaction contract, then use `.agents/skills/stemmio-product-design/SKILL.md`. Pure internal changes are exempt; scale evidence to the change and retain `DESIGN_LANGUAGE.md` section 5's lightweight exception for one-copy/token edits.

## Progressive disclosure

Read only the documents needed for the task. Start architecture work at
`docs/ARCHITECTURE_MAP.md` and the capability-context query above. Read the
relevant state-ownership sections when crossing owners or persistence; expand to
the full document only if those sections leave a specific contract unresolved.
The table routes to relevant sections, not a full-document reading checklist.
Update the unique owner document when a contract changes; other files should keep a pointer.

| Task area | Source for relevant sections |
| --- | --- |
| Subagent routing, task packets, runtime evidence and lifecycle | `docs/CODEX_SUBAGENT_ROUTING_WORKSHEET.md` section 5 |
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

Before review, read `docs/ENGINEERING_STANDARDS.md` sections `Defense classes`, `Tests` and `Definition of complete`, then the task-specific contracts routed above. Apply these boundaries:

- Fail closed at irreversible filesystem, AI-adoption, identity, persistence and release boundaries; require equivalent protection and negative coverage for any change there.
- Converge or degrade automatically for reversible coordination failures. Presentation and preflight uncertainty must not block editing.
- Flag widened renderer/IPC/filesystem/AI authority, protocol drift, unsafe concurrent writes, real user data or secrets, and packages without clean source provenance.
- Verified P0/P1 findings block delivery. Review evidence complements deterministic gates and human acceptance; it does not replace them.
