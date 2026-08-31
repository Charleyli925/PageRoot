# ADR 0066: Review pairs persistent IDs and reports source changes

- Status: Accepted
- Date: 2026-08-30
- Supersedes: the fact-scope and negative movement/attribute clauses of [ADR 0046](0046-review-core-text-and-element-diff.md)
- Extended by: [ADR 0068](0068-review-visual-verdict-gate.md), which adds non-authoritative current-frame visual enhancement

## Context

ADR 0046 deliberately reduced Review to text and element presence while the
editor had no durable source-element identity. Persistent
`data-pageroot-id` now makes exact element continuity available across text,
attribute and source-tree changes without reviving runtime screenshots or
visual inference.

## Decision

- Review's source-evidence layer still analyzes only the frozen before/after
  complete HTML and remains user-visible Review authority. ADR 0068 adds
  best-effort visual enhancement; screenshots and a second capture owner remain
  forbidden.
- A valid, unique `data-pageroot-id` is the strongest element pairing key.
  It is the sole persistent element identity; authored tag, parent and source
  order are Review change facts and semantic stale evidence, never alternate
  identity keys.
  The same ID remains paired after same-parent reorder or cross-parent move.
  Duplicate or invalid IDs cannot establish exact identity. Any element that
  carries `data-pageroot-id` claims persistent identity. If it does not pair by
  the same valid, unique ID, it cannot re-enter exact-subtree, relocation,
  singleton, weighted or fuzzy pairing; deleting, replacing or wrongly
  migrating its ID therefore appears as element removal plus addition even when
  its content or markup is unchanged. Duplicate values are globally ambiguous
  across the whole document pair and fail under the same rule. A formal Review
  with any absent, partial, invalid or duplicate Stable ID cannot use exact
  identity or visual enhancement; the already-existing semantic source matcher
  remains the historical-document fallback. Conversely,
  the same persistent ID remains paired when the authored element tag changes;
  the tag change is a source-structure fact, not identity loss.
- Stable sibling topology reports same-parent and cross-parent movement. An
  insertion alone does not report every following sibling as moved. A stable
  element that moves and changes text retains both movement and text facts;
  byte-identical element markup cannot suppress a topology movement fact.
- For a stable pair, authored attribute changes, inline `style` changes and
  `<style>`/stylesheet or `<script>` source changes are source facts. Current-
  frame visual observation may annotate them but cannot delete them. They stay
  under the existing `structure` category and `全部 / 文字 / 元素` toolbar;
  Review does not add a visual/style filter or a second fact system.
  Movement, attribute, style and page-source facts do not suppress simultaneous
  text facts. Whole-element `added`/`removed` facts own descendant text. A moved
  stable subtree compares stable descendants through their individual IDs with
  the existing semantic text diff rather than flattening the subtree into one
  text blob. Moving text between different stable descendants therefore emits
  the movement and the corresponding removed/added text facts. Its separately
  paired one-sided regions suppress only duplicate text evidence after that
  descendant comparison. Candidate regions and their pairing are frozen from
  the authored DOM before disposable text wrappers are inserted, so Review
  markup cannot steal movement ownership from an authored root. Independent
  moved-subtree graphs use distinct semantic and geometry owner namespaces;
  facts from different moved roots cannot merge or suppress one another.
  On a pair with persistent continuity, ordered authored CSS/Script inventories
  are compared independently of element IDs, so a newly added no-ID `<style>`,
  stylesheet `<link>` or `<script>` remains visible in Review.
- Added and removed elements retain the outermost-unmatched-subtree rule.
  A stable element common to both inputs cannot be emitted as delete plus add
  merely because its source parent changed. A cross-region stable-common root
  suppresses only that root's false presence fact; traversal continues through
  its descendants so images, modules and other non-text elements added or
  removed during the move remain Review facts.
- Attribute/style/source facts discover what may be observed; ADR 0068's
  bounded observation reports whether sampled CSS cascade, layout, Canvas/SVG
  and runtime presentation differ or remain explicitly unverified.

## Consequences

- Stable-ID Working Copies get deterministic element continuity; old Versions
  continue through the existing source matcher without visual enhancement.
- Stable sibling topology groups common IDs by parent in one pass; it must not
  rescan the complete element inventory once per distinct parent. Identified
  sibling indexes are likewise built once per parent, not once per child.
- Projection facts remain only `text | structure`. Structure changes admit
  `added`, `removed`, `moved`, `attribute`, `style`, `css-source` and
  `script-source` with the existing purple element presentation.
- CSS/Script source-only changes remain a page-source user fact and may fan out
  to planned Stable-ID host observations without creating replacement changes.
- Tests must cover insertion versus reorder, cross-parent movement, moved text,
  attributes plus text, inline style plus text, CSS/Script source, pure reorder,
  unchanged and changed text inside cross-region moves, text transfer between
  stable descendants, ID deletion and replacement with unchanged markup,
  additions/removals inside a moved subtree, global duplicate-ID ambiguity,
  visual-unsupported incomplete identity, source fallback and the ADR 0068
  enhancement matrix.
