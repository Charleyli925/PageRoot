# ADR 0058: Bounded Canvas and SVG programs may complete the visible Edit document

> Renumbered from ADR 0046 on 2026-08-29 to repair a numbering collision.

- Status: Accepted
- Date: 2026-08-27
- Scope: visible-first Edit rendering and real-content readiness

## Context

ADR 0025 permits one direct, disposable author-runtime execution in the final
Edit iframe, but its candidate gate recognizes only ECharts. Real PageRoot
documents also draw charts with inline Canvas APIs or source-empty SVG roots.
Those documents currently publish readable static HTML and then silently fall
back without their authored visual content, so project `ready` and first text
visibility do not mean the page the user authored is complete.

## Decision

The existing one-shot Edit runtime may also admit a document when an ordered
classic script contains an explicit visual-paint signal:

- Canvas `getContext()` for 2D, WebGL or bitmap rendering;
- creation of a Canvas element;
- SVG namespace element creation; or
- mutation of an SVG `viewBox` before author-owned SVG descendants are added.

Script presence, DOM interaction, analytics and ordinary application behavior
are not candidates. Modules, async/defer/nomodule programs, unsupported imports,
script byte/count limits, local-path containment, the ECharts CDN allowlist,
CSP, the single execution identity, deadline, freeze and final source audit all
remain unchanged. A custom visual program may use only inline or contained
local script bytes; this decision does not add a remote-script allowlist.

Edit host discovery continues to require a unique stable source binding.
Source-empty non-dangerous hosts remain eligible. A direct Canvas may retain
authored fallback text because bitmap paint does not mutate HTML source. A
direct SVG is eligible only when its authored content is empty. Runtime SVG
descendants are moved under an owned inner SVG surface before the final audit,
while all authored root attributes are restored. Initialization-only attribute
changes on non-host source nodes are likewise restored before audit. A direct
Canvas may retain runtime `width` and `height` in the disposable DOM because
resetting either clears its bitmap; those values are excluded from source
comparison and never enter source patches. Source structure, source text and
persisted source attributes therefore remain the authority.

Readiness is reported as separate evidence:

1. `pageroot:document:static-frame-loaded`: readable script-disabled HTML is
   visible;
2. `pageroot:canvas:render-verified` with `detail.content=static-complete` or
   `runtime-complete`: the editable frame has passed its final audit; and
3. the real-content benchmark independently inspects visible text plus Canvas,
   SVG and chart facts before reporting full-content readiness.

No PNG or screenshot representation is introduced in Edit. Review retains its
separate runtime-snapshot owner and authority rules.

## Rejected alternatives

- Enabling every classic script would make an interactive application script a
  rendering prerequisite and unnecessarily widen the runtime surface.
- Declaring the static iframe load to be chart-ready would preserve misleading
  performance results for Canvas and SVG reports.
- Serializing the executed DOM back to source would create a second authoring
  authority and leak runtime-only nodes into saves.
- Capturing a screenshot for Edit would make the chart visible but not a real,
  editable DOM/Canvas/SVG document.

## Required proof

- ECharts, inline Canvas and source-empty SVG fixtures complete in the final
  visible Edit iframe with exactly one bootstrap execution and zero snapshot
  images.
- Ordinary non-visual scripts, non-empty source SVG roots, unsupported programs
  and unbound or dangerous hosts fail closed to the static document.
- Runtime-generated nodes remain inside approved hosts; authored source nodes,
  text and persisted attributes pass the final audit after display-only
  initialization attributes are normalized.
- Original fixture bytes remain unchanged after open, edit and benchmark runs.
- Benchmarks publish display-ready, edit-ready and full-content/chart-ready as
  distinct timings.
