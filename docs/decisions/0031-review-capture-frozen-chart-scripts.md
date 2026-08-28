# ADR 0031: Review capture serves allowlisted chart scripts from frozen bytes

- Status: Superseded by ADR 0046
- Date: 2026-08-20
- Extends: ADR 0029

## Context

The Review snapshot owner captures each side of a before/after pair in an
isolated offscreen session that cancels every request outside the
`pageroot-preview:` protocol. A page that loads its chart library from a CDN
therefore never renders a chart inside the capture window: both sides sample
the same blank host, and under ADR 0029 every such host is permanently
unverifiable. On CDN pages — the common shape of AI-generated reports — the
tri-state verdict degenerates to "commented → suspected, uncommented →
dimmed", and a genuinely changed but uncommented chart still dims silently.

The Edit one-shot ECharts session already solves the same problem on its side:
it freezes declared local or allowlisted ECharts-CDN script bytes in the main
process and serves only that closure, so the authored page executes without
live network access.

## Decision

The Review capture reuses that exact mechanism and allowlist:

- Before the first side of a pair is captured, the main process extracts the
  allowlisted chart-library `<script src>` URLs declared in the frozen HTML
  (bounded count) and fetches each one once through the Edit runtime's bounded
  fetcher (same HTTPS host allowlist, redirect limit, byte budget), under a
  dedicated bounded prewarm budget that runs before the owner deadline starts.
- Frozen bytes are pinned per capture session: the isolated session answers
  exactly those pinned URLs from memory and blocks every other https request.
  The capture page never reaches the live network.
- The pinned outcome — bytes or absence — is immutable for both sides of one
  capture session. A fetch that fails for the before side cannot succeed for
  the after side of the same pair, so script availability can never differ
  between the two sides and fabricate a changed verdict.
- Positive byte caches are shared across later reviews (immutable per URL);
  failures re-resolve per pair. Fetch failure, oversize, timeout or a missing
  store leaves the affected hosts exactly as unverifiable as today.

## Consequences

- CDN ECharts pages become pixel-verifiable: changed charts get confirmed
  highlights with or without comments, unchanged charts dim with real
  evidence, and the suspected frame recedes to the rare cases where freezing
  itself failed.
- Review capture now performs bounded main-process network fetches for
  allowlisted chart-library URLs authored in the page — the same egress the
  Edit runtime session already performs for the same URLs, and the same bytes
  any browser opening the page would fetch. The capture window itself still
  has no network authority.
- Offline or blocked-CDN environments degrade to the previous behavior
  (unverifiable, fail-closed), never to a partial render.

## Alternatives rejected

- Letting the capture window fetch the CDN directly: gives the authored page
  a live network side channel and makes the two sides race real network
  latency, which is exactly the asymmetry this design pins away.
- Lazy per-request freezing without prewarm: a fetch finishing between the
  two side captures renders the after side only and fabricates a changed
  verdict for an unchanged chart.
- Bundling a chart library with PageRoot: pins one library version, misses
  every other authored version or library, and adds a shipped dependency the
  page did not declare.
