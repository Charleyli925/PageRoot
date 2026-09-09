---
name: stemmio-product-design
description: Design, improve, audit or review Stemmio (legacy PageRoot) user interfaces and flows, including layout, copy, navigation, visible states, Agent progress, Review and adoption. Use for user-facing changes and UI code review; skip internal-only changes without user-visible effects.
---

# Stemmio Product Design

Use the current checkout's design contracts to make evidence-based decisions.

1. Resolve the active Git root. This skill belongs at `.agents/skills/stemmio-product-design/` in the product repository; its root is three levels above this directory. If invoked from an installed copy, locate the active checkout containing `docs/PRODUCT_DESIGN_SYSTEM.md`. Do not fall back to another checkout or stale primary tree.
2. Read `docs/PRODUCT_DESIGN_SYSTEM.md`. Select relevant sections of `docs/INTERACTION_FLOW.md` and focused policies through its Pattern table or the repository capability-context query. Read `docs/DESIGN_LANGUAGE.md` for visual changes.
3. Route through `docs/DESIGN_REVIEW_PROTOCOL.md`: SCREEN REVIEW for a screen, FLOW AUDIT for a journey, DESIGN CHANGE for authorized implementation, CODE REVIEW for a diff. Add AI EXPERIENCE LENS when Agent, Candidate, Review or adoption is involved.
4. Apply that mode's evidence and output contract. For flows, map the requested start/end and applicable state matrix before judging. For screenshots, do not infer unseen behavior. For source-only review, identify runtime checks as unverified. Keep a one-copy or token adjustment lightweight under DESIGN_LANGUAGE §5.
5. Report concrete findings with stable category, severity, confidence, evidence and observable acceptance criteria. If rules conflict, quote both locations and report the conflict separately from product bugs. Use current explicit superseding clauses where available.
6. For authorized changes, update the unique owner document and follow the existing task gates. Append actual QA evidence to `design-qa.md` when applicable. Preserve P0/P1 scope-stop, user authorization, root model and agent-routing rules; this skill grants no extra lifecycle authority.

All paths above are relative to the resolved product Git root. Missing contracts are a reported setup gap, not permission to invent a replacement design system. No external skill installation, background scheduler or custom CI gate is required.
