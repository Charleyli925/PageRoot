---
name: find-simplifications
description: Audits the PageRoot repository for over-design, dead code, duplicated implementations, documentation bloat/drift, and chain-of-thought leakage, then produces an evidence-based simplification proposal document. Use when the user asks to find simplifications, dead code, over-engineering, tech debt, redundant docs, or requests a cleanup/simplification audit.
---

# Find Simplifications

Trigger: the user asks for a simplification audit, dead-code hunt, over-design review, doc cleanup, or similar.

Task type: **read-only review**. Do not implement removals in this pass.

Canonical workflow: read [docs/SIMPLIFICATION_AUDIT.md](../../../docs/SIMPLIFICATION_AUDIT.md) and follow it exactly. That document owns the scope table, scan commands, verification bar, proposal template, and safety classification. Do not copy those rules here.

Output: `output/simplification-proposal-YYYY-MM-DD.md` only.
