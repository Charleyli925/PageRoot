# ADR 0062: semantic source operations lower to complete identified HTML

## Status

Accepted.

## Context

The live Canvas still creates capability-specific SourcePatch plans and the
history outbox stores exact patches. That preserves current behavior, but it
does not provide one contract for text, attribute, style and structural edits.
Persistent `data-pageroot-id` now gives managed Working Copies a stable source
identity on which such a contract can be based. The first kernel must remain
pure and independently testable: it must not become a second saver, read a
Runtime DOM or prematurely switch the existing Canvas and history paths.

## Decision

1. `app/lib/semantic-operation-kernel.js` owns semantic operation schema v1.
   The public kinds are `setText`, `replaceTextRange`, `setAttribute`,
   `setStyle`, `insertElement`, `deleteElement`, `moveElement` and
   `replaceSubtree`. Every operation carries a stable `operationId`, exact base
   revision, expected complete-source Hash and operation-specific preconditions.
2. Element preconditions contain persistent element ID, authored tag and exact
   outer-source Hash. Parent and `before` insertion evidence use the same
   triple. A missing ID, changed subtree, tag migration, stale revision, stale
   source Hash or repeated operation ID fails closed before materialization.
3. The kernel accepts only complete identity-v1 source. It returns complete next
   HTML, before/after Hashes, monotonic revision, lineage entry, allocation
   report, system-derived `identityDelta` and a generated inverse operation.
   Runtime DOM, preview snapshots and browser editing history are never inputs.
4. Semantic intent lowers to an independently replayable SourcePatch plan.
   `applyPatchPlan` re-plans semantic patches from sealed metadata before
   applying them, then retains the existing exact before-bytes, scope and parse
   integrity checks. SourcePatch therefore becomes an internal materializer for
   this kernel without changing the current Canvas call sites in this PR.
5. `replaceTextRange` uses the source-only decoded text map. It preserves inline
   source wrappers but refuses empty selections, unsafe UTF-16 boundaries and
   authored structural boundaries. `setText` replaces the target's complete
   authored content with escaped plain text and therefore intentionally deletes
   descendant source elements.
6. New structural fragments may not supply or clone persistent PageRoot IDs.
   The kernel allocates a new cryptographic ID for every inserted source
   element. `replaceSubtree` retains the target root ID, may change its tag,
   allocates new descendant IDs and refuses identity authored by its caller. Move preserves
   the exact source fragment and every contained ID; cycles and root moves fail
   closed. Delete removes only the exact identified source range.
7. `data-pageroot-id` is protected from ordinary attribute editing. Other HTML,
   CSS and Script source remains user-authorable; this kernel is not a component
   model, layout engine or script classifier.
8. Accepted operations always advance semantic revision and lineage, including
   byte no-ops, so replay remains unambiguous. Generated exact-source inverse
   operations restore authoritative pre-operation bytes and generate a redo.
   These inverses are session-local exact restore values created and consumed
   only by the current open-document history. They are not persistent or
   collaborative semantic commands and cannot be authored by an external
   caller. Closing/switching HTML or restarting discards the at-most-20-entry
   cursor; crash recovery may retain save evidence but never restores history.
9. `HtmlCanvasEditor` now uses the kernel for source edits and forwards complete
   HTML, exact patches, the semantic operation and derived delta through
   `DocumentWorkflow` autosave. Repository independently validates the saved
   transition. AI Candidate and Review remain separate authorities and cannot
   submit semantic inverse or identity-delta claims through this boundary.
10. Public operation structure is documented by
    `schemas/semantic-operation.v1.schema.json`. Source lowering, all eight
    operations, exact inverse/redo, deterministic allocation replay and stale,
    duplicate, target-precondition and tamper rejection are covered by focused
    tests.

## Consequences

- PageRoot has one stable-ID semantic editing contract before any UI migration.
- Source-byte materialization remains exact while product authorization comes
  from the semantic operation and verified identity delta.
- Structural commands are source operations, not Runtime DOM serialization.
- Undo/Redo remains deliberately session-local and bounded rather than a
  durable second history authority.

## Rejected alternatives

- **Serialize the live page.** Script-created nodes and browser normalization
  would become false source authority.
- **Let callers submit exact patches.** A forged range could bypass semantic
  target and insertion preconditions.
- **Allow cloned IDs in inserted HTML.** The kernel could not distinguish a new
  element from an identity transplant.
- **Switch Canvas and persistence in the foundation PR.** That would combine a
  new contract with migration risk and remove the isolated rollback boundary.
