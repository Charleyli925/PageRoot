---
name: find-simplifications
description: Audits the PageRoot repository for over-design, dead code, duplicated implementations, documentation bloat/drift, and chain-of-thought leakage, then produces an evidence-based simplification proposal document. Use when the user asks to find simplifications, dead code, over-engineering, tech debt, redundant docs, or requests a cleanup/simplification audit.
---

# Find Simplifications

The canonical, agent-agnostic workflow lives in [docs/SIMPLIFICATION_AUDIT.md](../../../docs/SIMPLIFICATION_AUDIT.md). Read that document and follow it exactly — scope table, scan commands, verification bar, proposal template, and guardrails are all defined there.

Key reminders (details in the canonical document):

- The audit is strictly **read-only**; the only artifact is `output/simplification-proposal-YYYY-MM-DD.md`.
- Every finding must be verified against current code before it enters the proposal.
- Never propose weakening fail-closed safety paths or AGENTS.md product invariants.
