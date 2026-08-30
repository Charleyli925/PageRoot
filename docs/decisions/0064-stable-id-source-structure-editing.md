# ADR 0064: Source structure edits use stable IDs and semantic operations

- Status: Accepted
- Date: 2026-08-30

## Context

The semantic kernel already defines insert, delete and move operations, but the
Canvas previously exposed only same-parent reorder. Editing preview DOM would
mix authored elements with Script-generated nodes and could serialize runtime
state. Cloning authored markup also cannot retain the original persistent IDs.

## Decision

- Insert, duplicate, delete and cross-parent move address authored elements by
  `data-pageroot-id` and run through `SemanticOperationKernel`.
- Insert accepts exactly one identity-free source element. The kernel allocates
  a fresh ID for every element in the inserted subtree.
- Duplicate removes every persistent ID from the selected source subtree before
  using the insert contract. The original and copy never share an ID.
- Move preserves the selected subtree and all of its IDs. Delete retires those
  IDs; later operations never deliberately reuse them.
- The Canvas toolbar exposes duplicate, delete and the existing same-parent
  up/down actions. The editor port also supports identity-addressed insertion
  and cross-parent move without introducing an element palette, component
  system or layout engine.
- Only elements proven in the current `SourceIndex` are eligible. Runtime DOM
  descendants, document roots, stale targets, cycles and ambiguous insertion
  points fail closed.
- Every accepted operation publishes complete next HTML and exact inverse
  patches. It joins ADR 0063's current-open, 20-step memory history and the
  existing Hash/CAS atomic autosave path.

## Consequences

- Structure editing and comments share stable authored identity; deleting a
  target makes its comment orphaned instead of heuristically rebinding it.
- Structural changes normally rebuild the disposable preview from complete
  source. Runtime DOM is never serialized back to HTML.
- Runtime simplification, Review pairing and AI Candidate validation remain in
  PR7, PR8 and PR9 respectively.
