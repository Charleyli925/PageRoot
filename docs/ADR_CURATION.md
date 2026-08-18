# ADR Curation Workflow

Curates `docs/decisions/` so the directory stays a navigable knowledge base instead of an append-only pile. This workflow is agent-agnostic: any coding agent (or a human) can execute it by following this document. Curation means **status marking and indexing — never deleting or rewriting ADR bodies**. An ADR's text is a historical record; only its metadata (status header, index entry, filename in narrow cases) may change.

## Workflow

```
Curation Progress:
- [ ] Step 1: Inventory and numbering health
- [ ] Step 2: Classify every ADR by future value
- [ ] Step 3: Write curation report to output/
- [ ] Step 4 (on approval): apply index + status changes via task branch
```

### Step 1: Inventory and numbering health

```bash
ls docs/decisions/ | sort
# collisions: same 4-digit prefix twice; gaps: missing numbers in the sequence
ls docs/decisions/ | grep -oE '^[0-9]{4}' | sort | uniq -d   # collisions
```

For each **collision**, decide the fix by checking references first:

```bash
rg -n "00XX" --glob '!node_modules' --glob '!docs/decisions/00XX-*'
```

- Colliding file is **unreferenced elsewhere** → propose renaming the *newer* file (by git history: `git log --follow --format=%ad --date=short -- <file> | tail -1`) to the next free number. Renames preserve git history; use `git mv`.
- Colliding file **is referenced** (docs, code comments, PR descriptions that cannot be edited) → do **not** rename; disambiguate in the index with full filenames and add a one-line collision note at the top of each colliding file.

**Gaps** are recorded in the index as "number never used" — never backfill a gap with a new ADR; new ADRs always take `max + 1`.

### Step 2: Classify by future value

Read each ADR and assign exactly one status. For LIVING candidates, spot-verify at least one claim against current code before assigning — an ADR describing removed code is not living.

| Status | Meaning | Test |
| --- | --- | --- |
| **LIVING** | Still constrains how code must be written today | A PR violating it should be rejected; the modules/behaviors it names still exist |
| **HISTORICAL** | The decision shaped the codebase but no longer guides new work | Context is past; nothing enforces it; deleting it loses history, not guidance |
| **SUPERSEDED** | A later ADR or contract document replaced it | Name the successor explicitly |

Signals for SUPERSEDED: a later ADR covers the same subsystem with a different conclusion; the mechanism it mandates was replaced (verify with `rg` for the named modules); a contract document (`docs/ARCHITECTURE_CONTRACT.md`, `docs/STATE_OWNERSHIP.md`) now owns the rule.

When unsure between LIVING and HISTORICAL, mark LIVING and flag it in the report for the requester — false-historical is the expensive mistake.

### Step 3: Curation report

Write `output/adr-curation-YYYY-MM-DD.md` containing:

1. Numbering health: collisions with proposed resolution (rename vs annotate, with reference evidence), gaps, next free number
2. Status table: number · title · proposed status · one-line justification · verification evidence for LIVING/SUPERSEDED calls
3. Draft of `docs/decisions/README.md` using the index template in the appendix below
4. Exact file operations required (`git mv` commands, header lines to add), so the apply step is mechanical

### Step 4: Apply (only after explicit approval)

Per AGENTS.md: `npm run task:start -- docs/adr-curation`, apply exactly the operations from the report, run `npm run gate:edit`, open a Draft PR. Changes allowed:

- Create/refresh the `docs/decisions/README.md` index
- Add one status line under a superseded ADR's title: `> Status: Superseded by [ADR-00YY](00YY-....md)`
- `git mv` for approved collision renames, plus updating any in-repo references in the same commit
- Nothing else. No body edits, no deletions, no reformatting.

## Guardrails

- **Never delete an ADR.** HISTORICAL status lives in the index, not in file removal.
- **Never rewrite ADR content** — rationale and rejected alternatives are the point of an ADR; trimming them destroys its value.
- **Numbers are immutable once referenced.** Rename only the unreferenced side of a collision, and only with approval.
- Steps 1–3 are read-only; Step 4 requires the requester's explicit go-ahead and follows the standard branch/PR lifecycle.

## Appendix: index template

```markdown
# Architecture Decision Records

> Index maintained by the ADR curation workflow (`docs/ADR_CURATION.md`). Statuses: **Living** (still constrains new code) · **Historical** (shaped the codebase, no longer guides new work) · **Superseded** (replaced — see successor).
>
> New ADRs take the next free number: **{next-free-number}**. Never reuse a gap number.

## Numbering notes

{Collision/gap notes.}

## Index

| # | Title | Status | Successor / Note |
| --- | --- | --- | --- |
| 0001 | [{title}]({file}) | Living | |
| 0002 | [{title}]({file}) | Historical | |
| 0003 | [{title}]({file}) | Superseded | → [00YY]({successor-file}) |

## Reading guide

- Implementing a change? Read the **Living** rows touching your subsystem before coding.
- Investigating "why is it built this way"? **Historical** and **Superseded** rows hold the context.
```
