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

- Work only in this repository; a parent workspace is not a source fallback. GitHub `main` is authoritative; local checkouts, worktrees, installed apps, backups, `release/` and `output/` are working or generated copies.
- Preserve unrelated user changes. Never stash, overwrite, discard, reformat or stage them without explicit approval.
- Analysis, inspection, diagnosis and review are read-only. Implementation ends at a tested branch and Draft PR unless the user authorizes more.
- Do not merge, create or move a tag, publish a Release, or change repository/security settings unless the user explicitly asks.
- Never push directly to `main`, force-push a shared branch, rewrite a published tag or replace published Release assets.
- Decide ordinary local implementation choices in-scope; new authority, destructive operations, merge and release require a separate explicit request.

## Standard task lifecycle

For any implementation or delivery task, the root reads `docs/CODEX_WORKFLOW.md` sections `Standard commands` and `Branch and Pull Request flow`; it reads `docs/RELEASING.md` only for packaging or release work. Children receive only the applicable steps in their task packet. The non-negotiable summary is:

1. Inspect with `npm run task:status`; work on an isolated task branch/worktree and never stash unrelated user changes.
2. Keep the diff focused. Use `gate:edit` while editing and run `npm run task:finish` once before publication; it already owns `gate:task`.
3. Review the unstaged and staged diff, stage only intended paths, then commit, push and open a Draft PR.
4. Stop at the tested Draft PR unless the user separately authorizes Ready, merge, packaging or release. After merge, audit and retire only the exact merged task.

## Product invariants

- Current HTML bytes are authoritative; Preview DOM is disposable. Visual edits use Stable ID semantic operations, with SourcePatch only as the internal materializer. Preserve unrelated bytes, source identity, native selection and IME behavior.
- Source commits fail closed on ambiguous targets, stale hashes, external writes, invalid scope, identity failures and unsafe paths; presentation or preflight uncertainty must not refuse edit entry. Privileged filesystem work stays behind narrow validated Electron/Bridge IPC.
- AI output remains untrusted until protocol, identity, hash, path and complete-HTML checks pass. Authored scripts are part of the user's requested HTML. Weak page continuity forces review instead of failing an otherwise usable candidate.
- QoderWork handoff remains clipboard-only unless the user explicitly authorizes a different product boundary. Authorized automatic paths are ADR 0032's Qoder ACP driver, ADR 0053's Codex ACP adapter, and ADR 0069's PageRoot native OpenAI-compatible HTTP Agent. Anthropic is not authorized.
- Committed tests and fixtures use synthetic data only. Relevant editor/runtime/recovery changes also require real Electron acceptance using the user-designated local HTML corpus, as defined in `tests/TEST_STRATEGY.md`. Never commit real user HTML, attachments, project records, credentials, personal paths, logs or generated binaries.
- Implementation shape, ownership, testing and completion rules live in `docs/ENGINEERING_STANDARDS.md`; read only the sections relevant to the routed task.

## Locate, execute, and finish

- Locate through `docs/ARCHITECTURE_MAP.md` and `npm run gate:plan -- --context-domain <id>` or `--context-file <path>`. Read the matched contract, owners, implementation, tests and named sections; expand only for a dependency, failure or contract change.
- If guidance conflicts, name and quote the files and state the affected decision. Use `docs/decisions/README.md` for living ADR status; do not infer current behavior from historical ADR prose.
- Enlarge or repeat verification only for changed code, missing coverage, a new failure or a specific risk. Node tests do not prove Enter, IME, caret or iframe continuity; use public-behavior evidence for those paths.
- Deliver the actual result, verification evidence and remaining limits. Do not widen the task into packaging, merge or release.

## User-facing design changes

For any change affecting what a Stemmio user sees, understands or operates, read `docs/PRODUCT_DESIGN_SYSTEM.md` and the relevant interaction contract, then use `.agents/skills/stemmio-product-design/SKILL.md`. Pure internal changes are exempt; scale evidence to the change and retain `DESIGN_LANGUAGE.md` section 5's lightweight exception for one-copy/token edits.

## Progressive disclosure

The paths below are read gates, not optional references: before the matching action, the root reads the named sections. Every fresh-context child task packet lists `required_reading`; the child reads it before acting and reports a missing source as blocked. Read no unrelated sections.

Architecture and implementation start with `ARCHITECTURE_MAP.md` plus the capability-context query above; cross-owner or persistence work then reads only the relevant sections of `ARCHITECTURE_CONTRACT.md`, `STATE_OWNERSHIP.md` and `SECURITY_MODEL.md`.

- Subagents: `CODEX_SUBAGENT_ROUTING_WORKSHEET.md` section 5. Testing: `DEVELOPMENT.md` and `tests/TEST_STRATEGY.md`.
- Git/task delivery: `GIT_WORKFLOW.md` and `CODEX_WORKFLOW.md`. Packaging/release: `RELEASING.md`. Dependencies or public-source boundaries: `DEPENDENCY_SECURITY.md` or `OPEN_SOURCE_BOUNDARY.md`.
- User-visible behavior: the named `INTERACTION_FLOW.md` section and focused policy. Design work additionally uses `PRODUCT_DESIGN_SYSTEM.md`, `DESIGN_REVIEW_PROTOCOL.md` and `DESIGN_LANGUAGE.md` as applicable.
- AI requests, schemas or versions: `CHANGE_REQUEST_PROTOCOL.md`, relevant schemas/fixtures and the focused AI or product PRD selected by capability context.

Before finishing, use `CODEX_WORKFLOW.md` section `Documentation impact`; when code makes an owner document inaccurate, update that document in the same PR. Do not duplicate a complex contract here.

## Code Review Rules

Before review, read `docs/ENGINEERING_STANDARDS.md` sections `Defense classes`, `Tests` and `Definition of complete`, then the task-specific contracts routed above. Apply these boundaries:

- Fail closed at irreversible filesystem, AI-adoption, identity, persistence and release boundaries; require equivalent protection and negative coverage for any change there.
- Converge or degrade automatically for reversible coordination failures. Presentation and preflight uncertainty must not block editing.
- Flag widened renderer/IPC/filesystem/AI authority, protocol drift, unsafe concurrent writes, real user data or secrets, and packages without clean source provenance.
- Verified P0/P1 findings block delivery. Review evidence complements deterministic gates and human acceptance; it does not replace them.
