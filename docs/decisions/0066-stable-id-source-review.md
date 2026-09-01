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
- Stable sibling topology reports cross-parent movement exactly. A same-parent
  reorder names one moved element only when that attribution is unique; an
  ambiguous reorder attaches `元素顺序调整` to the shared stable parent instead
  of guessing. An insertion alone does not report every following sibling as
  moved. A stable element that moves and changes text retains both movement and
  text facts; byte-identical element markup cannot suppress a topology fact.
- For a stable pair, authored attribute changes and inline `style` changes are
  position-bound source facts. A safely parsed simple CSS selector may map a
  stylesheet difference to its concrete Stable-ID hosts. Whole-page CSS/Script
  changes without such a mapping are private diagnostics under ADR 0068 and do
  not enter `structure` or `全部 / 文字 / 元素`.
  Movement, reorder, attribute and style facts do not suppress simultaneous
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
  Ordered authored CSS/Script inventories may be retained as task/version
  diagnostics independently of element IDs; they are not page Review markers.
- Added and removed elements retain the outermost-unmatched-subtree rule.
  A stable element common to both inputs cannot be emitted as delete plus add
  merely because its source parent changed. A cross-region stable-common root
  suppresses only that root's false presence fact; traversal continues through
  its descendants so images, modules and other non-text elements added or
  removed during the move remain Review facts.
- Attribute/style facts discover what may be observed. ADR 0068's bounded
  observation remains private diagnostic input and cannot manufacture a
  user-visible page change or uncertainty banner.

## Consequences

- Stable-ID Working Copies get deterministic element continuity; old Versions
  continue through the existing source matcher without visual enhancement.
- Stable sibling topology groups common IDs by parent in one pass; it must not
  rescan the complete element inventory once per distinct parent. Identified
  sibling indexes are likewise built once per parent, not once per child.
- Projection facts remain only `text | structure`. Structure changes admit
  `added`, `removed`, `moved`, `reordered`, `attribute` and `style` with the
  existing purple element presentation.
- CSS/Script source-only changes cannot fan out to Stable-ID hosts or create a
  page-level Review change.
- Tests must cover insertion versus reorder, cross-parent movement, moved text,
  attributes plus text, inline style plus text, CSS/Script source, pure reorder,
  unchanged and changed text inside cross-region moves, text transfer between
  stable descendants, ID deletion and replacement with unchanged markup,
  additions/removals inside a moved subtree, global duplicate-ID ambiguity,
  visual-unsupported incomplete identity, source fallback and the ADR 0068
  enhancement matrix.
