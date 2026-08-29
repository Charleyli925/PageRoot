# ADR 0030: Review runtime projection tolerates authored host mutation

- Status: Superseded by [ADR 0046](../0046-review-core-text-and-element-diff.md)
- Date: 2026-08-20
- Extends: ADR 0029

## Context

Review runtime facts (`changed` highlights and ADR 0029's `suspected` frames)
are delivered to each review page and bound to exact source `Element`
references captured by the parser-blocking bootstrap before authored scripts
run. Both fact intake and every overlay render re-validated the bound element
against its frozen binding, including the source-box signature over the
`class/height/hidden/style/width` attributes.

Chart libraries mutate their own host as a normal part of rendering: ECharts
writes inline `style` (`position: relative`, `user-select: none`, tap
highlight), stamps an `_echarts_instance_` attribute, rescales `width`/
`height` on a canvas host and injects canvas children. Fact intake and overlay
rendering always run after those mutations, so the source-box re-check
classified every real chart host as fingerprint drift and silently dropped its
runtime fact. On real ECharts pages neither the changed highlight nor the
suspected frame could ever appear, even though capture, comparison and merge
all produced correct results — verified end-to-end against a real report page
with a probe reproducing the pipeline.

## Decision

The source-box signature stays strict where it protects identity: while the
parser-blocking bootstrap captures the element reference, before authored
scripts execute. After capture, the frozen reference itself is the identity.
Fact intake and overlay rendering accept the bound element when it is still
connected and keeps its tag name plus frozen identity attributes; they no
longer re-compare the source-box signature. Replacement or removal of the
bound element still drops that host's runtime fact with no outline fallback.

## Consequences

- Runtime facts finally render on real chart hosts: ADR 0029's suspected
  frame and the pre-existing changed highlight both survive normal chart
  library mutation.
- An authored script mutating its own host's box attributes can move where
  the overlay draws. The overlay is disposable presentation inside the page's
  own sandboxed frame — the page can already paint arbitrary pixels — so this
  adds no authority.
- A parser decoy still cannot steal a binding: capture-time checks, reference
  identity, connectivity and frozen identity attributes remain enforced.

## Alternatives rejected

- Allowlisting known chart-library style mutations: every library writes a
  different set; the allowlist would fail the next library and re-create the
  silent drop.
- Re-freezing the signature after scripts settle: there is no reliable settle
  boundary inside the authored page, and the reference identity already
  answers the question the signature was asking.
