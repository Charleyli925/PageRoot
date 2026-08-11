# ADR 0017: Review-only runtime snapshot owner

- Status: Accepted
- Date: 2026-08-10

## Context

ADR 0013 introduced an Edit bitmap projection and ADR 0016 introduced a
static-first Review capture owner. The later shared implementation still made
ordinary Edit interactions own a cache, request lifecycle, IPC capability and
Blob-backed DOM projection for a feature that is not part of Edit's source
authority.

The product contract is simpler: Edit is script-disabled, source-backed and
static; Preview owns real page interaction; Review may add bounded runtime
evidence after its static result is ready. Keeping Edit capture would retain a
second consumer and presentation protocol without changing that contract.

## Decision

- `runtime-snapshot-hosts.js` is the sole source-host resolver for Review. It
  permits only direct source Canvas/SVG roots and source-empty hosts with a
  unique stable source binding. Arbitrary HTML, `tbody`, script causality,
  computed selectors, comment scope and runtime-DOM discovery are outside the
  feature.
- `runtime-visual-capture-owner.mjs` is the sole Electron capture owner. Its
  `htmlAIReviewRuntimeSnapshots` route accepts only `before` and `after`
  requests with exact HTML/SHA, viewport and frozen host bindings; it never
  accepts a project path, TargetRef, comment identity, binary input or
  arbitrary script.
- The owner creates a one-use isolated preview/session and validates bindings
  before scripts run. It confirms only the corresponding runtime host and
  visible Canvas/SVG paint, then returns bounded PNG bytes and its measured
  CSS-pixel layout rectangle. A trusted parser validates every response.
- Edit has no runtime snapshot session, cache, capture API, bitmap projection,
  Blob URL, owner request or projection attributes. Authored inline SVG remains
  a source-backed non-editable root; runtime-only Canvas/SVG stays in Preview.
- Review remains static-first and requests one before/after pair after both
  frames are ready. It may add an opaque exact-host fact only for a verified
  difference. Candidate results travel from the trusted parent to the first-
  bootstrap-bound `Element` over a separate challenged private port; runtime
  facts remain an additive in-memory map, and outline IDs never supply geometry.
  Unavailable, malformed, timed-out or late data is a static-only result.

## Consequences

There is one Review candidate finder, IPC route, owner, session/PNG envelope
parser and comparison path. The Edit controller, projection protocol, cache,
preload capability, Blob mounting and their dedicated tests are deleted.
Runtime screenshots remain presentation-only: they cannot affect source
persistence, selection, IME, comments, source history, Review source analysis
or AI input.
