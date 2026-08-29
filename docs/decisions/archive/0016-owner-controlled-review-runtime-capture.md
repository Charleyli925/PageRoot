# ADR 0016: Review Runtime Snapshot owner

- Status: Superseded by [ADR 0017](0017-shared-runtime-snapshot-owner.md)
- Date: 2026-08-09

## Context

Static Review compares immutable source HTML and remains the only authority for
source bytes, comments, acceptance and Versions. Some supported source hosts
are empty in those bytes but render a Canvas or SVG after authored code runs.
That paint is useful supplemental presentation evidence, but it must not give
an authored review page control over discovery, scheduling or persistence.

The previous deterministic-review design tried to establish a stronger
forensic conclusion through script causality, comment-scope groups and a second
fresh before/after confirmation pair. Those mechanisms made Review own a large
state machine without changing its source authority.

## Decision

- `SourceHostResolver` starts from `SourceIndex` and `TargetRef` before scripts
  execute. It supports direct source Canvas/SVG roots and source-empty stable
  hosts with an unambiguous `id`, `name`, `aria-label`, `data-*` value or class
  token. Deleted, ambiguous, changed-type or non-empty ordinary hosts are
  omitted.
- The Electron `RuntimeSnapshotOwner` is the only Review capture owner. The
  trusted renderer retains the source-backed binding and sends one bounded,
  side-specific request with exact HTML, source SHA, viewport and owner
  bindings through preload IPC. Authored review pages receive none of that
  information and have no capture channel.
- For each request the owner validates the raw source binding before scripts,
  then uses one-use isolated-world capture to confirm the exact rendered host
  and visible Canvas/SVG paint. It uses a disposable non-persistent session and
  hidden sandboxed window, denies navigation, popups, downloads, webviews,
  permissions and non-preview URLs, applies a main-process deadline and tears
  down the window and session on every result.
- One rect pass and at most one PNG capture per accepted host produce a bounded
  `{ key, state, PNG bytes/hash/size }` snapshot. Trusted renderer memory
  revalidates PNG structure, dimensions, hash and page budgets before comparing
  one before/after pair. Only a completed captured pair with different PNG
  presentation can add one opaque exact-host style fact while the existing
  outline remains navigation-only. The first managed bootstrap binds the
  candidate key to the original per-side `Element`; a separate challenged,
  session/side/source-SHA-fenced private port adds that fact to an in-memory
  runtime map which is unioned with static facts. No runtime DOM attribute or
  outline geometry fallback is permitted.
- Capture failure, late completion, malformed data, unavailable hosts and
  missing desktop capability are silent static-only outcomes. There is no
  second fresh pair, confirmation coordinator, runtime status UI, runtime cache
  or Edit migration in this milestone.

## Consequences

Review becomes usable as soon as static frames are ready. Runtime data can
decorate the existing review presentation but cannot change source HTML,
TargetRefs, comment targets, acceptance, persistence or AI input. Stage 08
later removed Edit capture instead of converging it; [ADR 0017](0017-shared-runtime-snapshot-owner.md) is the current
Review-only contract.

Tests cover source-host resolution, owner request rejection and containment,
one-pass PNG validation, silent static fallback, package inclusion and the
existing comment-location privacy boundary. They do not enumerate arbitrary
script causality, computed selectors, comment-scope groups or forensic replay
cases.
