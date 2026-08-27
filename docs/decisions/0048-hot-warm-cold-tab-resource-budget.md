# ADR 0048: Tab display cache uses a measured Hot/Warm/Cold resource budget

- Status: Accepted
- Date: 2026-08-28
- Scope: read-only document display projections and tab-switch presentation

## Context

The first display cache retained three mounted iframes, eight HTML projections
and up to 48 MiB of source strings. The packaged 20-tab benchmark proved that
this bounded tab identity correctly, but it also exposed two different costs:

- 40 switches recreated 150 iframes and reached roughly 3 GiB working set;
- a cache projection disappeared at project publication, before the exact new
  Canvas generation had finished rendering its full authored content.

HTML string bytes are therefore a useful warm-cache bound, but not a credible
proxy for live iframe, DOM, image, font, Canvas or GPU cost.

A two-Hot trial and the restored three-Hot run both recreated 187 iframes under
the new overlap handoff and produced no credible working-set difference. Hot
count was therefore not the dominant churn variable. The measured budget keeps
the existing three Hot surfaces and constrains the larger Warm tier explicitly;
the higher overlap-handoff churn remains separately visible in the benchmark.

## Decision

The cache now publishes three explicit projection tiers:

- **Hot**: at most three recent exact projections may keep inert, script-disabled
  display iframes mounted. Three is the hard live-surface budget, independent of
  how small the HTML strings are.
- **Warm**: Hot and Warm together retain at most twenty exact HTML projections;
  after the three Hot entries, up to seventeen remain as frozen in-memory bytes
  and presentation metadata. They have no mounted DOM and cover the product's
  measured 20-tab scenario without becoming another authority.
- **Cold**: every open document tab outside the entry or byte budget retains
  only its durable Project/Document identity. Selecting it uses the normal
  registered-project open path.

Warm plus Hot source projections are bounded to 32 MiB. The snapshot exposes
hot, warm and cold identities plus the effective limits so diagnostics and the
packaged benchmark can prove the budget instead of inferring it from DOM count.

When a cached tab is selected, its inert display surface remains above the new
authoritative Canvas until the exact Canvas generation and source Hash are
verified. The real editor or Preview mounts underneath immediately; cached
presentation never delays hydration, Canvas verification or input readiness.
The handoff emits distinct `visible-ready` and `handoff-complete` timing marks.

## Authority constraints

- Cache bytes never enter DocumentSession, Source, save, export or Version
  authority.
- Dirty, flushing, failed or Canvas-unverified documents remain inadmissible.
- A cached surface stays sandboxed without scripts and cannot receive pointer
  input.
- Every activation still uses WorkbenchNavigationWorkflow and ProjectWorkflow.
- Eviction never closes, reorders or changes the active identity of a tab.

## Required proof

- default budget retains three Hot plus seventeen Warm projections for 20 tabs;
- the twenty-first retained document becomes Cold without losing its tab;
- 20-open and 40-switch packaged runs remain within live, entry and byte limits;
- a cached surface becomes visible before the authoritative Canvas handoff and
  is retired only after exact Canvas verification;
- edit, preview, review, acceptance, close, restart and source integrity remain
  governed by their existing owners.
