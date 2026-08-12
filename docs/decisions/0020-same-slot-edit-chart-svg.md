# ADR 0020: Declared Edit charts use one-shot same-slot SVG

- Status: Accepted for staged implementation
- Date: 2026-08-12
- Supersedes: none
- Related: ADR 0017 and `docs/EDIT_CHART_VISUALS.md`

## Context

Edit deliberately disables authored scripts. Runtime-only charts are therefore
empty even when their source host is a valid comment target.

An earlier proposal would run the authored page separately and composite a
native visual layer above Edit. Phase 0 showed that this requires another
window/document lifecycle, cross-window geometry, clipping, native input
pass-through, cache invalidation and platform-level proof that ordinary
Playwright DOM assertions cannot supply. Those responsibility classes are too
large for the bounded user benefit.

A smaller Phase 0 proved that a PageRoot-owned, fixed-viewBox SVG can occupy the
existing empty source host while authored scripts remain disabled. Pointer and
IME ownership stay in the Edit iframe, and source bytes remain unchanged.

## Decision

PageRoot accepts one explicit, versioned source contract for a bounded class of
read-only Cartesian charts. The source contains an empty, uniquely identified
host with fixed SSR width, height and aspect ratio plus a separate inert
`<template>` containing JSON-only Chart Spec.

The trusted renderer validates that closed schema, maps it to a fixed PageRoot
ECharts option, performs SVG SSR with the pinned PageRoot ECharts version and
validates the output. Product integration may mount the SVG only inside the
original source host's Shadow DOM. It never enables or imports authored script,
authored ECharts, raw option, runtime DOM or network content.

All accepted charts for one Edit iframe generation are rendered once. Hidden
Tab panels retain their SVG; Tab changes only apply the existing
`PageViewContext`. Rendering uses only declared fixed dimensions, never the
current layout rectangle of a hidden slot. A source-authority change destroys
the existing iframe and its Shadow roots through the existing Canvas
generation lifecycle.

The source host remains the sole selection and comment target. Runtime SVG
nodes are pointer-transparent, inaccessible to TargetResolver and absent from
source, persistence, Review, Version and AI input. There is no new Session,
cache, observer, IPC route, drain obligation or failure UI.

PR-1 introduces the dormant pure contract and renderer only. It does not alter
production Edit. PR-2 is the sole authorized integration step and must prove
the full behavior in real Electron before the feature is considered active.

## Consequences

- Eligible bar, line, area, stacked, mixed and scatter charts can become
  visible in place without changing Edit's script sandbox.
- Unsupported and malformed declarations fail silently and preserve current
  behavior.
- Tab return is immediate because it neither reruns ECharts nor rebuilds SVG.
- A chart is one source-backed comment box; data points are not targets.
- Initial Canvas readiness includes bounded one-shot SVG generation cost.
- Responsive behavior is vector scaling only; label layout does not rerun.
- Existing arbitrary-script documents need generator-authored Chart Spec or
  static HTML/SVG and are not automatically compatible.
- Updating the pinned ECharts version is a product renderer change, not author
  page compatibility work.

## Rejected alternatives

### Execute selected authored scripts in Edit

Rejected because a script name, ECharts version or apparent chart call does not
bound its side effects. It would weaken the source/DOM/input authority that Edit
depends on.

### Separate runtime page with a native overlay

Rejected because it introduces the lifecycle, geometry, clipping and native
input responsibilities observed in the failed Phase 0.

### Screenshot or bitmap projection

Rejected because it needs capture timing, raster scaling, cache and stale-image
management and has poorer visual quality.

### Raw ECharts option plus sanitizer

Rejected because ECharts options are an extensible capability language. A
denylist would have to track callbacks, formatter forms, components, URLs,
transforms and future library behavior.

### Rerender on Tab activation or resize

Rejected because hidden layout commonly reports zero size and a recurring
render loop creates generation, observer and flash behavior. Fixed source
dimensions and viewBox scaling remove that responsibility.

### User-facing fallback and retry UI

Rejected for v0.1. The feature is a silent enhancement to Edit, not a new
workflow. Unsupported content remains available in Preview.
