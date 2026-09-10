---
name: terra-luna-standard
description: Standard PageRoot engineering workflow used only when the active user-selected primary is GPT-5.6 Terra Max. Use for routine implementation, bug fixes, UI or content changes, and scoped refactors with Luna High exploration and Luna Max implementation and test execution, and Terra Max review. Do not use for architecture-wide or highly ambiguous work.
---

# Terra–Luna Standard Workflow

## Model integrity

- Use this skill only when the active primary is already the user's selected `gpt-5.6-terra` with reasoning effort `max`.
- Treat the primary model and reasoning effort as immutable inputs. Never invoke this skill to switch, upgrade, or downgrade the primary.
- Use `gpt-5.6-luna` with `high` reasoning for `luna_explorer` and `max` reasoning for `luna_builder` and `luna_tester`. Use the model-neutral `reviewer` with explicit `gpt-5.6-terra` / `max` for independent review. Pass model and reasoning effort explicitly with fresh/limited context for every spawn.
- Never silently substitute another child model or reasoning level. If a required Luna profile cannot be launched, report the exact runtime error to the primary. The primary continues independent authorized work and decides the next step; request user input only when a necessary decision, authorization or external dependency prevents progress.

## Primary-agent ownership

The Terra primary agent owns:

- understanding the user's actual goal;
- defining concrete acceptance criteria;
- deciding whether delegation is useful;
- assigning narrow, non-overlapping tasks;
- waiting for delegated work;
- inspecting the actual diff;
- running or confirming appropriate validation;
- resolving disagreement between agents;
- making the final decision and final response.

The primary checks the actual diff and underlying evidence needed for acceptance. Reuse supported exploration findings; expand or repeat investigation only for a contradiction, missing evidence, changed source or an unresolved risk.
Remain available to the user while delegated work proceeds, provide concise progress updates, and keep all approval decisions with the user.

## Delegation decision

Use the lightest workflow that reliably completes the task:

### Micro change

For an exact, low-risk, single-file change with a known location and very small edit surface, the Terra primary agent may implement it directly when spawning an agent would add more coordination than value.

### Routine scoped implementation

When acceptance criteria and the likely edit area are already clear:

1. Give `luna_builder` one narrow implementation assignment.
2. Include the acceptance criteria, permitted edit area, forbidden unrelated changes, and required validation.
3. Wait for the builder to finish.
4. Inspect the actual diff.
5. Run or confirm focused validation.

### Unclear code path

When the owning files, state flow, or execution path are unclear:

1. Spawn one `luna_explorer`, or multiple explorers only for distinct read-only questions that can be investigated independently.
2. Use `fork_turns: "none"` and provide each explorer a self-contained assignment.
3. Run independent explorers in parallel only when their questions and evidence surfaces do not overlap.
4. Integrate their evidence to define the edit scope.
5. Spawn `luna_builder` only after the scope is clear.
6. Inspect the actual diff and validate it.

### Meaningful behavior change

For a multi-file change, state-flow change, bug fix with regression risk, or user-visible behavior change:

1. Use `luna_explorer` when discovery is needed.
2. Use `luna_builder` for the implementation.
3. After implementation, use a fresh-context `reviewer` (`gpt-5.6-terra` / `max`) for an independent read-only review. Give it the original acceptance criteria and actual diff, not the builder's conclusions.
4. Apply the project scope rule: verified P0/P1 findings block delivery; record P2/P3 findings without expanding the change unless the user requests it.

## Test handoff

Follow the workspace AGENTS.md shared testing and review rules. At task-level validation, longer existing test batches, or CI evidence collection, delegate to `luna_tester` with explicit `gpt-5.6-luna` / `max`; reuse it for authorized retests. A short edit-time check may remain with the builder or primary; hand off its tested source, command and result. The primary assesses evidence rather than repeating the tester's execution. `task:finish` already runs `gate:task`; required CI and release boundaries still apply.

Supply the exact checkout, source identity and base, acceptance goals, existing gate entrypoint, artifact location, and stop conditions. Freeze tested source while the tester owns build/test resources. The primary may review read-only during execution. Before fixes, end affected tests and hand the checkout to its sole writer.

The tester returns facts and provisional failure classification; the primary decides whether code or assertions need changing, checks coverage and raw evidence, and makes the final acceptance decision. Preserve failed attempts and use the gate's existing resume eligibility checks. Test summaries never replace deterministic gate results.

## Concurrency and write safety

- Never have more than two spawned Agent threads open concurrently.
- Only one Agent may write to the working tree at a time.
- Never run two implementation agents against overlapping files.
- Independent explorers may run concurrently only when all are read-only and their assignments do not overlap.
- Prefer sequential handoffs for normal PageRoot changes.
- Do not create extra agents merely to imitate Ultra mode.
- Every spawned Luna profile is a leaf and must complete its assignment directly without spawning or delegating to another agent.

## Handoff quality

Every delegated assignment must specify:

- the concrete outcome;
- known relevant files or areas;
- acceptance criteria;
- forbidden scope;
- whether edits are allowed;
- required tests or validation;
- the exact form of the returned result.

For every fresh-context assignment, repeat the relevant user constraints, permitted scope, safety boundaries, and stop conditions instead of relying on inherited conversation history.
Subagents should return evidence and results, not long general explanations.

## Final verification

Before reporting completion, the Terra primary agent must:

1. Inspect the final diff itself.
2. Confirm no unrelated files changed.
3. Confirm appropriate validation through the tester and underlying version-bound reports, or run a short focused check directly. Do not repeat passed checks without changed source, missing coverage, or unresolved evidence.
4. Resolve or explicitly document material reviewer findings.
5. State what changed, what was validated, and any remaining risk.

## Escalation boundary

This standard workflow is not intended for architecture-wide redesigns, deeply ambiguous cross-system changes, or high-risk migrations.

When a task clearly exceeds the standard tier:

- do not switch or replace the user-selected Terra Max primary;
- do not manufacture additional Luna agents to compensate;
- leave this routine workflow and let the same primary continue diagnosis, decomposition and decisions within the authorized task;
- request user input only for a necessary missing product decision, authorization or unresolved external dependency. Workflow complexity alone is not a reason to stop or ask for a different model.
