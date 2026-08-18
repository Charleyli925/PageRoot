---
name: archive-decision-notes
description: Curates PageRoot's docs/decisions ADR directory by future value — detects numbering collisions and gaps, classifies each ADR as living contract, historical snapshot, or superseded, and maintains a status index. Use when the user asks to curate, archive, audit, or clean up ADRs, decision records, decision notes, or the docs/decisions directory.
---

# Archive Decision Notes

The canonical, agent-agnostic workflow lives in [docs/ADR_CURATION.md](../../../docs/ADR_CURATION.md). Read that document and follow it exactly — numbering-health checks, classification rules, report format, index template, and guardrails are all defined there.

Key reminders (details in the canonical document):

- Steps 1–3 are **read-only**; the only artifact is `output/adr-curation-YYYY-MM-DD.md`. Applying changes (Step 4) requires explicit approval and a task branch.
- Never delete or rewrite an ADR body; curation is status marking and indexing only.
- ADR numbers are immutable once referenced; rename only the unreferenced side of a collision.
