# ADR 0054: bundle common ECharts bytes and retain five exact frozen Canvases

## Status

Partially superseded by [ADR 0065](0065-disposable-edit-runtime.md) and the
single-active-Canvas retirement. Decision 1, the immutable verified byte-store
responsibility in Decision 2, and the bounded static document-surface cache
remain active. Multi-tab `HtmlCanvasEditor` residency, script-enabled iframe
residency, script prewarm and paint/freeze rules are retired.

## Context

Progressive HTML readiness made text scrollable before Canvas verification, but
real finance reports still exposed two avoidable costs. A fixed-version ECharts
URL was fetched with `no-store` for every one-shot runtime and could consume the
entire four-second safety deadline. After author scripts ran, every visual page
also waited a fixed 1,200 milliseconds even when its chart had already painted.
Tab activation then discarded the verified iframe, so returning to one of five
working reports executed the same chart again.

## Decision

1. ECharts 5.5.0 minified bytes, SHA-256, Apache-2.0 license and NOTICE ship in
   App Resources. Exact 5.5.0 cdnjs/jsDelivr/unpkg minified URLs resolve to that
   integrity-checked file without network access or source rewriting.
2. Exact-version allowlisted ECharts core URLs use a private content-addressed
   library store. It strictly enforces both entry and byte ceilings and verifies
   every blob on read. URL metadata never replaces the content hash. The store
   owns bytes only, never a runtime session, compatibility result or DOM.
3. Registered inactive tabs sequentially prewarm only immutable script bytes.
   The cache is keyed by source HTML plus resolved source root, holds at least
   five and never caches mutable local-script dependencies.
4. The author bootstrap has no minimum settle duration. It disables disposable
   initial ECharts animation, observes the instance paint, and freezes after two
   quiet animation frames. One-shot timeout/animation work drains by completion.
   The four-second deadline remains only as a broken-script safety fallback.
   ECharts stays on the exact 5.5.0 CDN bytes; GHSA-fgmj-fm8m-jvvx is a dated
   reviewed exception because 6.1.0 would miss those URLs.
5. Workbench keeps exactly one `HtmlCanvasEditor` for the current runtime owner.
   A tab switch mounts the new active editor underneath the matching
   script-disabled static projection; exact Canvas generation and source-Hash
   verification retire that projection. Inactive tabs retain no editor iframe
   or Runtime DOM.
6. `DocumentSurfaceCacheSession` and the library store remain presentation and
   resource caches. Neither owns Session facts, operation IDs, source commits,
   snapshots or rollback.

## Consequences

- A known ECharts report can render offline and no longer pays CDN cold start.
- Inactive report tabs retain byte-bounded static projections and scroll state,
  but chart/runtime execution is recreated only for the selected document.
- Memory is bounded by five static display iframes, one active Edit Canvas and
  its bounded handoff slot, 20 source projections and the separate 128 MiB
  library ceiling.
- Correctness gates still validate source path, SHA, host bindings, script size,
  runtime audit and Canvas authority; only duplicate resource work and minimum
  waiting are removed.
