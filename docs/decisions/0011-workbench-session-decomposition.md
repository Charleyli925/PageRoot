# ADR 0011: Workbench is a composition root over explicit sessions and views

- Status: Accepted
- Date: 2026-07-31

## Context

`app/workbench.tsx` accumulated project identity, source persistence, comments,
AI runs, Versions, project rules, view transitions and their UI in one React
component. Several facts were mirrored across React state and refs so async
callbacks could read current values. The product behavior was covered, but a
small change could cross unrelated save, project-switch, AI and comment
boundaries.

`HtmlCanvasEditor.tsx` had a similar concentration of parsing, DOM
instrumentation, selection, interaction, preview synchronization and source
editing coordination. The repository also retained the retired V1 native
editing controller and its isolated tests even though production had already
adopted V2 editable islands exclusively.

The migration must preserve visible behavior, source-byte authority,
autosave/close safety and AI lifecycle semantics. A line-count rewrite or a
temporary dual-write would increase rather than reduce that risk.

## Decision

The Workbench remains the React composition root, but mutable facts move to
explicit application sessions:

- `ProjectSession` owns open/registered identity, generation and query fencing.
- `DocumentSession` owns source bytes, Hash, revisions, pending write and the
  single in-flight flush.
- `CommentSession` owns the renderer comment working copy, composer,
  tombstones and saved-comment edit session. `DraftSession` remains the
  acknowledged durable mutation authority.
- `ProjectRulesSession` owns the rules editor, composition fence, autosave and
  reconciliation.
- `RunSession` owns active/background run projections, Qoder handoff state,
  background results and renderer operation locks.
- `VersionSession` owns immutable Version projection and history-view
  transitions.

`workbench.tsx` subscribes to session snapshots and dispatches intent. It may
derive read-only presentation values, but it cannot keep an independently
writable copy of a session-owned fact.

Pure formatting, decoding and browser helpers live under `app/workbench/`.
History and AI handoff rendering are snapshot-and-callback view components.
The architecture gate rejects application-service imports from those
presentation files.

Canvas coordination stays in `HtmlCanvasEditor.tsx`; pure DOM, interaction,
selection, preview-sync, page-view and style-inspection helpers live in
adjacent `html-canvas-*.ts` modules. The split does not introduce another
source, Selection or editing authority.

The V1 `NativeEditingController`, its support modules, its dedicated tests and
the unreachable V1 SourcePatch operations are removed. The V2
`IslandEditingController` plus `SourcePatchEngine` remain the only production
text-edit path, as established by ADR 0004.

The migration lands in independently testable stages. Each stage first moves
one owner or one pure view, removes the former writers, updates its tests and
passes the architecture gate. There is no compatibility dual-write inside the
renderer.

## Preserved product contract

- Visible controls, text, ordering and interaction outcomes stay unchanged.
- Source HTML bytes remain authoritative; preview DOM is never serialized.
- Project switch, close, Request freeze and history navigation use the same
  drain obligations and fail-closed recovery.
- AI results remain immutable and require explicit user activation.
- Comment Draft CAS, attachment persistence, source Hash conflicts and
  unknown-outcome reconciliation keep their existing authority.
- No package, release, data migration or stored-schema change is introduced by
  this decomposition.

## Rejected alternatives

### Split by line count

Rejected because arbitrary extraction can separate a transition from its
identity fence or leave shared mutable refs behind. Boundaries follow state
ownership and pure rendering responsibilities.

### Introduce a second state-management framework

Rejected because the existing application sessions already provide explicit
snapshots, identities and reconciliation. Another store would add a parallel
authority without changing the persistence model.

### Rewrite Workbench in one commit

Rejected because a large replacement would make behavioral equivalence,
failure injection and regression localization unnecessarily difficult.

### Keep V1 as dormant fallback

Rejected because production never imports it, its tests describe a retired
contract, and dormant editing engines can be accidentally reconnected. Git
history remains the historical reference.

## Consequences

- Async callbacks read one session authority instead of paired state and refs.
- Owner tests can exercise transitions without rendering the entire
  Workbench.
- Pure view extraction can continue without moving business decisions into
  components.
- `workbench.tsx` remains large while it still coordinates many product
  workflows; remaining size alone is not permission to create new owners.
- Future changes that add a mutable fact must name its sole owner, update the
  state table and test-impact map, and pass the architecture gate.
