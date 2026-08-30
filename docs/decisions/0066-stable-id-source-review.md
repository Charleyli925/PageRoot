# ADR 0066: Review pairs persistent IDs and reports source changes

- Status: Accepted
- Date: 2026-08-30
- Supersedes: the fact-scope and negative movement/attribute clauses of [ADR 0046](0046-review-core-text-and-element-diff.md)
- Retains: ADR 0046's static-analysis-only boundary and removal of Review runtime capture

## Context

ADR 0046 deliberately reduced Review to text and element presence while the
editor had no durable source-element identity. Persistent
`data-pageroot-id` now makes exact element continuity available across text,
attribute and source-tree changes without reviving runtime screenshots or
visual inference.

## Decision

- Review still analyzes only the frozen before/after complete HTML. It never
  uses Runtime DOM, screenshots, computed style, layout or rendered pixels as
  formal evidence.
- A valid, unique `data-pageroot-id` is the strongest element pairing key.
  The same ID remains paired after same-parent reorder or cross-parent move.
  Duplicate or invalid IDs cannot establish exact identity. Duplicate values
  are globally ambiguous across the whole document pair and cannot fall back
  to exact-subtree, relocation or fuzzy pairing. Historical inputs
  without IDs retain ADR 0046's legacy semantic pairing and are never assigned
  IDs by Review. A pair with no shared valid persistent ID, including a legacy
  Candidate that churned every ID, uses that legacy matcher for the whole pair;
  isolated unmatched IDs cannot partially enable exact topology.
- Stable sibling topology reports same-parent and cross-parent movement. An
  insertion alone does not report every following sibling as moved. A stable
  element that moves and changes text retains both movement and text facts;
  byte-identical element markup cannot suppress a topology movement fact.
- For a stable pair, authored attribute changes, inline `style` changes and
  `<style>`/stylesheet or `<script>` source changes are Review facts. They stay
  under the existing `structure` category and `全部 / 文字 / 元素` toolbar;
  Review does not add a visual/style filter or a second fact system.
  Movement, attribute, style and page-source facts do not suppress simultaneous
  text facts; only whole-element `added`/`removed` facts own descendant text.
- Added and removed elements retain the outermost-unmatched-subtree rule.
  A stable element common to both inputs cannot be emitted as delete plus add
  merely because its source parent changed.
- Attribute/style/source facts explain source edits, not their complete visual
  impact. CSS cascade effects, layout, wrapping, animation state, Canvas/SVG
  pixels, generated DOM and other runtime presentation remain non-goals.

## Consequences

- Stable-ID Working Copies get deterministic element continuity; old Versions
  continue to open and use their earlier bounded matcher.
- Projection facts remain only `text | structure`. Structure changes admit
  `added`, `removed`, `moved`, `attribute`, `style`, `css-source` and
  `script-source` with the existing purple element presentation.
- CSS/Script source-only changes receive an explicit page-source Review entry
  even when their source elements are non-rendering `<head>` content.
- Tests must cover insertion versus reorder, cross-parent movement, moved text,
  attributes plus text, inline style plus text, CSS/Script source, pure reorder,
  global duplicate-ID ambiguity, legacy no-ID behavior and the continuing
  absence of runtime/pixel facts.
