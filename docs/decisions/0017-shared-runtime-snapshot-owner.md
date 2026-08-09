# ADR 0017: Edit and Review share one runtime snapshot owner

- Status: Accepted
- Date: 2026-08-09

## Context

ADR 0013 gave Edit a separate capture protocol and cache while ADR 0016 gave
Review a source-host resolver and isolated owner. The parallel paths had
different IPC globals, candidate rules, cache identity, PNG validation and
tests. That duplicated security-sensitive logic and made normal text editing
needlessly recapture or clear an otherwise valid visual.

## Decision

- `runtime-snapshot-hosts.js` is the sole source-host resolver for both
  consumers. It permits only direct source Canvas/SVG roots and source-empty
  hosts with a unique stable source binding. Arbitrary HTML, `tbody`, script
  causality, computed selectors, comment scope and runtime-DOM discovery are
  outside the feature.
- `runtime-visual-capture-owner.mjs` is the sole Electron capture owner. One
  narrow request supports the `edit`, `before`, and `after` sides; it contains
  exact HTML/SHA, viewport and frozen host bindings, never a project path,
  TargetRef, comment identity, binary input or arbitrary script.
- The owner creates a one-use isolated preview/session and validates bindings
  before scripts run. It confirms only the corresponding runtime host and
  visible Canvas/SVG paint, then returns bounded PNG bytes plus the measured
  CSS-pixel layout rectangle. A shared trusted parser validates every response
  for both Edit and Review.
- `EditRuntimeSnapshotSession` is a separate renderer owner for Edit's small,
  non-durable cache. Its coarse input hash covers supported host markup plus
  `base`, `link`, `script` and `style`, not every text byte or an inferred
  JavaScript graph. Normal text edits and view/mode transitions re-resolve the
  same host and reuse a verified image. A changed input preserves a compatible
  image only while one background replacement is captured and decoded.
- Review remains static-first and requests one before/after pair after both
  frames are ready. It may add an opaque marker only for a verified difference;
  unavailable, malformed, timed-out or late data is a static-only result.
- Direct Edit projections own only their temporary overrides. If a source patch
  replaces a mounted Canvas/SVG inline style, clearing or replacing the bitmap
  leaves the newer source style intact while the direct host keeps the captured
  CSS-pixel geometry.

## Consequences

There is one candidate finder, IPC route, owner, session/PNG envelope parser and
host presentation contract. The old Edit controller, projection protocol,
separate preload global, `tbody` route, dependency graph and their tests are
removed. Runtime screenshots remain presentation-only: they cannot affect
source persistence, selection, IME, comments, source history, Review source
analysis or AI input.
