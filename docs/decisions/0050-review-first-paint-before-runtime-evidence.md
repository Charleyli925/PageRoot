# ADR 0050: Review paints authored content before optional runtime evidence

- Status: Superseded by ADR 0046
- Date: 2026-08-28
- Scope: formal Review rendering, runtime-visual capture and real-HTML performance evidence

> Historical note: this ADR recorded the short-lived runtime-visual Review
> supplement. ADR 0046 removed that supplement; current Review is static-only
> and does not schedule runtime capture or use runtime evidence for diff facts.

## Decision

Formal Review has three observable stages with different authority:

1. the before/after transport and static review facts are ready;
2. both visible authored documents have completed an initial compositor turn;
3. optional runtime-visual comparison has settled and its display-only facts have been delivered.

The first two stages own user-visible Review availability. Runtime comparison
starts only after both frames report first-paint readiness and a short quiet
turn has elapsed. It remains bounded, cancellable and non-authoritative; it
cannot delay page visibility, mode switching, returning, or accepting.

Review remains an opaque-origin `allow-scripts` sandbox. Because opaque origins
throw when common authored pages read Web Storage, Preview and Review inject the
same frame-local memory-compatible Storage surface before authored scripts.
The values are neither durable nor shared and disappear when the iframe is
revoked. This compatibility layer grants no origin, filesystem, Bridge, Source,
Candidate, Version, save, export or AI-input authority.

Real-HTML measurement keeps text visibility and authored chart completion as
separate facts. PageRoot's own Review SVG masks, outlines and transition layers
are excluded from chart discovery; otherwise UI annotation geometry can create
both false chart counts and permanent false timeouts. Review additionally
records the point at which both child frames acknowledge first paint.

## Rejected alternatives

- Adding `allow-same-origin` would make storage work by expanding the sandbox's
  authority instead of supplying the narrow compatibility behavior the page
  needs.
- Starting hidden runtime capture at child `DOMContentLoaded` makes optional
  validation windows compete with the two documents the user is waiting to
  see.
- Calling iframe load or visible text "complete" would hide blank Canvas and
  delayed SVG/ECharts content.
- Counting Review-owned overlays as authored charts makes the benchmark measure
  the diagnostic UI rather than the user's HTML.

## Required proof

- An opaque Review iframe can run a storage-reading authored script and paint a
  non-empty Canvas without persisting values beyond that frame.
- Existing private comment/runtime projection capabilities remain isolated and
  unforgeable.
- Runtime capture cannot start before both frames report first-paint readiness.
- Real chart completion is reported separately from shell, text and first paint,
  and managed Review overlays do not enter the chart inventory.
- Return and accept preserve the existing Candidate and Version authority flow.
