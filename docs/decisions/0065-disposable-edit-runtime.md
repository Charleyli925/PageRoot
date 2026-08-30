# ADR 0065: Edit runs supported author scripts in a disposable source-bound page

- Status: Accepted
- Date: 2026-08-30
- Supersedes: [ADR 0025](archive/0025-edit-direct-one-shot-runtime.md), [ADR 0058](archive/0058-bounded-canvas-svg-edit-runtime.md), and the library-store/prewarm/freeze portions of [ADR 0054](0054-bundled-echarts-and-five-canvas-residency.md)
- Does not change: Preview isolation, Review's static-source facts, or complete-HTML persistence

## Context

The one-shot Edit runtime admitted only visually classified ECharts, Canvas and
SVG programs. It then tried to detect paint, wait for quiet frames, freeze
timers and listeners, audit runtime mutations against source hosts and retain a
single settled iframe. That contract made ordinary Script pages unavailable in
Edit and made every semantic source change participate in a second runtime
reconciliation system.

Stable source-element IDs and complete-HTML semantic operations now provide the
durable identity and save boundary. Runtime DOM no longer needs to impersonate
source or be reconciled node by node.

## Decision

- A persisted desktop document with a supported executable `script` program may
  use the direct Edit runtime. The visible iframe runs the authored scripts with
  normal browser scheduling; PageRoot does not stop timers, listeners,
  observers, animations or message ports.
- Main verifies the active source path, exact HTML Hash, Canvas generation and
  resource budgets before preparing a scoped `pageroot-edit-runtime:` resource
  closure. Inline and contained local scripts are supported. Exact reviewed
  ECharts 5.5.0 CDN URLs may resolve to pinned packaged bytes. Module import
  graphs remain unsupported and fail closed to static Edit.
- Before author scripts execute, the fixed bootstrap privately binds each
  instrumented source node to its source identity and removes copied public
  markers from runtime-generated clones. Runtime-generated descendants resolve
  only to their nearest still-proven authored source host.
- PageRoot directly edits only nodes still proven to be authored source
  elements. A runtime-generated node is display-only: it may be commented on
  through its nearest source host but cannot be text-edited, styled, reordered,
  moved, duplicated or deleted as source.
- Every accepted semantic source change still produces complete next HTML.
  Structural and other non-native changes rebuild the disposable iframe and
  rerun the author program. Native text input may remain in the current frame
  while composing and rebuilds once when the edit finishes. Comments, save and
  source echoes without an HTML change do not require a rebuild.
- One scoped resource session may serve repeated disposable frames only while
  the authored script markup and bodies have the same exact program identity.
  A script change requires a new Canvas generation and a newly authorized
  resource closure.
- Script-enabled Edit pages are not retained in the inactive five-Canvas pool.
  Switching away discards the page and revokes its resource session; returning
  prepares a fresh closure and runs a fresh disposable page. Script-disabled
  static Canvases keep the existing bounded hot cache.
- Runtime DOM, Canvas pixels, form state and generated nodes are never
  serialized to source, save, Version, export, Request, Candidate or Review.
  Source HTML plus stable IDs remains the only persistence authority.
- The former visual-signal gate, host discovery, real-paint/quiet-frame probe,
  runtime mutation audit, activity freeze, script prewarm, disk cache and
  per-node runtime snapshot reconciliation are retired.

## Boundaries

- The runtime remains a trusted-local authoring capability, not hostile-content
  isolation. The iframe has no Node integration or preload of its own, while
  same-origin parent reachability remains the accepted cost of DOM editing.
- Navigation, popup and form submission remain blocked. Resource byte/count,
  source-root containment, CSP, stale generation/Hash and orphan-session limits
  remain fail-closed.
- Unsupported programs fall back to the script-disabled source document. Edit
  does not use screenshots, bitmap projection or hidden execution probes.
- Review continues to compare frozen source HTML only; runtime output is not a
  formal change fact.

## Required proof

- Ordinary DOM scripts continue running in Edit without leaking generated DOM
  into the Working Copy.
- ECharts and Canvas pages render in the real editable iframe.
- `async` and `defer` scheduling attributes are preserved.
- A semantic structure edit rebuilds the iframe, reruns the program and saves
  only the complete semantic HTML result.
- Switching away and back creates a fresh runtime page without replaying an old
  request identity or reusing an inactive live Script DOM.
- Generated descendants map to a source host for comments and expose no source
  edit or structure commands.
